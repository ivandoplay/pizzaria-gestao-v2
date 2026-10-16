/**
 * Design system do sistema — primitivos de interface usados por todas as telas.
 *
 * Diretrizes (revisão de 15/10/2026, com base em padrões de 2026 usados por
 * Linear/Stripe/Vercel e nas regras que fazem um produto parecer profissional):
 *  · superfície = borda de 1px + sombra quase invisível (sombra é elevação, não enfeite);
 *  · escala curta de tamanhos de texto — variedade vem de peso, cor e espaço;
 *  · raio externo ≠ raio interno (cartão 14 px, elemento interno 8 px);
 *  · espaçamento sempre de 4 em 4 (12/16/20/24), sem valores soltos;
 *  · cor de marca só como ACENTO: ação, foco e seleção;
 *  · micro-interações curtas (150–220 ms) e com propósito.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { Icon, type NomeIcone } from './icons'

// ===========================================================================
// BOTÕES
// ===========================================================================
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'

const VARIANTS: Record<Variant, string> = {
  primary: 'botao-primario',
  secondary:
    'bg-white text-ink-700 border border-ink-300 shadow-card hover:bg-ink-50 hover:border-ink-400 active:translate-y-px',
  ghost: 'bg-transparent text-ink-600 hover:bg-ink-100 hover:text-ink-900 active:bg-ink-200',
  danger: 'bg-rose-600 text-white shadow-brilho hover:bg-rose-700 active:translate-y-px',
  success: 'bg-emerald-600 text-white shadow-brilho hover:bg-emerald-700 active:translate-y-px',
}

const SIZES = {
  sm: 'h-11 gap-1.5 px-2.5 text-pequeno rounded-interno sm:h-8',
  md: 'h-11 gap-2 px-3.5 text-pequeno rounded-control sm:h-10',
  lg: 'h-12 gap-2 px-5 text-base rounded-control',
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  icone,
  iconeDireita,
  block,
  children,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  icone?: NomeIcone
  iconeDireita?: NomeIcone
  block?: boolean
}) {
  const tamanhoIcone = size === 'sm' ? 'h-4 w-4' : 'h-[17px] w-[17px]'
  return (
    <button
      type={props.type ?? 'button'}
      {...props}
      disabled={props.disabled || loading}
      className={`inline-flex select-none items-center justify-center whitespace-nowrap font-medium transition duration-150
        ease-smooth focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:ring-offset-2
        disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none
        ${VARIANTS[variant]} ${SIZES[size]} ${block ? 'w-full' : ''} ${className}`}
    >
      {loading ? (
        <Spinner className={tamanhoIcone} />
      ) : (
        icone && <Icon nome={icone} className={tamanhoIcone} />
      )}
      {children}
      {iconeDireita && !loading && (
        <Icon nome={iconeDireita} className={`${tamanhoIcone} opacity-60`} />
      )}
    </button>
  )
}

/** Botão só com ícone — usado em barras de ação e linhas de tabela. */
export function IconButton({
  nome,
  titulo,
  size = 'md',
  variant = 'ghost',
  className = '',
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'title'> & {
  nome: NomeIcone
  titulo: string
  size?: 'sm' | 'md' | 'lg'
  variant?: Variant
}) {
  const lado = {
    sm: 'h-11 w-11 rounded-interno sm:h-8 sm:w-8',
    md: 'h-11 w-11 rounded-control sm:h-10 sm:w-10',
    lg: 'h-12 w-12 rounded-control',
  }[size]
  return (
    <button
      type={props.type ?? 'button'}
      {...props}
      title={titulo}
      aria-label={titulo}
      className={`inline-flex shrink-0 items-center justify-center transition duration-150 ease-smooth
        disabled:cursor-not-allowed disabled:opacity-45 ${VARIANTS[variant]} ${lado} ${className}`}
    >
      <Icon nome={nome} className={size === 'sm' ? 'h-4 w-4' : 'h-[18px] w-[18px]'} />
    </button>
  )
}

export function Spinner({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <span
      className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
      role="status"
      aria-label="Carregando"
    />
  )
}

// ===========================================================================
// ESTRUTURA DE PÁGINA
// ===========================================================================
/** Cabeçalho padrão de todas as telas: título, contexto e ações. */
export function PageHeader({
  titulo,
  descricao,
  acoes,
  voltar,
  selo,
}: {
  titulo: string
  descricao?: ReactNode
  acoes?: ReactNode
  voltar?: ReactNode
  selo?: ReactNode
}) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        {voltar}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-titulo font-semibold text-ink-900">{titulo}</h1>
            {selo}
          </div>
          {descricao && (
            <p className="mt-1 max-w-3xl text-pequeno leading-relaxed text-ink-500">{descricao}</p>
          )}
        </div>
      </div>
      {acoes && <div className="flex flex-wrap items-center gap-2">{acoes}</div>}
    </header>
  )
}

