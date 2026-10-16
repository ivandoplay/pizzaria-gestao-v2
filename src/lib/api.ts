import { supabase } from './supabase'
import type {
  BusinessSettings,
  CartItem,
  CashMovement,
  CashSession,
  CashSessionOverview,
  Category,
  Customer,
  CustomerAddress,
  DeliveryFeeZone,
  FinancialSummary,
  ModifierGroup,
  ModifierOption,
  OrderItemOverview,
  OrderOverview,
  OrderStatus,
  Payment,
  PaymentMethod,
  Product,
  ProductSize,
  ProductVariant,
  Profile,
  Role,
  SalesSeriesPoint,
  TableOverview,
  TopProduct,
} from './types'

/** Erro com a mensagem crua do banco — a tradução é feita em lib/errors. */
export class ApiError extends Error {
  code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.code = code
  }
}

function unwrap<T>(data: T | null, error: { message: string; code?: string } | null): T {
  if (error) throw new ApiError(error.message, error.code)
  if (data === null) throw new ApiError('Resposta vazia do servidor')
  return data
}

// ===========================================================================
// AUTENTICAÇÃO
// ===========================================================================
/** O acesso é feito pelo LOGIN do funcionário; o e-mail interno é derivado dele. */
export function loginToEmail(login: string): string {
  const clean = login.trim().toLowerCase()
  return clean.includes('@') ? clean : `${clean}@pizzaria.local`
}

export async function signIn(login: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: loginToEmail(login),
    password,
  })
  if (error) throw new ApiError(error.message)
  return data
}

export async function signOut() {
  await supabase.auth.signOut()
}

/**
 * Troca obrigatória de senha (primeiro acesso com senha temporária).
 *
 * São três passos e a ordem importa:
 *   1. entrar de novo com a senha ATUAL — sem isso, quem achasse o aparelho
 *      aberto trocaria a senha sem saber a antiga;
 *   2. gravar a senha nova no Auth (a senha nunca passa pelo banco);
 *   3. avisar o banco para baixar a flag `must_change_password` (RPC que só
 *      mexe no próprio perfil e registra o evento na auditoria).
 *
 * Se o passo 2 falhar, a flag continua de pé: o operador tenta de novo.
 */
export async function definirSenhaDefinitiva(email: string, senhaAtual: string, novaSenha: string): Promise<void> {
  // Os códigos crus do Auth viram códigos do sistema, para que lib/errors
  // mostre uma frase em português em vez do texto em inglês do Supabase.
  const { error: erroDeLogin } = await supabase.auth.signInWithPassword({ email, password: senhaAtual })
  if (erroDeLogin) throw new ApiError('SENHA_ATUAL_INCORRETA', erroDeLogin.code)

  const { error: erroDeTroca } = await supabase.auth.updateUser({ password: novaSenha })
  if (erroDeTroca) {
    const codigo = erroDeTroca.code
    const fraca = codigo === 'weak_password' || codigo === 'same_password' || /weak|same password/i.test(erroDeTroca.message)
    throw new ApiError(fraca ? 'SENHA_NOVA_FRACA' : 'FALHA_AO_TROCAR_SENHA', codigo)
  }

  // Passo final e obrigatório: o banco baixa a flag `must_change_password`.
  // Se ele falhar, o sistema continua pedindo a troca (nada fica pela metade).
  const { error } = await supabase.rpc('complete_password_change')
  if (error) throw new ApiError('FALHA_AO_TROCAR_SENHA', error.code)
}

export async function fetchMyProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('auth_user_id', userId)
    .maybeSingle()
  if (error) throw new ApiError(error.message)
  return data as Profile | null
}

export async function markLogin(userId: string) {
  // Registra o último acesso do funcionário (permitido pela política do próprio perfil).
  await supabase.from('profiles').update({ last_login_at: new Date().toISOString() }).eq('auth_user_id', userId)
}

// ===========================================================================
// CONFIGURAÇÕES
// ===========================================================================
export async function fetchSettings(): Promise<BusinessSettings> {
  const { data, error } = await supabase.from('business_settings').select('*').eq('id', true).single()
  return unwrap(data as BusinessSettings, error)
}

export async function saveSettings(patch: Partial<BusinessSettings>) {
  const { data, error } = await supabase
    .from('business_settings')
    .update(patch)
    .eq('id', true)
    .select()
    .single()
  return unwrap(data as BusinessSettings, error)
}

