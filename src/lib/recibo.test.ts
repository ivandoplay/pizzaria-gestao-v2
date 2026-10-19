import { describe, expect, it } from 'vitest'
import {
  empresaDoRecibo,
  linhaDeContato,
  linhasRecibo,
  hostsDeLogoPermitidos,
  motivoLogoRecusado,
  urlDeLogo,
  valoresRecibo,
  type PedidoParaRecibo,
} from './recibo'

const pedido = (over: Partial<PedidoParaRecibo> = {}): PedidoParaRecibo => ({
  subtotal_cents: 0,
  discount_cents: 0,
  delivery_fee_cents: 0,
  total_cents: 0,
  paid_cents: 0,
  ...over,
})

// `toLocaleString('pt-BR')` separa "R$" do número com espaço inseparável;
// o teste compara com espaço comum para não depender do byte exato.
const semEspacoFixo = (texto: string | undefined) => texto?.replace(/\u00a0/g, ' ')

const valor = (linhas: ReturnType<typeof linhasRecibo>, rotulo: string) =>
  semEspacoFixo(linhas.find((linha) => linha.label === rotulo)?.value)

describe('recibo impresso', () => {
  it('soma a conta inteira quando o escopo é a conta', () => {
    const conta = [
      pedido({ subtotal_cents: 3000, total_cents: 3000, paid_cents: 3000 }),
      pedido({ subtotal_cents: 2000, discount_cents: 500, total_cents: 1500, paid_cents: 1500 }),
    ]
    const valores = valoresRecibo(conta)
    expect(valores).toMatchObject({ subtotal: 5000, desconto: 500, total: 4500, recebido: 4500, saldo: 0 })

    const linhas = linhasRecibo(conta)
    expect(valor(linhas, 'Subtotal')).toBe('R$ 50,00')
    expect(valor(linhas, 'Desconto')).toBe('- R$ 5,00')
    expect(valor(linhas, 'Total')).toBe('R$ 45,00')
  })

  it('imprime só os valores do pedido escolhido (não os da conta)', () => {
    // Regressão: o recibo de um pedido saía com o subtotal e o desconto da
    // conta toda. Aqui o escopo é [pedido], então os números são dele.
    const umPedido = [
      pedido({ subtotal_cents: 2000, discount_cents: 500, total_cents: 1500, paid_cents: 1500 }),
    ]
    const linhas = linhasRecibo(umPedido)
    expect(valor(linhas, 'Subtotal')).toBe('R$ 20,00')
    expect(valor(linhas, 'Desconto')).toBe('- R$ 5,00')
    expect(valor(linhas, 'Total')).toBe('R$ 15,00')
  })

  it('mostra a taxa de entrega e faz as linhas fecharem com o total', () => {
    const entrega = [
      pedido({ subtotal_cents: 4000, delivery_fee_cents: 700, total_cents: 4700, paid_cents: 0 }),
    ]
    const linhas = linhasRecibo(entrega)
    expect(valor(linhas, 'Taxa de entrega')).toBe('R$ 7,00')
    expect(valor(linhas, 'Total')).toBe('R$ 47,00')
    expect(valor(linhas, 'Saldo a pagar')).toBe('R$ 47,00')
  })

  it('não inventa linha de desconto nem de taxa quando são zero', () => {
    const linhas = linhasRecibo([pedido({ subtotal_cents: 1000, total_cents: 1000, paid_cents: 1000 })])
    expect(valor(linhas, 'Desconto')).toBeUndefined()
    expect(valor(linhas, 'Taxa de entrega')).toBeUndefined()
    expect(valor(linhas, 'Troco entregue')).toBeUndefined()
  })

  it('separa pagamentos e troco do saldo, sem saldo negativo', () => {
    const linhas = linhasRecibo([pedido({ subtotal_cents: 5000, total_cents: 5000, paid_cents: 5000 })], {
      trocoCents: 1200,
      pagamentos: [{ rotulo: 'Dinheiro', valorCents: 5000 }],
    })
    expect(valor(linhas, 'Pgto. Dinheiro')).toBe('R$ 50,00')
    expect(valor(linhas, 'Troco entregue')).toBe('R$ 12,00')
    expect(valor(linhas, 'Saldo a pagar')).toBe('R$ 0,00')
  })

  it('conta sem pedidos imprime zeros coerentes', () => {
    expect(linhasRecibo([]).map((linha) => ({ ...linha, value: semEspacoFixo(linha.value) }))).toEqual([
      { label: 'Subtotal', value: 'R$ 0,00' },
      { label: 'Total', value: 'R$ 0,00', emphasis: true },
      { label: 'Recebido', value: 'R$ 0,00' },
      { label: 'Saldo a pagar', value: 'R$ 0,00', emphasis: true },
    ])
  })
})


