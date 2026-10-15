# Arquitetura

Este documento explica **como** o sistema foi construído e **por quê**. Ele é a referência para
manutenção: onde ficam as regras, o que é garantido pelo banco e o que é apenas conveniência de tela.

---

## 1. Visão geral

```
┌──────────────────────────────┐          ┌───────────────────────────────────────┐
│  Navegador (Vercel)          │          │  Supabase                             │
│  React + TS + TanStack Query │          │                                       │
│                              │  HTTPS   │  Auth  ── login/password + JWT        │
│  • telas por perfil          │ ───────► │  PostgreSQL ── tabelas, RLS, triggers │
│  • leituras via views        │          │     • 22 RPCs (regras de negócio)     │
│  • escritas SOMENTE via RPC  │ ◄─────── │     • 4 views de leitura (invoker)    │
│  • Realtime: painel-sync     │  WS      │  Realtime ── postgres_changes         │
│  • anon key (pública)        │          │  Edge Function ── service_role        │
└──────────────────────────────┘          └───────────────────────────────────────┘
```

Princípios de projeto:

1. **O navegador nunca decide regra de negócio.** Ele monta a intenção (itens, forma de pagamento,
   desconto) e o banco valida, calcula e grava.
2. **Preço só existe de verdade no servidor.** A prévia da tela (`src/lib/pricing.ts`) existe para o
   operador conferir o valor, mas quem calcula é a RPC `create_order`, que relê o cardápio e grava
   **snapshots** nos itens.
3. **Nada com histórico é apagado.** Produtos, clientes, mesas, formas de pagamento e funcionários são
   desativados; pagamentos são estornados (nunca excluídos); a auditoria é append-only.
4. **Idempotência por `client_uuid`.** Toda operação que cria algo (pedido, pagamento, sessão, turno)
   recebe um UUID gerado no cliente. Repetir a chamada com o mesmo UUID não duplica nada.
5. **Dinheiro em centavos inteiros** (`integer`). Nunca `float`, nunca arredondamento implícito.

---

## 2. Modelo de dados

### 2.1 Entidades financeiras distintas (exigência da seção 9.1 do prompt)

O sistema **não** mistura conceitos:

| Entidade | Tabela | Papel |
|---|---|---|
| Atendimento da mesa | `table_sessions` | Período em que a mesa fica ocupada. Pode conter **vários** pedidos. Abre e fecha uma vez. |
| Pedido | `orders` | Uma rodada de itens. Tem status próprio, totais próprios e histórico. |
| Conta | `orders.account_closed_at` / `table_sessions.closed_at` | O fechamento consolida os pedidos da sessão e encerra a mesa. |
| Pagamento | `payments` | Recebimento (total ou parcial) vinculado a **um pedido**. Nunca alterado: estorno cria `status='reversed'` com motivo. |

Pedido de mesa pertence a uma `table_session`; pedido de delivery não tem sessão (o próprio pedido é a
conta) e é fechado por `close_delivery_account`.

### 2.2 Tabelas (25)

- **Fundação:** `profiles` (1:1 com `auth.users`), `business_settings` (nome, fuso, regra de meio a meio,
  limites de desconto, taxas, liga/desliga salão e delivery), `business_hours`, `payment_methods`,
  `audit_logs`.
- **Cardápio:** `categories`, `product_sizes`, `products`, `product_variants` (produto × tamanho = preço),
  `modifier_groups` (mín./máx.), `modifier_options`, `product_modifier_groups`.
- **Caixa:** `cash_sessions` (turno), `cash_movements` (venda, sangria, suprimento, despesa, ajuste).
- **Clientes/delivery:** `customers` (chave de dedupe `phone_digits`), `customer_addresses`,
  `delivery_fee_zones` (bairro → taxa; padrão em `business_settings`).
- **Operação:** `restaurant_tables`, `table_sessions`, `orders`, `order_items`, `order_item_flavors`
  (sabores de pizza), `order_item_modifiers` (adicionais), `order_status_history`, `payments`.

### 2.3 Integridade garantida pelo banco

- Índices únicos **parciais**: uma sessão aberta por mesa, um turno de caixa aberto por vez.
- `client_uuid unique` em pedidos, pagamentos, sessões e movimentos — a rede de segurança contra
  clique duplo e reenvio.
