import { useEffect, useMemo, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'
import { useOnlineStatus, useRealtimeSync } from '../lib/hooks'
import { ROLE_LABELS, type Role } from '../lib/types'
import { Icon, type NomeIcone } from './icons'
import { Badge, ConfirmDialog, IconButton, Modal, useToast } from './ui'
import { CommandPalette, type Comando } from './CommandPalette'

interface ItemNav {
  to: string
  rotulo: string
  icone: NomeIcone
  roles: Role[]
  grupo: 'operacao' | 'gestao' | 'sistema'
  /** Aparece na barra inferior do celular. */
  mobile?: boolean
  /** Termos extras para a busca da paleta de comandos (⌘K). */
  termos?: string
}

const NAV: ItemNav[] = [
  { to: '/caixa', rotulo: 'Caixa', icone: 'caixa', roles: ['admin', 'manager'], grupo: 'operacao', mobile: true },
  { to: '/mesas', rotulo: 'Mesas', icone: 'mesas', roles: ['admin', 'manager', 'waiter'], grupo: 'operacao', mobile: true },
  { to: '/pedidos-prontos', rotulo: 'Prontos', icone: 'check', roles: ['admin', 'manager', 'waiter'], grupo: 'operacao', mobile: true, termos: 'pedidos prontos fila entrega garçom salão' },
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
      className={`flex items-center justify-center rounded-[10px] bg-gradient-to-b from-brand-500 to-brand-700 text-white shadow-brilho ${className}`}
      aria-hidden
    >
      <Icon nome="pizza" className="h-[18px] w-[18px]" />
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
  const [paletaAberta, setPaletaAberta] = useState(false)
  const [atalhosAbertos, setAtalhosAbertos] = useState(false)
  const queryClient = useQueryClient()
  const toast = useToast()
  const [saindo, setSaindo] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  const iniciais = (profile?.full_name ?? '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((parte) => parte[0]?.toUpperCase())
    .join('')

  const items = NAV.filter((item) => profile && item.roles.includes(profile.role))
  const ativo = (to: string) => location.pathname === to || location.pathname.startsWith(`${to}/`)
  const atual = items.find((item) => ativo(item.to))

  // Fecha o menu ao trocar de tela (celular) e trava a rolagem com ele aberto.
  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname])

  /**
   * Atalhos globais — feitos para quem opera no COMPUTADOR (caixa/admin):
   *   ⌘K / Ctrl+K  abre a paleta de comandos;
   *   ?            mostra a lista de atalhos.
   * Nunca disparam enquanto o operador está digitando num campo.
   */
  useEffect(() => {
    function aoTeclar(evento: KeyboardEvent) {
      const alvo = evento.target as HTMLElement | null
      const digitando =
        alvo instanceof HTMLInputElement ||
        alvo instanceof HTMLTextAreaElement ||
        alvo instanceof HTMLSelectElement ||
        alvo?.isContentEditable === true

      // Ctrl+K abre/fecha a paleta — mas nunca por cima de outra janela aberta,
      // para não trocar o contexto de quem está no meio de um atendimento.
      if ((evento.metaKey || evento.ctrlKey) && evento.key.toLowerCase() === 'k') {
        evento.preventDefault()
        if (paletaAberta) {
          setPaletaAberta(false)
          return
        }
        if (document.querySelector('[role="dialog"]')) return
        setPaletaAberta(true)
        return
      }

      if (digitando) return
      if (document.querySelector('[role="dialog"]')) return

      // "?" abre a lista de atalhos.
      if (evento.key === '?') {
        evento.preventDefault()
        setAtalhosAbertos(true)
        return
      }

      // "/" pula direto para o campo de busca da tela aberta (histórico,
      // auditoria, cardápio…). É o atalho que os operadores esperam em lista.
      if (evento.key === '/') {
        const campo = document.querySelector<HTMLInputElement>('main input[type="search"]')
        if (campo) {
          evento.preventDefault()
          campo.focus()
        }
      }
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [paletaAberta])

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

  const comandos = useMemo<Comando[]>(() => {
    const navegacao: Comando[] = items.map((item) => ({
      id: `ir-${item.to}`,
      rotulo: `Ir para ${item.rotulo}`,
      grupo: 'Navegar',
      icone: item.icone,
      termos: item.termos,
      executar: () => navigate(item.to),
    }))
    const acoes: Comando[] = [
      {
        id: 'atalhos',
        rotulo: 'Atalhos de teclado',
        grupo: 'Ajuda',
        icone: 'info',
        atalho: '?',
        termos: 'teclas atalhos ajuda comandos',
        executar: () => setAtalhosAbertos(true),
      },
      {
        id: 'atualizar',
        rotulo: 'Atualizar os dados das telas',
        grupo: 'Ações',
        icone: 'atualizar',
        termos: 'recarregar sincronizar',
        executar: () => {
          void queryClient.invalidateQueries()
          toast.success('Pedindo dados atualizados ao servidor…')
        },
      },
    ]
    if (items.some((item) => item.to === '/caixa')) {
      acoes.push({
        id: 'painel-caixa',
        rotulo: 'Ir para a operação do caixa',
        grupo: 'Ações',
        icone: 'cofre',
        termos: 'turno gaveta abrir fechar',
        executar: () => navigate('/caixa'),
      })
    }
    acoes.push({
      id: 'sair',
      rotulo: 'Sair do sistema',
      grupo: 'Sistema',
      icone: 'sair',
      executar: () => setSairAberto(true),
    })
    return [...navegacao, ...acoes]
  }, [items, navigate, queryClient, toast])

  const grupos: ItemNav['grupo'][] = ['operacao', 'gestao', 'sistema']
  const itensMobile = items.filter((item) => item.mobile).slice(0, 4)

  function ConteudoSidebar() {
    return (
      <>
        <div className="flex items-center gap-3 px-4 py-5">
          <Logo />
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold tracking-[-0.01em] text-white">Gestão da Pizzaria</p>
            <p className="truncate text-[11px] text-white/40">Salão · Delivery · Caixa</p>
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
                <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/30">
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
                          className={`group relative flex items-center gap-2.5 rounded-[10px] px-3 py-2 text-[13.5px] transition duration-150 ease-smooth ${
                            selecionado
                              ? 'bg-white/[0.09] font-medium text-white'
                              : 'text-white/60 hover:bg-white/[0.05] hover:text-white'
                          }`}
                        >
                          {selecionado && (
                            <span
                              className="absolute -left-2 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-brand-500"
                              aria-hidden
                            />
                          )}
                          <Icon
                            nome={item.icone}
                            className={`h-[17px] w-[17px] transition ${
                              selecionado ? 'text-brand-300' : 'text-white/40 group-hover:text-white/80'
                            }`}
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

        <div className="border-t border-white/[0.08] p-3">
          <div className="flex items-center gap-2.5 rounded-[10px] bg-white/[0.04] px-3 py-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-500/15 text-[12px] font-semibold text-brand-200">
              {iniciais}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-white">{profile?.full_name ?? '—'}</p>
              <p className="truncate text-[11px] text-white/40">{descricaoDoUsuario}</p>
            </div>
            <IconButton
              nome="sair"
              titulo="Sair do sistema"
              variant="ghost"
              size="sm"
              className="text-white/50 hover:bg-white/10 hover:text-white"
              onClick={() => setSairAberto(true)}
            />
          </div>
        </div>
      </>
    )
  }

  return (
    <div className="papel-da-tela flex min-h-screen">
      {/* Menu lateral fixo (desktop) */}
      <aside className="lateral fixed inset-y-0 left-0 z-40 hidden w-[248px] flex-col border-r border-black/20 lg:flex">
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
          <aside className="lateral animate-slide-in-left absolute inset-y-0 left-0 flex w-[264px] max-w-[85vw] flex-col border-r border-black/30">
            <ConteudoSidebar />
          </aside>
        </div>
      )}

      {/* Conteúdo */}
      <div className="flex min-w-0 flex-1 flex-col lg:ml-[248px]">
        <header className="sem-impressao sticky top-0 z-30 border-b border-ink-200/80 bg-white/80 backdrop-blur-md">
          <div className="mx-auto flex w-full max-w-tela items-center gap-3 px-3 py-2.5 sm:px-5 lg:px-7">
            <IconButton
              nome="lista"
              titulo="Abrir menu"
              variant="secondary"
              className="lg:hidden"
              onClick={() => setMenuOpen(true)}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-semibold tracking-[-0.01em] text-ink-900">
                {atual?.rotulo ?? (profile ? 'Acesso restrito' : 'Sistema')}
              </p>
              <p className="hidden truncate text-[12px] text-ink-500 sm:block">
                {profile?.full_name}
                {descricaoDoUsuario && descricaoDoUsuario !== profile?.full_name ? ` · ${descricaoDoUsuario}` : ''}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPaletaAberta(true)}
                className="hidden items-center gap-2 rounded-control border border-ink-200 bg-white px-3 py-1.5 text-pequeno text-ink-400 shadow-card transition hover:border-ink-300 hover:text-ink-600 lg:flex"
                title="Buscar telas e ações (Ctrl+K)"
              >
                <Icon nome="busca" className="h-4 w-4" />
                Buscar ou ir para…
                <kbd className="rounded-[5px] border border-ink-200 bg-ink-50 px-1.5 py-0.5 text-[11px] font-medium text-ink-500">
                  Ctrl K
                </kbd>
              </button>
              <IconButton
                nome="busca"
                titulo="Buscar telas e ações"
                variant="secondary"
                size="sm"
                className="!h-8 !w-8 lg:hidden"
                onClick={() => setPaletaAberta(true)}
              />
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
          <div className="sem-impressao flex items-start gap-2.5 border-b border-amber-200/70 bg-amber-50/80 px-4 py-2.5 text-pequeno text-amber-900 sm:px-7">
            <Icon nome="nuvem-off" className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              <strong className="font-semibold">Você está sem conexão.</strong> Nada é enviado ao servidor até a
              internet voltar e <em>nenhuma venda é registrada</em> sem a confirmação dele — evite fechar contas
              agora.
            </p>
          </div>
        )}

        {online && profile && !realtimeConnected && (
          <div className="sem-impressao flex items-start gap-2.5 border-b border-sky-200/70 bg-sky-50/80 px-4 py-2.5 text-pequeno text-sky-900 sm:px-7">
            <Icon nome="raio" className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              Atualização automática reconectando. As telas continuam funcionando, mas podem ficar alguns segundos
              atrás do servidor — use “Atualizar” se precisar do dado agora.
            </p>
          </div>
        )}

        <main className="min-w-0 flex-1 px-3 pb-24 pt-5 sm:px-5 lg:px-7 lg:pb-10 lg:pt-7">
          <div key={location.pathname} className="animate-fade-in mx-auto w-full max-w-tela">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Barra inferior (celular): acesso rápido às telas do dia a dia */}
      {itensMobile.length > 1 && (
        <nav
          className="barra-inferior sem-impressao fixed inset-x-0 bottom-0 z-30 border-t border-ink-200/80 bg-white/90 backdrop-blur-md lg:hidden"
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
                    title={item.rotulo}
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

      <CommandPalette aberta={paletaAberta} onFechar={() => setPaletaAberta(false)} comandos={comandos} />

      <Modal
        open={atalhosAbertos}
        title="Atalhos de teclado"
        descricao="Feitos para quem opera o sistema no computador (caixa e administração)."
        onClose={() => setAtalhosAbertos(false)}
        size="sm"
      >
        <ul className="divide-y divide-ink-100">
          {[
            { teclas: 'Ctrl K', o: 'Abrir a busca de telas e ações' },
            { teclas: '?', o: 'Ver esta lista de atalhos' },
            { teclas: '/', o: 'Ir para o campo de busca da tela' },
            { teclas: 'Esc', o: 'Fechar a janela aberta' },
            { teclas: '↑ ↓', o: 'Navegar na busca' },
            { teclas: 'Enter', o: 'Abrir o item escolhido / confirmar' },
            { teclas: 'Tab', o: 'Passar de um campo para o outro' },
          ].map((linha) => (
            <li key={linha.teclas} className="flex items-center justify-between gap-4 py-2.5">
              <span className="text-pequeno text-ink-700">{linha.o}</span>
              <kbd className="shrink-0 rounded-[6px] border border-ink-200 bg-ink-50 px-2 py-1 text-[11px] font-semibold text-ink-600">
                {linha.teclas}
              </kbd>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11px] leading-relaxed text-ink-500">
          No celular, o sistema é todo por toque: os botões principais ficam na parte de baixo da tela, ao alcance do
          polegar.
        </p>
      </Modal>

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
