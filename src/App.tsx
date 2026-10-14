import { Suspense, lazy, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AppLayout } from './components/AppLayout'
import { ErrorBoundary } from './components/ErrorBoundary'
import { useAuth } from './context/AuthContext'
import type { Role } from './lib/types'
import { LoadingBlock, ErrorBlock } from './components/ui'
import { isSupabaseConfigured } from './lib/supabase'

// Cada tela é carregada sob demanda: o painel do salão abre rápido mesmo no
// celular do garçom, e as telas administrativas só baixam quando usadas.
const LoginPage = lazy(() => import('./pages/LoginPage'))
const SetupPage = lazy(() => import('./pages/SetupPage'))
const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const TablesPage = lazy(() => import('./pages/TablesPage'))
const TableSessionPage = lazy(() => import('./pages/TableSessionPage'))
const CashierHomePage = lazy(() => import('./pages/CashierHomePage'))
const DeliveryPage = lazy(() => import('./pages/DeliveryPage'))
const CashControlPage = lazy(() => import('./pages/CashControlPage'))
const MenuAdminPage = lazy(() => import('./pages/MenuAdminPage'))
const EmployeesPage = lazy(() => import('./pages/EmployeesPage'))
const ReportsPage = lazy(() => import('./pages/ReportsPage'))
const HistoryPage = lazy(() => import('./pages/HistoryPage'))
const AuditPage = lazy(() => import('./pages/AuditPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))

function Guard({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { profile, loading, blockedReason } = useAuth()

  if (loading) return <LoadingBlock label="Carregando seu acesso…" />
  if (blockedReason) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <ErrorBlock message={blockedReason} />
      </div>
    )
  }
  if (!profile) return <Navigate to="/login" replace />
  if (roles.length > 0 && !roles.includes(profile.role)) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <ErrorBlock message="Seu perfil não tem permissão para acessar esta área." />
      </div>
    )
  }
  return <>{children}</>
}

function HomeRedirect() {
  const { profile, loading, blockedReason } = useAuth()
  if (loading) return <LoadingBlock />
  if (blockedReason) return <Navigate to="/login" replace />
  if (!profile) return <Navigate to="/login" replace />
  if (profile.role === 'admin') return <Navigate to="/dashboard" replace />
  if (profile.role === 'manager') return <Navigate to="/caixa" replace />
  return <Navigate to="/mesas" replace />
}

export default function App() {
  // A chave pelo caminho faz a rede de segurança se reiniciar ao trocar de tela:
  // um erro no cardápio não deixa o resto do sistema inutilizável.
  const { pathname } = useLocation()

  if (!isSupabaseConfigured) {
    return (
      <Suspense fallback={<LoadingBlock label="Carregando…" />}>
        <SetupPage />
      </Suspense>
    )
  }

  return (
    <ErrorBoundary key={pathname}>
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-ink-100">
          <LoadingBlock label="Carregando o sistema…" linhas={3} />
        </div>
      }
    >
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        element={
          <Guard roles={[]}>
            <AppLayout />
          </Guard>
        }
      >
        <Route path="/" element={<HomeRedirect />} />

        <Route
          path="/dashboard"
          element={
            <Guard roles={['admin']}>
              <DashboardPage />
            </Guard>
          }
        />
        <Route
          path="/caixa"
          element={
            <Guard roles={['admin', 'manager']}>
              <CashierHomePage />
            </Guard>
          }
        />
        <Route
          path="/mesas"
          element={
            <Guard roles={['admin', 'manager', 'waiter']}>
              <TablesPage />
            </Guard>
          }
        />
        <Route
          path="/mesas/:sessionId"
          element={
            <Guard roles={['admin', 'manager', 'waiter']}>
              <TableSessionPage />
            </Guard>
          }
        />
        <Route
          path="/delivery"
          element={
            <Guard roles={['admin', 'manager']}>
              <DeliveryPage />
            </Guard>
          }
        />
        <Route
          path="/cardapio"
          element={
            <Guard roles={['admin']}>
              <MenuAdminPage />
            </Guard>
          }
        />
        <Route
          path="/funcionarios"
          element={
            <Guard roles={['admin']}>
              <EmployeesPage />
            </Guard>
          }
        />
        <Route
          path="/relatorios"
          element={
            <Guard roles={['admin']}>
              <ReportsPage />
            </Guard>
          }
        />
        <Route
          path="/historico"
          element={
            <Guard roles={['admin', 'manager']}>
              <HistoryPage />
            </Guard>
          }
        />
        <Route
          path="/caixa-controle"
          element={
            <Guard roles={['admin', 'manager']}>
              <CashControlPage />
            </Guard>
          }
        />
        <Route
          path="/auditoria"
          element={
            <Guard roles={['admin']}>
              <AuditPage />
            </Guard>
          }
        />
        <Route
          path="/configuracoes"
          element={
            <Guard roles={['admin']}>
              <SettingsPage />
            </Guard>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
    </ErrorBoundary>
  )
}
