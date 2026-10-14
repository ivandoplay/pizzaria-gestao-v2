# Entrega — resumo do sistema

Documento de fechamento (seção 19 do prompt): o que foi implementado, o que foi realmente testado,
o que ainda depende de configuração manual e quais são as limitações.

---

## 1. Funcionalidades implementadas

### Salão e mesas
- Mapa de mesas com situação ao vivo (disponível, ocupada, aguardando fechamento, atenção).
- Abertura de atendimento com número de pessoas e observação; idempotente por `client_uuid`;
  bloqueio de segunda abertura na mesma mesa (garantido por índice único parcial + validação).
- Vários pedidos por mesa; conta consolidada por sessão; fechamento só sem saldo pendente
  (admin pode forçar com motivo).

### Pedidos
- Composição com pizza meio a meio (regra `highest`/`average` configurável), tamanhos, bordas e
  adicionais com mínimo/máximo por grupo.
- Cálculo de preço no servidor e **snapshot histórico** (nome e preço do item não mudam depois).
- Cancelamento de item (total ou parcial) com motivo; cancelamento de pedido com motivo;
  `PAYMENT_REFUND_REQUIRED` se houver valor recebido.
- Fluxo de status com histórico completo e sincronização dos painéis em tempo real.

### Caixa
- Turno com fundo de troco (um caixa aberto por vez), sangria, suprimento, despesa e ajuste.
- Recebimento total/parcial, dinheiro com troco calculado, Pix/cartão com confirmação consciente,
  estorno com motivo (registro preservado).
- Descontos por percentual ou valor com justificativa e dois limites configuráveis.
- Fechamento de turno com gaveta esperada, valor contado, divergência e justificativa obrigatória.

### Delivery
- Cliente por telefone (deduplicado por dígitos), endereço com snapshot no pedido.
- Taxa por zona de bairro ou taxa padrão; taxa ajustável pelo admin com motivo.
- Acompanhamento até `delivered`; fechamento da conta do delivery (com força apenas pelo admin).

### Cardápio
- Categorias, tamanhos, produtos, variações de preço (produto × tamanho), grupos e opções de
  adicionais, disponibilidade e ordem de exibição. Nada é excluído — só desativado.

### Administração
- Dashboard com dados reais, relatórios (financeiro, série temporal, top produtos, por funcionário,
  por forma de pagamento, sessões de caixa, painel operacional), histórico com filtros e paginação.
- Funcionários: criar, ativar/desativar, trocar função, redefinir senha (via Edge Function).
- Configurações: identidade da casa, fuso, regra do meio a meio, descontos, taxas, pedido mínimo,
  aceitar salão/delivery, horários e formas de pagamento.
- Auditoria append-only com autor, data/hora, valor e motivo por operação.

## 2. Migrações e tabelas

8 migrações versionadas em `supabase/migrations/` (**25 tabelas**), aplicadas em ordem:

| Migração | Conteúdo |
|---|---|
| `0001_foundation` | `profiles`, `business_settings`, `business_hours`, `payment_methods`, `audit_logs`, schema `app_private`, triggers de auditoria e de usuário novo |
| `0002_menu` | `categories`, `product_sizes`, `products`, `product_variants`, `modifier_groups`, `modifier_options`, `product_modifier_groups` |
| `0003_cash` | `cash_sessions`, `cash_movements` |
| `0004_customers` | `customers`, `customer_addresses`, `delivery_fee_zones` |
| `0005_operations` | `restaurant_tables`, `table_sessions`, `orders`, `order_items`, `order_item_flavors`, `order_item_modifiers`, `order_status_history`, `payments`, `recalc_order_totals` |
| `0006_rls` | RLS + grants em todas as tabelas, **revogação de escrita nas tabelas RPC-only**, `guard_profiles`, 4 views (`security_invoker`), publicação de Realtime |
| `0007_rpc` | 14 RPCs operacionais |
| `0008_reports` | 8 funções de relatório/indicadores (22 funções no total) |

Convenções do banco: dinheiro em **centavos inteiros**; índices únicos parciais garantindo uma sessão
aberta por mesa e um turno aberto; `client_uuid unique` para idempotência; snapshots históricos;
trilha de auditoria somente-adição.

## 3. Políticas RLS

- **25 de 25 tabelas** com RLS habilitada **e forçada** (`force row level security`), conferido por
  consulta ao catálogo.
- Leitura por perfil; a escrita operacional passa por RPC; `payments`, `cash_movements` e `audit_logs`
  são somente-leitura para clientes.
