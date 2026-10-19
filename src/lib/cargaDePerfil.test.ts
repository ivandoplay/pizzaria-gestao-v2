import { describe, expect, it } from 'vitest'
// `?raw` é do Vite/Vitest: lê o arquivo como texto, sem depender de tipos do Node.
import fonteAuth from '../context/AuthContext.tsx?raw'
import { criarGuardaDePerfil } from './cargaDePerfil'

describe('ordem das cargas de perfil', () => {
  it('a resposta que chega fora de ordem não sobrescreve a sessão atual', async () => {
    const guarda = criarGuardaDePerfil()
    const estado: { perfil: string | null } = { perfil: null }

    // Sessão A começa; o operador troca para B antes de A responder.
    const ticketA = guarda.iniciar('usuario-A')
    const ticketB = guarda.iniciar('usuario-B')

    // B responde primeiro.
    const carregar = async (ticket: number, id: string, atraso: number) => {
      await new Promise((r) => setTimeout(r, atraso))
      if (guarda.deveAplicar(ticket, id)) estado.perfil = id
    }

    await Promise.all([carregar(ticketA, 'usuario-A', 30), carregar(ticketB, 'usuario-B', 5)])

    expect(estado.perfil).toBe('usuario-B')
  })

  it('a carga mais recente do mesmo usuário vence', () => {
    const guarda = criarGuardaDePerfil()
    const primeira = guarda.iniciar('usuario-A')
    const segunda = guarda.iniciar('usuario-A')

    expect(guarda.deveAplicar(primeira, 'usuario-A')).toBe(false)
    expect(guarda.deveAplicar(segunda, 'usuario-A')).toBe(true)
  })

  it('sair da conta invalida qualquer carga pendente', () => {
    const guarda = criarGuardaDePerfil()
    const pendente = guarda.iniciar('usuario-A')
    guarda.iniciar(null)

    expect(guarda.deveAplicar(pendente, 'usuario-A')).toBe(false)
    expect(guarda.deveAplicar(pendente, null)).toBe(false)
  })

  it('uma carga antiga não pode se passar por outro usuário', () => {
    const guarda = criarGuardaDePerfil()
    const ticket = guarda.iniciar('usuario-A')

    expect(guarda.deveAplicar(ticket, 'usuario-B')).toBe(false)
  })

  it('o AuthContext usa a guarda antes de gravar o perfil', () => {
    // Trava a regressão no código de verdade: sem estas duas chamadas, a
    // condição de corrida volta a existir mesmo com a guarda testada acima.
    expect(fonteAuth).toContain('criarGuardaDePerfil')
    expect(fonteAuth).toMatch(/deveAplicar\(/)
    expect(fonteAuth).toMatch(/iniciar\(/)
  })
})
