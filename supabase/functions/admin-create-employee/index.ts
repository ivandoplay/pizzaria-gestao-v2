// =============================================================================
// Edge Function: admin-create-employee
// =============================================================================
// Criação e manutenção de funcionários (Supabase Auth) feita SEMPRE no servidor.
//
// Por que aqui: criar usuários exige a chave `service_role`, que NUNCA pode
// existir no navegador. Esta função:
//   1. valida o JWT do chamador (Authorization: Bearer <access_token>);
//   2. confirma no banco que o chamador é administrador ATIVO;
//   3. só então usa `service_role` para criar/redefinir o usuário no Auth.
//
// Ações:
//   { action?: 'create', full_name, login, role, password, email?, phone?, activate? }
//   { action: 'reset_password', login }
//
// O perfil correspondente é criado pelo trigger `on_auth_user_created` da
// migração 0001 e nasce SEMPRE inativo — a ativação é um passo explícito.
//
// Segredos usados (configurados no Supabase, nunca no frontend):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
// -----------------------------------------------------------------------------

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const EMAIL_DOMAIN = 'pizzaria.local'
const ROLES = ['admin', 'manager', 'waiter'] as const
type Role = (typeof ROLES)[number]

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

function fail(message: string, status = 400) {
  return json({ ok: false, error: message }, status)
}

/** Converte o login em e-mail interno (mesma regra do frontend). */
function loginToEmail(login: string): string {
  const clean = login.trim().toLowerCase()
  return clean.includes('@') ? clean : `${clean}@${EMAIL_DOMAIN}`
}

function randomPassword(length = 10): string {
  // Senha temporária legível (sem caracteres ambíguos) — o funcionário deve trocá-la.
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')
}

function isValidLogin(login: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{2,39}$/.test(login)
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (request.method !== 'POST') return fail('Método não permitido.', 405)

  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !anonKey || !serviceKey) {
    return fail('Função mal configurada: variáveis de ambiente do Supabase ausentes.', 500)
  }

  const authorization = request.headers.get('Authorization') ?? ''
  if (!authorization.toLowerCase().startsWith('bearer ')) {
    return fail('AUTH_REQUIRED: envie o token de acesso do usuário.', 401)
  }

  // 1. Quem está chamando?
  const callerClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: caller, error: callerError } = await callerClient.auth.getUser()
  if (callerError || !caller?.user) {
    return fail('AUTH_REQUIRED: token inválido ou expirado.', 401)
  }

  // 2. O chamador é administrador ativo? (checagem no banco, não no cliente)
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('id, role, is_active, full_name')
    .eq('auth_user_id', caller.user.id)
    .maybeSingle()

  if (profileError) return fail(`Falha ao validar o operador: ${profileError.message}`, 500)
  if (!profile) return fail('FORBIDDEN: não existe funcionário vinculado a este usuário.', 403)
  if (!profile.is_active) return fail('FORBIDDEN: o acesso deste funcionário está desativado.', 403)
  if (profile.role !== 'admin') return fail('FORBIDDEN: somente administradores gerenciam funcionários.', 403)

  let payload: Record<string, unknown>
  try {
    payload = (await request.json()) as Record<string, unknown>
  } catch {
    return fail('Corpo da requisição inválido (JSON esperado).')
  }

  const action = (payload.action as string | undefined) ?? 'create'

  // ---------------------------------------------------------------- reset_password
  if (action === 'reset_password') {
    const login = String(payload.login ?? '').trim().toLowerCase()
    if (!isValidLogin(login)) return fail('Login inválido.')

    const { data: target, error: targetError } = await admin
      .from('profiles')
      .select('id, auth_user_id, full_name')
      .eq('login', login)
      .maybeSingle()

    if (targetError) return fail(`Falha ao localizar o funcionário: ${targetError.message}`, 500)
    if (!target) return fail('Funcionário não encontrado.', 404)

    const tempPassword = randomPassword()
    const { error: updateError } = await admin.auth.admin.updateUserById(target.auth_user_id, {
      password: tempPassword,
    })
    if (updateError) return fail(`Falha ao redefinir a senha: ${updateError.message}`, 500)

    // Marca a troca obrigatória de senha no perfil (auditado pelo trigger).
    const { error: flagError } = await admin
      .from('profiles')
      .update({ must_change_password: true })
      .eq('id', target.id)
    if (flagError) return fail(`Senha alterada, mas falhou ao marcar a troca obrigatória: ${flagError.message}`, 500)

    return json({ ok: true, login, temp_password: tempPassword })
  }

  // ---------------------------------------------------------------------- create
  if (action !== 'create') return fail(`Ação desconhecida: ${action}`)

  const fullName = String(payload.full_name ?? '').trim()
  const login = String(payload.login ?? '').trim().toLowerCase()
  const role = String(payload.role ?? '') as Role
  const password = String(payload.password ?? '')
  const phone = payload.phone ? String(payload.phone).trim() : null
  const email = payload.email ? String(payload.email).trim().toLowerCase() : loginToEmail(login)
  const activate = payload.activate === true

  if (fullName.length < 2) return fail('Informe o nome completo do funcionário.')
  if (!isValidLogin(login)) {
    return fail('Login inválido: use de 3 a 40 caracteres (letras minúsculas, números, ponto, hífen ou sublinhado).')
  }
  if (!ROLES.includes(role)) return fail('Função inválida: use admin, manager (caixa) ou waiter (garçom).')
  if (password.length < 8) return fail('A senha inicial deve ter ao menos 8 caracteres.')

  // Login já usado? (evita erro confuso do Auth)
  const { data: existing } = await admin.from('profiles').select('id').eq('login', login).maybeSingle()
  if (existing) return fail('Já existe um funcionário com este login.', 409)

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, login, role, created_by: profile.id },
  })

  if (createError || !created?.user) {
    const message = createError?.message ?? 'erro desconhecido'
    if (/already registered|already exists/i.test(message)) {
      return fail('Já existe um usuário com este e-mail/login.', 409)
    }
    return fail(`Falha ao criar o usuário: ${message}`, 500)
  }

  // O trigger do banco cria o perfil inativo; aqui completamos dados e ativamos.
  const { data: updatedProfile, error: updateProfileError } = await admin
    .from('profiles')
    .update({
      full_name: fullName,
      role,
      phone,
      is_active: activate,
      must_change_password: true,
    })
    .eq('auth_user_id', created.user.id)
    .select('id, login, role, is_active')
    .maybeSingle()

  if (updateProfileError || !updatedProfile) {
    // Não deixamos um usuário órfão no Auth sem avisar o operador.
    return fail(
      `Usuário criado no Auth, mas o perfil não pôde ser atualizado (${
        updateProfileError?.message ?? 'perfil não encontrado'
      }). Verifique o funcionário na lista antes de tentar de novo.`,
      500,
    )
  }

  return json({
    ok: true,
    profile_id: updatedProfile.id,
    login: updatedProfile.login,
    role: updatedProfile.role,
    is_active: updatedProfile.is_active,
    temporary_password_required: true,
  })
})