- **Defesa em profundidade:** nas 10 tabelas cuja escrita é exclusivamente por RPC, o GRANT de
  INSERT/UPDATE/DELETE foi revogado de `authenticated` — além de não existir política, a permissão
  não existe. Conferido no catálogo (`information_schema.table_privileges` retorna só SELECT).
- As 4 views são `security_invoker = true` (respeitam a RLS de quem consulta).
- `app_private.require_role(...)` valida o perfil no banco a cada RPC (garçom não recebe, não desconta,
  não cancela); trigger `guard_profiles` impede alterar a própria função (`SELF_ROLE_CHANGE`) e
  desativar o último admin (`LAST_ADMIN`).
- Cobertura de teste: `01_auth_permissions.sql` (anônimo, garçom, caixa, admin, escalada de permissão)
  + asserções de escrita bloqueada em cada domínio (inclusive `permission denied` nas tabelas RPC-only).

## 4. Testes realmente executados

| Verificação | Comando | Resultado |
|---|---|---|
| Suíte do banco (00–06), local | `bash tools/run-sql-tests.sh` | **280 asserções aprovadas**, 0 falhas |
| Suíte do banco (00–06), **no Supabase real** | `tools/supabase-cloud-sql.sh` | **nenhuma falha** (falha em qualquer asserção aborta o arquivo) |
| Concorrência real (07) | idem (duas conexões em paralelo) | **verde**: abertura dupla bloqueada, clique duplo → 1 pagamento, fechamento duplo → recusado |
| Testes unitários | `npm test` (Vitest) | **25/25** |
| Tipos | `npm run typecheck` | **exit 0** |
| Build de produção | `npx vite build` | **exit 0** (587 kB, 162 kB gzip) |

Detalhes, valores esperados e limitações em [`TESTES.md`](TESTES.md).

## 5. Estado do build e do deploy

Atualizado em **14/10/2026**, depois da execução com as credenciais reais.

### 5.1 GitHub — **executado**

- Repositório privado **`ivandoplay/pizzaria-gestao-v2`**, branch `main`, commit `7791d98` (71 arquivos).
- Conferido antes do push: nenhum `.env`, `node_modules` ou `dist`; nenhum token/segredo no conteúdo
  versionado (só `.env.example` com marcadores).
- O repositório antigo `ivandoplay/pizzaria-gestao` (versão Node.js + SQLite) **não foi alterado**.

### 5.2 Supabase — **executado no projeto da org "Pizzaria"**

- Projeto: `qmrcnoigaszditwchsdz` (org *Pizzaria*, região `sa-east-1`, PostgreSQL 17.11).
- **Backup do estado anterior** antes de qualquer alteração: as 22 tabelas / 101 linhas foram exportadas
  para `backups_supabase/` (dados em JSON + estrutura em SQL + instruções de restauração).
- Schema `public` anterior removido (com a sua autorização) e as **8 migrações aplicadas em ordem**,
  seguidas do `seed_structure.sql`. Catálogo conferido: **25 tabelas, 4 views, 22 funções, RLS e
  FORCE RLS nas 25 tabelas** e 10 tabelas publicadas no Realtime.
- **Suíte de testes executada contra o banco real** (00 → 06): **nenhuma falha**. Em seguida os dados de
  teste foram removidos, as migrações reaplicadas e o banco ficou limpo (0 pedidos, 0 clientes, 0
  atendimentos — apenas o administrador). O teste de concorrência (07) não roda pela API de consulta
  (exige duas conexões simultâneas); ele foi executado localmente e está verde.
- **Edge Function `admin-create-employee` publicada e verificada no ar:** sem token → HTTP 401; com
  token de admin → cria funcionário, recusa login duplicado e redefine senha gerando senha temporária.
- **Administrador criado**: `admin@pizzaria.local` (login `admin`, perfil `admin` ativo). O trigger do
  banco cria todo perfil **inativo** por segurança; ele foi ativado explicitamente.
- **Teste de fumaça com login real:** token emitido pelo Auth, leitura de `profiles` via PostgREST
  (passando pela RLS) e chamada da RPC `get_operational_summary` retornando dados reais
  (fuso `America/Fortaleza`, 12 mesas livres, caixa fechado). Acesso anônimo bloqueado: tabela devolve
  `[]` e RPC devolve `42501 AUTH_REQUIRED`.

### 5.3 Vercel — **pendente (um passo)**

