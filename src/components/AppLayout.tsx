import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useOnlineStatus, useRealtimeSync } from '../lib/hooks'
import { ROLE_LABELS, type Role } from '../lib/types'
import { Icon, type NomeIcone } from './icons'
import { Badge, ConfirmDialog, IconButton } from './ui'

interface ItemNav {
  to: string
  rotulo: string
  icone: NomeIcone
  roles: Role[]
  grupo: 'operacao' | 'gestao' | 'sistema'
  /** Aparece na barra inferior do celular. */
  mobile?: boolean
}

const NAV: ItemNav[] = [
  { to: '/caixa', rotulo: 'Caixa', icone: 'caixa', roles: ['admin', 'manager'], grupo: 'operacao', mobile: true },
  { to: '/mesas', rotulo: 'Mesas', icone: 'mesas', roles: ['admin', 'manager', 'waiter'], grupo: 'operacao', mobile: true },
  { to: '/delivery', rotulo: 'Delivery', icone: 'entrega', roles: ['admin', 'manager'], grupo: 'operacao', mobile: true },
  { to: '/historico', rotulo: 'Histórico', icone: 'historico', roles: ['admin', 'manager'], grupo: 'operacao', mobile: true },
  { to: '/dashboard', rotulo: 'Painel do dia', icone: 'painel', roles: ['admin'], grupo: 'gestao', mobile: true },
  { to: '/relatorios', rotulo: 'Relatórios', icone: 'relatorios', roles: ['admin'], grupo: 'gestao' },
  { to: '/caixa-controle', rotulo: 'Controle de caixa', icone: 'cofre', roles: ['admin', 'manager'], grupo: 'gestao' },
  { to: '/cardapio', rotulo: 'Cardápio', icone: 'cardapio', roles: ['admin'], grupo: 'gestao' },
  { to: '/funcionarios', rotulo: 'Funcionários', icone: 'equipe', roles: ['admin'], grupo: 'gestao' },
  { to: '/auditoria', rotulo: 'Auditoria', icone: 'auditoria', roles: ['admin'], grupo: 'gestao' },
  { to: '/configuracoes', rotulo: 'Configurações', icone: 'config', roles: ['admin'], grupo: 'sistema' },
]

const TITULOS_GRUPO: Record<ItemNav['grupo'], string> = {
  operacao: 'Operação',
  gestao: 'Gestão',
  sistema: 'Sistema',
}

/** Marca do sistema — desenhada em SVG para não depender de imagem externa. */
function Logo({ className = 'h-9 w-9' }: { className?: string }) {
  return (
    <span
      className={`flex items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-sm ${className}`}
      aria-hidden
    >
      <Icon nome="pizza" className="h-5 w-5" />
    </span>
  )
}

