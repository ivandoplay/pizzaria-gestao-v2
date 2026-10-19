-- =============================================================================
-- 17_realtime_cardapio.sql — cardápio/configurações publicados (A18)
-- =============================================================================

do $$
declare
  v_tabela text;
  v_faltando text[] := '{}';
begin
  foreach v_tabela in array array[
    'products', 'product_variants', 'product_sizes', 'categories',
    'modifier_groups', 'modifier_options', 'product_modifier_groups',
    'business_settings', 'payment_methods'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = v_tabela
    ) then
      v_faltando := v_faltando || v_tabela;
    end if;
  end loop;

  perform tests.ok(cardinality(v_faltando) = 0,
    'todas as tabelas de cardápio/configuração estão na publicação de realtime');

  -- As de operação continuam publicadas (não houve regressão).
  perform tests.ok(exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'),
    'orders continua publicada');
end
$$;