- **Build:** verde e reprodutível (`npm install && npm run build` → `dist/`).
- O deploy **não foi feito**: não houve token da Vercel. Duas opções:
  1. **Pelo painel (5 cliques):** Vercel → *Add New → Project* → importe
     `ivandoplay/pizzaria-gestao-v2` → confirme Vite / `npm run build` / `dist` → cadastre
     `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` e `VITE_TIMEZONE` → *Deploy*.
  2. **Por token:** crie um em vercel.com/account/tokens, me envie e **revogue depois** — eu faço o
     deploy e cadastro as variáveis.

## 6. Variáveis de ambiente necessárias (sem valores)

**Aplicação (Vercel / `.env.local`)**

| Variável | Obrigatória | Descrição |
|---|---|---|
| `VITE_SUPABASE_URL` | sim | URL do projeto Supabase |
| `VITE_SUPABASE_ANON_KEY` | sim | chave pública (`anon`) — protegida pela RLS |
| `VITE_TIMEZONE` | não | fuso de exibição; padrão `America/Fortaleza` |

**Edge Function `admin-create-employee` (segredos do Supabase)**

| Variável | Descrição |
|---|---|
| `SUPABASE_URL` | URL do projeto |
| `SUPABASE_ANON_KEY` | chave pública, usada para validar o JWT recebido |
| `SERVICE_ROLE_KEY` | chave administrativa — **nunca** no front, nunca no Git |

## 7. Configurações manuais pendentes

**Já executado:** projeto Supabase com migrações aplicadas, administrador criado, Edge Function
publicada, Realtime ativo e banco limpo (seção 5.2); código publicado no GitHub (seção 5.1).

**Ainda falta:**

1. **Deploy na Vercel** (seção 5.3) com as três variáveis de ambiente.
2. **Trocar a senha do administrador** no primeiro acesso — a senha temporária foi entregue no chat e
   deve ser considerada exposta (use *Funcionários → Redefinir senha*, ou defina outra pelo painel).
3. **Cadastrar o negócio:** tela Configurações (nome, telefone, fuso, descontos, taxa padrão, bairros,
   ligar/desligar salão e delivery) e o cardápio real (categorias, tamanhos, produtos, preços, adicionais).
4. **Cadastrar os funcionários** (caixa e garçons) pela tela Funcionários.
5. Revisar a política de backup do plano contratado.
6. **Rotacionar os tokens** usados nesta sessão (GitHub e Supabase) — eles trafegaram no chat.

## 8. Limitações conhecidas

- Sem teste de fumaça contra o Supabase real nem E2E de navegador (detalhes em `TESTES.md`, seção 5).
- Sem perfil de cozinha, sem impressão térmica, sem estoque avançado, sem emissão fiscal, sem gateway
  de pagamento e sem integrações externas (WhatsApp, aplicativos de entrega) — fora do escopo definido;
  Pix e cartão são registrados manualmente com confirmação do caixa.
- Carga e desempenho não medidos com volume alto de pedidos.
- Chunk único de 587 kB no bundle (aviso cosmético; caminho de melhoria em `TESTES.md`, seção 4).
- A troca de login curto (`login@pizzaria.local`) para e-mail real exige cadastro e pequena alteração
  no `AuthContext` (decisão registrada em `DECISIONS.md`, 1.2).

## 9. Próximas etapas recomendadas

1. Aplicar em um projeto Supabase de **teste** e rodar o teste de fumaça do checklist.
2. Escrever E2E (Playwright) para os fluxos críticos: mesa → pedido → conta → caixa; delivery completo.
3. Separar ambientes (produção × staging) com projetos Supabase distintos e previews da Vercel.
4. Monitoramento: alertar sobre divergência de caixa recorrente e pedidos abertos há muito tempo.
5. Evoluções naturais do produto: perfil de cozinha (tela de produção), impressão térmica,
   estoque por insumo e ficha técnica, integração Pix real (com gateway homologado).
6. Revisar periodicamente as permissões (`docs/ARQUITETURA.md`, seção 4) antes de cada nova função.

---

## Estado do sistema

| Aspecto | Situação |
|---|---|
| Código (banco + servidor + interface) | completo para o escopo definido |
| Migrações, RLS, RPCs, views, Realtime | escritos e validados localmente |
| Testes | executados, verdes (280 asserções SQL + 25 unitários + concorrência real) |
| Build | verde |
| GitHub | **publicado** (`ivandoplay/pizzaria-gestao-v2`, privado) |
| Supabase | **configurado e verificado na nuvem** (migrações, RLS, Realtime, Edge Function, admin, login real) |
| Deploy Vercel | **pendente** — importar o repositório + 3 variáveis de ambiente |
| Pronto para venda real? | **falta pouco:** deploy na Vercel, troca da senha do admin e cadastro do cardápio real. O banco e as permissões já estão verificados em produção. |
