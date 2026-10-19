import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import * as api from './api'
import type { OrderStatus } from './types'

// ===========================================================================
// CHAVES DE CACHE
// ===========================================================================
export const qk = {
  settings: ['settings'] as const,
  paymentMethods: ['payment-methods'] as const,
  tables: ['tables'] as const,
  orders: (filters: Record<string, unknown>) => ['orders', filters] as const,
  orderItems: (ids: string[]) => ['order-items', ids] as const,
  payments: (ids: string[]) => ['payments', ids] as const,
  statusHistory: (ids: string[]) => ['status-history', ids] as const,
  cashSession: ['cash-session'] as const,
  cashSessionOpen: ['cash-session-open'] as const,
  cashMovements: (sessionId: string) => ['cash-movements', sessionId] as const,
  menu: ['menu'] as const,
  profiles: ['profiles'] as const,
  zones: ['delivery-zones'] as const,
  businessHours: ['business-hours'] as const,
}

// ===========================================================================
// CONSULTAS
// ===========================================================================
export function useSettings() {
  return useQuery({ queryKey: qk.settings, queryFn: api.fetchSettings, staleTime: 60_000 })
}

export function usePaymentMethods(onlyActive = true) {
  return useQuery({
    queryKey: [...qk.paymentMethods, onlyActive],
    queryFn: () => api.fetchPaymentMethods(onlyActive),
    staleTime: 60_000,
  })
}

export function useTables() {
  return useQuery({ queryKey: qk.tables, queryFn: api.fetchTables, refetchInterval: 30_000 })
}

export function useOrders(filters: Parameters<typeof api.fetchOrders>[0]) {
  return useQuery({
    queryKey: qk.orders(filters as Record<string, unknown>),
    queryFn: () => api.fetchOrders(filters),
  })
}

export function useOrderItems(orderIds: string[]) {
  return useQuery({
    queryKey: qk.orderItems(orderIds),
    queryFn: () => api.fetchOrderItems(orderIds),
    enabled: orderIds.length > 0,
  })
}

export function usePayments(orderIds: string[]) {
  return useQuery({
    queryKey: qk.payments(orderIds),
    queryFn: () => api.fetchPayments(orderIds),
    enabled: orderIds.length > 0,
  })
}

export function useStatusHistory(orderIds: string[]) {
  return useQuery({
    queryKey: qk.statusHistory(orderIds),
    queryFn: () => api.fetchStatusHistory(orderIds),
    enabled: orderIds.length > 0,
  })
}

export function useOpenCashSession() {
  return useQuery({ queryKey: qk.cashSession, queryFn: api.fetchOpenCashSession, refetchInterval: 60_000 })
}

/**
 * Estado do caixa para quem NÃO lê a gaveta (o garçom): devolve apenas
 * "existe turno aberto?" — sem valores, sem movimentos. Evita o garçom
 * preencher a janela de recebimento para só então descobrir que não dá.
 */
export function useCashSessionIsOpen(habilitado: boolean) {
  return useQuery({
    queryKey: qk.cashSessionOpen,
    queryFn: api.cashSessionIsOpen,
    enabled: habilitado,
    refetchInterval: 60_000,
  })
}

export function useCashMovements(sessionId?: string) {
  return useQuery({
    queryKey: qk.cashMovements(sessionId ?? 'none'),
    queryFn: () => api.fetchCashMovements(sessionId as string),
    enabled: Boolean(sessionId),
  })
}

/** Catálogo completo (categorias, produtos, tamanhos, preços e adicionais). */
export function useMenu() {
  return useQuery({
    queryKey: qk.menu,
    queryFn: async () => {
      const [categories, products, sizes, variants, groups, options, links] = await Promise.all([
        api.fetchCategories(),
        api.fetchProducts(),
        api.fetchProductSizes(),
        api.fetchVariants(),
        api.fetchModifierGroups(),
        api.fetchModifierOptions(),
        api.fetchProductModifierGroups(),
      ])
      return { categories, products, sizes, variants, groups, options, links }
    },
    staleTime: 30_000,
  })
}

export function useProfiles(enabled: boolean) {
  return useQuery({ queryKey: qk.profiles, queryFn: api.fetchProfiles, enabled })
}

export function useZones() {
  return useQuery({ queryKey: qk.zones, queryFn: api.fetchDeliveryZones })
}

export function useBusinessHours() {
  return useQuery({ queryKey: qk.businessHours, queryFn: api.fetchBusinessHours })
}

