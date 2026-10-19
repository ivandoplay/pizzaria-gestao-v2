# Correções da auditoria de 17/10/2026

Relatório de origem: `AUDITORIA-2026-10-17.md` (fora do repositório, no workspace).
Esta página registra **o que foi corrigido, onde, como foi testado e o que ainda depende de autorização**.

## 1. Situação

| Item | Estado |
|---|---|
| Código (frontend + migrações + Edge Function) | corrigido, commitado e **publicado** (`main` = `f9e2ce7`) |
| Suíte de banco local (PostgreSQL 17) | **460 asserções aprovadas** + teste de concorrência |
| TypeScript / Vitest / build | **0 erros / 91 testes / build OK** |
| Produção (Supabase) | **migrações 0013–0022 aplicadas** em 19/10 (verificado no catálogo) |
| Deploy (Vercel) | **publicado** em 19/10 (`5d1aa0a` → `2e4b640`; smoke e login dos 3 perfis OK) |
| Limpeza dos dados de teste em produção | **executada** em 19/10 (ver §6) |
| Push para o GitHub | **feito** (`ivandoplay/pizzaria-gestao-v2`) |

> **Atualização de 19/10/2026:** a produção recebeu as migrações, o build foi publicado e os dados de
> teste foram limpos. As seções §5 e §6 registram a ordem executada e o que foi encontrado.

## 2. Matriz de correções