export async function fetchPaymentMethods(onlyActive = false): Promise<PaymentMethod[]> {
  let query = supabase.from('payment_methods').select('*').order('sort_order')
  if (onlyActive) query = query.eq('is_active', true)
  const { data, error } = await query
  if (error) throw new ApiError(error.message)
  return (data ?? []) as PaymentMethod[]
}

export async function savePaymentMethod(patch: Partial<PaymentMethod> & { id: string }) {
  const { data, error } = await supabase.from('payment_methods').upsert(patch).select().single()
  return unwrap(data as PaymentMethod, error)
}

export async function fetchDeliveryZones(): Promise<DeliveryFeeZone[]> {
  const { data, error } = await supabase
    .from('delivery_fee_zones')
    .select('*')
    .order('neighborhood')
  if (error) throw new ApiError(error.message)
  return (data ?? []) as DeliveryFeeZone[]
}

export async function upsertDeliveryZone(zone: Partial<DeliveryFeeZone> & { neighborhood: string; fee_cents: number }) {
  const payload = zone.id ? zone : { ...zone }
  const { data, error } = await supabase.from('delivery_fee_zones').upsert(payload).select().single()
  return unwrap(data as DeliveryFeeZone, error)
}

export async function fetchBusinessHours() {
  const { data, error } = await supabase.from('business_hours').select('*').order('weekday')
  if (error) throw new ApiError(error.message)
  return data as { id: string; weekday: number; is_open: boolean; opens_at: string | null; closes_at: string | null }[]
}

export async function saveBusinessHour(id: string, patch: Record<string, unknown>) {
  const { error } = await supabase.from('business_hours').update(patch).eq('id', id)
  if (error) throw new ApiError(error.message)
}

// ===========================================================================
// CARDÁPIO
// ===========================================================================
export async function fetchCategories(): Promise<Category[]> {
  const { data, error } = await supabase.from('categories').select('*').order('sort_order')
  if (error) throw new ApiError(error.message)
  return (data ?? []) as Category[]
}

export async function upsertCategory(patch: Partial<Category> & { name: string }) {
  const { data, error } = await supabase.from('categories').upsert(patch).select().single()
  return unwrap(data as Category, error)
}

export async function fetchProductSizes(): Promise<ProductSize[]> {
  const { data, error } = await supabase.from('product_sizes').select('*').order('sort_order')
  if (error) throw new ApiError(error.message)
  return (data ?? []) as ProductSize[]
}

export async function upsertProductSize(patch: Partial<ProductSize> & { code: string; name: string; kind: 'pizza' | 'other' }) {
  const { data, error } = await supabase.from('product_sizes').upsert(patch).select().single()
  return unwrap(data as ProductSize, error)
}

export async function fetchProducts(): Promise<Product[]> {
  const { data, error } = await supabase.from('products').select('*').order('sort_order')
  if (error) throw new ApiError(error.message)
  return (data ?? []) as Product[]
}

export async function upsertProduct(patch: Partial<Product> & { category_id: string; name: string; kind: 'simple' | 'pizza' }) {
  const { data, error } = await supabase.from('products').upsert(patch).select().single()
  return unwrap(data as Product, error)
}

export async function fetchVariants(): Promise<ProductVariant[]> {
  const { data, error } = await supabase.from('product_variants').select('*')
  if (error) throw new ApiError(error.message)
  return (data ?? []) as ProductVariant[]
}

export async function upsertVariant(patch: { product_id: string; size_id: string; price_cents: number; is_available?: boolean }) {
  const { data, error } = await supabase.from('product_variants').upsert(patch, { onConflict: 'product_id,size_id' }).select().single()
  return unwrap(data as ProductVariant, error)
}

export async function fetchModifierGroups(): Promise<ModifierGroup[]> {
  const { data, error } = await supabase.from('modifier_groups').select('*').order('sort_order')
  if (error) throw new ApiError(error.message)
  return (data ?? []) as ModifierGroup[]
}

export async function upsertModifierGroup(patch: Partial<ModifierGroup> & { name: string }) {
  const { data, error } = await supabase.from('modifier_groups').upsert(patch).select().single()
  return unwrap(data as ModifierGroup, error)
}

export async function fetchModifierOptions(): Promise<ModifierOption[]> {
  const { data, error } = await supabase.from('modifier_options').select('*').order('sort_order')
  if (error) throw new ApiError(error.message)
  return (data ?? []) as ModifierOption[]
}

