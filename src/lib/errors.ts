/**
 * Tradução das mensagens de erro do banco para o português operacional.
 *
 * O banco (RPCs e RLS) responde com códigos padronizados (ex.: 'BALANCE_PENDING').
 * Aqui apenas tornamos a mensagem amigável — a regra continua sendo aplicada
 * no servidor, nunca no navegador.
 */

const MESSAGES: { code: string; message: string }[] = [
  { code: 'AUTH_REQUIRED', message: 'Sua sessão expirou ou seu acesso está inativo. Entre novamente.' },
  { code: 'FORBIDDEN', message: 'Seu perfil não tem permissão para esta operação.' },
  { code: 'TABLE_ALREADY_OPEN', message: 'Esta mesa já possui um atendimento aberto. Atualize a tela.' },
  { code: 'TABLE_INACTIVE', message: 'Esta mesa está desativada.' },
  { code: 'TABLE_NOT_FOUND', message: 'Mesa não encontrada.' },
  { code: 'TABLE_SESSION_NOT_FOUND', message: 'Atendimento não encontrado. Atualize a tela.' },
  { code: 'TABLE_SESSION_CLOSED', message: 'Este atendimento já foi encerrado.' },
  { code: 'SESSION_NOT_FOUND', message: 'Conta não encontrada.' },
  { code: 'SESSION_NOT_OPEN', message: 'Esta conta já foi fechada por outro usuário.' },
  { code: 'BALANCE_PENDING', message: 'Ainda há saldo pendente nesta conta.' },
  {
    code: 'ORDERS_IN_PROGRESS',
    message:
      'Ainda há pedido em andamento nesta mesa. Entregue em Pedidos prontos ou cancele o pedido antes de fechar a conta.',
  },
  { code: 'ORDER_NOT_FOUND', message: 'Pedido não encontrado.' },
  { code: 'ORDER_CANCELLED', message: 'Este pedido está cancelado.' },
  { code: 'ORDER_ACCOUNT_CLOSED', message: 'A conta deste pedido já foi fechada.' },
  { code: 'ORDER_CLOSED_OR_CANCELLED', message: 'Pedido encerrado ou cancelado.' },
  { code: 'ITEM_NOT_FOUND', message: 'Item não encontrado.' },
  { code: 'ITEM_ALREADY_CANCELLED', message: 'Este item já está cancelado.' },
  { code: 'PAYMENT_NOT_FOUND', message: 'Recebimento não encontrado.' },
  { code: 'PAYMENT_ALREADY_REVERSED', message: 'Este recebimento já foi estornado.' },
  { code: 'PAYMENT_METHOD_INVALID', message: 'Forma de pagamento inválida ou desativada.' },
  { code: 'TENDERED_REQUIRED', message: 'Informe o valor recebido em dinheiro.' },
  { code: 'TENDERED_BELOW_AMOUNT', message: 'O valor recebido é menor que o valor do pagamento.' },
  { code: 'AMOUNT_EXCEEDS_BALANCE', message: 'O valor informado é maior que o saldo pendente.' },
  { code: 'INVALID_AMOUNT', message: 'Informe um valor maior que zero.' },
  { code: 'CASH_SESSION_REQUIRED', message: 'Abra o caixa antes de registrar recebimentos.' },
  { code: 'CASH_SESSION_ALREADY_OPEN', message: 'Já existe um caixa aberto. Feche-o antes de abrir outro.' },
  { code: 'CASH_SESSION_CLOSED', message: 'Este caixa já foi fechado.' },
  { code: 'CASH_SESSION_NOT_FOUND', message: 'Sessão de caixa não encontrada.' },
  { code: 'VARIANCE_REASON_REQUIRED', message: 'Há divergência de caixa: informe a justificativa.' },
  { code: 'INSUFFICIENT_CASH', message: 'Não há dinheiro suficiente na gaveta para esta saída.' },
  { code: 'DISCOUNT_LIMIT_EXCEEDED', message: 'Desconto acima do limite do seu perfil.' },
  { code: 'DISCOUNT_TOO_HIGH', message: 'O desconto não pode ser maior que o subtotal.' },
  { code: 'DISCOUNT_REQUIRED', message: 'Informe o percentual ou o valor do desconto.' },
  { code: 'REASON_REQUIRED', message: 'Informe o motivo desta operação.' },
  { code: 'EMPTY_ORDER', message: 'O pedido não possui itens válidos.' },
  { code: 'PRODUCT_UNAVAILABLE', message: 'Produto indisponível no momento.' },
  { code: 'PRODUCT_NOT_FOUND', message: 'Produto não encontrado.' },
  { code: 'VARIANT_UNAVAILABLE', message: 'Tamanho indisponível para este produto.' },
  { code: 'SIZE_INACTIVE', message: 'Tamanho desativado.' },
  { code: 'FLAVOR_UNAVAILABLE', message: 'Um dos sabores está indisponível.' },
  { code: 'FLAVOR_SIZE_UNAVAILABLE', message: 'Um dos sabores não é vendido neste tamanho.' },
  { code: 'TOO_MANY_FLAVORS', message: 'Este tamanho aceita menos sabores.' },
  { code: 'DUPLICATE_FLAVOR', message: 'O mesmo sabor foi informado duas vezes.' },
  { code: 'FLAVORS_NOT_ALLOWED', message: 'Este produto não aceita divisão de sabores.' },
  { code: 'MODIFIER_REQUIRED', message: 'Há um grupo de adicionais obrigatório sem escolha.' },
  { code: 'MODIFIER_LIMIT_EXCEEDED', message: 'Você escolheu mais adicionais do que o permitido.' },
  { code: 'MODIFIER_INVALID', message: 'Adicional inválido para este produto.' },
  { code: 'DUPLICATE_MODIFIER', message: 'Adicional repetido.' },
  { code: 'INVALID_QUANTITY', message: 'Quantidade inválida.' },
  { code: 'ITEMS_REQUIRED', message: 'Adicione ao menos um item ao pedido.' },
  { code: 'TOO_MANY_ITEMS', message: 'Pedido com itens demais.' },
  { code: 'INVALID_TRANSITION', message: 'Mudança de situação não permitida para este pedido.' },
  { code: 'NO_STATUS_CHANGE', message: 'O pedido já está nesta situação.' },
  { code: 'INVALID_SERVICE_MODE', message: 'Modalidade de pedido inválida.' },
  { code: 'DINE_IN_DISABLED', message: 'O atendimento no salão está desativado nas configurações.' },
  { code: 'DELIVERY_DISABLED', message: 'O delivery está desativado nas configurações.' },
  {
    code: 'DELIVERY_MINIMUM_NOT_MET',
    message: 'O pedido está abaixo do mínimo para delivery configurado. Adicione mais itens.',
  },
  {
    code: 'SPLIT_PAYMENT_DISABLED',
    message: 'O pagamento dividido está desativado. Use a mesma forma de pagamento já usada neste pedido.',
  },
  { code: 'CUSTOMER_REQUIRED', message: 'Informe os dados do cliente.' },
  { code: 'CUSTOMER_NOT_FOUND', message: 'Cliente não encontrado.' },
  { code: 'CUSTOMER_NAME_INVALID', message: 'Informe o nome do cliente.' },
  { code: 'CUSTOMER_PHONE_INVALID', message: 'Informe o telefone com DDD.' },
  { code: 'ADDRESS_REQUIRED', message: 'Informe o endereço de entrega.' },
  { code: 'ADDRESS_INVALID', message: 'Endereço incompleto: informe rua, número e bairro.' },
  { code: 'DELIVERY_ZONE_INVALID', message: 'Zona de entrega inválida.' },
  { code: 'NOT_DELIVERY_ORDER', message: 'Este pedido não é de delivery.' },
  { code: 'PAYMENT_REFUND_REQUIRED', message: 'Estorne os recebimentos antes de cancelar ou reduzir este pedido.' },
  { code: 'LAST_ADMIN', message: 'Não é possível desativar o último administrador ativo.' },
  { code: 'SELF_ROLE_CHANGE', message: 'Não é permitido alterar a própria função.' },
  { code: 'INVALID_FEE', message: 'Taxa inválida.' },
  { code: 'INVALID_BUCKET', message: 'Agrupamento de período inválido.' },
  {
    code: 'SENHA_ATUAL_INCORRETA',
    message: 'A senha que você usou agora não confere. Confira a senha temporária que o administrador entregou.',
  },
  {
    code: 'SENHA_NOVA_FRACA',
    message: 'O sistema de acesso recusou a nova senha por ser fraca ou igual à anterior. Tente uma senha mais forte.',
  },
  {
    code: 'FALHA_AO_TROCAR_SENHA',
    message: 'Não foi possível gravar a nova senha agora. Tente de novo em instantes.',
  },
]

