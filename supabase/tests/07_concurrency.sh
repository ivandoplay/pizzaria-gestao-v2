#!/usr/bin/env bash
# =============================================================================
# TESTE 07 — CONCORRÊNCIA REAL (duas conexões simultâneas de verdade)
#
# Simula dois usuários agindo no mesmo instante, mantendo uma transação aberta
# enquanto a outra tenta a mesma operação:
#   1. abrir atendimento na mesma mesa;
#   2. registrar o mesmo pagamento (idempotência por client_uuid);
#   3. fechar a mesma conta.
#
# Requer o banco de teste já migrado, com seed estrutural e tests/00_setup.sql
# aplicados (o runner tools/run-sql-tests.sh cuida disso).
# Uso:  bash supabase/tests/07_concurrency.sh
# =============================================================================
set -uo pipefail
DB="${DB:-pizzaria_test}"
FAILED=0

# Mesmo ajuste do runner: na esteira a conexão é direta (usuário e senha).
# shellcheck disable=SC2086
SUDO_PG="${PSQL_SUDO-sudo -u postgres}"

q() { $SUDO_PG psql -q -t -A -v ON_ERROR_STOP=1 -d "$DB" -c "$1" 2>&1; }
ok()   { echo "  OK  $1"; }
fail() { echo "  FALHOU  $1"; FAILED=1; }

# Mesa usada no teste: a última, para não colidir com os outros arquivos.
ABERTAS_ANTES=$(q "select count(*) from public.table_sessions where status = 'open'")

TABELA=$(q "select id from public.restaurant_tables order by number desc limit 1")
if [ -z "$TABELA" ]; then echo "banco sem mesas — rode o seed estrutural"; exit 1; fi

# -----------------------------------------------------------------------------
echo "-- 07.1 duas aberturas simultâneas na mesma mesa --"
# Sessão A (gisele) abre o atendimento e segura a transação por 3s.
(
  q "select tests.login('gisele.garcom');
     begin;
     select public.open_table_session('$TABELA'::uuid, 2::smallint, null,
       '00000000-0000-0000-0000-0000000c0001'::uuid);
     select pg_sleep(3);
     commit;" > /tmp/conc_a1.log 2>&1
) &
A_PID=$!
sleep 1