export async function upsertModifierOption(patch: Partial<ModifierOption> & { group_id: string; name: string }) {
  const { data, error } = await supabase.from('modifier_options').upsert(patch).select().single()
  return unwrap(data as ModifierOption, error)
}

export async function fetchProductModifierGroups(): Promise<{ product_id: string; group_id: string }[]> {
  const { data, error } = await supabase.from('product_modifier_groups').select('product_id, group_id')
  if (error) throw new ApiError(error.message)
  return data ?? []
}

export async function linkProductModifierGroup(product_id: string, group_id: string) {
  const { error } = await supabase.from('product_modifier_groups').insert({ product_id, group_id })
  if (error) throw new ApiError(error.message)
}

export async function unlinkProductModifierGroup(product_id: string, group_id: string) {
  const { error } = await supabase
    .from('product_modifier_groups')
    .delete()
    .eq('product_id', product_id)
    .eq('group_id', group_id)
  if (error) throw new ApiError(error.message)
}

// ===========================================================================
// MESAS E PEDIDOS
// ===========================================================================
export async function createTable(number: number, name?: string | null, seats?: number | null) {
  const { data, error } = await supabase
    .from('restaurant_tables')
    .insert({ number, name: name ?? `Mesa ${number}`, seats: seats ?? null })
    .select()
    .single()
  return unwrap(data, error)
}

export async function updateTable(
  id: string,
  patch: { name?: string | null; seats?: number | null; is_active?: boolean },
) {
  const { data, error } = await supabase.from('restaurant_tables').update(patch).eq('id', id).select().single()
  return unwrap(data, error)
}

export async function fetchTables(): Promise<TableOverview[]> {
  const { data, error } = await supabase.from('table_overview').select('*').order('number')
  if (error) throw new ApiError(error.message)
  return (data ?? []) as TableOverview[]
}

/**
 * Endereço de entrega gravado no pedido (snapshot).
 *
 * O snapshot fica na tabela `orders` (coluna jsonb) e não é exposto pela view
 * `order_overview`; por isso esta consulta direta, restrita aos perfis que já
 * podem ver pedidos de delivery (RLS de `orders`).
 */
export async function fetchDeliveryAddresses(
  orderIds: string[],
): Promise<Record<string, Record<string, string | null>>> {
  if (orderIds.length === 0) return {}
  const { data, error } = await supabase
    .from('orders')
    .select('id, delivery_address_snapshot')
    .in('id', orderIds)
  if (error) throw new ApiError(error.message)
  const mapa: Record<string, Record<string, string | null>> = {}
  for (const linha of (data ?? []) as { id: string; delivery_address_snapshot: Record<string, string | null> | null }[]) {
    if (linha.delivery_address_snapshot) mapa[linha.id] = linha.delivery_address_snapshot
  }
  return mapa
}

export async function fetchOrders(filters: {
  statuses?: OrderStatus[]
  serviceMode?: 'dine_in' | 'delivery'
  sessionId?: string
  openOnly?: boolean
  limit?: number
  /**
   * Ordenação da consulta. O padrão é o mais recente primeiro (histórico).
   * A fila de prontos usa 'prontos_mais_antigos', que ordena por ready_at
   * crescente — quem espera há mais tempo aparece primeiro, e no PostgreSQL
   * o ASC deixa os nulos (sem horário confiável) no fim.
   */
  ordem?: 'recentes' | 'prontos_mais_antigos'
}): Promise<OrderOverview[]> {
  let query = supabase.from('order_overview').select('*')
  query =
    filters.ordem === 'prontos_mais_antigos'
      ? query.order('ready_at', { ascending: true })
      : query.order('created_at', { ascending: false })
  if (filters.statuses?.length) query = query.in('status', filters.statuses)
  if (filters.serviceMode) query = query.eq('service_mode', filters.serviceMode)
  if (filters.sessionId) query = query.eq('table_session_id', filters.sessionId)
  if (filters.openOnly) query = query.is('account_closed_at', null)
  query = query.limit(filters.limit ?? 100)
  const { data, error } = await query
  if (error) throw new ApiError(error.message)
  return (data ?? []) as OrderOverview[]
}

