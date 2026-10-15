import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon, type NomeIcone } from './icons'
import { Badge } from './ui'

export interface Comando {
  id: string
  rotulo: string
  grupo: string
  icone?: NomeIcone
  atalho?: string
  /** Termos extras para a busca (ex.: "fechar turno" para Controle de caixa). */
  termos?: string
  executar: () => void
}

/** Tira acento e caixa para a busca casar como o operador digita ("pizzao" acha "Pizzão"). */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * Paleta de comandos do sistema (⌘K / Ctrl+K).
 *
 * Existe para quem trabalha no COMPUTADOR — caixa e administração: em vez de
 * caçar o item no menu, o operador digita o que quer e aperta Enter. É um
 * acelerador em cima do menu visível, nunca um substituto dele (o menu
 * continua na lateral para quem não usa teclado).
 *
 * Teclado: ↑ ↓ para navegar, Enter para executar, Esc para fechar.
 */
export function CommandPalette({
  aberta,
  onFechar,
  comandos,
}: {
  aberta: boolean
  onFechar: () => void
  comandos: Comando[]
}) {
  const [busca, setBusca] = useState('')
  const [ativo, setAtivo] = useState(0)
  const listaRef = useRef<HTMLUListElement>(null)

  const filtrados = useMemo(() => {
    const termo = normalizar(busca)
    if (!termo) return comandos
    return comandos.filter((comando) =>
      normalizar(`${comando.rotulo} ${comando.grupo} ${comando.termos ?? ''}`).includes(termo),
    )
  }, [busca, comandos])

  const grupos = useMemo(() => {
    const mapa = new Map<string, Comando[]>()
    for (const comando of filtrados) {
      const lista = mapa.get(comando.grupo) ?? []
      lista.push(comando)
      mapa.set(comando.grupo, lista)
    }
    return [...mapa.entries()]
  }, [filtrados])

  // Reinicia o estado a cada abertura.
  useEffect(() => {
    if (aberta) {
      setBusca('')
      setAtivo(0)
    }
  }, [aberta])

  useEffect(() => {
    setAtivo(0)
  }, [busca])

  useEffect(() => {
    if (!aberta) return
    const overflowAnterior = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = overflowAnterior
    }
  }, [aberta])

  // Mantém o item ativo visível ao navegar com as setas.
  useEffect(() => {
    const elemento = listaRef.current?.querySelector<HTMLElement>('[data-ativo="true"]')
    elemento?.scrollIntoView({ block: 'nearest' })
  }, [ativo])

  if (!aberta) return null

  function executar(indice: number) {
    const comando = filtrados[indice]
    if (!comando) return
    onFechar()
    // Executa depois de fechar, para o foco voltar ao lugar certo.
    window.setTimeout(() => comando.executar(), 0)
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-ink-950/40 p-4 pt-[12vh] backdrop-blur-[3px]"
      onMouseDown={(evento) => {
        if (evento.target === evento.currentTarget) onFechar()
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Buscar e executar comandos"
    >
      <div className="animate-slide-up w-full max-w-xl overflow-hidden rounded-card bg-white shadow-float ring-1 ring-ink-900/5">
        <div className="flex items-center gap-3 border-b border-ink-100 px-4 py-3">
          <Icon nome="busca" className="h-[18px] w-[18px] shrink-0 text-ink-400" />
          <input
            autoFocus
            value={busca}
            onChange={(evento) => setBusca(evento.target.value)}
            onKeyDown={(evento) => {
              if (evento.key === 'ArrowDown') {
                evento.preventDefault()
                setAtivo((atual) => Math.min(atual + 1, filtrados.length - 1))
              } else if (evento.key === 'ArrowUp') {
                evento.preventDefault()
                setAtivo((atual) => Math.max(atual - 1, 0))
              } else if (evento.key === 'Enter') {
                evento.preventDefault()
                executar(ativo)
              } else if (evento.key === 'Escape') {
                evento.preventDefault()
                onFechar()
              }
            }}
            placeholder="Ir para uma tela ou executar uma ação…"
            className="w-full bg-transparent text-base text-ink-900 outline-none placeholder:text-ink-400 focus-visible:ring-0 focus-visible:ring-offset-0"
            aria-label="Buscar comando"
          />
          <kbd className="hidden rounded-[5px] border border-ink-200 bg-ink-50 px-1.5 py-0.5 text-[11px] font-medium text-ink-500 sm:block">
            Esc
          </kbd>
        </div>

        {filtrados.length === 0 ? (
          <p className="px-4 py-8 text-center text-pequeno text-ink-500">
            Nada encontrado para “{busca}”. Tente o nome da tela (mesas, caixa, cardápio…).
          </p>
        ) : (
          <ul ref={listaRef} className="scroll-thin max-h-[52vh] overflow-y-auto py-2">
            {grupos.map(([grupo, itens]) => (
              <li key={grupo}>
                <p className="rotulo px-4 pb-1 pt-2">{grupo}</p>
                <ul>
                  {itens.map((comando) => {
                    const indice = filtrados.indexOf(comando)
                    const selecionado = indice === ativo
                    return (
                      <li key={comando.id}>
                        <button
                          type="button"
                          data-ativo={selecionado}
                          onMouseEnter={() => setAtivo(indice)}
                          onClick={() => executar(indice)}
                          className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-pequeno transition-colors ${
                            selecionado ? 'bg-brand-50 text-ink-900' : 'text-ink-700 hover:bg-ink-50'
                          }`}
                        >
                          {comando.icone && (
                            <Icon
                              nome={comando.icone}
                              className={`h-[17px] w-[17px] ${selecionado ? 'text-brand-600' : 'text-ink-400'}`}
                            />
                          )}
                          <span className="flex-1 truncate">{comando.rotulo}</span>
                          {comando.atalho && <Badge tone="slate">{comando.atalho}</Badge>}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-ink-100 bg-ink-50/60 px-4 py-2.5 text-[11px] text-ink-500">
          <span className="flex items-center gap-2">
            <kbd className="rounded-[5px] border border-ink-200 bg-white px-1.5 py-0.5 font-medium">↑</kbd>
            <kbd className="rounded-[5px] border border-ink-200 bg-white px-1.5 py-0.5 font-medium">↓</kbd>
            navegar
            <kbd className="ml-2 rounded-[5px] border border-ink-200 bg-white px-1.5 py-0.5 font-medium">Enter</kbd>
            abrir
          </span>
          <span>digite o nome da tela ou da ação</span>
        </div>
      </div>
    </div>
  )
}
