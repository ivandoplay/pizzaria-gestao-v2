/**
 * Linhas do recibo/comanda impressos pelo navegador.
 *
 * Existe por causa de um defeito real: o recibo impresso de **um pedido** de
 * uma mesa mostrava o subtotal e o desconto da **conta inteira** (a tela usava
 * os totais da sessão para qualquer impressão). O papel saía sem fechar a
 * conta: itens de um pedido, subtotal de vários.
 *
 * Aqui o escopo é explícito: quem imprime passa exatamente os pedidos que
 * saem no papel. Os valores são sempre calculados a partir deles — nunca
 * "emprestados" de outro lugar.
 *
 * Regras:
 *  - desconto e taxa só aparecem quando existem (recibo limpo continua limpo);
 *  - total, recebido e saldo sempre aparecem (é o que o cliente confere);
 *  - saldo nunca fica negativo (troco é linha separada, não receita);
 *  - troco só aparece quando houve troco.
 */

import { formatMoney } from './format'

export interface PedidoParaRecibo {
  subtotal_cents: number
  discount_cents: number
  delivery_fee_cents: number
  total_cents: number
  paid_cents: number
}

export interface ValoresRecibo {
  subtotal: number
  desconto: number
  taxa: number
  total: number
  recebido: number
  saldo: number
}

export interface LinhaRecibo {
  label: string
  value: string
  emphasis?: boolean
}

/** Soma os valores que vão para o papel, a partir dos pedidos do escopo. */
export function valoresRecibo(pedidos: PedidoParaRecibo[]): ValoresRecibo {
  const somar = (campo: keyof PedidoParaRecibo) =>
    pedidos.reduce((total, pedido) => total + (pedido[campo] ?? 0), 0)

  const total = somar('total_cents')
  const recebido = somar('paid_cents')

  return {
    subtotal: somar('subtotal_cents'),
    desconto: somar('discount_cents'),
    taxa: somar('delivery_fee_cents'),
    total,
    recebido,
    saldo: Math.max(total - recebido, 0),
  }
}

/**
 * Monta as linhas de valores do recibo.
 *
 * `pagamentos` é opcional: quando informado, cada recebimento vira uma linha
 * ("Pgto. Pix — R$ 30,00"), de forma que o papel mostre como a conta foi paga.
 */
export function linhasRecibo(
  pedidos: PedidoParaRecibo[],
  opcoes: {
    trocoCents?: number
    pagamentos?: { rotulo: string; valorCents: number }[]
  } = {},
): LinhaRecibo[] {
  const valores = valoresRecibo(pedidos)
  const troco = opcoes.trocoCents ?? 0

  return [
    { label: 'Subtotal', value: formatMoney(valores.subtotal) },
    ...(valores.desconto > 0 ? [{ label: 'Desconto', value: `- ${formatMoney(valores.desconto)}` }] : []),
    ...(valores.taxa > 0 ? [{ label: 'Taxa de entrega', value: formatMoney(valores.taxa) }] : []),
    { label: 'Total', value: formatMoney(valores.total), emphasis: true },
    { label: 'Recebido', value: formatMoney(valores.recebido) },
    ...(opcoes.pagamentos ?? []).map((pagamento) => ({
      label: `Pgto. ${pagamento.rotulo}`,
      value: formatMoney(pagamento.valorCents),
    })),
    ...(troco > 0 ? [{ label: 'Troco entregue', value: formatMoney(troco) }] : []),
    { label: 'Saldo a pagar', value: formatMoney(valores.saldo), emphasis: true },
  ]
}


// ============================================================================
// Identificação da pizzaria no papel (achado B4 da auditoria de 19/10/2026)
// ============================================================================

export interface EmpresaRecibo {
  nome: string | null
  endereco: string | null
  telefone: string | null
  logoUrl: string | null
  rodape: string | null
}

/**
 * Converte o que está salvo em `business_settings` no cabeçalho do recibo.
 *
 * A tela de Configurações promete que esses dados "aparecem no topo dos
 * comprovantes" — esta função é o que faz a promessa valer. Campos vazios viram
 * `null` para não imprimir linha em branco nem separador solto.
 */
export function empresaDoRecibo(
  config:
    | {
        trade_name?: string | null
        address_line?: string | null
        phone?: string | null
        logo_url?: string | null
        receipt_footer_text?: string | null
      }
    | null
    | undefined,
): EmpresaRecibo | undefined {
  if (!config) return undefined

  const limpar = (valor?: string | null) => {
    const texto = (valor ?? '').trim()
    return texto.length > 0 ? texto : null
  }

  const empresa: EmpresaRecibo = {
    nome: limpar(config.trade_name),
    endereco: limpar(config.address_line),
    telefone: limpar(config.phone),
    logoUrl: limpar(config.logo_url),
    rodape: limpar(config.receipt_footer_text),
  }

  const temAlgo = Object.values(empresa).some((valor) => valor !== null)
  return temAlgo ? empresa : undefined
}

/** Endereço e telefone na mesma linha, sem separador sobrando. */
export function linhaDeContato(empresa: EmpresaRecibo | undefined): string | null {
  const partes = [empresa?.endereco, empresa?.telefone].filter(
    (parte): parte is string => Boolean(parte),
  )
  return partes.length > 0 ? partes.join(' · ') : null
}

/** Só aceita logo http(s) — nada de esquema estranho indo para o papel. */
export function urlDeLogo(logoUrl: string | null | undefined): string | null {
  const url = (logoUrl ?? '').trim()
  return /^https?:\/\//i.test(url) ? url : null
}