export function Card({
  title,
  actions,
  children,
  className = '',
  padded = true,
  descricao,
  rodape,
  icone,
}: {
  title?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  padded?: boolean
  descricao?: ReactNode
  rodape?: ReactNode
  icone?: NomeIcone
}) {
  return (
    <section
      className={`flex flex-col overflow-hidden rounded-card border border-ink-200 bg-white shadow-card ${className}`}
    >
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-4 py-3.5 sm:px-5">
          {/* O bloco do título ocupa o espaço que sobra: assim o selo/contador do
              cabeçalho fica na mesma linha do título em vez de cair sozinho
              embaixo dele quando a descrição é comprida (celular). */}
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {icone && (
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-interno bg-ink-100 text-ink-600">
                <Icon nome={icone} className="h-4 w-4" />
              </span>
            )}
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold leading-snug tracking-[-0.01em] text-ink-900">
                {title}
              </h2>
              {descricao && <p className="mt-0.5 text-pequeno leading-snug text-ink-500">{descricao}</p>}
            </div>
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={padded ? 'flex-1 p-4 sm:p-5' : 'flex-1'}>{children}</div>
      {rodape && (
        <footer className="border-t border-ink-100 bg-ink-50/50 px-4 py-3 sm:px-5">{rodape}</footer>
      )}
    </section>
  )
}

/**
 * Número de destaque (painel do dia, relatórios, caixa).
 * Só o ícone recebe cor — o cartão fica branco para não competir com o dado.
 */