# Sessão B (gabriel) tenta a MESMA mesa enquanto A ainda está aberta.
B_OUT=$(q "select tests.login('gabriel.garcom');
           select public.open_table_session('$TABELA'::uuid, 4::smallint, null,
             '00000000-0000-0000-0000-0000000c0002'::uuid);")
wait $A_PID

if grep -q "TABLE_ALREADY_OPEN" <<<"$B_OUT"; then
  ok "segunda abertura simultânea foi bloqueada (TABLE_ALREADY_OPEN)"
else
  fail "segunda abertura simultânea NÃO foi bloqueada: $B_OUT"
fi

SESSOES=$(q "select count(*) from public.table_sessions
             where table_id = '$TABELA'::uuid and status = 'open'")
if [ "$SESSOES" = "1" ]; then
  ok "existe exatamente 1 atendimento aberto na mesa (nenhum duplicado)"
else
  fail "atendimentos abertos na mesma mesa = $SESSOES (esperado 1)"
fi

# O client_uuid repetido na segunda tentativa não pode ter criado sessão extra.
EXTRA=$(q "select count(*) from public.table_sessions
           where client_uuid = '00000000-0000-0000-0000-0000000c0002'")
if [ "$EXTRA" = "0" ]; then
  ok "a tentativa recusada não deixou sessão órfã"
else
  fail "tentativa recusada criou $EXTRA sessão(ões)"
fi

# -----------------------------------------------------------------------------
echo "-- 07.2 mesmo recebimento enviado duas vezes ao mesmo tempo --"
SESSION_A=$(q "select id from public.table_sessions
               where table_id = '$TABELA'::uuid and status = 'open'")

# Caixa aberto para poder receber (idempotente: só abre se não houver turno)
q "select tests.login('carlos.caixa');
   select case when not exists (select 1 from public.cash_sessions where status = 'open')
               then public.start_cash_session(10000, null, null) end;" > /dev/null

ORDER=$(q "select tests.login('carlos.caixa');
           select (public.create_order(jsonb_build_object(
             'service_mode','dine_in',
             'table_session_id','$SESSION_A',
             'items', jsonb_build_array(jsonb_build_object(
               'product_id',(select drink from tests.fx),
               'variant_id',(select variant_drink_un from tests.fx),
               'quantity',2)),
             'client_uuid','00000000-0000-0000-0000-0000000c0010'
           ))::public.orders).id" | tail -1)

VALOR=$(q "select total_cents from public.orders where id = '$ORDER'")
if [ "$VALOR" = "1400" ]; then
  ok "pedido criado no atendimento concorrente (2 x refrigerante = 1400)"
else
  fail "total inesperado do pedido: $VALOR"
fi

(
  q "select tests.login('carlos.caixa');
     begin;
     select public.register_payment('$ORDER'::uuid, 'cash', 1400, 2000, false, null,
              '00000000-0000-0000-0000-0000000c0003'::uuid);
     select pg_sleep(3);
     commit;" > /tmp/conc_a2.log 2>&1
) &
A_PID=$!
sleep 1

B_OUT=$(q "select tests.login('carlos.caixa');
           select public.register_payment('$ORDER'::uuid, 'cash', 1400, 2000, false, null,
                    '00000000-0000-0000-0000-0000000c0003'::uuid);")
wait $A_PID

PAY_COUNT=$(q "select count(*) from public.payments
               where client_uuid = '00000000-0000-0000-0000-0000000c0003'")
PAID=$(q "select paid_cents from public.orders where id = '$ORDER'")
TROCO=$(q "select coalesce(sum(change_cents), 0) from public.payments
           where client_uuid = '00000000-0000-0000-0000-0000000c0003'")

if [ "$PAY_COUNT" = "1" ] && [ "$PAID" = "1400" ] && [ "$TROCO" = "600" ]; then
  ok "clique duplo simultâneo gerou 1 único recebimento de 1400 (troco 600 registrado uma vez)"
else
  fail "recebimentos=$PAY_COUNT, pago=$PAID, troco=$TROCO — possível duplicidade: $B_OUT"
fi

# -----------------------------------------------------------------------------
echo "-- 07.3 fechamento simultâneo da mesma conta --"
(
  q "select tests.login('carlos.caixa');
     begin;
     select public.close_table_account('$SESSION_A'::uuid);
     select pg_sleep(3);
     commit;" > /tmp/conc_a3.log 2>&1
) &
A_PID=$!
sleep 1

B_OUT=$(q "select tests.login('carlos.caixa');
           select public.close_table_account('$SESSION_A'::uuid);")
wait $A_PID

if grep -qE "SESSION_NOT_OPEN|BALANCE_PENDING|ACCOUNT_ALREADY_CLOSED" <<<"$B_OUT"; then
  ok "segundo fechamento simultâneo foi recusado ($(grep -oE 'SESSION_NOT_OPEN|BALANCE_PENDING|ACCOUNT_ALREADY_CLOSED' <<<"$B_OUT" | head -1))"
else
  fail "fechamento duplicado não foi bloqueado: $B_OUT"
fi

CLOSED=$(q "select count(*) from public.table_sessions where id = '$SESSION_A'::uuid and status = 'closed'")
AUDITORIAS=$(q "select count(*) from public.audit_logs
                where action = 'table_account.close' and entity_id = '$SESSION_A'")
if [ "$CLOSED" = "1" ] && [ "$AUDITORIAS" = "1" ]; then
  ok "conta fechada exatamente uma vez e auditada uma única vez"
else
  fail "sessão fechada=$CLOSED, eventos de fechamento=$AUDITORIAS (esperado 1 e 1)"
fi

# -----------------------------------------------------------------------------
echo "-- 07.4 estado final coerente --"
STATUS=$(q "select status from public.table_overview where id = '$TABELA'::uuid")
if [ "$STATUS" = "available" ]; then
  ok "mesa volta a ficar disponível após o fechamento"
else
  fail "mesa com estado inesperado: $STATUS"
fi

CAIXAS=$(q "select count(*) from public.cash_sessions where status = 'open'")
if [ "$CAIXAS" = "1" ]; then
  ok "continua existindo um único caixa aberto"
else
  fail "caixas abertos = $CAIXAS (esperado 1)"
fi

ABERTAS=$(q "select count(*) from public.table_sessions where status = 'open'")
if [ "$ABERTAS" = "$ABERTAS_ANTES" ]; then
  ok "o teste de concorrência não deixou atendimento aberto sobrando ($ABERTAS antes, $ABERTAS depois)"
else
  fail "atendimentos abertos: $ABERTAS_ANTES antes, $ABERTAS depois"
fi

echo
if [ "$FAILED" = "0" ]; then echo "07_concurrency: TUDO OK"; else echo "07_concurrency: HÁ FALHAS"; fi
exit "$FAILED"
