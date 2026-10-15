/**
 * Regras da troca de senha.
 *
 * Ficam aqui, fora da tela, por dois motivos:
 *   1. a mesma regra vale para o administrador que cria o funcionário (a senha
 *      temporária vem de fora) e para o funcionário que define a definitiva;
 *   2. dá para testar a regra sem abrir navegador (ver senha.test.ts).
 *
 * A regra mínima acompanha a do servidor: 8 caracteres. Qualquer exigência
 * maior que essa é orientação na tela, não bloqueio — quem decide o que é uma
 * boa senha para a própria pizzaria é o dono.
 */

export const MINIMO_DE_SENHA = 8

export interface CamposDeSenha {
  atual: string
  nova: string
  repetir: string
}

/** Devolve a mensagem do primeiro problema encontrado — ou `null` se estiver tudo certo. */
export function validarTrocaDeSenha({ atual, nova, repetir }: CamposDeSenha): string | null {
  if (!atual) return 'Informe a senha que você está usando agora.'
  if (!nova) return 'Informe a nova senha.'
  // Espaço é caractere legítimo em senha (não recortamos nada), mas senha só
  // de espaços é erro de digitação que trancaria a pessoa do lado de fora.
  if (!nova.trim()) return 'A nova senha não pode ser só espaços.'
  if (nova.length < MINIMO_DE_SENHA) {
    return `A nova senha precisa ter ao menos ${MINIMO_DE_SENHA} caracteres.`
  }
  if (nova === atual) return 'A nova senha precisa ser diferente da senha atual.'
  if (nova !== repetir) return 'A repetição não confere com a nova senha.'
  return null
}

const COMUNS = [
  '12345678',
  '123456789',
  'senha123',
  'pizzaria',
  'password',
  'abcd1234',
  'admin123',
  'garcom123',
  'caixa123',
  '87654321',
]

export interface ForcaDaSenha {
  /** 0 = muito curta, 1 = fraca, 2 = razoável, 3 = forte. */
  nivel: 0 | 1 | 2 | 3
  rotulo: string
  dica: string | null
}

/**
 * Avaliação simples e honesta da senha: comprimento + variedade + óbvias.
 * Não é um medidor científico — é um aviso para o operador não escolher
 * "12345678" numa conta que abre e fecha o caixa da casa.
 */
export function avaliarSenha(senha: string): ForcaDaSenha {
  if (senha.length < MINIMO_DE_SENHA) {
    return {
      nivel: 0,
      rotulo: `Faltam ${MINIMO_DE_SENHA - senha.length} caractere(s)`,
      dica: `Use ao menos ${MINIMO_DE_SENHA} caracteres.`,
    }
  }

  const baixa = /[a-z]/.test(senha)
  const alta = /[A-Z]/.test(senha)
  const numero = /[0-9]/.test(senha)
  const simbolo = /[^A-Za-z0-9]/.test(senha)
  const variedade = [baixa, alta, numero, simbolo].filter(Boolean).length
  const obvia = COMUNS.includes(senha.toLowerCase()) || /^(.)\1+$/.test(senha) || /^\d+$/.test(senha)

  if (obvia) {
    return { nivel: 1, rotulo: 'Fácil de adivinhar', dica: 'Evite sequências e palavras conhecidas.' }
  }

  let pontos = variedade
  if (senha.length >= 12) pontos += 1
  if (senha.length >= 16) pontos += 1

  if (pontos <= 2) {
    return { nivel: 1, rotulo: 'Fraca', dica: 'Misture letras maiúsculas, minúsculas e números.' }
  }
  if (pontos === 3) {
    return { nivel: 2, rotulo: 'Razoável', dica: 'Um símbolo a mais deixaria bem melhor.' }
  }
  return { nivel: 3, rotulo: 'Forte', dica: null }
}
