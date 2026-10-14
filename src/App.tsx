import { Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from './components/AppLayout'
import { useAuth } from './context/AuthContext'
import type { Role } from './lib/types'
import { LoadingBlock, ErrorBlock } from './components/ui'

import LoginPage from './pages/LoginPage'
import SetupPage from './pages/SetupPage'
import DashboardPage from './pages/DashboardPage'
import TablesPage from './pages/TablesPage'
import TableSessionPage from './pages/TableSessionPage'
import CashierHomePage from './pages/CashierHomePage'
import DeliveryPage from './pages/DeliveryPage'
import CashControlPage from './pages/CashControlPage'
import MenuAdminPage from './pages/MenuAdminPage'
import EmployeesPage from './pages/EmployeesPage'
import ReportsPage from './pages/ReportsPage'
import HistoryPage from './pages/HistoryPage'
import AuditPage from './pages/AuditPage'
import SettingsPage from './pages/SettingsPage'
import { isSupabaseConfigured } from './lib/supabase'
import type { ReactNode } from 'react'

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
  if (!isSupabaseConfigured) return <SetupPage />

  return (
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
  )
}
