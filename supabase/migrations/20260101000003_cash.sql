-- =============================================================================
-- 0003 — CONTROLE DE CAIXA: sessões (turnos) e movimentações
--
-- Conceitos:
--   * cash_sessions  = turno de caixa (abertura -> fechamento). Apenas UMA
--     sessão aberta por vez (índice único parcial).
--   * cash_movements = entradas/saídas de DINHEIRO FÍSICO na gaveta.
--       - Manuais: reforço de troco, sangria, despesa, ajuste (lançadas por
--         admin/caixa via RPC add_cash_movement).
--       - Automáticas: recebimentos em dinheiro (categoria 'sale'), criadas
--         pelo RPC register_payment. Pix/cartão NÃO entram na gaveta.
--   * O troco não é receita: o movimento automático registra o valor líquido
--     retido (payment.amount_cents), nunca o valor entregue pelo cliente.
-- =============================================================================

create table if not exists public.cash_sessions (
  id                    uuid primary key default gen_random_uuid(),
  opened_by             uuid not null references public.profiles (id) on delete restrict,
  opened_at             timestamptz not null default now(),
  opening_amount_cents  integer not null default 0 check (opening_amount_cents >= 0),
  opening_note          text,
  status                text not null default 'open' check (status in ('open', 'closed')),
  closed_by             uuid references public.profiles (id) on delete restrict,
  closed_at             timestamptz,
  -- Snapshots do fechamento (não recalculados depois):
  expected_cash_cents   integer check (expected_cash_cents is null or expected_cash_cents >= 0),
  counted_cash_cents    integer check (counted_cash_cents is null or counted_cash_cents >= 0),
  difference_cents      integer,
  closing_note          text,
  variance_reason       text,
  created_at            timestamptz not null default now(),
  -- Idempotência da abertura (clique repetido não abre duas sessões).
  client_uuid           uuid unique,
  constraint cash_sessions_closed_consistency check (
    (status = 'open' and closed_at is null and counted_cash_cents is null)
    or
    (status = 'closed' and closed_at is not null and counted_cash_cents is not null and expected_cash_cents is not null and difference_cents is not null)
  )
);

-- Somente uma sessão de caixa aberta por vez (regra operacional padrão).
create unique index if not exists cash_sessions_single_open_idx
  on public.cash_sessions ((status)) where status = 'open';

create index if not exists cash_sessions_opened_idx on public.cash_sessions (opened_at desc);

create table if not exists public.cash_movements (
  id              uuid primary key default gen_random_uuid(),
  cash_session_id uuid not null references public.cash_sessions (id) on delete restrict,
  kind            text not null check (kind in ('in', 'out')),
  category        text not null check (category in (
                    'change_fund',   -- reforço de troco (in)
                    'withdrawal',    -- sangria / retirada (out)
                    'expense',       -- despesa operacional paga na gaveta (out)
                    'adjustment',    -- ajuste autorizado (in/out)
                    'sale',          -- recebimento em dinheiro de venda (in, automático)
                    'receipt'        -- recebimento avulso / quitação (in, automático)
                  )),
  source          text not null default 'manual' check (source in ('manual', 'automatic')),
  amount_cents    integer not null check (amount_cents > 0),
  description     text,
  reason          text,
  payment_id      uuid,          -- FK adicionada na migração de pagamentos
  order_id        uuid,          -- FK adicionada na migração de operações
  created_by      uuid not null references public.profiles (id) on delete restrict,
  created_at      timestamptz not null default now(),
  -- Idempotência para chamadas repetidas do aplicativo.
  client_uuid     uuid unique,
  constraint cash_movements_auto_has_payment
    check (source = 'manual' or payment_id is not null),
  constraint cash_movements_sale_is_in
    check (category <> 'sale' or kind = 'in'),
  constraint cash_movements_withdrawal_is_out
    check (category <> 'withdrawal' or kind = 'out'),
  constraint cash_movements_expense_is_out
    check (category <> 'expense' or kind = 'out')
);

create index if not exists cash_movements_session_idx on public.cash_movements (cash_session_id, created_at);
create index if not exists cash_movements_category_idx on public.cash_movements (category, created_at desc);

drop trigger if exists audit_cash_sessions on public.cash_sessions;
create trigger audit_cash_sessions
  after insert or update or delete on public.cash_sessions
  for each row execute function app_private.audit_trigger();

drop trigger if exists audit_cash_movements on public.cash_movements;
create trigger audit_cash_movements
  after insert or update or delete on public.cash_movements
  for each row execute function app_private.audit_trigger();