export function StatTile({
  rotulo,
  valor,
  detalhe,
  icone,
  tom = 'neutro',
  className = '',
}: {
  rotulo: string
  valor: ReactNode
  detalhe?: ReactNode
  icone?: NomeIcone
  tom?: 'neutro' | 'marca' | 'verde' | 'ambar' | 'vermelho'
  className?: string
}) {
  const iconeTom = {
    neutro: 'bg-ink-100 text-ink-500',
    marca: 'bg-brand-50 text-brand-600',
    verde: 'bg-emerald-50 text-emerald-600',
    ambar: 'bg-amber-50 text-amber-600',
    vermelho: 'bg-rose-50 text-rose-600',
  }
  return (
    <div
      className={`rounded-card border border-ink-200 bg-white p-4 shadow-card transition-colors duration-200 hover:border-ink-300 ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="rotulo leading-tight">{rotulo}</p>
        {icone && (
          <span className={`-mt-0.5 flex h-7 w-7 items-center justify-center rounded-interno ${iconeTom[tom]}`}>
            <Icon nome={icone} className="h-4 w-4" />
          </span>
        )}
      </div>
      <p className="num mt-3 text-[25px] font-semibold leading-tight text-ink-900 sm:text-numero">{valor}</p>
      {detalhe && <p className="mt-1 text-pequeno text-ink-500">{detalhe}</p>}
    </div>
  )
}

/** Faixa de aviso embutida na tela (erro, atenção, informação). */
export function Callout({
  tom = 'info',
  titulo,
  children,
  acoes,
}: {
  tom?: 'info' | 'atencao' | 'erro' | 'sucesso'
  titulo?: string
  children?: ReactNode
  acoes?: ReactNode
}) {
  const tons = {
    info: { caixa: 'border-sky-200/70 bg-sky-50/70 text-sky-900', icone: 'text-sky-600' },
    atencao: { caixa: 'border-amber-200/70 bg-amber-50/70 text-amber-900', icone: 'text-amber-600' },
    erro: { caixa: 'border-rose-200/70 bg-rose-50/70 text-rose-900', icone: 'text-rose-600' },
    sucesso: { caixa: 'border-emerald-200/70 bg-emerald-50/70 text-emerald-900', icone: 'text-emerald-600' },
  }
  const icones: Record<string, NomeIcone> = {
    info: 'info',
    atencao: 'alerta',
    erro: 'alerta',
    sucesso: 'check',
  }
  return (
    <div className={`flex flex-wrap items-start gap-x-3 gap-y-2.5 rounded-card border px-4 py-3 text-pequeno ${tons[tom].caixa}`}>
      <Icon nome={icones[tom]} className={`mt-0.5 h-[17px] w-[17px] shrink-0 ${tons[tom].icone}`} />
      <div className="min-w-0 flex-1 leading-relaxed">
        {titulo && <p className="font-semibold">{titulo}</p>}
        {children && <div className={titulo ? 'mt-0.5 opacity-90' : ''}>{children}</div>}
      </div>
      {acoes && (
        <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto [&>button]:w-full sm:[&>button]:w-auto">
          {acoes}
        </div>
      )}
    </div>
  )
}

export function Badge({
  children,
  tone = 'slate',
  ponto,
  className = '',
}: {
  children: ReactNode
  tone?: 'slate' | 'green' | 'amber' | 'red' | 'blue' | 'brand'
  ponto?: boolean
  className?: string
}) {
  const tones = {
    slate: 'bg-ink-100 text-ink-600',
    green: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-800',
    red: 'bg-rose-50 text-rose-700',
    blue: 'bg-sky-50 text-sky-700',
    brand: 'bg-brand-50 text-brand-700',
  }
  const pontos = {
    slate: 'bg-ink-400',
    green: 'bg-emerald-500',
    amber: 'bg-amber-500',
    red: 'bg-rose-500',
    blue: 'bg-sky-500',
    brand: 'bg-brand-500',
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-medium leading-none ${tones[tone]} ${className}`}
    >
      {ponto && <span className={`h-1.5 w-1.5 rounded-full ${pontos[tone]}`} />}
      {children}
    </span>
  )
}

/** Selo de status de pedido/turno — traduz o código do banco para o operador. */
const STATUS_INFO: Record<string, { rotulo: string; tone: 'slate' | 'green' | 'amber' | 'red' | 'blue' | 'brand' }> = {
  draft: { rotulo: 'Rascunho', tone: 'slate' },
  received: { rotulo: 'Recebido', tone: 'blue' },
  confirmed: { rotulo: 'Confirmado', tone: 'brand' },
  preparing: { rotulo: 'Em preparo', tone: 'amber' },
  ready: { rotulo: 'Pronto', tone: 'green' },
  delivered_to_table: { rotulo: 'Entregue na mesa', tone: 'green' },
  out_for_delivery: { rotulo: 'Saiu para entrega', tone: 'amber' },
  delivered: { rotulo: 'Entregue', tone: 'green' },
  cancelled: { rotulo: 'Cancelado', tone: 'red' },
}

export function StatusPill({ status, className = '' }: { status: string; className?: string }) {
  const info = STATUS_INFO[status] ?? { rotulo: status, tone: 'slate' as const }
  return (
    <Badge tone={info.tone} ponto className={`text-micro uppercase tracking-[0.05em] ${className}`}>
      {info.rotulo}
    </Badge>
  )
}

