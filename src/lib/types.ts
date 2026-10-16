/**
 * Tipos do domínio — espelham o banco (Supabase PostgreSQL).
 * Valores monetários são SEMPRE inteiros em centavos.
 */

export type Role = 'admin' | 'manager' | 'waiter'

export type ServiceMode = 'dine_in' | 'delivery'

export type OrderStatus =
  | 'received'
  | 'confirmed'
  | 'preparing'
  | 'ready'
  | 'delivered_to_table'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled'

export type TableStatus = 'available' | 'occupied' | 'awaiting_close' | 'attention' | 'inactive'

export interface Profile {
  id: string
  auth_user_id: string
  full_name: string
  login: string
  role: Role
  is_active: boolean
  phone: string | null
  must_change_password: boolean
  last_login_at: string | null
  created_at: string
}

export interface BusinessSettings {
  id: boolean
  trade_name: string
  legal_name: string | null
  phone: string | null
  address_line: string | null
  logo_url: string | null
  timezone: string
  pix_key: string | null
  accept_delivery: boolean
  accept_dine_in: boolean
  default_delivery_fee_cents: number
  min_delivery_order_cents: number
  half_and_half_price_rule: 'highest' | 'average'
  max_discount_pct_without_auth: number
  max_discount_pct_hard: number
  cash_variance_tolerance_cents: number
  split_payment_enabled: boolean
  receipt_footer_text: string | null
}

export interface PaymentMethod {
  id: string
  label: string
  kind: 'cash' | 'pix' | 'debit_card' | 'credit_card' | 'other'
  affects_cash_drawer: boolean
  requires_change: boolean
  allows_prepaid: boolean
  is_active: boolean
  is_default: boolean
  sort_order: number
}

export interface Category {
  id: string
  name: string
  description: string | null
  sort_order: number
  is_active: boolean
}

export interface ProductSize {
  id: string
  code: string
  name: string
  kind: 'pizza' | 'other'
  slices: number | null
  max_flavors: number
  sort_order: number
  is_active: boolean
}

export interface Product {
  id: string
  category_id: string
  name: string
  description: string | null
  image_url: string | null
  kind: 'simple' | 'pizza'
  is_available: boolean
  is_active: boolean
  sort_order: number
}

export interface ProductVariant {
  id: string
  product_id: string
  size_id: string
  price_cents: number
  is_available: boolean
}

export interface ModifierGroup {
  id: string
  name: string
  description: string | null
  min_select: number
  max_select: number
  is_active: boolean
  sort_order: number
}

export interface ModifierOption {
  id: string
  group_id: string
  name: string
  price_cents: number
  is_available: boolean
  sort_order: number
}

export interface TableOverview {
  id: string
  number: number
  name: string | null
  seats: number | null
  is_active: boolean
  status: TableStatus
  open_session_id: string | null
  opened_at: string | null
  guest_count: number | null
  opened_by: string | null
  opened_by_name: string | null
  open_orders_count: number
  open_items_count: number
  subtotal_cents: number
  discount_cents: number
  delivery_fee_cents: number
  total_cents: number
  paid_cents: number
  balance_cents: number
  pending_kitchen_count: number
}

export interface OrderOverview {
  id: string
  order_number: number
  service_mode: ServiceMode
  status: OrderStatus
  table_session_id: string | null
  table_id: string | null
  table_number: number | null
  customer_id: string | null
  customer_name_snapshot: string | null
  customer_phone_snapshot: string | null
  delivery_neighborhood: string | null
  delivery_fee_cents: number
  delivery_notes: string | null
  subtotal_cents: number
  discount_cents: number
  discount_pct: number
  total_cents: number
  paid_cents: number
  balance_cents: number
  change_given_cents: number
  is_cancelled: boolean
  cancel_reason: string | null
  notes: string | null
  created_by: string
  created_by_name: string
  created_at: string
  /** Quando o pedido ficou pronto (gravado pelo banco). Nulo em pedidos antigos. */
  ready_at: string | null
  /** Situação do atendimento da mesa. Nulo em pedidos sem mesa (delivery). */
  session_status: 'open' | 'closed' | null
  account_closed_at: string | null
  cash_session_id: string | null
}

