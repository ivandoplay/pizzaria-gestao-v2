import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'

// ===========================================================================
// BOTÕES
// ===========================================================================
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 focus-visible:outline-brand-600',
  secondary: 'bg-white text-slate-800 border border-slate-300 hover:bg-slate-50',
  ghost: 'bg-transparent text-slate-600 hover:bg-slate-100',
  danger: 'bg-red-700 text-white hover:bg-red-800',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700',
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  children,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
}) {
  const sizes = {
    sm: 'px-2.5 py-1.5 text-xs',
    md: 'px-3.5 py-2 text-sm',
    lg: 'px-4 py-2.5 text-base',
  }
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition
        disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${sizes[size]} ${className}`}
    >
      {loading && <Spinner className="h-3.5 w-3.5" />}
      {children}
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
// CARTÕES E ESTRUTURA
// ===========================================================================
export function Card({
  title,
  actions,
  children,
  className = '',
  padded = true,
}: {
  title?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  padded?: boolean
}) {
  return (
    <section className={`rounded-lg border border-slate-200 bg-white shadow-sm ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          {actions}
        </header>
      )}
      <div className={padded ? 'p-4' : ''}>{children}</div>
    </section>
  )
}

export function Badge({
  children,
  tone = 'slate',
}: {
  children: ReactNode
  tone?: 'slate' | 'green' | 'amber' | 'red' | 'blue' | 'brand'
}) {
  const tones = {
    slate: 'bg-slate-100 text-slate-700',
    green: 'bg-emerald-100 text-emerald-800',
    amber: 'bg-amber-100 text-amber-900',
    red: 'bg-red-100 text-red-800',
    blue: 'bg-blue-100 text-blue-800',
    brand: 'bg-brand-100 text-brand-800',
  }
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  )
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center">
      <p className="text-sm font-semibold text-slate-700">{title}</p>
      {description && <p className="max-w-md text-xs text-slate-500">{description}</p>}
      {action}
    </div>
  )
}

export function LoadingBlock({ label = 'Carregando…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
      <Spinner className="h-4 w-4" /> {label}
    </div>
  )
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <p className="font-medium">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-2" onClick={onRetry}>
          Tentar novamente
        </Button>
      )}
    </div>
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
}: {
  label?: string
  hint?: string
  error?: string
  children: ReactNode
  className?: string
}) {
  return (
    <label className={`block ${className}`}>
      {label && <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>}
      {children}
      {hint && !error && <span className="mt-1 block text-[11px] text-slate-500">{hint}</span>}
      {error && <span className="mt-1 block text-[11px] text-red-600">{error}</span>}
    </label>
  )
}

const inputClass =
  'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-100'

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputClass} ${className}`} />
}

export function Textarea({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${inputClass} min-h-[72px] ${className}`} />
}

export function Select({ className = '', children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={`${inputClass} ${className}`}>
      {children}
    </select>
  )
}

export function Checkbox({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
}) {
  return (
    <label className={`flex items-center gap-2 text-sm text-slate-700 ${disabled ? 'opacity-60' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
      />
      {label}
    </label>
  )
}

// ===========================================================================
// MODAL
// ===========================================================================
export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  size = 'md',
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
}) {
  useEffect(() => {
    if (!open) return
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  const sizes = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-6xl' }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-3 sm:p-6">
      <div className={`w-full ${sizes[size]} rounded-lg bg-white shadow-xl`}>
        <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Fechar">
            ✕
          </button>
        </header>
        <div className="max-h-[70vh] overflow-y-auto p-4">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-4 py-3">{footer}</footer>}
      </div>
    </div>
  )
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirmar',
  tone = 'primary',
  onConfirm,
  onCancel,
  loading,
}: {
  open: boolean
  title: string
  message: ReactNode
  confirmLabel?: string
  tone?: Variant
  onConfirm: () => void
  onCancel: () => void
  loading?: boolean
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={loading}>
            Cancelar
          </Button>
          <Button variant={tone} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-slate-700">{message}</div>
    </Modal>
  )
}

// ===========================================================================
// AVISOS (toast)
// ===========================================================================
type Toast = { id: number; kind: 'success' | 'error' | 'info'; message: string }
const ToastContext = createContext<(kind: Toast['kind'], message: string) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const push = useCallback((kind: Toast['kind'], message: string) => {
    const id = Date.now() + Math.random()
    setToasts((prev) => [...prev, { id, kind, message }])
    window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 6000)
  }, [])

  const value = useMemo(() => push, [push])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-3 right-3 z-[100] flex w-80 flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto rounded-md px-3 py-2 text-sm shadow-lg ${
              toast.kind === 'success'
                ? 'bg-emerald-600 text-white'
                : toast.kind === 'error'
                  ? 'bg-red-700 text-white'
                  : 'bg-slate-800 text-white'
            }`}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const push = useContext(ToastContext)
  return {
    success: (message: string) => push('success', message),
    error: (message: string) => push('error', message),
    info: (message: string) => push('info', message),
  }
}

// ===========================================================================
// TABELAS
// ===========================================================================
export function DataTable<T>({
  columns,
  rows,
  emptyMessage = 'Nenhum registro encontrado.',
  rowKey,
  onRowClick,
}: {
  columns: { key: string; header: ReactNode; render: (row: T) => ReactNode; align?: 'right' | 'center' }[]
  rows: T[]
  emptyMessage?: string
  rowKey: (row: T) => string | number
  onRowClick?: (row: T) => void
}) {
  if (rows.length === 0) return <EmptyState title={emptyMessage} />

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
            {columns.map((column) => (
              <th
                key={column.key}
                className={`px-3 py-2 font-medium ${column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : ''}`}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`border-b border-slate-100 ${onRowClick ? 'cursor-pointer hover:bg-slate-50' : ''}`}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={`px-3 py-2 align-middle ${column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : ''}`}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