export async function fetchOrderItems(orderIds: string[]): Promise<OrderItemOverview[]> {
  if (orderIds.length === 0) return []
  const { data, error } = await supabase
    .from('order_item_overview')
    .select('*')
    .in('order_id', orderIds)
    .order('line_number')
  if (error) throw new ApiError(error.message)
  return (data ?? []) as OrderItemOverview[]
}

export async function fetchPayments(orderIds: string[]): Promise<Payment[]> {
  if (orderIds.length === 0) return []
  const { data, error } = await supabase
    .from('payments')
    .select('*')
    .in('order_id', orderIds)
    .order('created_at')
  if (error) throw new ApiError(error.message)
  return (data ?? []) as Payment[]
}

export async function fetchStatusHistory(orderIds: string[]) {
  if (orderIds.length === 0) return []
  const { data, error } = await supabase
    .from('order_status_history')
    .select('*')
    .in('order_id', orderIds)
    .order('changed_at')
  if (error) throw new ApiError(error.message)
  return data as { id: number; order_id: string; from_status: string | null; to_status: string; changed_by: string | null; changed_at: string; notes: string | null }[]
}

export interface CreateOrderPayload {
  service_mode: 'dine_in' | 'delivery'
  table_session_id?: string
  customer?: { name: string; phone: string; email?: string; notes?: string }
  address?: {
    street: string
    number: string
    complement?: string
    neighborhood: string
    city?: string
    state?: string
    postal_code?: string
    reference?: string
    delivery_notes?: string
  }
  customer_id?: string
  address_id?: string
  delivery_fee_zone_id?: string | null
  delivery_notes?: string
  notes?: string
  items: {
    product_id: string
    variant_id: string
    quantity: number
    notes?: string
    flavor_product_ids?: string[]
    modifier_option_ids?: string[]
  }[]
}

export async function openTableSession(tableId: string, guestCount: number | null, notes: string | null, clientUuid: string) {
  const { data, error } = await supabase.rpc('open_table_session', {
    p_table_id: tableId,
    p_guest_count: guestCount,
    p_notes: notes,
    p_client_uuid: clientUuid,
  })
  return unwrap(data, error)
}

export async function createOrder(payload: CreateOrderPayload, clientUuid: string): Promise<OrderOverview> {
  const { data, error } = await supabase.rpc('create_order', { p_payload: payload, p_client_uuid: clientUuid })
  return unwrap(data as OrderOverview, error)
}

export async function advanceOrderStatus(orderId: string, toStatus: OrderStatus, notes?: string) {
  const { data, error } = await supabase.rpc('advance_order_status', {
    p_order_id: orderId,
    p_to_status: toStatus,
    p_notes: notes ?? null,
  })
  return unwrap(data, error)
}

export async function cancelOrderItem(itemId: string, reason: string, quantity?: number) {
  const { data, error } = await supabase.rpc('cancel_order_item', {
    p_item_id: itemId,
    p_reason: reason,
    p_quantity: quantity ?? null,
  })
  return unwrap(data, error)
}

export async function setOrderDiscount(orderId: string, reason: string, pct?: number, cents?: number) {
  const { data, error } = await supabase.rpc('set_order_discount', {
    p_order_id: orderId,
    p_reason: reason,
    p_discount_pct: pct ?? null,
    p_discount_cents: cents ?? null,
  })
  return unwrap(data, error)
}

export async function registerPayment(input: {
  orderId: string
  methodId: string
  amountCents: number
  tenderedCents?: number | null
  isPrepaid?: boolean
  note?: string | null
  clientUuid: string
}) {
  const { data, error } = await supabase.rpc('register_payment', {
    p_order_id: input.orderId,
    p_method_id: input.methodId,
    p_amount_cents: input.amountCents,
    p_tendered_cents: input.tenderedCents ?? null,
    p_is_prepaid: input.isPrepaid ?? false,
    p_note: input.note ?? null,
    p_client_uuid: input.clientUuid,
  })
  return unwrap(data as Payment, error)
}

export async function reversePayment(paymentId: string, reason: string) {
  const { data, error } = await supabase.rpc('reverse_payment', {
    p_payment_id: paymentId,
    p_reason: reason,
  })
  return unwrap(data as Payment, error)
}

export async function setDeliveryFee(orderId: string, feeCents: number, reason: string) {
  const { data, error } = await supabase.rpc('set_delivery_fee', {
    p_order_id: orderId,
    p_fee_cents: feeCents,
    p_reason: reason,
  })
  return unwrap(data, error)
}