export function translateError(error: unknown): string {
  if (!error) return 'Ocorreu um erro inesperado.'

  const raw =
    typeof error === 'string'
      ? error
      : ((error as { message?: string }).message ?? JSON.stringify(error))

  for (const { code, message } of MESSAGES) {
    if (raw.toUpperCase().includes(code)) return message
  }

  if (/row-level security/i.test(raw)) {
    return 'Seu perfil não tem permissão para esta operação.'
  }
  if (/duplicate key|unique/i.test(raw) && /orders_client_uuid/i.test(raw)) {
    return 'Este pedido já foi registrado.'
  }
  if (/duplicate key|unique/i.test(raw)) {
    return 'Registro duplicado: já existe um item com estes dados.'
  }
  if (/failed to fetch|network|conex/i.test(raw)) {
    return 'Sem conexão com o servidor. Verifique a internet e tente novamente.'
  }

  return raw
}

/**
 * Código do erro, quando o banco devolveu um. Sem código = a resposta não
 * chegou (rede caiu, sessão expirou): o navegador NÃO sabe se a operação foi
 * gravada — é o caso em que repetir com a mesma chave é seguro.
 */
export function codigoDoErro(error: unknown): string | null {
  if (!error) return null
  const raw =
    typeof error === 'string' ? error : ((error as { message?: string }).message ?? '')
  const achado = MESSAGES.find(({ code }) => raw.toUpperCase().includes(code))
  return achado?.code ?? null
}

/** Verdadeiro quando a resposta não trouxe código: resultado incerto. */
export function erroSemCodigo(error: unknown): boolean {
  return codigoDoErro(error) === null
}