- `recalc_order_totals` mantém `subtotal_cents`, `discount_cents`, `delivery_fee_cents`, `total_cents`
  coerentes a cada alteração de item; pedido **cancelado preserva o valor** (auditoria), apenas as views
  de leitura o ignoram nos totais.
- Itens carregam `product_name_snapshot`, `size_name_snapshot`, `unit_price_cents` do momento da venda:
  reajuste de cardápio **nunca** reescreve o passado.

---

## 3. Regras de negócio (RPCs)

14 funções em `20260101000007_rpc.sql`, 8 de relatório em `0008` e 1 de senha em `0009` (23 no total). Todas:

- validam o perfil com `app_private.require_role(...)` (erro `FORBIDDEN`, SQLSTATE 42501);
- são `security definer` com `search_path` fixo;
- validam entrada e devolvem **códigos** estáveis (ex.: `BALANCE_PENDING`), traduzidos na tela por
  `src/lib/errors.ts`.

| Área | RPCs |
|---|---|
| Mesas | `open_table_session` |
| Pedidos | `create_order`, `advance_order_status`, `cancel_order_item`, `set_order_discount` |
| Pagamentos | `register_payment`, `reverse_payment` |
| Contas | `close_table_account`, `close_delivery_account` |
| Caixa | `start_cash_session`, `add_cash_movement`, `close_cash_session` |
| Delivery | `upsert_customer`, `set_delivery_fee` |
| Relatórios | `get_financial_summary`, `get_sales_series`, `get_top_products`, `get_sales_by_employee`, `get_payment_method_report`, `get_cash_sessions_report`, `get_orders_page`, `get_operational_summary` |

### 3.1 Preço

1. Item simples → preço da variação (produto × tamanho).
2. Pizza com 2 sabores → regra configurável em `business_settings.half_and_half_price_rule`:
   `highest` (maior preço) ou `average` (média arredondada).
3. Adicionais somados por unidade.
4. A diferença **tem** que bater: se a tradução no navegador divergir do cálculo do banco, o valor
   mostrado é substituído pelo valor oficial gravado no pedido. `src/lib/pricing.ts` é testado em Vitest
   justamente para reduzir essa divergência a zero.

### 3.2 Estados do pedido

```
received ──► confirmed ──► preparing ──► ready ──┬─► delivered_to_table   (salão)
   │             │              │                 └─► out_for_delivery ──► delivered (delivery)
   └─────────────┴──────────────┴───────► cancelled (motivo ≥ 3 caracteres)
```

- Garçom **só** faz `ready → delivered_to_table`.
- Caixa/admin fazem as demais; `received → preparing` (salto) também é permitido.
- Transição inválida → `INVALID_TRANSITION`; status repetido → `NO_STATUS_CHANGE`.
- Cada mudança grava uma linha em `order_status_history` (a criação grava a primeira).

### 3.3 Fechamento e pagamentos

- Recebimento parcial é permitido; `paid_cents` e `balance_cents` (view) refletem a soma.
- Dinheiro guarda `tendered_cents` e calcula `change_cents`; o **troco não é receita** — a gaveta recebe
  o valor líquido.
- Desconto: percentual ou valor, com justificativa obrigatória. Acima do limite do perfil
  (`business_settings.max_discount_pct_without_auth`) → `DISCOUNT_LIMIT_EXCEEDED`; acima do teto
  absoluto (`max_discount_pct_hard`) → recusado para todo mundo, inclusive admin.
- Conta com saldo → `BALANCE_PENDING`. Só admin força fechamento, com motivo (`close_*_account(..., force := true, reason := ...)`).
- Cancelar pedido com valor recebido → `PAYMENT_REFUND_REQUIRED` (obriga o estorno explícito primeiro).
- Turno de caixa: `expected_cash_cents` = fundo + entradas − saídas. Fechar com divergência exige
  `variance_reason` (`VARIANCE_REASON_REQUIRED`). Sangria maior que a gaveta → `INSUFFICIENT_CASH`.

---

## 4. Segurança

### 4.1 RLS

- **25 tabelas com RLS habilitada e forçada** (`force row level security`), inclusive para o dono.
- Leitura conforme perfil; **escrita direta pelo cliente ficou restrita** ao que é seguro
  (ex.: ajustes administrativos de cardápio pelo admin). Todo o fluxo operacional passa por RPC.