export async function closeTableAccount(sessionId: string, options?: { force?: boolean; reason?: string }) {
  const { data, error } = await supabase.rpc('close_table_account', {
    p_session_id: sessionId,
    p_force: options?.force ?? false,
    p_reason: options?.reason ?? null,
  })
  return unwrap(data, error)
}

export async function closeDeliveryAccount(orderId: string, options?: { force?: boolean; reason?: string }) {
  const { data, error } = await supabase.rpc('close_delivery_account', {
    p_order_id: orderId,
    p_force: options?.force ?? false,
    p_reason: options?.reason ?? null,
  })
  return unwrap(data, error)
}

// ===========================================================================
// CLIENTES / DELIVERY
// ===========================================================================
export async function upsertCustomer(
  customer: { name: string; phone: string; email?: string; notes?: string },
  address?: Record<string, string | undefined> | null,
) {
  const { data, error } = await supabase.rpc('upsert_customer', {
    p_customer: customer,
    p_address: address ?? null,
  })
  return unwrap(data as { customer_id: string; address_id: string | null }, error)
}

export async function searchCustomers(term: string): Promise<(Customer & { addresses: CustomerAddress[] })[]> {
  const digits = term.replace(/\D/g, '')
  let query = supabase
    .from('customers')
    .select('*, customer_addresses(*)')
    .eq('is_active', true)
    .order('name')
    .limit(20)

  if (digits.length >= 3) {
    query = query.like('phone_digits', `%${digits}%`)
  } else if (term.trim().length >= 2) {
    query = query.ilike('name', `%${term.trim()}%`)
  } else {
    return []
  }

  const { data, error } = await query
  if (error) throw new ApiError(error.message)
  return (data ?? []).map((c) => {
    const row = c as Customer & { customer_addresses: CustomerAddress[] }
    return { ...row, addresses: row.customer_addresses ?? [] }
  })
}

// ===========================================================================
// CAIXA
// ===========================================================================
export async function fetchOpenCashSession(): Promise<CashSessionOverview | null> {
  const { data, error } = await supabase
    .from('cash_session_overview')
    .select('*')
    .eq('status', 'open')
    .maybeSingle()
  if (error) throw new ApiError(error.message)
  return (data as CashSessionOverview | null) ?? null
}

export async function fetchCashSessions(limit = 30): Promise<CashSessionOverview[]> {
  const { data, error } = await supabase
    .from('cash_session_overview')
    .select('*')
    .order('opened_at', { ascending: false })
    .limit(limit)
  if (error) throw new ApiError(error.message)
  return (data ?? []) as CashSessionOverview[]
}

export async function fetchCashMovements(sessionId: string): Promise<CashMovement[]> {
  const { data, error } = await supabase
    .from('cash_movements')
    .select('*')
    .eq('cash_session_id', sessionId)
    .order('created_at', { ascending: false })
  if (error) throw new ApiError(error.message)
  return (data ?? []) as CashMovement[]
}

export async function startCashSession(openingCents: number, note: string | null, clientUuid: string): Promise<CashSession> {
  const { data, error } = await supabase.rpc('start_cash_session', {
    p_opening_amount_cents: openingCents,
    p_note: note,
    p_client_uuid: clientUuid,
  })
  return unwrap(data as CashSession, error)
}

export async function addCashMovement(input: {
  sessionId: string
  kind: 'in' | 'out'
  category: 'change_fund' | 'withdrawal' | 'expense' | 'adjustment' | 'other'
  amountCents: number
  description?: string
  reason?: string
  clientUuid: string
}) {
  const { data, error } = await supabase.rpc('add_cash_movement', {
    p_session_id: input.sessionId,
    p_kind: input.kind,
    p_category: input.category,
    p_amount_cents: input.amountCents,
    p_description: input.description ?? null,
    p_reason: input.reason ?? null,
    p_client_uuid: input.clientUuid,
  })
  return unwrap(data as CashMovement, error)
}

export async function closeCashSession(sessionId: string, countedCents: number, note?: string, varianceReason?: string) {
  const { data, error } = await supabase.rpc('close_cash_session', {
    p_session_id: sessionId,
    p_counted_cash_cents: countedCents,
    p_note: note ?? null,
    p_variance_reason: varianceReason ?? null,
  })
  return unwrap(data as CashSession, error)
}

