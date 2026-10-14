import { useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useOnlineStatus, useRealtimeSync } from '../lib/hooks'
import { ROLE_LABELS, type Role } from '../lib/types'
import { Badge } from './ui'

interface NavItem {
  to: string
  label: string
  icon: string
  roles: Role[]
  badge?: 'kitchen'
}

const NAV: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: '📊', roles: ['admin'] },
  { to: '/caixa', label: 'Caixa', icon: '💰', roles: ['admin', 'manager'] },
  { to: '/mesas', label: 'Mesas', icon: '🍽️', roles: ['admin', 'manager', 'waiter'] },
  { to: '/delivery', label: 'Delivery', icon: '🛵', roles: ['admin', 'manager'] },
  { to: '/cardapio', label: 'Cardápio', icon: '📋', roles: ['admin'] },
  { to: '/funcionarios', label: 'Funcionários', icon: '👥', roles: ['admin'] },
  { to: '/relatorios', label: 'Relatórios', icon: '📈', roles: ['admin'] },
  { to: '/historico', label: 'Histórico', icon: '🧾', roles: ['admin', 'manager'] },
  { to: '/caixa-controle', label: 'Controle de caixa', icon: '🔐', roles: ['admin', 'manager'] },
  { to: '/auditoria', label: 'Auditoria', icon: '🛡️', roles: ['admin'] },
  { to: '/configuracoes', label: 'Configurações', icon: '⚙️', roles: ['admin'] },
]

export function AppLayout() {
  const { profile, signOut, isAdmin } = useAuth()
  const online = useOnlineStatus()
  const realtimeConnected = useRealtimeSync(Boolean(profile))
  const [menuOpen, setMenuOpen] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  const items = NAV.filter((item) => profile && item.roles.includes(profile.role))

  return (
    <div className="flex min-h-screen bg-slate-100">
      {/* Menu lateral */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-60 transform bg-slate-900 text-slate-200 transition-transform lg:static lg:translate-x-0 ${
          menuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-4">
          <span className="text-xl" aria-hidden>
            🍕
          </span>
          <div>
            <p className="text-sm font-semibold text-white">Gestão da Pizzaria</p>
            <p className="text-[11px] text-slate-400">Operação e caixa</p>
          </div>
        </div>

        <nav className="flex flex-col gap-0.5 p-2">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-2 rounded-md px-3 py-2 text-sm transition ${
                  isActive || location.pathname.startsWith(`${item.to}/`)
                    ? 'bg-brand-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`
              }
            >
              <span aria-hidden>{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-2 border-t border-slate-800 px-4 py-3 text-[11px] text-slate-400">
          <p className="font-medium text-slate-300">{profile?.full_name}</p>
          <p>{profile ? ROLE_LABELS[profile.role] : ''}</p>
          <button
            onClick={async () => {
              await signOut()
              navigate('/login', { replace: true })
            }}
            className="mt-2 rounded border border-slate-700 px-2 py-1 text-slate-300 hover:bg-slate-800"
          >
            Sair
          </button>
        </div>
      </aside>

      {/* Conteúdo */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-3 py-2.5 lg:px-5">
          <div className="flex items-center gap-3">
            <button
              className="rounded p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
              onClick={() => setMenuOpen((open) => !open)}
              aria-label="Abrir menu"
            >
              ☰
            </button>
            <div>
              <h1 className="text-sm font-semibold text-slate-800">
                {items.find((i) => location.pathname.startsWith(i.to))?.label ?? 'Sistema'}
              </h1>
              <p className="text-[11px] text-slate-500">
                {profile?.full_name} · {profile ? ROLE_LABELS[profile.role] : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!online && <Badge tone="red">Sem conexão</Badge>}
            {online && !realtimeConnected && profile && <Badge tone="amber">Reconectando…</Badge>}
            {online && realtimeConnected && <Badge tone="green">Tempo real</Badge>}
            {isAdmin && <Badge tone="brand">Administrador</Badge>}
          </div>
        </header>

        {!online && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
            Você está sem conexão. As operações não serão enviadas até a internet voltar — nenhuma venda é
            registrada sem a confirmação do servidor.
          </div>
        )}

        <main className="min-w-0 flex-1 p-3 lg:p-5">
          <Outlet />
        </main>
      </div>

      {menuOpen && (
        <button
          className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden"
          onClick={() => setMenuOpen(false)}
          aria-label="Fechar menu"
        />
      )}
    </div>
  )
}