// ===========================================================================
// TEMPO REAL — sincroniza os painéis entre si
// ===========================================================================
/** Tabelas observadas pelo Realtime e o "balde" de cache que cada uma invalida. */
const REALTIME_BUCKETS: { table: string; bucket: string }[] = [
  // Cardápio: mudou preço/produto no administrador, todos os aparelhos veem.
  { table: 'products', bucket: 'catalog' },
  { table: 'product_variants', bucket: 'catalog' },
  { table: 'product_sizes', bucket: 'catalog' },
  { table: 'categories', bucket: 'catalog' },
  { table: 'modifier_groups', bucket: 'catalog' },
  { table: 'modifier_options', bucket: 'catalog' },
  { table: 'product_modifier_groups', bucket: 'catalog' },
  // Configuração e formas de pagamento mudam a operação de quem está logado.
  { table: 'business_settings', bucket: 'settings' },
  { table: 'payment_methods', bucket: 'settings' },
  { table: 'restaurant_tables', bucket: 'tables' },
  { table: 'table_sessions', bucket: 'tables' },
  { table: 'orders', bucket: 'orders' },
  { table: 'order_items', bucket: 'orders' },
  { table: 'order_status_history', bucket: 'orders' },
  { table: 'payments', bucket: 'payments' },
  { table: 'cash_sessions', bucket: 'cash' },
  { table: 'cash_movements', bucket: 'cash' },
]

export function useRealtimeSync(enabled = true) {
  const queryClient = useQueryClient()
  const [connected, setConnected] = useState(false)
  const queue = useRef<Set<string>>(new Set())
  const timer = useRef<number | null>(null)

  useEffect(() => {
    if (!enabled) return

    const flush = () => {
      const has = (prefix: string) => [...queue.current].some((k) => k.startsWith(prefix))
      if (has('catalog')) {
        void queryClient.invalidateQueries({ queryKey: qk.menu })
        queue.current.delete('catalog')
      }
      if (has('tables')) {
        void queryClient.invalidateQueries({ queryKey: qk.tables })
        queue.current.delete('tables')
      }
      if (has('orders')) {
        void queryClient.invalidateQueries({ queryKey: ['orders'] })
        void queryClient.invalidateQueries({ queryKey: ['order-items'] })
        void queryClient.invalidateQueries({ queryKey: ['status-history'] })
        queue.current.delete('orders')
      }
      if (has('payments')) {
        void queryClient.invalidateQueries({ queryKey: ['payments'] })
        void queryClient.invalidateQueries({ queryKey: ['orders'] })
        void queryClient.invalidateQueries({ queryKey: ['order-items'] })
        queue.current.delete('payments')
      }
      if (has('settings')) {
        void queryClient.invalidateQueries({ queryKey: qk.settings })
        void queryClient.invalidateQueries({ queryKey: qk.paymentMethods })
        queue.current.delete('settings')
      }
      if (has('cash')) {
        void queryClient.invalidateQueries({ queryKey: qk.cashSession })
        void queryClient.invalidateQueries({ queryKey: qk.cashSessionOpen })
        void queryClient.invalidateQueries({ queryKey: ['cash-movements'] })
        queue.current.delete('cash')
      }
    }

    const schedule = (bucket: string) => {
      queue.current.add(bucket)
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(flush, 350)
    }

    let channel = supabase.channel('painel-sync')
    for (const { table, bucket } of REALTIME_BUCKETS) {
      channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => schedule(bucket))
    }

    channel
      .subscribe((status) => {
        setConnected(status === 'SUBSCRIBED')
        if (status === 'SUBSCRIBED') {
          // Reconexão: garante que nada ficou desatualizado.
          void queryClient.invalidateQueries()
        }
      })

    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
      void supabase.removeChannel(channel)
    }
  }, [enabled, queryClient])

  return connected
}

/** Estado da conexão com a internet — exibido no cabeçalho. */
export function useOnlineStatus() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)

  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  return online
}

/** Invalida tudo que depende de uma mesa/pedido após uma operação de escrita. */
export function invalidateOrderData(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: qk.tables })
  void queryClient.invalidateQueries({ queryKey: ['orders'] })
  void queryClient.invalidateQueries({ queryKey: ['order-items'] })
  void queryClient.invalidateQueries({ queryKey: ['payments'] })
  void queryClient.invalidateQueries({ queryKey: ['status-history'] })
  void queryClient.invalidateQueries({ queryKey: qk.cashSession })
  void queryClient.invalidateQueries({ queryKey: ['cash-movements'] })
  void queryClient.invalidateQueries({ queryKey: ['orders-page'] })
  invalidateReports(queryClient)
}

/** Indicadores e relatórios são agregados no banco: recalculados quando algo muda. */
export function invalidateReports(queryClient: QueryClient) {
  for (const prefix of ['dashboard-summary', 'dashboard-series', 'dashboard-top', 'dashboard-methods', 'report-summary', 'report-series', 'report-products', 'report-employees', 'report-methods', 'report-cash']) {
    void queryClient.invalidateQueries({ queryKey: [prefix] })
  }
}

export const ACTIVE_KITCHEN_STATUSES: OrderStatus[] = ['received', 'confirmed', 'preparing', 'ready']
export const DELIVERY_FLOW: OrderStatus[] = ['received', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered']
