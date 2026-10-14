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
    expect(translateError('PAYMENT_METHOD_INVALID: pix')).toBe('Forma de pagamento inválida ou desativada.')
    expect(translateError('MODIFIER_REQUIRED: grupo Borda')).toBe(
      'Há um grupo de adicionais obrigatório sem escolha.',
    )
  })

  it('reconhece o código mesmo com o texto do banco antes da mensagem', () => {
    expect(translateError('ERROR: PAYMENT_REFUND_REQUIRED: estorne antes de cancelar (SQLSTATE 55006)')).toBe(
      'Estorne os recebimentos antes de cancelar este pedido.',
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

  it('não inventa tradução: mensagem desconhecida é repassada', () => {
    expect(translateError('erro interno desconhecido do servidor')).toBe('erro interno desconhecido do servidor')
  })
})
