-- =============================================================================
-- 0022 — Fechamento de caixa idempotente (fecha a pendência do A2)
--
-- O A2 tratou a chave de idempotência da abertura e das movimentações, mas o
-- FECHAMENTO ficou sem proteção: se a resposta se perdesse (rede caindo no
-- balcão, operador tocando duas vezes), a segunda chamada recebia
-- CASH_SESSION_CLOSED e não havia como saber se o fechamento anterior valeu.
--
-- Aqui a idempotência é POR CONTEÚDO, e não por UUID, porque `client_uuid` da
-- sessão já pertence à ABERTURA (é ela que garante que o clique duplo não abre
-- dois turnos). Regra nova:
--
--   * caixa já fechado + mesma contagem + mesma observação + mesma
--     justificativa  -> devolve o fechamento gravado (repetição da operação);
--   * caixa já fechado + conteúdo diferente -> continua sendo erro de negócio
--     (CASH_SESSION_CLOSED): ninguém "reabre e fecha de novo" por engano.
--
-- A assinatura não muda, então nada quebra em quem já chama a função.
-- =============================================================================

create or replace function public.close_cash_session(
  p_session_id        uuid,
  p_counted_cash_cents integer,
  p_note              text default null,
  p_variance_reason   text default null
)
returns public.cash_sessions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile  public.profiles;
  v_session  public.cash_sessions;
  v_settings public.business_settings;
  v_expected integer;
  v_diff     integer;
  v_reason   text;
  v_nota     text;
begin
  v_profile := app_private.require_role('admin', 'manager');

  if p_counted_cash_cents is null or p_counted_cash_cents < 0 then
    raise exception 'INVALID_AMOUNT: informe o valor contado na gaveta' using errcode = '22023';
  end if;

  select cs.* into v_session from public.cash_sessions cs where cs.id = p_session_id for update;
  if not found then
    raise exception 'CASH_SESSION_NOT_FOUND' using errcode = '22023';
  end if;

  v_nota := nullif(btrim(coalesce(p_note, '')), '');
  v_reason := nullif(btrim(coalesce(p_variance_reason, '')), '');

  if v_session.status <> 'open' then
    -- Repetição da MESMA operação: devolve o fechamento como está gravado.
    if v_session.counted_cash_cents = p_counted_cash_cents
       and coalesce(v_session.closing_note, '') = coalesce(v_nota, '')
       and coalesce(v_session.variance_reason, '') = coalesce(v_reason, '') then
      return v_session;
    end if;
    raise exception 'CASH_SESSION_CLOSED: este caixa já foi fechado' using errcode = '55006';
  end if;

  -- Caixa só fecha a própria sessão; administrador pode fechar qualquer uma.
  if v_profile.role <> 'admin' and v_session.opened_by <> v_profile.id then
    raise exception 'FORBIDDEN: somente o responsável pelo caixa (ou um administrador) pode fechá-lo'
      using errcode = '42501';
  end if;

  select * into v_settings from public.business_settings where id;

  -- O saldo esperado considera SOMENTE dinheiro físico:
  -- abertura + entradas - saídas. Pix/cartões nunca entram na gaveta.
  select v_session.opening_amount_cents
         + coalesce(sum(case when m.kind = 'in' then m.amount_cents else -m.amount_cents end), 0)
  into v_expected
  from public.cash_movements m
  where m.cash_session_id = v_session.id;

  v_diff := p_counted_cash_cents - v_expected;

  if v_diff <> 0 and abs(v_diff) > v_settings.cash_variance_tolerance_cents and v_reason is null then
    raise exception 'VARIANCE_REASON_REQUIRED: há divergência de R$ %; informe a justificativa',
      to_char(abs(v_diff)::numeric / 100, 'FM999990.00') using errcode = '22023';
  end if;

  update public.cash_sessions cs
     set status              = 'closed',
         closed_by           = v_profile.id,
         closed_at           = now(),
         expected_cash_cents = v_expected,
         counted_cash_cents  = p_counted_cash_cents,
         difference_cents    = v_diff,
         closing_note        = v_nota,
         variance_reason     = v_reason
   where cs.id = v_session.id
  returning * into v_session;

  perform app_private.log_audit(
    'cash_session.close', 'cash_sessions', v_session.id::text, null, null, v_session.id,
    v_diff, v_reason,
    jsonb_build_object(
      'opening_cents', v_session.opening_amount_cents,
      'expected_cents', v_expected,
      'counted_cents', p_counted_cash_cents,
      'difference_cents', v_diff
    )
  );

  return v_session;
end
$$;