export function EmptyState({
  title,
  description,
  action,
  icone = 'lista',
}: {
  title: string
  description?: string
  action?: ReactNode
  icone?: NomeIcone
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2.5 rounded-card bg-ink-50/50 px-6 py-10 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-control border border-ink-200 bg-white text-ink-400">
        <Icon nome={icone} className="h-[18px] w-[18px]" />
      </span>
      <div>
        <p className="text-[15px] font-semibold text-ink-800">{title}</p>
        {description && (
          <p className="mx-auto mt-1 max-w-md text-pequeno leading-relaxed text-ink-500">{description}</p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}

/** Esqueleto de carregamento — evita o "pulo" de layout. */
export function Skeleton({ className = 'h-4 w-full' }: { className?: string }) {
  return <span className={`esqueleto block ${className}`} />
}

export function LoadingBlock({ label = 'Carregando…', linhas = 3 }: { label?: string; linhas?: number }) {
  return (
    <div className="space-y-3" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      {Array.from({ length: linhas }).map((_, indice) => (
        <Skeleton key={indice} className={indice === 0 ? 'h-5 w-1/3' : 'h-4 w-full'} />
      ))}
      <div className="flex items-center gap-2 pt-1 text-pequeno text-ink-400">
        <Spinner className="h-3.5 w-3.5" />
        {label}
      </div>
    </div>
  )
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Callout
      tom="erro"
      titulo="Não foi possível carregar"
      acoes={
        onRetry && (
          <Button variant="secondary" size="sm" icone="atualizar" onClick={onRetry}>
            Tentar de novo
          </Button>
        )
      }
    >
      {message}
    </Callout>
  )
}

// ===========================================================================
// FORMULÁRIOS
// ===========================================================================
export function Field({
  label,
  hint,
  error,
  children,
  className = '',
  obrigatorio,
}: {
  label?: string
  hint?: string
  error?: string
  children: ReactNode
  className?: string
  obrigatorio?: boolean
}) {
  return (
    <label className={`block ${className}`}>
      {label && (
        <span className="mb-1.5 block text-pequeno font-medium text-ink-700">
          {label}
          {obrigatorio && <span className="ml-0.5 text-brand-600">*</span>}
        </span>
      )}
      {children}
      {hint && !error && <span className="mt-1.5 block text-[12px] leading-snug text-ink-500">{hint}</span>}
      {error && (
        <span className="mt-1.5 flex items-center gap-1 text-[12px] font-medium text-rose-600">
          <Icon nome="alerta" className="h-3.5 w-3.5" />
          {error}
        </span>
      )}
    </label>
  )
}

/** Classes dos campos: `campo` fica na camada de componentes (ver styles.css). */
const inputClass = 'campo'

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputClass} ${className}`} />
}

export function Textarea({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${inputClass} min-h-[84px] resize-y ${className}`} />
}

export function Select({ className = '', children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`${inputClass} cursor-pointer appearance-none bg-[length:16px] bg-[right_0.7rem_center] bg-no-repeat pr-9 ${className}`}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%237c766e' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5.5 9L12 15.5 18.5 9'/%3E%3C/svg%3E\")",
        ...props.style,
      }}
    >
      {children}
    </select>
  )
}

/** Campo de busca com ícone — usado em filtros e listas. */
export function SearchInput({
  value,
  onValueChange,
  placeholder = 'Buscar…',
  className = '',
  autoFocus,
}: {
  value: string
  onValueChange: (valor: string) => void
  placeholder?: string
  className?: string
  autoFocus?: boolean
}) {
  return (
    <div className={`relative ${className}`}>
      <Icon
        nome="busca"
        className="pointer-events-none absolute left-3 top-1/2 h-[17px] w-[17px] -translate-y-1/2 text-ink-400"
      />
      <input
        type="search"
        value={value}
        autoFocus={autoFocus}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder={placeholder}
        className={`${inputClass} pl-9`}
      />
    </div>
  )
}

