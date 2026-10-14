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
| Suíte do banco (00–06) | `bash tools/run-sql-tests.sh` | **280 asserções aprovadas**, 0 falhas |
| Concorrência real (07) | idem (duas conexões em paralelo) | **verde**: abertura dupla bloqueada, clique duplo → 1 pagamento, fechamento duplo → recusado |
| Testes unitários | `npm test` (Vitest) | **25/25** |
| Tipos | `npm run typecheck` | **exit 0** |
| Build de produção | `npx vite build` | **exit 0** (587 kB, 162 kB gzip) |

Detalhes, valores esperados e limitações em [`TESTES.md`](TESTES.md).

## 5. Estado do build e do deploy

- **Build:** verde e reprodutível (`npm install && npm run build` → `dist/`).
- **Deploy Vercel:** **não executado** — exige a sua conta e o repositório no GitHub. O projeto está
  preparado: `vercel.json` com roteamento SPA e cabeçalhos de segurança, saída estática em `dist/`,
  variáveis lidas de `import.meta.env`. Passo a passo em [`SETUP.md`](SETUP.md), seção 7.
- **Supabase:** migrações, políticas e RPCs validados em PostgreSQL local; **ainda não aplicados** em
  um projeto em nuvem (sem credenciais nesta sessão). Passo a passo: seções 1–5 do `SETUP.md`.
- **GitHub:** repositório ainda não criado; comandos prontos na seção 8 do `SETUP.md`.

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

1. Criar o projeto Supabase e aplicar as 8 migrações + `seed_structure.sql`.
2. Criar o primeiro administrador (`Authentication → Users`) e vinculá-lo em `public.profiles`.
3. Publicar a Edge Function `admin-create-employee` e cadastrar seus 3 segredos.
4. Confirmar a publicação `supabase_realtime` nas tabelas operacionais.
5. Configurar as variáveis de ambiente na Vercel (Production/Preview/Development).
6. Deploy na Vercel e teste de fumaça: abrir mesa → pedido → conta → caixa → relatório.
7. Preencher a tela **Configurações** (identidade, fuso, descontos, taxas, modos aceitos) e cadastrar
   o cardápio real.
8. Revisar a política de backup do plano Supabase contratado.

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
| Deploy | **pendente de ação manual** (Supabase + Vercel + GitHub) |
| Pronto para venda real? | **não ainda** — depende da aplicação no Supabase e do teste de fumaça |
