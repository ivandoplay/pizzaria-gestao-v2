-- =============================================================================
-- 0013 — Salvar preços do cardápio em lote, sem zerar e sem reativar tamanho
--
-- Achado de auditoria A3: o botão “Salvar preços” percorria TODOS os tamanhos.
-- Campo em branco virava `parseMoneyToCents('') = 0` e o banco aceita
-- `price_cents >= 0`; além disso o cliente enviava `is_available: true` em toda
-- linha, reativando tamanho que estava escondido. Se uma gravação falhasse no
-- meio do laço, o preço do produto ficava pela metade.
--
-- Esta migração cria `set_product_prices`, que faz o lote em UMA transação:
--   * campo vazio nem chega ao banco (a tela só envia o que mudou);
--   * preço precisa ser maior que zero (não existe “preço zero” de venda);
--   * `is_available` NÃO é tocado no update — esconder um tamanho continua
--     sendo uma decisão separada, feita onde ela existe;
--   * o lote é atômico: ou todos os preços entram, ou nenhum entra.
--
-- Quem pode chamar: administrador (a tela de cardápio já é rota de admin e as
-- políticas de escrita das tabelas de cardápio exigem admin).
-- =============================================================================

create or replace function public.set_product_prices(
  p_product_id uuid,
  p_prices     jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles;
  v_item    record;
  v_count   integer := 0;
begin
  v_profile := app_private.require_role('admin');

  if p_product_id is null then
    raise exception 'PRODUCT_REQUIRED: informe o produto' using errcode = '22023';
  end if;
  if p_prices is null or jsonb_typeof(p_prices) <> 'array' then
    raise exception 'INVALID_PRICES: informe uma lista de preços' using errcode = '22023';
  end if;
  if not exists (select 1 from public.products p where p.id = p_product_id) then
    raise exception 'PRODUCT_NOT_FOUND: produto inexistente' using errcode = '22023';
  end if;

  for v_item in
    select *
      from jsonb_to_recordset(p_prices) as x(size_id uuid, price_cents integer)
  loop
    if v_item.size_id is null then
      raise exception 'INVALID_PRICES: tamanho não informado' using errcode = '22023';
    end if;
    if v_item.price_cents is null or v_item.price_cents <= 0 then
      raise exception 'INVALID_PRICE: o preço do tamanho % precisa ser maior que zero', v_item.size_id
        using errcode = '22023';
    end if;
    if not exists (select 1 from public.product_sizes s where s.id = v_item.size_id) then
      raise exception 'SIZE_NOT_FOUND: tamanho inexistente' using errcode = '22023';
    end if;

    insert into public.product_variants (product_id, size_id, price_cents, is_available)
    values (p_product_id, v_item.size_id, v_item.price_cents, true)
    on conflict (product_id, size_id) do update
      set price_cents = excluded.price_cents,
          updated_at  = now();
    -- Importante: `is_available` não aparece no UPDATE. Um tamanho escondido
    -- continua escondido; reativar é uma ação explícita.

    v_count := v_count + 1;
  end loop;

  perform app_private.log_audit(
    'menu.prices.update', 'products', p_product_id::text, null, null, null, null, null,
    jsonb_build_object('prices', p_prices, 'updated_count', v_count)
  );

  return v_count;
end
$$;

revoke all on function public.set_product_prices(uuid, jsonb) from public, anon;
grant execute on function public.set_product_prices(uuid, jsonb) to authenticated, service_role;
