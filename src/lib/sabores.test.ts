import { describe, expect, it } from 'vitest'
import { alternarSabor } from './sabores'

describe('alternarSabor', () => {
  it('mantém um único sabor adicional em tamanho de 2 sabores', () => {
    expect(alternarSabor([], 'atum', 2)).toEqual(['atum'])
    // Terceiro sabor não pode: substitui o anterior.
    expect(alternarSabor(['atum'], 'bacon', 2)).toEqual(['bacon'])
    expect(alternarSabor(['bacon'], 'banana', 2)).toEqual(['banana'])
  })

  it('nunca devolve mais adicionais do que o tamanho aceita', () => {
    let selecao: string[] = []
    for (const sabor of ['a', 'b', 'c', 'd']) selecao = alternarSabor(selecao, sabor, 2)
    expect(selecao).toHaveLength(1)
    expect(selecao).toEqual(['d'])
  })

  it('em tamanho de 3 sabores aceita dois adicionais e substitui o mais antigo', () => {
    expect(alternarSabor([], 'a', 3)).toEqual(['a'])
    expect(alternarSabor(['a'], 'b', 3)).toEqual(['a', 'b'])
    expect(alternarSabor(['a', 'b'], 'c', 3)).toEqual(['b', 'c'])
  })

  it('em tamanho de 4 sabores mantém três adicionais', () => {
    expect(alternarSabor(['a', 'b', 'c'], 'd', 4)).toEqual(['b', 'c', 'd'])
  })

  it('clicar de novo remove o sabor escolhido', () => {
    expect(alternarSabor(['a', 'b'], 'a', 3)).toEqual(['b'])
  })

  it('limite inválido nunca libera mais de um adicional', () => {
    expect(alternarSabor([], 'a', 1)).toEqual(['a'])
    expect(alternarSabor(['a'], 'b', 1)).toEqual(['b'])
  })
})
