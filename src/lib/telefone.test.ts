import { describe, expect, it } from 'vitest'
import { buscaPorTelefone, somenteDigitos, telefoneComparavel, telefonesIguais } from './telefone'

describe('telefone do cliente recorrente', () => {
  it('descarta a máscara', () => {
    expect(somenteDigitos('(86) 98811-0001')).toBe('86988110001')
    expect(somenteDigitos(null)).toBe('')
  })

  it('remove o código do país quando ele está presente', () => {
    expect(telefoneComparavel('+55 (86) 98811-0001')).toBe('86988110001')
    expect(telefoneComparavel('5586988110001')).toBe('86988110001')
    expect(telefoneComparavel('86988110001')).toBe('86988110001')
  })

  it('não confunde número começado por 55 com código de país', () => {
    // 10 dígitos: é telefone fixo, não "55 + DDD + número".
    expect(telefoneComparavel('5532881122')).toBe('5532881122')
    // 11 dígitos com DDD 55 (Santa Maria/RS) continua inteiro.
    expect(telefoneComparavel('55988110001')).toBe('55988110001')
  })

  it('reconhece o mesmo cliente escrito de três formas', () => {
    expect(telefonesIguais('(86) 98811-0001', '5586988110001')).toBe(true)
    expect(telefonesIguais('86 98811-0001', '86988110001')).toBe(true)
    expect(telefonesIguais('86988110002', '86988110001')).toBe(false)
  })

  it('telefone vazio nunca é igual a outro vazio', () => {
    expect(telefonesIguais('', '')).toBe(false)
    expect(telefonesIguais(null, undefined)).toBe(false)
  })

  it('só consulta o banco com pelo menos 10 dígitos', () => {
    expect(buscaPorTelefone('98811-00')).toBeNull()
    expect(buscaPorTelefone('(86) 98811-0001')).toEqual({
      exato: '86988110001',
      parcial: '988110001',
    })
  })

  it('a busca exata usa o valor de phone_digits, que é indexado', () => {
    expect(buscaPorTelefone('5586988110001')?.exato).toBe('86988110001')
  })
})
