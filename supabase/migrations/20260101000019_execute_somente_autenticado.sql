-- =============================================================================
-- 0019 — Nenhuma RPC pública executável por visitante anônimo
--
-- Achado de auditoria A15: 15 funções SECURITY DEFINER tinham EXECUTE herdado
-- de PUBLIC (e portanto de `anon`). Todas chamam `require_role` e devolviam
-- AUTH_REQUIRED — não havia vazamento —, mas a superfície ficava maior do que
-- o necessário: qualquer falha futura numa checagem seria alcançável sem login.
--
-- Correção: retira EXECUTE de PUBLIC/anon em TODAS as funções do schema public
-- e mantém o privilégio para `authenticated` e `service_role`. Também ajusta os
-- privilégios padrão, para função nova já nascer fechada.
-- =============================================================================

do $$
declare
  f record;
begin
  for f in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as argumentos
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
  loop
    execute format('revoke all on function %I.%I(%s) from public, anon',
                   f.nspname, f.proname, f.argumentos);
    execute format('grant execute on function %I.%I(%s) to authenticated, service_role',
                   f.nspname, f.proname, f.argumentos);
  end loop;
end
$$;

-- Funções criadas depois desta migração seguem a mesma regra.
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public grant execute on functions to authenticated, service_role;
