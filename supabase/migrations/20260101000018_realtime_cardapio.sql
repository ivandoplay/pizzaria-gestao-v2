-- =============================================================================
-- 0018 — Cardápio e configurações também propagam em tempo real
--
-- Achado de auditoria A18: o cliente já tinha o balde `catalog` em
-- `useRealtimeSync`, mas NENHUMA tabela de cardápio estava na publicação
-- `supabase_realtime`. Resultado: preço/produto alterado no administrador só
-- aparecia nos outros aparelhos após recarregar a página.
--
-- Esta migração publica as tabelas que formam o cardápio e as duas que mudam o
-- comportamento da operação (configurações e formas de pagamento). As tabelas
-- de operação já eram publicadas na 0006.
-- =============================================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    'products', 'product_variants', 'product_sizes', 'categories',
    'modifier_groups', 'modifier_options', 'product_modifier_groups',
    'business_settings', 'payment_methods'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;