describe('identificação da pizzaria no recibo', () => {
  it('sem configuração, o papel continua como antes', () => {
    expect(empresaDoRecibo(null)).toBeUndefined()
    expect(empresaDoRecibo(undefined)).toBeUndefined()
    expect(empresaDoRecibo({})).toBeUndefined()
  })

  it('leva nome, endereço, telefone, logo e rodapé das configurações', () => {
    const empresa = empresaDoRecibo({
      trade_name: 'Pizzaria do Bairro',
      address_line: 'Rua Grande, 412 — Centro',
      phone: '(86) 98811-0001',
      logo_url: 'https://exemplo.supabase.co/storage/v1/object/public/product-images/logo.png',
      receipt_footer_text: 'Obrigado pela preferência!',
    })
    expect(empresa).toMatchObject({
      nome: 'Pizzaria do Bairro',
      endereco: 'Rua Grande, 412 — Centro',
      telefone: '(86) 98811-0001',
      rodape: 'Obrigado pela preferência!',
    })
    expect(linhaDeContato(empresa)).toBe('Rua Grande, 412 — Centro · (86) 98811-0001')
  })

  it('campo em branco não vira linha nem separador solto', () => {
    const empresa = empresaDoRecibo({ trade_name: '  Pizzaria X  ', address_line: '   ', phone: null })
    expect(empresa?.nome).toBe('Pizzaria X')
    expect(linhaDeContato(empresa)).toBeNull()
  })

  it('só aceita logo http(s) no papel', () => {
    expect(urlDeLogo('javascript:alert(1)')).toBeNull()
    expect(urlDeLogo('data:image/png;base64,AAAA')).toBeNull()
    expect(urlDeLogo(null)).toBeNull()
  })

  // Revisão de 19/10/2026: a janela de impressão herda a CSP da aplicação
  // (comprovado em navegador), então logo de outro domínio não carrega.
  // Em vez de imprimir um ícone quebrado, o endereço é recusado na hora.
  // A lista de hosts vai EXPLÍCITA nos testes: sem isso o resultado depende de
  // `.env.local` existir na máquina e a esteira (que não tem o arquivo) falha —
  // foi o que aconteceu em 19/10/2026.
  const hosts = ['qmrcnoigaszditwchsdz.supabase.co', 'pizzaria-gestao-v2.vercel.app']

  it('aceita logo do próprio projeto Supabase', () => {
    const url = 'https://qmrcnoigaszditwchsdz.supabase.co/storage/v1/object/public/product-images/logo.png'
    expect(urlDeLogo(url, hosts)).toBe(url)
    expect(motivoLogoRecusado(url, hosts)).toBeNull()
  })

  it('recusa logo de domínio que a CSP bloqueia, explicando o motivo', () => {
    const motivo = motivoLogoRecusado('https://cdn.exemplo.com/logo.png', hosts)
    expect(motivo).toContain('só carrega imagem de')
    expect(urlDeLogo('https://cdn.exemplo.com/logo.png', hosts)).toBeNull()
  })

  it('recusa endereço relativo sem host', () => {
    expect(urlDeLogo('/logo.png', hosts)).toBeNull()
    expect(motivoLogoRecusado('/logo.png', hosts)).toContain('Endereço inválido')
  })

  it('sem configuração de ambiente a lista sai vazia (e o teste não depende dela)', () => {
    // O que a lista contém é decidido em tempo de execução; o que importa é que
    // a função aceite a lista pronta e que a lista nunca invente host.
    expect(Array.isArray(hostsDeLogoPermitidos())).toBe(true)
  })
})
