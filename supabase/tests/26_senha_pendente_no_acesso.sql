-- =============================================================================
-- 26_senha_pendente_no_acesso.sql — a flag vale também nas tabelas (achado R1)
--
-- A revisão externa de 20/10 mostrou que a 0020 só fechou as RPCs: com a flag
-- ligada, o operador continuava lendo o cardápio/pedidos e escrevendo direto
-- nas tabelas pelas políticas de RLS. Este arquivo prova o antes (o que a 0027
-- corrige) e o depois, sem depender de nenhum arquivo anterior.
-- =============================================================================

do $$
declare
  v_caixa  text := 'carlos.caixa';
  v_admin  text := 'ana.admin';
  v_linhas bigint;
begin
  -- ---------------------------------------------------------------- preparação
  perform tests.login(v_admin);
  update public.profiles set must_change_password = true where login = v_caixa;
  perform tests.logout();

  perform tests.login(v_caixa);

  -- ------------------------------------------------- leitura: fechada pela flag
  select count(*) into v_linhas from public.products;
  perform tests.eq_int(v_linhas, 0, 'cardápio não é lido com senha temporária');

  select count(*) into v_linhas from public.categories;
  perform tests.eq_int(v_linhas, 0, 'categorias não são lidas com senha temporária');

  select count(*) into v_linhas from public.orders;
  perform tests.eq_int(v_linhas, 0, 'pedidos não são lidos com senha temporária');

  select count(*) into v_linhas from public.restaurant_tables;
  perform tests.eq_int(v_linhas, 0, 'mesas não são lidas com senha temporária');

  select count(*) into v_linhas from public.payments;
  perform tests.eq_int(v_linhas, 0, 'recebimentos não são lidos com senha temporária');

  -- O próprio perfil continua legível: é o que deixa a tela de troca de senha
  -- mostrar quem está logado (sem isso, o operador ficaria preso em "Carregando").
  select count(*) into v_linhas from public.profiles where login = v_caixa;
  perform tests.eq_int(v_linhas, 1, 'o próprio perfil continua legível para a troca de senha');

  -- ----------------------------------------------- escrita direta: fechada
  -- `customers` é a tabela em que o gerente tem INSERT direto pela política
  -- `customers_insert` (is_manager). Antes da 0027, quem estava com a senha
  -- temporária continuava criando/alterando cliente por aqui.
  perform tests.expect_denied(
    format($sql$insert into public.customers (name, phone)
                 values ('Cliente com senha pendente', '86999990000')$sql$),
    'cliente não é criado direto com senha temporária');

  perform tests.assert_blocked_write(
    format('update public.customers set notes = notes where phone_digits = %L', '86999990000'),
    'cliente não é alterado direto com senha temporária');

  -- ------------------------------------------------ RPC: continua fechada (0020)
  perform tests.expect_error(
    format($sql$select public.start_cash_session(0, 'senha temporária')$sql$),
    'PASSWORD_CHANGE_REQUIRED', 'RPC segue fechada com senha temporária');

  -- ------------------------------------------------------ o caminho de saída
  perform public.complete_password_change();
  perform tests.eq_bool(
    (select must_change_password from public.profiles where login = v_caixa),
    false, 'a troca de senha baixa a flag mesmo com as tabelas fechadas');

  -- ------------------------------------------- depois da troca, tudo reabre
  select count(*) into v_linhas from public.products;
  perform tests.ok(v_linhas > 0, 'cardápio volta a ser lido depois da troca');

  select count(*) into v_linhas from public.restaurant_tables;
  perform tests.ok(v_linhas > 0, 'mesas voltam a ser lidas depois da troca');

  -- A escrita volta a passar (o gerente volta a cadastrar cliente).
  execute $sql$insert into public.customers (name, phone)
               values ('Cliente depois da troca', '86999990000')$sql$;
  get diagnostics v_linhas = row_count;
  perform tests.eq_int(v_linhas, 1, 'cliente volta a ser criado depois da troca');

  perform tests.eq_bool(public.cash_session_is_open(), true,
    'RPC volta a responder depois da troca');
  perform tests.logout();

  -- ------------------------------------------------------------- não regressão
  -- Administrador sem flag e garçom sem flag seguem vendo o cardápio.
  perform tests.login(v_admin);
  select count(*) into v_linhas from public.products;
  perform tests.ok(v_linhas > 0, 'administrador sem flag segue lendo o cardápio');
  perform tests.logout();

  perform tests.login('gisele.garcom');
  select count(*) into v_linhas from public.products;
  perform tests.ok(v_linhas > 0, 'garçom sem flag segue lendo o cardápio');
  perform tests.logout();

  -- Limpeza: não deixar cliente de teste para os arquivos seguintes.
  delete from public.customers where phone_digits = '86999990000';
end
$$;
