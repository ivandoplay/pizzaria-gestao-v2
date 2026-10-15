-- =============================================================================
-- 0009 — TROCA OBRIGATÓRIA DE SENHA (o caminho de volta da flag)
-- =============================================================================
-- Contexto: quem cria um funcionário (ou redefine a senha dele) entra com uma
-- senha TEMPORÁRIA, conhecida pelo administrador, e a coluna
-- `profiles.must_change_password` fica marcada para dizer "esta pessoa precisa
-- escolher uma senha própria".
--
-- Até aqui a flag era só um aviso na tela: nada impedia o funcionário de
-- continuar operando com a senha temporária. E, como só o administrador pode
-- alterar `profiles`, o próprio funcionário não tinha como baixar a flag.
--
-- Esta migração fecha a volta do fluxo: a função abaixo é o ÚNICO caminho para
-- baixar a flag, e cada usuário só baixa a DELE (a função ignora qualquer id
-- recebido e usa sempre o dono da sessão). A troca de senha em si acontece no
-- Auth do Supabase — a senha nunca passa pela tabela `profiles`.
--
-- Sem risco de afrouxar permissão: é uma função nova, concedida apenas a
-- `authenticated`, que não recebe parâmetro nenhum e não devolve dados.
-- Para reverter: drop function public.complete_password_change();
-- =============================================================================

create or replace function public.complete_password_change()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id      uuid := app_private.current_profile_id();
  v_baixou  boolean := false;
begin
  if v_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  -- O `and must_change_password` deixa a operação idempotente: chamar de novo
  -- não gera linha nova nem evento novo de auditoria.
  update public.profiles
     set must_change_password = false,
         updated_at = now()
   where id = v_id
     and must_change_password
  returning true into v_baixou;

  if coalesce(v_baixou, false) then
    perform app_private.log_audit(
      'profile.password_changed',
      'profiles',
      v_id::text,
      null, null, null, null, null,
      jsonb_build_object('origem', 'troca obrigatoria no primeiro acesso')
    );
  end if;
end
$$;

comment on function public.complete_password_change() is
  'Baixa a própria flag `must_change_password` depois que o funcionário definiu a senha definitiva. Só age sobre o dono da sessão.';

-- O Supabase concede EXECUTE a anon/authenticated/service_role em toda função nova
-- de `public` (privilégios padrão do projeto). Por isso o REVOKE precisa citar o
-- `anon` explicitamente: revogar só de `public` deixaria o visitante sem sessão
-- alcançando a função (que responderia AUTH_REQUIRED, mas sem motivo para expor).
revoke all on function public.complete_password_change() from public, anon;
grant execute on function public.complete_password_change() to authenticated;
