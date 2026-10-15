import { describe, expect, it } from 'vitest'
import { avaliarSenha, MINIMO_DE_SENHA, validarTrocaDeSenha } from './senha'

describe('validarTrocaDeSenha', () => {
  const base = { atual: 'temporaria123', nova: 'MinhaSenha@2026', repetir: 'MinhaSenha@2026' }

  it('aceita uma troca completa e coerente', () => {
    expect(validarTrocaDeSenha(base)).toBeNull()
  })

  it('exige a senha atual (é ela que prova quem está trocando)', () => {
    expect(validarTrocaDeSenha({ ...base, atual: '' })).toMatch(/agora/i)
  })

  it('exige a nova senha', () => {
    expect(validarTrocaDeSenha({ ...base, nova: '', repetir: '' })).toMatch(/nova senha/i)
  })

  it(`rejeita senha menor que ${MINIMO_DE_SENHA} caracteres`, () => {
    expect(validarTrocaDeSenha({ ...base, nova: 'curta1', repetir: 'curta1' })).toMatch(/8 caracteres/)
  })

  it('rejeita repetir a senha temporária', () => {
    expect(validarTrocaDeSenha({ ...base, nova: base.atual, repetir: base.atual })).toMatch(/diferente/i)
  })

  it('rejeita repetição que não confere', () => {
    expect(validarTrocaDeSenha({ ...base, repetir: 'outra-coisa-9' })).toMatch(/não confere/i)
  })

  it('não deixa a senha só com espaços passar como preenchida', () => {
    expect(validarTrocaDeSenha({ ...base, nova: '        ', repetir: '        ' })).not.toBeNull()
  })
})

describe('avaliarSenha', () => {
  it('avisa quando falta caractere', () => {
    const aviso = avaliarSenha('curta1')
    expect(aviso.nivel).toBe(0)
    expect(aviso.rotulo).toMatch(/faltam/i)
  })

  it('marca sequência óbvia como fácil de adivinhar', () => {
    expect(avaliarSenha('12345678').rotulo).toMatch(/adivinhar/i)
    expect(avaliarSenha('aaaaaaaa').rotulo).toMatch(/adivinhar/i)
  })

  it('marca senha de uma só família como fraca', () => {
    expect(avaliarSenha('festanoite').rotulo).toBe('Fraca')
  })

  it('reconhece senha longa e variada como forte', () => {
    const aviso = avaliarSenha('Pizza@Boa2026!')
    expect(aviso.nivel).toBe(3)
    expect(aviso.dica).toBeNull()
  })

  it('marca variedade mediana com tamanho bom como razoável', () => {
    expect(avaliarSenha('pizzaboa2026').rotulo).toBe('Razoável')
  })

  it('sobe para forte quando junta tamanho e variedade', () => {
    expect(avaliarSenha('PizzaBoa2026').rotulo).toBe('Forte')
  })
})