// ===========================================================================
// RELATÓRIOS (agregados calculados no banco)
// ===========================================================================
export async function getFinancialSummary(params: {
  from: string
  to: string
  serviceMode?: 'dine_in' | 'delivery' | null
  employeeId?: string | null
  categoryId?: string | null
}): Promise<FinancialSummary> {
  const { data, error } = await supabase.rpc('get_financial_summary', {
    p_from: params.from,
    p_to: params.to,
    p_service_mode: params.serviceMode ?? null,
    p_employee_id: params.employeeId ?? null,
    p_category_id: params.categoryId ?? null,
  })
  return unwrap(data as FinancialSummary, error)
}

export async function getSalesSeries(from: string, to: string, bucket: 'day' | 'week' | 'month' = 'day') {
  const { data, error } = await supabase.rpc('get_sales_series', {
    p_from: from,
    p_to: to,
    p_bucket: bucket,
  })
  if (error) throw new ApiError(error.message)
  return (data ?? []) as SalesSeriesPoint[]
}

export async function getTopProducts(from: string, to: string, limit = 20, categoryId?: string | null) {
  const { data, error } = await supabase.rpc('get_top_products', {
    p_from: from,
    p_to: to,
    p_limit: limit,
    p_category_id: categoryId ?? null,
  })
  if (error) throw new ApiError(error.message)
  return (data ?? []) as TopProduct[]
}

export async function getSalesByEmployee(from: string, to: string) {
  const { data, error } = await supabase.rpc('get_sales_by_employee', { p_from: from, p_to: to })
  if (error) throw new ApiError(error.message)
  return (data ?? []) as { profile_id: string; full_name: string; role: Role; orders_count: number; net_cents: number; cancelled_count: number }[]
}

export async function getPaymentMethodReport(from: string, to: string) {
  const { data, error } = await supabase.rpc('get_payment_method_report', { p_from: from, p_to: to })
  if (error) throw new ApiError(error.message)
  return (data ?? []) as { method_id: string; label: string; kind: string; payments_count: number; received_cents: number; change_cents: number; in_drawer_cents: number }[]
}

export async function getCashSessionsReport(from: string, to: string) {
  const { data, error } = await supabase.rpc('get_cash_sessions_report', { p_from: from, p_to: to })
  if (error) throw new ApiError(error.message)
  return (data ?? []) as {
    session_id: string
    opened_at: string
    opened_by_name: string | null
    closed_at: string | null
    closed_by_name: string | null
    opening_cents: number
    cash_sales_cents: number
    movements_in_cents: number
    movements_out_cents: number
    expected_cents: number | null
    counted_cents: number | null
    difference_cents: number | null
    variance_reason: string | null
  }[]
}

export async function getOrdersPage(params: {
  from: string
  to: string
  status?: string | null
  serviceMode?: string | null
  tableNumber?: number | null
  search?: string | null
  limit?: number
  offset?: number
}) {
  const { data, error } = await supabase.rpc('get_orders_page', {
    p_from: params.from,
    p_to: params.to,
    p_status: params.status ?? null,
    p_service_mode: params.serviceMode ?? null,
    p_table_number: params.tableNumber ?? null,
    p_search: params.search ?? null,
    p_limit: params.limit ?? 50,
    p_offset: params.offset ?? 0,
  })
  if (error) throw new ApiError(error.message)
  return (data ?? []) as {
    id: string
    order_number: number
    service_mode: 'dine_in' | 'delivery'
    status: OrderStatus
    table_number: number | null
    customer_name: string | null
    customer_phone: string | null
    total_cents: number
    paid_cents: number
    balance_cents: number
    created_by_name: string
    created_at: string
    account_closed_at: string | null
    cancel_reason: string | null
    total_count: number
  }[]
}

export async function getOperationalSummary() {
  const { data, error } = await supabase.rpc('get_operational_summary', { p_at: new Date().toISOString() })
  return unwrap(data, error) as unknown as Record<string, unknown>
}

// ===========================================================================
// FUNCIONÁRIOS E AUDITORIA (admin)
// ===========================================================================
export async function fetchProfiles(): Promise<Profile[]> {
  const { data, error } = await supabase.from('profiles').select('*').order('full_name')
  if (error) throw new ApiError(error.message)
  return (data ?? []) as Profile[]
}

export async function updateProfile(id: string, patch: Partial<Profile>) {
  const { data, error } = await supabase.from('profiles').update(patch).eq('id', id).select().single()
  return unwrap(data as Profile, error)
}

