/**
 * Idempotência do lado do operador.
 *
 * As RPCs de escrita (abrir mesa, lançar pedido, receber pagamento, abrir caixa)
 * são idempotentes por `client_uuid`: a MESMA chave devolve a operação já
 * gravada em vez de criar outra. Isso é o que impede clique duplo e retentativa
 * de virarem dois pedidos.
 *
 * O problema que este arquivo resolve: gerar a chave dentro da tentativa
 * (`newClientUuid()` no clique) significa que, se a resposta se perder na rede,
 * a segunda tentativa chega com OUTRA chave — e o banco registra de novo.
 *
 * A regra aqui é simples: a chave pertence à OPERAÇÃO LÓGICA, não à tentativa.
 * Ela só troca quando o conteúdo muda (assinatura) ou quando o operador confirma
 * que a operação terminou (`renovar()`, chamado no sucesso).
 *
 * Nada disso substitui a validação do banco — é só o navegador se comportando
 * de forma segura quando a rede falha.
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import { newClientUuid } from './format'

/** Chave estável enquanto a assinatura não mudar; `renovar()` abre uma nova. */
export function useChaveIdempotente(assinatura: string) {
  const [geracao, setGeracao] = useState(0)
  const chave = useMemo(
    () => newClientUuid(),
    // A chave é recriada quando o conteúdo da operação muda ou quando o
    // operador conclui a operação (geração).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [assinatura, geracao],
  )
  const renovar = useCallback(() => setGeracao((atual) => atual + 1), [])
  return { chave, renovar }
}

/**
 * Cofre fora do ciclo de render, para operações cuja assinatura só existe no
 * momento do clique (ex.: abrir mesa com os dados digitados na janela).
 */
export function criarCofreDeChaves() {
  let assinaturaAtual = ''
  let chaveAtual = newClientUuid()
  return {
    chavePara(assinatura: string) {
      if (assinaturaAtual !== assinatura) {
        assinaturaAtual = assinatura
        chaveAtual = newClientUuid()
      }
      return chaveAtual
    },
    renovar() {
      assinaturaAtual = ''
      chaveAtual = newClientUuid()
    },
  }
}

/** Versão de cofre presa à vida do componente. */
export function useCofreDeChaves() {
  const ref = useRef<ReturnType<typeof criarCofreDeChaves> | null>(null)
  if (ref.current === null) ref.current = criarCofreDeChaves()
  return ref.current
}