export interface OrderItemOverview {
  id: string
  order_id: string
  line_number: number
  product_id: string
  variant_id: string
  product_name: string
  category_name: string | null
  size_name: string
  quantity: number
  unit_base_price_cents: number
  modifiers_unit_cents: number
  unit_price_cents: number
  modifiers_total_cents: number
  total_cents: number
  pricing_rule: 'single' | 'highest' | 'average' | null
  notes: string | null
  is_cancelled: boolean
  cancel_reason: string | null
  created_at: string
  flavors: { product_id: string; name: string; position: number }[]
  modifiers: { group_name: string; option_name: string; price_cents: number; quantity: number }[]
}

export interface Payment {
  id: string
  order_id: string
  cash_session_id: string
  method_id: string
  amount_cents: number
  tendered_cents: number | null
  change_cents: number
  is_prepaid: boolean
  status: 'confirmed' | 'reversed'
  note: string | null
  reversed_at: string | null
  reverse_reason: string | null
  created_by: string
  created_at: string
}

export interface CashSession {
  id: string
  status: 'open' | 'closed'
  opened_by: string
  opened_at: string
  opening_amount_cents: number
  opening_note: string | null
  closed_by: string | null
  closed_at: string | null
  expected_cash_cents: number | null
  counted_cash_cents: number | null
  difference_cents: number | null
  closing_note: string | null
  variance_reason: string | null
}

export interface CashSessionOverview extends CashSession {
  opened_by_name: string | null
  closed_by_name: string | null
  movements_in_cents: number
  movements_out_cents: number
  cash_sales_cents: number
  expected_cash_cents: number
}

export interface CashMovement {
  id: string
  cash_session_id: string
  kind: 'in' | 'out'
  category: 'change_fund' | 'withdrawal' | 'expense' | 'adjustment' | 'sale' | 'receipt'
  source: 'manual' | 'automatic'
  amount_cents: number
  description: string | null
  reason: string | null
  order_id: string | null
  payment_id: string | null
  created_at: string
  created_by: string
}

export interface Customer {
  id: string
  name: string
  phone: string
  phone_digits: string
  email: string | null
  notes: string | null
  is_active: boolean
}

export interface CustomerAddress {
  id: string
  customer_id: string
  label: string | null
  street: string
  number: string
  complement: string | null
  neighborhood: string
  city: string
  state: string
  postal_code: string | null
  reference: string | null
  delivery_notes: string | null
  is_default: boolean
}

export interface DeliveryFeeZone {
  id: string
  neighborhood: string
  fee_cents: number
  is_active: boolean
}

/** Item pedido no compositor (antes de virar pedido no banco). */
export interface CartItem {
  key: string
  product_id: string
  variant_id: string
  quantity: number
  notes: string
  flavor_product_ids: string[]
  modifier_option_ids: string[]
  /** Somente para exibição na interface. */
  preview: {
    product_name: string
    size_name: string
    flavors: string[]
    modifiers: { name: string; price_cents: number }[]
    unit_price_cents: number
  }
}

export interface FinancialSummary {
  period: { from: string; to: string; timezone: string }
  orders_valid_count: number
  orders_cancelled_count: number
  gross_items_cents: number
  discounts_cents: number
  delivery_fees_cents: number
  cancelled_cents: number
  net_valid_cents: number
  received_cents: number
  pending_cents: number
  ticket_average_cents: number
  dine_in: { orders_count: number; net_cents: number }
  delivery: { orders_count: number; net_cents: number; fees_cents: number }
}

export interface SalesSeriesPoint {
  bucket_start: string
  orders_count: number
  gross_cents: number
  discount_cents: number
  net_cents: number
  received_cents: number
}

export interface TopProduct {
  product_id: string
  product_name: string
  category_name: string | null
  quantity: number
  total_cents: number
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrador',
  manager: 'Caixa',
  waiter: 'Garçom',
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  received: 'Recebido',
  confirmed: 'Confirmado',
  preparing: 'Em preparação',
  ready: 'Pronto',
  delivered_to_table: 'Entregue à mesa',
  out_for_delivery: 'Saiu para entrega',
  delivered: 'Entregue',
  cancelled: 'Cancelado',
}

export const TABLE_STATUS_LABELS: Record<TableStatus, string> = {
  available: 'Disponível',
  occupied: 'Ocupada',
  awaiting_close: 'Aguardando fechamento',
  attention: 'Atenção',
  inactive: 'Inativa',
}

export const CASH_CATEGORY_LABELS: Record<CashMovement['category'], string> = {
  change_fund: 'Reforço de troco',
  withdrawal: 'Sangria / retirada',
  expense: 'Despesa operacional',
  adjustment: 'Ajuste',
  sale: 'Venda em dinheiro',
  receipt: 'Recebimento',
}
