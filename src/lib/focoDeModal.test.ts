import { describe, expect, it } from 'vitest'
// `?raw` é do Vite/Vitest: o teste lê o próprio componente compartilhado.
import fonteUi from '../components/ui.tsx?raw'
import {
  deveDevolverFoco,
  deveFocarPrimeiroCampo,
  entrarNaPilha,
  estaNaPilhaDoTopo,
  limparPilha,
  sairDaPilha,
  tamanhoDaPilha,
} from './focoDeModal'

describe('pilha de modais', () => {
  it('só o modal do topo responde a teclado', () => {
    limparPilha()
    entrarNaPilha('pedido')
    entrarNaPilha('montagem')
    expect(estaNaPilhaDoTopo('montagem')).toBe(true)
    expect(estaNaPilhaDoTopo('pedido')).toBe(false)
    expect(tamanhoDaPilha()).toBe(2)
  })

  it('fechar o modal de cima devolve o teclado para o de baixo', () => {
    limparPilha()
    entrarNaPilha('pedido')
    entrarNaPilha('montagem')
    sairDaPilha('montagem')
    expect(estaNaPilhaDoTopo('pedido')).toBe(true)
    expect(tamanhoDaPilha()).toBe(1)
  })

  it('fechar fora de ordem não deixa fantasma na pilha', () => {
    limparPilha()
    entrarNaPilha('a')
    entrarNaPilha('b')
    entrarNaPilha('c')
    sairDaPilha('b')
    expect(tamanhoDaPilha()).toBe(2)
    expect(estaNaPilhaDoTopo('c')).toBe(true)
    sairDaPilha('b') // segunda vez não muda nada
    expect(tamanhoDaPilha()).toBe(2)
  })

  it('pilha vazia não elege nenhum modal como topo', () => {
    limparPilha()
    expect(estaNaPilhaDoTopo('qualquer')).toBe(false)
    expect(estaNaPilhaDoTopo('')).toBe(false)
  })
})

describe('foco inicial do modal', () => {
  it('foca o primeiro campo quando o modal é o do topo e nada dentro dele tem o foco', () => {
    expect(deveFocarPrimeiroCampo({ noTopo: true, focoDentroDoPainel: false })).toBe(true)
  })

  it('não foca quando já há foco dentro do painel (autoFocus, ou clique antes dos 40 ms)', () => {
    expect(deveFocarPrimeiroCampo({ noTopo: true, focoDentroDoPainel: true })).toBe(false)
  })

  it('não rouba o foco quando outro modal abriu por cima', () => {
    expect(deveFocarPrimeiroCampo({ noTopo: false, focoDentroDoPainel: false })).toBe(false)
  })
})

describe('devolução do foco ao fechar', () => {
  const base = { temAnterior: true, anteriorConectado: true, focoDentroDoPainel: false, focoSolto: false }

  it('devolve o foco quando ele ficou solto (campo do modal removido junto)', () => {
    expect(deveDevolverFoco({ ...base, focoSolto: true })).toBe(true)
  })

  it('devolve o foco quando ele ainda está dentro do painel que está saindo', () => {
    expect(deveDevolverFoco({ ...base, focoDentroDoPainel: true })).toBe(true)
  })

  it('NÃO rouba o foco de outro modal que está com ele', () => {
    expect(deveDevolverFoco({ ...base, focoDentroDoPainel: false, focoSolto: false })).toBe(false)
  })

  it('não devolve o foco para um elemento que saiu da página', () => {
    expect(deveDevolverFoco({ ...base, anteriorConectado: false, focoSolto: true })).toBe(false)
  })

  it('sem elemento anterior (modal aberto no primeiro render), não há para onde devolver', () => {
    expect(deveDevolverFoco({ ...base, temAnterior: false, focoSolto: true })).toBe(false)
  })
})

describe('regressão: o efeito de foco do Modal não pode depender de onClose', () => {
  /**
   * Foi exatamente essa dependência que quebrou a digitação de todo o sistema:
   * as telas passam `onClose={() => setX(null)}`, uma função nova a cada render,
   * então cada tecla digitada reiniciava o efeito — a limpeza devolvia o foco
   * para o campo anterior e o timer de 40 ms re-focava o primeiro campo.
   * Este teste trava a regra no código-fonte: o efeito que mexe em
   * `document.body.style.overflow` (o efeito de abertura do modal) só pode
   * depender de `open` e da chave estável do modal.
   */
  const fonte = fonteUi

  it('o efeito de abertura do modal não lista onClose nas dependências', () => {
    const inicio = fonte.indexOf('document.body.style.overflow = \'hidden\'')
    expect(inicio).toBeGreaterThan(-1)
    const fim = fonte.indexOf('}, [', inicio)
    expect(fim).toBeGreaterThan(inicio)
    const dependencias = fonte.slice(fim, fonte.indexOf(')', fim) + 1)
    expect(dependencias).not.toMatch(/onClose/)
    expect(dependencias).toMatch(/open/)
  })

  it('o Modal lê o onClose mais recente por ref (sem reiniciar o efeito)', () => {
    expect(fonte).toMatch(/const aoFechar = useRef\(onClose\)/)
    expect(fonte).toMatch(/aoFechar\.current\(\)/)
  })
})
