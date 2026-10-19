-- =============================================================================
-- 12_precos_em_lote.sql — “Salvar preços” não zera, não reativa e é atômico
-- =============================================================================
-- Regressão do achado A3 da auditoria de 17/10/2026:
--   * campo em branco virava R$ 0,00 no cliente;
--   * toda linha era enviada com is_available = true, reativando tamanho
--     escondido;
--   * o laço de upserts não era atômico.
-- =============================================================================

do $$
declare
  v_fx     record;
  v_qtd    integer;
begin
  select * into v_fx from tests.fx;

  perform tests.login('ana.admin');

  -- Esconde o tamanho P da Pizza Teste A (situação que o “Salvar preços”
  -- antigo desfazia sem avisar).
  update public.product_variants
     set is_available = false
   where product_id = v_fx.pizza_a and size_id = v_fx.size_p;
  perform tests.eq_bool(
    (select is_available from public.product_variants
      where product_id = v_fx.pizza_a and size_id = v_fx.size_p),
    false, 'tamanho P começa escondido');

  -- Salva UM preço (só o que mudou). O tamanho G não é enviado.
  v_qtd := public.set_product_prices(
    v_fx.pizza_a,
    jsonb_build_array(jsonb_build_object('size_id', v_fx.size_p, 'price_cents', 3500))
  );
  perform tests.eq_int(v_qtd, 1, 'lote atualiza exatamente o preço enviado');
  perform tests.eq_int(
    (select price_cents from public.product_variants
      where product_id = v_fx.pizza_a and size_id = v_fx.size_p),
    3500, 'preço do tamanho P foi atualizado');
  perform tests.eq_bool(
    (select is_available from public.product_variants
      where product_id = v_fx.pizza_a and size_id = v_fx.size_p),
    false, 'salvar preço NÃO reativa o tamanho escondido');
  perform tests.eq_int(
    (select price_cents from public.product_variants
      where product_id = v_fx.pizza_a and size_id = v_fx.size_g),
    5000, 'tamanho não enviado mantém o preço');

  -- Preço zero é recusado (não existe preço de venda zero).
  perform tests.expect_error(
    format($sql$select public.set_product_prices(%L, %L::jsonb)$sql$,
           v_fx.pizza_a,
           jsonb_build_array(jsonb_build_object('size_id', v_fx.size_p, 'price_cents', 0))::text),
    'INVALID_PRICE', 'preço zero é recusado');

  -- Lote com um item válido e outro inválido não grava NADA (atomicidade).
  perform tests.expect_error(
    format($sql$select public.set_product_prices(%L, %L::jsonb)$sql$,
           v_fx.pizza_a,
           jsonb_build_array(
             jsonb_build_object('size_id', v_fx.size_g, 'price_cents', 9000),
             jsonb_build_object('size_id', v_fx.size_p, 'price_cents', -1)
           )::text),
    'INVALID_PRICE', 'lote inválido é recusado');
  perform tests.eq_int(
    (select price_cents from public.product_variants
      where product_id = v_fx.pizza_a and size_id = v_fx.size_g),
    5000, 'o item válido do lote inválido não foi gravado (tudo ou nada)');

  -- Tamanho inexistente também recusa o lote inteiro.
  perform tests.expect_error(
    format($sql$select public.set_product_prices(%L, %L::jsonb)$sql$,
           v_fx.pizza_a,
           jsonb_build_array(
             jsonb_build_object('size_id', gen_random_uuid(), 'price_cents', 1000)
           )::text),
    'SIZE_NOT_FOUND', 'tamanho inexistente é recusado');

  -- Um preço novo pode ser criado (tamanho UN ainda não tinha preço).
  v_qtd := public.set_product_prices(
    v_fx.pizza_a,
    jsonb_build_array(jsonb_build_object('size_id', v_fx.size_un, 'price_cents', 1000))
  );
  perform tests.eq_int(v_qtd, 1, 'preço novo é criado');
  perform tests.eq_bool(
    (select is_available from public.product_variants
      where product_id = v_fx.pizza_a and size_id = v_fx.size_un),
    true, 'preço novo nasce disponível');

  -- Lote vazio é no-op, não erro.
  perform tests.eq_int(public.set_product_prices(v_fx.pizza_a, '[]'::jsonb), 0,
    'lote vazio não grava nada');

  perform tests.logout();
end
$$;

-- --------------------------------------------------- caixa e garçom não podem
do $$
declare
  v_fx record;
begin
  select * into v_fx from tests.fx;

  perform tests.login('carlos.caixa');
  perform tests.expect_error(
    format($sql$select public.set_product_prices(%L, %L::jsonb)$sql$,
           v_fx.pizza_a,
           jsonb_build_array(jsonb_build_object('size_id', v_fx.size_p, 'price_cents', 1234))::text),
    'FORBIDDEN', 'caixa não altera preço');
  perform tests.logout();

  perform tests.login('gisele.garcom');
  perform tests.expect_error(
    format($sql$select public.set_product_prices(%L, %L::jsonb)$sql$,
           v_fx.pizza_a,
           jsonb_build_array(jsonb_build_object('size_id', v_fx.size_p, 'price_cents', 1234))::text),
    'FORBIDDEN', 'garçom não altera preço');
  perform tests.logout();

  perform tests.login_anon();
  perform tests.expect_error(
    format($sql$select public.set_product_prices(%L, %L::jsonb)$sql$,
           v_fx.pizza_a,
           jsonb_build_array(jsonb_build_object('size_id', v_fx.size_p, 'price_cents', 1234))::text),
    'permission denied', 'anônimo não executa a função');
  perform tests.logout();
end
$$;