/**
 * Criação de funcionário: passa SEMPRE pela Edge Function (server-side),
 * que usa a service_role e nunca a expõe ao navegador.
 */
export async function createEmployee(input: {
  full_name: string
  login: string
  role: Role
  password: string
  email?: string
  phone?: string
  activate?: boolean
}) {
  const { data, error } = await supabase.functions.invoke('admin-create-employee', { body: input })
  if (error) throw new ApiError(error.message)
  const result = data as { ok?: boolean; error?: string; profile_id?: string } | null
  if (!result?.ok) throw new ApiError(result?.error ?? 'Falha ao criar o funcionário')
  return result
}

export async function resetEmployeePassword(login: string) {
  const { data, error } = await supabase.functions.invoke('admin-create-employee', {
    body: { action: 'reset_password', login },
  })
  if (error) throw new ApiError(error.message)
  const result = data as { ok?: boolean; error?: string; temp_password?: string } | null
  if (!result?.ok) throw new ApiError(result?.error ?? 'Falha ao redefinir a senha')
  return result
}

export async function fetchAuditLogs(params: { limit?: number; offset?: number; action?: string }) {
  let query = supabase
    .from('audit_logs')
    .select('*', { count: 'exact' })
    .order('occurred_at', { ascending: false })
    .limit(params.limit ?? 50)
    .range(params.offset ?? 0, (params.offset ?? 0) + (params.limit ?? 50) - 1)
  if (params.action) query = query.ilike('action', `%${params.action}%`)
  const { data, error, count } = await query
  if (error) throw new ApiError(error.message)
  return {
    rows: (data ?? []) as {
      id: number
      occurred_at: string
      actor_name: string | null
      actor_role: string | null
      action: string
      entity_table: string
      entity_id: string | null
      order_id: number | null
      amount_cents: number | null
      reason: string | null
      details: Record<string, unknown>
    }[],
    count: count ?? 0,
  }
}

// ===========================================================================
// IMPRESSÃO (comprovante pelo navegador — sem integração com impressora térmica)
// ===========================================================================
export interface ReceiptData {
  title: string
  subtitle?: string
  lines: { label: string; value: string; emphasis?: boolean }[]
  items: { description: string; details: string[]; qty: number; unit: string; total: string }[]
  footer?: string
}

export function printReceipt(data: ReceiptData) {
  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8" />
<title>${data.title}</title>
<style>
  * { font-family: 'Courier New', monospace; }
  body { width: 300px; margin: 0 auto; padding: 8px; font-size: 12px; color: #000; }
  h1 { font-size: 15px; text-align: center; margin: 0 0 2px; }
  .sub { text-align: center; font-size: 11px; margin-bottom: 8px; }
  hr { border: none; border-top: 1px dashed #000; margin: 6px 0; }
  .line { display: flex; justify-content: space-between; gap: 8px; }
  .item { margin-bottom: 4px; }
  .det { font-size: 11px; padding-left: 6px; }
  .bold { font-weight: bold; }
  .footer { text-align: center; font-size: 10px; margin-top: 8px; white-space: pre-line; }
</style></head>
<body>
  <h1>${escapeHtml(data.title)}</h1>
  ${data.subtitle ? `<div class="sub">${escapeHtml(data.subtitle)}</div>` : ''}
  <hr />
  ${data.lines.map((l) => `<div class="line ${l.emphasis ? 'bold' : ''}"><span>${escapeHtml(l.label)}</span><span>${escapeHtml(l.value)}</span></div>`).join('')}
  <hr />
  ${data.items
    .map(
      (i) => `<div class="item">
        <div class="line"><span>${i.qty}x ${escapeHtml(i.description)}</span><span>${escapeHtml(i.total)}</span></div>
        ${i.details.map((d) => `<div class="det">${escapeHtml(d)}</div>`).join('')}
        <div class="det">Unitário: ${escapeHtml(i.unit)}</div>
      </div>`,
    )
    .join('')}
  <hr />
  ${data.footer ? `<div class="footer">${escapeHtml(data.footer)}</div>` : ''}
  <div class="footer">Documento não fiscal • emitido pelo sistema</div>
</body></html>`

  const win = window.open('', '_blank', 'width=380,height=640')
  if (!win) {
    alert('Permita pop-ups para imprimir o comprovante.')
    return
  }
  win.document.write(html)
  win.document.close()
  win.focus()
  win.print()
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export type { CartItem }
