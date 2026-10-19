import { describe, expect, it } from 'vitest'
import { translateError } from './errors'
import { ApiError } from './api'

describe('tradução de erros do banco para pt-BR', () => {
  it('traduz códigos de negócio devolvidos pelas RPCs', () => {
    expect(translateError(new ApiError('BALANCE_PENDING: ainda há saldo', '22023'))).toBe(
      'Ainda há saldo pendente nesta conta.',
    )
    expect(translateError('CASH_SESSION_REQUIRED: abra o caixa')).toBe('Abra o caixa antes de registrar recebimentos.')
    expect(translateError('TABLE_ALREADY_OPEN: mesa 4')).toBe(
      'Esta mesa já possui um atendimento aberto. Atualize a tela.',
    )
    expect(translateError('REASON_REQUIRED: informe o motivo')).toBe('Informe o motivo desta operação.')
    expect(translateError('TABLE_HAS_OPEN_ACCOUNT: feche a conta')).toBe(
      'Esta mesa tem conta aberta: feche o atendimento antes de desativá-la.',
    )
    expect(translateError('TABLE_HAS_HISTORY: mesa usada')).toBe(
      'Esta mesa já tem atendimentos registrados. Desative em vez de excluir.',
    )
    expect(translateError('PAYMENT_METHOD_INVALID: pix')).toBe('Forma de pagamento inválida ou desativada.')
    expect(translateError('MODIFIER_REQUIRED: grupo Borda')).toBe(
      'Há um grupo de adicionais obrigatório sem escolha.',
    )
    expect(translateError('PASSWORD_CHANGE_REQUIRED: troque a senha temporária')).toBe(
      'Sua senha é temporária. Troque a senha para continuar usando o sistema.',
    )
  })

  it('reconhece o código mesmo com o texto do banco antes da mensagem', () => {
    expect(translateError('ERROR: PAYMENT_REFUND_REQUIRED: estorne antes de cancelar (SQLSTATE 55006)')).toBe(
      'Estorne os recebimentos antes de cancelar ou reduzir este pedido.',
    )
  })

  it('traduz bloqueios de RLS mesmo sem código padronizado', () => {
    expect(translateError('new row violates row-level security policy for table "products"')).toBe(
      'Seu perfil não tem permissão para esta operação.',
    )
  })

  it('traduz falha de rede e ausência de erro', () => {
    expect(translateError('TypeError: Failed to fetch')).toBe(
      'Sem conexão com o servidor. Verifique a internet e tente novamente.',
    )
    expect(translateError(null)).toBe('Ocorreu um erro inesperado.')
  })

  it('não repassa o texto cru do banco quando o erro é desconhecido', () => {
    const bruto = 'permission denied for table payments'
    const texto = translateError(bruto)
    expect(texto.startsWith('Ocorreu um erro inesperado.')).toBe(true)
    expect(texto).not.toContain('permission denied')
    expect(texto).not.toContain('payments')

    expect(translateError(new ApiError('algo estranho', 'XX000'))).toBe(
      'Ocorreu um erro inesperado. Se persistir, informe o código XX000 ao responsável técnico.',
    )
  })
})