| # | Gravidade | Correção | Onde | Commit | Teste |
|---|---|---|---|---|---|
| A1 | P1 | Saldo do recebimento calculado **uma vez** (`total − pago`); a janela recebe os valores crus | `PaymentPanel.tsx`, `TableSessionPage.tsx`, `DeliveryPage.tsx`, `lib/pagamento.ts` | `ae67b08` | `pagamento.test.ts` (6 casos) |
| A2 | P2 | Chave de idempotência presa ao conteúdo da operação (caixa, movimento, delivery) | `CashControlPage.tsx`, `DeliveryPage.tsx` | `10a5e0a` | revisão + suíte de banco (idempotência) |
| A3 | P2 | Preços em lote atômicos; branco mantém; zero recusado; `is_available` preservado | `0013_precos_em_lote.sql`, `MenuAdminPage.tsx` | `04a1b17` | `12_precos_em_lote.sql` |
| A4 | P2 | Seleção de sabores nunca passa do máximo do tamanho | `lib/sabores.ts`, `OrderComposer.tsx` | `9c33e26` | `sabores.test.ts` (6 casos) |
| A5 | P2 | `touch_last_login()` atualiza o próprio perfil sem abrir UPDATE em `profiles` | `0014_ultimo_acesso.sql`, `api.ts`, `AuthContext.tsx` | `a54ede0` | `13_ultimo_acesso.sql` |
| A6 | P2 | `min_delivery_order_cents` e `split_payment_enabled` aplicados no servidor; aviso na tela | `0015_configs_com_efeito.sql`, `DeliveryPage.tsx`, `PaymentPanel.tsx` | `4211651` | `14_configs_com_efeito.sql` |
| A7 | P2 | Janela de desconto em mesa e delivery (motivo, percentual/valor, limite do perfil) | `DiscountDialog.tsx`, `TableSessionPage.tsx`, `DeliveryPage.tsx` | `a32748a` | RPC já coberta no `04_cash_payments.sql` |
| A8 | P2 | Cancelar/reduzir item com valor recebido devolve `PAYMENT_REFUND_REQUIRED` + valores | `0016_cancelar_item_com_pagamento.sql` | `48f4a78` | `15_cancelar_item_com_pagamento.sql` |
| A9 | P2 | Cancelado tem saldo 0 na visão e sai de “contas em aberto” | `0017_saldo_de_cancelado.sql`, `api.ts` | `8e1a9ed` | `16_saldo_de_cancelado.sql` |
| A10 | P2 | Data civil calculada com `Intl` no fuso (sem pular de dia após 21h) | `lib/format.ts` | `c7f615e` | `format.test.ts` (3 cenários com relógio simulado) |
| A11 | P3 | Painel do caixa mostra erro de **todas** as consultas | `CashierHomePage.tsx` | `81d4ac6` | revisão |
| A12 | P3 | Mensagem real da Edge Function exibida (não a genérica) | `api.ts` | `78c57be` | revisão |
| A13 | P3 | “Estornar” só aparece para caixa/admin | `PaymentPanel.tsx` | `7b81328` | servidor já recusava (teste 10) |
| A14 | P3 | CSV neutraliza `= + - @ TAB CR` em texto | `lib/format.ts` | `24212b2` | `format.test.ts` (3 casos) |
| A15 | P3 | EXECUTE retirado de `PUBLIC`/`anon` em todas as funções públicas | `0019_execute_somente_autenticado.sql` | `a0bf6d9` | `18_execute_somente_autenticado.sql` |
| A16 | P3 | `must_change_password` bloqueia RPC no servidor | `0020_senha_obrigatoria_no_servidor.sql` | `2a43e40` | `19_senha_obrigatoria.sql` |
| A17 | P3 | Reset de senha marca a flag **antes** e desfaz se a troca falhar | `functions/admin-create-employee` | `d6f1451` | revisão (ver limite em §3) |
| A18 | P3 | Cardápio/configurações publicados no Realtime e ligados ao balde `catalog`/`settings` | `0018_realtime_cardapio.sql`, `lib/hooks.ts` | `67f5cdd` | `17_realtime_cardapio.sql` |
| A19 | P3 | Rótulos nos horários, filtro de categoria e `h1` no atendimento inexistente | `SettingsPage`, `MenuAdminPage`, `TableSessionPage` | `aef98d6` | revisão estática |
| A20 | P3 | Série de relatórios passa a receber a modalidade | `api.ts`, `ReportsPage.tsx` | `9756396` | revisão |
| A21 | P3 | Senha inicial oculta por padrão, com botão mostrar | `EmployeesPage.tsx` | `499cf87` | revisão |
| A22 | P3 | Removidas funções de API sem tela | `api.ts` | `01d59bc` | `tsc -b` (sem uso) |
| A23 | P1 | Modal renderizado no `<body>`, altura limitada à tela e rodapé sempre visível — no celular o "Registrar" do recebimento ficava **atrás da barra inferior** e era intocável | `ui.tsx` | `031dbc6` | `tools/e2e-partial-desconto.mjs` (falhava antes) |
| A24 | P2 | Desconto não pode deixar o total abaixo do valor recebido (`DISCOUNT_BELOW_PAID`) | `0021_desconto_abaixo_do_pago.sql` | `fde7b83` | `20_desconto_abaixo_do_pago.sql` |
| A25 | P2 | Fechamento de caixa idempotente por conteúdo (repetir devolve o fechamento; conteúdo diferente continua erro) | `0022_fechar_caixa_idempotente.sql` | `e1d30a6` | `21_fechar_caixa_idempotente.sql` |
| A26 | P3 | Virada do dia segue `business_settings.timezone` (fecha a pendência do A10) | `lib/fuso.ts`, `format.ts`, `DashboardPage`, `HistoryPage`, `ReportsPage` | `c707091` | `format.test.ts` (+3 casos) |
| A27 | P2 | Histórico filtrável por **forma de pagamento** (seção 5.5 do prompt mestre, que faltava) | `0023_historico_por_forma_pagamento.sql`, `HistoryPage.tsx`, `api.ts` | `8ff083a` + `b499e11` | `22_historico_e_cliente.sql` (9 asserções) |
| A28 | P2 | Delivery reconhece **cliente recorrente pelo telefone** e reaproveita o endereço (seção 8.1) | `DeliveryPage.tsx`, `api.ts` (`findCustomerByPhone`) | `8ff083a` + `b499e11` | `22_historico_e_cliente.sql` + `tools/e2e-recorrente.mjs` (verde no site publicado) |

## 3. Decisões tomadas (e limites honestos)

### 3.1 Saldo do recebimento (A1)
A convenção passou a ser **total bruto + já pago**, e a subtração acontece em um único lugar
(`saldoPendenteCents`). Qualquer tela nova deve passar `orders.total_cents` e `orders.paid_cents`, nunca um
saldo já subtraído.

### 3.2 Pedido mínimo e pagamento dividido (A6)
* O mínimo compara o **subtotal dos itens**, sem a taxa de entrega. `0` desliga a exigência (padrão).
* Pagamento dividido desligado permite **parcelas na mesma forma**; só recusa a segunda forma diferente.
* A checagem do mínimo roda depois do recálculo oficial e antes da auditoria — pedido recusado não deixa
  registro nem histórico.

### 3.3 Cancelado não deve nada (A9)
A visão `order_overview` devolve `balance_cents = 0` para cancelado; o cliente também exclui cancelados de
`openOnly`. O total e o valor recebido continuam visíveis para histórico.