export function Checkbox({
  label,
  checked,
  onChange,
  disabled,
  hint,
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
  hint?: string
}) {
  return (
    <label
      className={`flex min-h-[44px] cursor-pointer items-center gap-2.5 text-pequeno text-ink-700 sm:min-h-0 sm:items-start ${
        disabled ? 'cursor-not-allowed opacity-60' : ''
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-[17px] w-[17px] shrink-0 cursor-pointer rounded-[5px] accent-brand-600 disabled:cursor-not-allowed"
      />
      <span className="leading-snug">
        {label}
        {hint && <span className="mt-0.5 block text-[12px] text-ink-500">{hint}</span>}
      </span>
    </label>
  )
}

/** Seletor com alternância visual entre poucas opções (ex.: Tipo, Turno). */
export function SegmentedControl<T extends string>({
  opcoes,
  valor,
  onChange,
  className = '',
}: {
  opcoes: { valor: T; rotulo: string; icone?: NomeIcone }[]
  valor: T
  onChange: (valor: T) => void
  className?: string
}) {
  return (
    <div
      className={`inline-flex max-w-full flex-wrap rounded-control border border-ink-200 bg-ink-100/80 p-[3px] ${className}`}
      role="tablist"
    >
      {opcoes.map((opcao) => {
        const ativo = opcao.valor === valor
        return (
          <button
            key={opcao.valor}
            type="button"
            role="tab"
            aria-selected={ativo}
            onClick={() => onChange(opcao.valor)}
            className={`inline-flex min-h-[44px] items-center gap-1.5 whitespace-nowrap rounded-[9px] px-3.5 py-2 text-pequeno font-medium transition duration-150 ease-smooth sm:min-h-0 sm:rounded-[7px] sm:px-3 sm:py-1.5 ${
              ativo
                ? 'bg-white text-ink-900 shadow-card ring-1 ring-ink-200/70'
                : 'text-ink-500 hover:text-ink-800'
            }`}
          >
            {opcao.icone && <Icon nome={opcao.icone} className="h-4 w-4" />}
            {opcao.rotulo}
          </button>
        )
      })}
    </div>
  )
}

/** Controle de quantidade (+/−) usado no lançamento de pedidos. */
export function QtyStepper({
  value,
  onChange,
  min = 1,
  max = 99,
  disabled,
}: {
  value: number
  onChange: (valor: number) => void
  min?: number
  max?: number
  disabled?: boolean
}) {
  const botao =
    'flex h-11 w-11 items-center justify-center text-ink-500 transition hover:bg-ink-50 hover:text-ink-800 active:bg-ink-100 disabled:cursor-not-allowed disabled:opacity-40 sm:h-9 sm:w-9'
  return (
    <div className="inline-flex items-center overflow-hidden rounded-control border border-ink-200 bg-white shadow-card">
      <button
        type="button"
        className={botao}
        disabled={disabled || value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
        aria-label="Diminuir"
      >
        <Icon nome="menos" className="h-4 w-4" />
      </button>
      <span className="num w-10 text-center text-base font-semibold text-ink-900" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        className={botao}
        disabled={disabled || value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
        aria-label="Aumentar"
      >
        <Icon nome="mais" className="h-4 w-4" />
      </button>
    </div>
  )
}

// ===========================================================================
// MODAL
// ===========================================================================
const TAMANHOS_MODAL = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-6xl' }

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  size = 'md',
  descricao,
  enterConfirma = true,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  descricao?: string
  /** Enter num campo confirma a ação principal da janela (teclado do computador). */
  enterConfirma?: boolean
}) {
  const idTitulo = useId()
  const painel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const anterior = document.activeElement as HTMLElement | null
    const overflowAnterior = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }
      // Enter confirma: quem digita no computador não larga o teclado para
      // clicar. Só dispara de dentro de um campo de texto simples — e nunca
      // quando o botão principal é destrutivo (vermelho) nem em textarea,
      // onde Enter serve para quebrar linha.
      if (event.key === 'Enter' && enterConfirma && !event.defaultPrevented) {
        const alvo = event.target as HTMLElement | null
        if (alvo && alvo.tagName === 'INPUT') {
          const botoes = painel.current?.querySelectorAll<HTMLButtonElement>('footer button')
          const principal = botoes?.[botoes.length - 1]
          if (principal && !principal.disabled && !/bg-rose/.test(principal.className)) {
            event.preventDefault()
            principal.click()
          }
        }
      }

      // Prende o foco dentro do modal enquanto ele está aberto.
      if (event.key !== 'Tab' || !painel.current) return
      const focaveis = painel.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
      )
      if (focaveis.length === 0) return
      const primeiro = focaveis[0]
      const ultimo = focaveis[focaveis.length - 1]
      if (!event.shiftKey && document.activeElement === ultimo) {
        event.preventDefault()
        primeiro.focus()
      } else if (event.shiftKey && document.activeElement === primeiro) {
        event.preventDefault()
        ultimo.focus()
      }
    }
    window.addEventListener('keydown', handler, true)

    // Coloca o foco no primeiro campo/botão assim que abre.
    const timer = window.setTimeout(() => {
      const alvo = painel.current?.querySelector<HTMLElement>(
        'input:not([type="hidden"]), select, textarea, button:not([data-fechar])',
      )
      alvo?.focus()
    }, 40)

    return () => {
      window.removeEventListener('keydown', handler, true)
      document.body.style.overflow = overflowAnterior
      window.clearTimeout(timer)
      anterior?.focus?.()
    }
  }, [open, onClose, enterConfirma])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain bg-ink-950/40 p-0 backdrop-blur-[3px] sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={painel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        className={`sem-impressao animate-slide-up w-full ${TAMANHOS_MODAL[size]} rounded-t-2xl bg-white shadow-float ring-1 ring-ink-900/5 sm:my-6 sm:rounded-card`}
      >
        <header className="flex items-start justify-between gap-4 border-b border-ink-100 px-5 py-4">
          <div className="min-w-0">
            <h3 id={idTitulo} className="text-[15px] font-semibold tracking-[-0.01em] text-ink-900">
              {title}
            </h3>
            {descricao && <p className="mt-0.5 text-pequeno text-ink-500">{descricao}</p>}
          </div>
          <IconButton nome="fechar" titulo="Fechar" size="sm" onClick={onClose} data-fechar />
        </header>
        <div className="scroll-thin max-h-[calc(100vh-12rem)] overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <footer className="flex flex-wrap justify-end gap-2 border-t border-ink-100 bg-ink-50/50 px-5 py-3.5">
            {footer}
          </footer>
        )}
      </div>
    </div>
  )
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  tone = 'primary',
  onConfirm,
  onCancel,
  loading,
  children,
}: {
  open: boolean
  title: string
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  tone?: Variant
  onConfirm: () => void
  onCancel: () => void
  loading?: boolean
  /** Conteúdo extra (ex.: motivo obrigatório para cancelamento). */
  children?: ReactNode
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      size="sm"
      enterConfirma={false}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={tone} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="text-pequeno leading-relaxed text-ink-700">{message}</div>
        {children}
      </div>
    </Modal>
  )
}

// ===========================================================================
// AVISOS (toast)
// ===========================================================================
type Toast = { id: number; kind: 'success' | 'error' | 'info'; message: string }

type ToastApi = {
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
}

const ToastContext = createContext<ToastApi>({
  success: () => {},
  error: () => {},
  info: () => {},
})

const TOAST_VISUAL: Record<Toast['kind'], { caixa: string; icone: NomeIcone; cor: string }> = {
  success: { caixa: 'border-emerald-200', icone: 'check', cor: 'bg-emerald-50 text-emerald-600' },
  error: { caixa: 'border-rose-200', icone: 'alerta', cor: 'bg-rose-50 text-rose-600' },
  info: { caixa: 'border-ink-200', icone: 'info', cor: 'bg-ink-100 text-ink-600' },
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const remover = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const push = useCallback(
    (kind: Toast['kind'], message: string) => {
      const id = Date.now() + Math.random()
      setToasts((prev) => [...prev.slice(-3), { id, kind, message }])
      window.setTimeout(() => remover(id), kind === 'error' ? 9000 : 5000)
    },
    [remover],
  )

  const value = useMemo<ToastApi>(
    () => ({
      success: (message) => push('success', message),
      error: (message) => push('error', message),
      info: (message) => push('info', message),
    }),
    [push],
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="sem-impressao pointer-events-none fixed bottom-3 left-3 right-3 z-[100] flex flex-col items-center gap-2 sm:bottom-5 sm:left-auto sm:right-5 sm:w-[360px] sm:items-stretch"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.kind === 'error' ? 'alert' : 'status'}
            className={`animate-slide-in-right pointer-events-auto flex w-full items-start gap-3 rounded-card border bg-white p-3.5 shadow-float ${TOAST_VISUAL[toast.kind].caixa}`}
          >
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${TOAST_VISUAL[toast.kind].cor}`}
            >
              <Icon nome={TOAST_VISUAL[toast.kind].icone} className="h-4 w-4" />
            </span>
            <p className="flex-1 pt-0.5 text-pequeno leading-snug text-ink-800">{toast.message}</p>
            <button
              type="button"
              onClick={() => remover(toast.id)}
              className="-mr-1 -mt-1 rounded-interno p-1.5 text-ink-400 transition hover:bg-ink-100 hover:text-ink-700"
              aria-label="Fechar aviso"
            >
              <Icon nome="fechar" className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  return useContext(ToastContext)
}

// ===========================================================================
// TABELAS
// ===========================================================================
export function DataTable<T>({
  columns,
  rows,
  emptyMessage = 'Nenhum registro encontrado.',
  emptyDescription,
  rowKey,
  onRowClick,
  dense,
  maxHeight,
  rodape,
  minW = 'min-w-[560px]',
  tamanho = 'padrao',
}: {
  columns: {
    key: string
    header: ReactNode
    render: (row: T) => ReactNode
    align?: 'right' | 'center'
    /** Largura fixa opcional (texto Tailwind, ex.: 'w-32'). */
    width?: string
  }[]
  rows: T[]
  emptyMessage?: string
  emptyDescription?: string
  rowKey: (row: T) => string | number
  onRowClick?: (row: T) => void
  dense?: boolean
  /** Altura máxima da área rolável (ex.: '60vh'); cabeçalho continua visível. */
  maxHeight?: string
  rodape?: ReactNode
  /** Largura mínima da tabela (classe Tailwind). `min-w-0` deixa as colunas se ajustarem. */
  minW?: string
  /** `compacto` reduz a altura das linhas (listas longas dentro de cartões). */
  tamanho?: 'padrao' | 'compacto'
}) {
  if (rows.length === 0) {
    return (
      <div className="p-1">
        <EmptyState title={emptyMessage} description={emptyDescription} />
      </div>
    )
  }

  const padding = dense || tamanho === 'compacto' ? 'px-4 py-2.5' : 'px-4 py-3.5 lg:py-2.5'

  return (
    <div className="overflow-hidden rounded-card border border-ink-200 bg-white">
      <div className="scroll-thin overflow-x-auto" style={maxHeight ? { maxHeight } : undefined}>
        <table className={`w-full ${minW} border-collapse text-pequeno`}>
          <thead className="sticky top-0 z-10">
            <tr className="bg-ink-50/90 backdrop-blur">
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={`border-b border-ink-200 ${padding} text-left text-micro font-semibold uppercase text-ink-500 ${column.width ?? ''} ${
                    column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : ''
                  }`}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {rows.map((row) => {
              const interativo = Boolean(onRowClick)
              return (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onKeyDown={
                    onRowClick
                      ? (event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            onRowClick(row)
                          }
                        }
                      : undefined
                  }
                  tabIndex={interativo ? 0 : undefined}
                  role={interativo ? 'button' : undefined}
                  className={`bg-white transition-colors duration-150 ${
                    interativo ? 'cursor-pointer hover:bg-brand-50/40 focus-visible:bg-brand-50/60' : 'hover:bg-ink-50/60'
                  }`}
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={`${padding} align-middle text-ink-700 ${
                        column.align === 'right' ? 'num text-right' : column.align === 'center' ? 'text-center' : ''
                      }`}
                    >
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {rodape && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 bg-ink-50/50 px-4 py-2.5 text-pequeno text-ink-500">
          {rodape}
        </div>
      )}
    </div>
  )
}

/** Linha de rótulo/valor usada em resumos (conta, turno, comanda). */
export function InfoRow({
  rotulo,
  valor,
  destaque,
  className = '',
}: {
  rotulo: ReactNode
  valor: ReactNode
  destaque?: boolean
  className?: string
}) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-1.5 ${className}`}>
      <span className={`text-pequeno ${destaque ? 'font-medium text-ink-700' : 'text-ink-500'}`}>{rotulo}</span>
      <span
        className={`num ${
          destaque ? 'text-base font-semibold text-ink-900' : 'text-pequeno font-medium text-ink-800'
        }`}
      >
        {valor}
      </span>
    </div>
  )
}
