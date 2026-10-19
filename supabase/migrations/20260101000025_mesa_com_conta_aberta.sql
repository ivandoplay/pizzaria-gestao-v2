-- =============================================================================
-- 0025 — Mesa com conta aberta não pode ser desativada nem excluída
--
-- Seção 4.7 do prompt mestre: "Não permitir desativar ou excluir uma mesa que
-- tenha conta aberta" e "não perca dados nem histórico" (seção 8 da revisão).
--
-- A tela já desabilitava o interruptor quando a mesa estava ocupada, mas isso
-- é só a interface: a tabela `restaurant_tables` aceita UPDATE direto do
-- administrador pela API (política `restaurant_tables_write`). Uma chamada
-- feita fora da tela — celular com a aba velha, script, erro de sincronização —
-- desativava a mesa com a conta aberta, e o atendimento em andamento ficava
-- órfão do mapa do salão.
--
-- A regra passa a valer no banco:
--
--   * desativar (is_active true -> false) com sessão aberta  -> recusado
--   * excluir uma mesa que já teve qualquer atendimento      -> recusado
--     (histórico é preservado; o caminho é desativar)
--
-- Renomear, corrigir lugares ou reativar continuam liberados, inclusive com a
-- conta aberta: nada disso muda a operação da mesa.
-- =============================================================================

create or replace function app_private.protect_table_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.table_sessions s where s.table_id = old.id) then
      raise exception
        'TABLE_HAS_HISTORY: esta mesa já tem atendimentos registrados; desative em vez de excluir'
        using errcode = '55006';
    end if;
    return old;
  end if;

  if new.is_active is false and coalesce(old.is_active, true) is true then
    if exists (
      select 1 from public.table_sessions s
       where s.table_id = new.id and s.status = 'open'
    ) then
      raise exception
        'TABLE_HAS_OPEN_ACCOUNT: feche a conta desta mesa antes de desativá-la'
        using errcode = '55006';
    end if;
  end if;

  return new;
end
$$;

comment on function app_private.protect_table_lifecycle() is
  'Impede desativar mesa com conta aberta e excluir mesa com histórico (seção 4.7).';

drop trigger if exists protect_table_lifecycle on public.restaurant_tables;
create trigger protect_table_lifecycle
  before update or delete on public.restaurant_tables
  for each row execute function app_private.protect_table_lifecycle();

revoke all on function app_private.protect_table_lifecycle() from public;