### 3.4 Fuso horário (A10)
O fuso de exibição do navegador continua vindo de `VITE_TIMEZONE` (padrão `America/Fortaleza`). O servidor
usa `business_settings.timezone` nos relatórios. Se o administrador **mudar** o fuso nas configurações, os
dois podem divergir até o próximo build; está registrado como pendência de produto, não como bug silencioso.

### 3.5 Senha temporária e sessões antigas (A16/A17)
A flag agora bloqueia todas as RPCs. O Admin API do Supabase **não expõe** “encerrar sessões por id de
usuário”; por isso uma sessão aberta antes do reset pode continuar **lendo** o que a RLS permite, mas não
consegue operar (RPC recusada) nem concluir a troca de senha sem a senha atual — que já não é a antiga.
Encerrar sessões de verdade exigiria integração com o GoTrue ou prazo curto de JWT; não foi fingido aqui.

### 3.6 Modal no celular (A23)
Encontrado ao rodar o robô de recebimento parcial em 19/10: com 390×844 o painel do modal crescia
além da tela e o rodapé caía na faixa da barra inferior (z-30). O `position: fixed` não vencia porque o
modal era renderizado dentro da árvore da página; agora vai para o `document.body` (portal), o painel
tem `max-h-[100dvh]` e só o corpo rola. A falha não aparecia no computador, onde sobra altura.

### 3.7 Realtime
Publicadas as tabelas de cardápio e configuração. A carga de replicação é pequena (catálogo muda pouco) e o
cliente já agrupava as invalidações em 350 ms.

## 4. Testes executados nesta rodada

```
npx tsc -b                     → 0 erros
npx vitest run                 → 91 testes, 9 arquivos, todos aprovados
npm run build                  → OK
bash tools/run-sql-tests.sh    → 24 migrações + 21 arquivos + concorrência
                               → 460 asserções aprovadas
```

**Não executados:** robôs Playwright de tela (`tools/e2e-*.mjs`, `auditar-telas.mjs`) e smoke de produção.
Motivo: eles escrevem na base de produção (pedidos, mesas, pagamentos) e nesta sessão não há credencial para
limpar nem para publicar o build. Rodá-los agora testaria o **site antigo** contra a **base antiga**, não
estas correções — o que seria um falso “passou”.

## 5. Ordem para aplicar em produção (quando autorizado)

1. Backup lógico das tabelas de operação (`orders`, `payments`, `cash_sessions`, `cash_movements`,
   `table_sessions`, `audit_logs`).
2. Aplicar as migrações **0013 → 0020** em ordem (Management API ou `supabase db push`).
3. Publicar o build (`git push` → Vercel) e aguardar o deploy.
4. Smoke: login dos três perfis; abrir/receber/fechar uma conta de teste; conferir saldo de recebimento
   parcial; conferir “a receber” sem cancelados; conferir preço em lote; conferir troca de senha.
5. Limpeza de dados de teste (pedido #46 da mesa 12, cancelados #45/#24, mesa 11) — somente com credencial
   administrativa e com o SQL revisado.


## 6. Limpeza da produção (19/10/2026)

Executada com backup lógico prévio em `~/backups_supabase/2026-10-19/` (25 tabelas em JSON).

| O que | Como | Resultado |
|---|---|---|
| Contas abertas (#46/#48/#50/#52/#54 da mesa 12, #49 da 11) | `tools/limpar-contas-teste.mjs` com `PZ_FECHAR=sim` — pelo caminho normal do sistema (caixa recebe, garçom entrega, fecha) | 0 mesas abertas |
| Pedido #51 | fechado pelo próprio robô na rodada em que provou o recebimento em partes | quitado |
| 9 pedidos de 16/10 fechados **sem pagamento** (antes da migração 0012), R$ 121,00 fantasma em “pendente” | `supabase/manual/2026-10-19-limpeza-dados-teste.sql` — cancelamento com motivo e autoria, nada apagado | “a receber” do painel = R$ 0,00 |
| Pedidos #56–#58 (demonstração criada só para a revisão visual das telas) | `supabase/manual/2026-10-19-limpeza-demonstracao-delivery.sql` | 0 delivery aberto |
| Mesa 11 | conferida sessão por sessão (10 sessões, todas `closed`, nenhum pedido em aberto) | nada a corrigir |

Estado final da base: **0 mesas abertas, 0 contas em aberto, 0 pedidos fechados com saldo, 51 pedidos no
histórico (14 cancelados — 2 de antes + 9 da baixa + 3 da demonstração)**. O turno de caixa segue aberto de
propósito: é o turno real da operação e quem fecha é o responsável no balcão.
