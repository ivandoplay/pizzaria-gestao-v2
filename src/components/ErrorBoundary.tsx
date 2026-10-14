import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Icon } from './icons'
import { Button } from './ui'

type Props = { children: ReactNode }
type State = { erro: Error | null; tentativa: number }

/**
 * Rede de segurança da interface.
 *
 * Sem isto, qualquer erro de renderização (ou um chunk de tela que não carrega
 * por causa de conexão instável) deixaria a tela em branco sem explicação.
 * Aqui o operador recebe o motivo real e um caminho de volta — sem perder o
 * que já estava na tela do navegador (recarregar mantém a sessão do Supabase).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { erro: null, tentativa: 0 }

  static getDerivedStateFromError(erro: Error): Partial<State> {
    return { erro }
  }

  componentDidCatch(erro: Error, info: ErrorInfo) {
    // Fica no console para quem for investigar (não há serviço de telemetria).
    console.error('[interface] erro não tratado:', erro, info.componentStack)
  }

  private reiniciar = () => {
    this.setState((estado) => ({ erro: null, tentativa: estado.tentativa + 1 }))
  }

  render() {
    const { erro, tentativa } = this.state
    if (!erro) return this.props.children

    const semRede = typeof navigator !== 'undefined' && navigator.onLine === false

    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-100 px-4 py-10">
        <div className="w-full max-w-lg rounded-card border border-ink-200 bg-white p-6 shadow-float sm:p-8">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600">
            <Icon nome="alerta" className="h-6 w-6" />
          </span>

          <h1 className="mt-4 text-lg font-semibold text-ink-900">
            {semRede ? 'Sem conexão com a internet' : 'Algo deu errado nesta tela'}
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-600">
            {semRede
              ? 'O sistema precisa de internet para falar com o banco de dados. Confira a rede do celular ou do computador e tente de novo.'
              : 'Nenhuma cobrança ou pedido foi perdido: tudo o que foi salvo está no banco de dados. Tente novamente — se o erro continuar, recarregue a página e avise o responsável técnico.'}
          </p>

          <p className="mt-4 overflow-x-auto rounded-control bg-ink-100 px-3 py-2 text-xs text-ink-700">
            {erro.message || String(erro)}
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            <Button onClick={this.reiniciar} icone="atualizar">
              Tentar de novo
            </Button>
            <Button variant="secondary" onClick={() => window.location.reload()}>
              Recarregar a página
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                window.location.href = '/'
              }}
            >
              Voltar ao início
            </Button>
          </div>

          {tentativa > 0 && (
            <p className="mt-3 text-xs text-ink-500">
              Tentativas nesta sessão: {tentativa}. Se o erro se repetir no mesmo lugar, anote a mensagem acima.
            </p>
          )}
        </div>
      </div>
    )
  }
}
