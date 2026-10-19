-- =============================================================================
-- 0028 — Tempo real para zonas de entrega, horários e funcionários
--
-- Revisão de 19/10/2026 (achado F2). O aplicativo já assinava 17 tabelas, mas
-- três domínios que aparecem em tela aberta ficavam de fora da publicação:
--
--   delivery_fee_zones  — a taxa sugerida no delivery (calculada no navegador)
--   business_hours      — o aviso de aberto/fechado
--   profiles            — a lista de funcionários do administrador
--
-- A consequência era cosmética, porém real: um administrador mudava a zona de
-- entrega e a tela de delivery aberta em outro aparelho continuava mostrando a
-- taxa antiga até alguém recarregar.
--
-- `customers` e `customer_addresses` NÃO entram de propósito: são dados
-- pessoais, a busca é uma ação explícita do operador e o cadastro é conferido no
-- envio do pedido pelo servidor. Publicá-los distribuiria nome, telefone e
-- endereço para todos os aparelhos logados sem ganho operacional.
--
-- Publicar no Realtime não afrouxa permissão: o Supabase entrega os eventos
-- respeitando a RLS de quem está inscrito. Para reverter:
--   alter publication supabase_realtime drop table <tabela>;
-- =============================================================================

do $$
declare
  v_tabela text;
begin
  foreach v_tabela in array array['delivery_fee_zones', 'business_hours', 'profiles']
  loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = v_tabela
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_tabela);
    end if;
  end loop;
end
$$;