export function AppLayout() {
  const { profile, signOut, isAdmin } = useAuth()
  // Evita repetir "Administrador · Administrador" quando o nome já é o da função.
  const funcaoDoPerfil = profile ? ROLE_LABELS[profile.role] : ''
  const descricaoDoUsuario =
    funcaoDoPerfil.toLowerCase() === (profile?.full_name ?? '').toLowerCase() ? '' : funcaoDoPerfil
  const online = useOnlineStatus()
  const realtimeConnected = useRealtimeSync(Boolean(profile))
  const [menuOpen, setMenuOpen] = useState(false)
  const [sairAberto, setSairAberto] = useState(false)
  const [saindo, setSaindo] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  const items = NAV.filter((item) => profile && item.roles.includes(profile.role))
  const ativo = (to: string) => location.pathname === to || location.pathname.startsWith(`${to}/`)
  const atual = items.find((item) => ativo(item.to))

  // Fecha o menu ao trocar de tela (celular) e trava a rolagem com ele aberto.
  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!menuOpen) return
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = overflow
    }
  }, [menuOpen])

  async function sair() {
    setSaindo(true)
    try {
      await signOut()
      navigate('/login', { replace: true })
    } finally {
      setSaindo(false)
      setSairAberto(false)
    }
  }

  const grupos: ItemNav['grupo'][] = ['operacao', 'gestao', 'sistema']
  const itensMobile = items.filter((item) => item.mobile).slice(0, 4)

  function ConteudoSidebar() {
    return (
      <>
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-4">
          <Logo />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">Gestão da Pizzaria</p>
            <p className="truncate text-[11px] text-ink-400">Salão · Delivery · Caixa</p>
          </div>
          <IconButton
            nome="fechar"
            titulo="Fechar menu"
            variant="ghost"
            size="sm"
            className="ml-auto text-ink-400 hover:bg-white/10 hover:text-white lg:hidden"
            onClick={() => setMenuOpen(false)}
          />
        </div>

        <nav className="scroll-thin flex-1 overflow-y-auto px-2 py-3" aria-label="Menu principal">
          {grupos.map((grupo) => {
            const doGrupo = items.filter((item) => item.grupo === grupo)
            if (doGrupo.length === 0) return null
            return (
              <div key={grupo} className="mb-3 last:mb-0">
                <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-500">
                  {TITULOS_GRUPO[grupo]}
                </p>
                <ul className="space-y-0.5">
                  {doGrupo.map((item) => {
                    const selecionado = ativo(item.to)
                    return (
                      <li key={item.to}>
                        <NavLink
                          to={item.to}
                          aria-current={selecionado ? 'page' : undefined}
                          className={`group flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition duration-150 ${
                            selecionado
                              ? 'bg-brand-600 font-medium text-white shadow-sm'
                              : 'text-ink-300 hover:bg-white/[0.07] hover:text-white'
                          }`}
                        >
                          <Icon
                            nome={item.icone}
                            className={`h-[18px] w-[18px] ${selecionado ? 'text-white' : 'text-ink-400 group-hover:text-white'}`}
                          />
                          <span className="truncate">{item.rotulo}</span>
                        </NavLink>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          })}
        </nav>

        <div className="border-t border-white/10 p-3">
          <div className="flex items-center gap-2.5 rounded-lg bg-white/[0.05] px-3 py-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-600/20 text-brand-200">
              <Icon nome="usuario" className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-white">{profile?.full_name ?? '—'}</p>
              <p className="truncate text-[11px] text-ink-400">{descricaoDoUsuario}</p>
            </div>
            <IconButton
              nome="sair"
              titulo="Sair do sistema"
              variant="ghost"
              size="sm"
              className="text-ink-300 hover:bg-white/10 hover:text-white"
              onClick={() => setSairAberto(true)}
            />
          </div>
        </div>
      </>
    )
  }

  return (
    <div className="flex min-h-screen bg-ink-100">
      {/* Menu lateral fixo (desktop) */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col bg-ink-900 lg:flex">
        <ConteudoSidebar />
      </aside>

      {/* Menu lateral deslizante (tablet/celular) */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            className="absolute inset-0 bg-ink-950/60 backdrop-blur-[2px]"
            onClick={() => setMenuOpen(false)}
            aria-label="Fechar menu"
          />
          <aside className="animate-slide-in-left absolute inset-y-0 left-0 flex w-[280px] max-w-[85vw] flex-col bg-ink-900">
            <ConteudoSidebar />
          </aside>
        </div>
      )}

      {/* Conteúdo */}
      <div className="flex min-w-0 flex-1 flex-col lg:ml-64">
        <header className="sem-impressao sticky top-0 z-30 border-b border-ink-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
          <div className="flex items-center gap-3 px-3 py-2.5 sm:px-4 lg:px-6">
            <IconButton
              nome="lista"
              titulo="Abrir menu"
              variant="secondary"
              className="lg:hidden"
              onClick={() => setMenuOpen(true)}
            />
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[15px] font-semibold text-ink-900">
                {atual?.rotulo ?? (profile ? 'Acesso restrito' : 'Sistema')}
              </h1>
              <p className="hidden truncate text-xs text-ink-500 sm:block">
                {profile?.full_name}
                {descricaoDoUsuario && descricaoDoUsuario !== profile?.full_name ? ` · ${descricaoDoUsuario}` : ''}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {!online ? (
                <Badge tone="red" ponto>
                  <span className="hidden sm:inline">Sem conexão</span>
                  <span className="sm:hidden">Offline</span>
                </Badge>
              ) : realtimeConnected ? (
                <Badge tone="green" ponto>
                  <span className="hidden sm:inline">Tempo real</span>
                  <span className="sm:hidden">Ao vivo</span>
                </Badge>
              ) : (
                <Badge tone="amber" ponto>
                  <span className="hidden sm:inline">Reconectando…</span>
                  <span className="sm:hidden">Instável</span>
                </Badge>
              )}
              {isAdmin && (
                <span className="hidden sm:inline">
                  <Badge tone="brand">
                    <Icon nome="auditoria" className="h-3.5 w-3.5" />
                    Administrador
                  </Badge>
                </span>
              )}
              <IconButton
                nome="sair"
                titulo="Sair do sistema"
                variant="secondary"
                size="sm"
                className="!h-8 !w-8 lg:hidden"
                onClick={() => setSairAberto(true)}
              />
            </div>
          </div>
        </header>

        {!online && (
          <div className="sem-impressao flex items-start gap-2.5 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900 sm:text-[13px]">
            <Icon nome="nuvem-off" className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              <strong className="font-semibold">Você está sem conexão.</strong> Nada é enviado ao servidor até a
              internet voltar e <em>nenhuma venda é registrada</em> sem a confirmação dele — evite fechar contas
              agora.
            </p>
          </div>
        )}

        {online && profile && !realtimeConnected && (
          <div className="sem-impressao flex items-start gap-2.5 border-b border-sky-200 bg-sky-50 px-4 py-2.5 text-xs text-sky-900 sm:text-[13px]">
            <Icon nome="raio" className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              Atualização automática reconectando. As telas continuam funcionando, mas podem ficar alguns segundos
              atrás do servidor — use “Atualizar” se precisar do dado agora.
            </p>
          </div>
        )}

        <main className="min-w-0 flex-1 px-3 pb-24 pt-4 sm:px-4 lg:px-6 lg:pb-8 lg:pt-6">
          <Outlet />
        </main>
      </div>

      {/* Barra inferior (celular): acesso rápido às telas do dia a dia */}
      {itensMobile.length > 1 && (
        <nav
          className="barra-inferior sem-impressao fixed inset-x-0 bottom-0 z-30 border-t border-ink-200 bg-white/95 backdrop-blur lg:hidden"
          aria-label="Acesso rápido"
        >
          <ul className="flex">
            {itensMobile.map((item) => {
              const selecionado = ativo(item.to)
              return (
                <li key={item.to} className="flex-1">
                  <NavLink
                    to={item.to}
                    aria-current={selecionado ? 'page' : undefined}
                    className={`flex flex-col items-center gap-1 py-2 text-[11px] font-medium transition ${
                      selecionado ? 'text-brand-700' : 'text-ink-500'
                    }`}
                  >
                    <Icon nome={item.icone} className={`h-5 w-5 ${selecionado ? 'text-brand-600' : ''}`} />
                    {item.rotulo.split(' ')[0]}
                  </NavLink>
                </li>
              )
            })}
          </ul>
        </nav>
      )}

      <ConfirmDialog
        open={sairAberto}
        title="Sair do sistema"
        message="Você vai precisar entrar com usuário e senha novamente. Contas de mesa abertas continuam abertas."
        confirmLabel="Sair"
        tone="danger"
        loading={saindo}
        onConfirm={sair}
        onCancel={() => setSairAberto(false)}
      />
    </div>
  )
}