- **Duas camadas, não uma:** nas 10 tabelas em que toda a escrita passa por RPC (`orders`,
  `order_items`, `order_item_flavors`, `order_item_modifiers`, `order_status_history`, `payments`,
  `table_sessions`, `cash_sessions`, `cash_movements`, `audit_logs`) o **GRANT de escrita foi
  revogado** de `authenticated` (migração 0006, seção 6). Mesmo que alguém crie por engano uma
  política permissiva no futuro, o PostgreSQL nega a operação antes de avaliar a RLS.
- Tabelas de dinheiro (`payments`, `cash_movements`, `audit_logs`) são somente-leitura para clientes:
  quem escreve é a RPC.
- `audit_logs` é append-only: nem o admin apaga (testado — a recusa agora vem do GRANT).

### 4.2 Chaves e segredos

- O front-end usa **apenas** a `anon` key (pública por definição; a proteção é a RLS).
- `service_role` aparece **somente** na Edge Function `admin-create-employee`, lida de variável de
  ambiente. Nenhum arquivo do repositório contém segredo.
- `.env`, `.env.local` e derivados estão no `.gitignore`; o repositório versiona só `.env.example`.

### 4.3 Autenticação

- O usuário digita **login** e senha; o front converte para o e-mail interno `login@pizzaria.local`
  (`src/context/AuthContext.tsx`). Trocar isso para e-mail real é uma decisão consciente documentada
  em `docs/DECISIONS.md` quando houver domínio próprio.
- `profiles.is_active = false` corta o acesso (o guard no banco recusa as chamadas).
- Alterar a própria função → `SELF_ROLE_CHANGE`; desativar o último admin → `LAST_ADMIN`.
- Funcionários são criados/redefinidos pela Edge Function (valida JWT + perfil admin).

---

## 5. Front-end

```
src/
├─ lib/
│  ├─ api.ts        todas as chamadas (RPC, views, Edge Function) em um só lugar
│  ├─ hooks.ts      React Query: chaves, queries, useRealtimeSync (canal painel-sync)
│  ├─ pricing.ts    prévia de preço espelhando as regras do banco (+ testes)
│  ├─ format.ts     BRL (NBSP), datas com fuso, parseMoneyToCents, newClientUuid, CSV
│  ├─ errors.ts     código do banco → mensagem em português (+ testes)
│  ├─ types.ts      tipos do domínio e rótulos pt-BR
│  └─ supabase.ts   cliente (anon key) + TIMEZONE
├─ context/AuthContext.tsx    sessão, perfil, guard
├─ components/      ui.tsx (base), AppLayout, OrderComposer, PaymentPanel
└─ pages/           14 telas (login, setup, mesas, mesa, caixa, controle de caixa,
                    delivery, dashboard, relatórios, cardápio, funcionários,
                    histórico, auditoria, configurações)
```

- **Navegação por perfil** (11 itens para admin; caixa: caixa/mesas/delivery/histórico/controle de
  caixa; garçom: mesas).
- **Sincronização em tempo real:** o canal `painel-sync` escuta `postgres_changes` das tabelas
  operacionais e invalida os "baldes" de cache com debounce de 350 ms — dois painéis abertos (caixa e
  garçom) veem a mesma verdade.
- **Nenhuma tela decorativa:** todo botão chama uma operação real; estados de carregamento, vazio e erro
  são tratados.

---

## 6. Decisões conscientes (e alternativas descartadas)

| Decisão | Motivo |
|---|---|
| Escrita operacional só por RPC | Regra única, auditável e impossível de burlar pelo navegador. |
| Preço do servidor sempre vence | Impede divergência entre tela e cobrança. |
| `client_uuid` em todas as criações | Clique duplo e retry de rede são o inimigo nº 1 em operação real. |
| Snapshot em item e endereço | Histórico imutável: o passado não muda quando o cardápio muda. |
| Cancelamento preserva o valor | Auditoria honesta: venda cancelada aparece no relatório como cancelamento. |
| Views `security_invoker = true` | A view respeita a RLS do usuário, não do criador. |
| Pg local com shim para testes | Testar RLS/RPC/concorrência de verdade sem depender de conta em nuvem. |
| Sem integrações externas | Não inventar WhatsApp/Pix/impressora/adquirente; tudo lançado manualmente e documentado. |

## 7. Limites do escopo desta versão

Sem perfil de cozinha, sem impressão térmica, sem app nativo, sem estoque avançado, sem emissão fiscal,
sem gateway de pagamento automático e sem integração com plataformas de entrega. Ver
[`docs/ENTREGA.md`](ENTREGA.md).
