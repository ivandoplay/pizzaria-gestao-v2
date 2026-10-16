# Sistema de Gestão para Pizzaria

Sistema web operacional (não é protótipo) para pizzaria com **salão, mesas, pedidos, delivery,
pagamentos, caixa, cardápio, funcionários, relatórios e auditoria**.
Front-end em React + TypeScript hospedável na **Vercel**; banco, autenticação, tempo real e
funções server-side no **Supabase** (PostgreSQL).

Idioma da interface: **português do Brasil**. Moeda: **BRL**. Fuso: **America/Fortaleza**
(configurável no banco, guardado em UTC).

---

## 1. Perfis de acesso

| Perfil | Código | O que faz |
|---|---|---|
| Administrador | `admin` | Tudo: cardápio, funcionários, configurações, relatórios, auditoria, fechamento forçado, descontos sem limite. |
| Caixa (gerente) | `manager` | Operação do dia: mesas, pedidos, delivery, recebimentos, fechamento de contas, turno de caixa, histórico, painel operacional. |
| Garçom | `waiter` | Abre mesa, lança pedido, acompanha status e usa a tela **Pedidos prontos** para marcar o pedido pronto como **entregue na mesa**. Não recebe, não desconta, não cancela. |

O perfil é validado **no banco** a cada chamada (`app_private.require_role`), não no navegador.
Esconder botão não é controle de acesso.

Conta criada ou com senha redefinida pelo administrador entra com **senha temporária** e, no primeiro
acesso, vê **uma única tela**: definir a senha definitiva. Enquanto `profiles.must_change_password`
estiver marcada, nenhuma rota, menu ou atalho abre — o portão fica no app e a baixa da flag é feita por
`public.complete_password_change()` (que só age sobre o próprio perfil e registra o evento na auditoria).

## 2. O que o sistema faz

- **Salão/mesas** — mapa de mesas com situação ao vivo; abertura de atendimento com idempotência
  (clique duplo não abre duas sessões); vários pedidos por mesa; conta separada por sessão.
- **Pedidos** — montagem com meio a meio, bordas/adicionais obrigatórios, preços calculados no
  servidor e gravados como **snapshot histórico** (reajuste de cardápio não altera pedido antigo).
- **Cozinha/produção** — estados `recebido → confirmado → em preparo → pronto → entregue`
  (ou `saiu para entrega → entregue`), com histórico de cada mudança e motivo obrigatório em cancelamentos.
- **Caixa** — turno com fundo de troco, sangria/suprimento, recebimento total/parcial, Pix e cartão
  registrados manualmente com confirmação consciente, troco calculado, estorno com motivo,
  fechamento com conferência de gaveta e justificativa de divergência.
- **Delivery** — cliente recorrente por telefone (deduplicado), endereço com snapshot no pedido,
  taxa por zona de bairro (ou padrão), acompanhamento até a entrega.
- **Cardápio** — categorias, tamanhos, produtos, variações de preço, grupos de adicionais com
  mínimo/máximo, disponibilidade; nada é excluído, tudo é desativado.
- **Administração** — funcionários (via Edge Function com `service_role`), configurações do
  negócio, horários, formas de pagamento, dashboard com dados reais e auditoria append-only.

## 3. Stack

| Camada | Tecnologia |
|---|---|
| Front-end | React 18, TypeScript 5.6, Vite 5, TailwindCSS 3, React Router 6, TanStack Query 5, `@supabase/supabase-js` 2 |
| Testes de UI/lógica | Vitest (25 testes) |
| Banco | PostgreSQL (Supabase) com RLS, triggers, views e 23 funções RPC (14 operacionais + 8 de relatório + a troca obrigatória de senha) |
| Autenticação | Supabase Auth — e-mail interno `login@pizzaria.local` gerado a partir do login digitado |
| Tempo real | Supabase Realtime (canal `painel-sync`, debounce de 350 ms) |
| Server-side privilegiado | Edge Function `admin-create-employee` (criar funcionário/redefinir senha) |
| Hospedagem | Vercel (build estático em `dist/`) + Supabase |

## 4. Como rodar localmente

```bash
npm install
cp .env.example .env.local     # preencha URL e anon key do SEU projeto Supabase
npm run dev                    # http://localhost:5173
```

Sem as variáveis preenchidas, o app abre a tela **Configuração pendente** explicando o que falta
(comportamento intencional — nada de tela quebrada).

Comandos:

```bash
npm run dev        # servidor de desenvolvimento
npm run build      # tsc -b && vite build  → dist/
npm run preview    # serve o build de produção
npm test           # Vitest (25 testes)
npm run typecheck  # tsc -b
```

## 5. Banco de dados

As migrações ficam em `supabase/migrations/` e são aplicadas **em ordem**:

| Arquivo | Conteúdo |
|---|---|
| `20260101000001_foundation.sql` | `profiles`, `business_settings`, `business_hours`, `payment_methods`, auditoria, helpers (`app_private`), triggers de usuário novo. |
| `20260101000002_menu.sql` | `categories`, `product_sizes`, `products`, `product_variants`, `modifier_groups`, `modifier_options`, `product_modifier_groups`. |
| `20260101000003_cash.sql` | `cash_sessions` (1 turno aberto por vez), `cash_movements`. |
| `20260101000004_customers.sql` | `customers` (dedupe por telefone), `customer_addresses`, `delivery_fee_zones`. |
| `20260101000005_operations.sql` | `restaurant_tables`, `table_sessions`, `orders`, `order_items`, `order_item_flavors`, `order_item_modifiers`, `order_status_history`, `payments` + recálculo de totais. |
| `20260101000006_rls.sql` | RLS em todas as tabelas, privilégios (com revogação de escrita nas tabelas que só aceitam RPC), `guard_profiles`, views de leitura (`table_overview`, `order_overview`, `cash_session_overview`, `order_item_overview`) e publicação de Realtime. |
| `20260101000007_rpc.sql` | Regras de negócio: 14 RPCs (pedidos, contas, pagamentos, caixa, delivery, clientes). |
| `20260101000008_reports.sql` | 8 funções de relatório/indicadores agregando no banco. |
| `20260101000009_troca_senha_obrigatoria.sql` | `complete_password_change()`: baixa a própria flag de senha temporária, idempotente e auditada (23 funções no total). |
| `20260101000010_fila_pedidos_prontos.sql` | Fila de pedidos prontos: a view `order_overview` passa a expor **`ready_at`** (horário em que o pedido ficou pronto) e **`session_status`**; `advance_order_status` confere **sessão da mesa e conta encerrada dentro da transação** no caminho `delivered_to_table`. Nenhuma função nova: continuam 23. |

Seeds:

| Arquivo | Para que serve |
|---|---|
| `supabase/seed/seed_structure.sql` | Estrutura mínima (categorias, tamanhos, mesas, formas de pagamento, horários). Seguro para produção. |
| `supabase/seed/seed_cardapio_EXEMPLO.sql` | **Cardápio de exemplo** (72 itens: pizzas, bebidas, lanches, porções, sobremesas + 32 adicionais + 8 bairros com taxa). Idempotente. Remoção em um comando. |
| `supabase/seed/remove_cardapio_EXEMPLO.sql` | Remove o cardápio de exemplo. **Se houver pedidos usando os itens, não apaga — apenas desativa**, para não quebrar histórico. |
| `supabase/seed/seed_demo_DESENVOLVIMENTO.sql` | Dados de demonstração com prefixo `[DEMO]` — **nunca** usar em produção. |

Os dois arquivos do cardápio de exemplo são gerados por `tools/gerar_seed_cardapio.py` (mesma fonte
para o seed e a remoção, então as listas nunca ficam desencontradas).

> Como as migrações se aplicam: **SQL Editor do Supabase, uma a uma, na ordem dos nomes** (ou
> `supabase db push` se você usar a CLI). Detalhes em [`docs/SETUP.md`](docs/SETUP.md).

## 6. Testes — o que foi realmente executado

| Suíte | O que cobre | Resultado |
|---|---|---|
| `supabase/tests/00_setup.sql` … `09_fila_prontos.sql` | 311 asserções no PostgreSQL: RLS, privilégios, permissões por perfil, cardápio, mesas/pedidos, caixa/pagamentos, delivery, relatórios, auditoria, troca obrigatória de senha e fila de prontos | **verde** (local) |
| `supabase/tests/07_concurrency.sh` | Concorrência real com duas conexões simultâneas (abertura de mesa, clique duplo de pagamento, fechamento duplo) | **verde** |
| Vitest (`npm test`) | Regras de preço espelhadas do banco, formatação BRL/datas/durações/plural, tradução de erros, criação sob demanda do cliente Supabase, regras da troca de senha e regras da fila de prontos | **56/56** |
| `npm run typecheck` | TypeScript em modo estrito, sem emissão | **exit 0** |
| `npm run build` | Build de produção com cada tela em um chunk próprio | **exit 0** (principal 491 kB / 141 kB gzip + chunks por tela) |
| GitHub Actions (`CI`) — aplicação | A cada push no `main`, pull request e execução manual: `npm ci` → `tsc -b` → Vitest → `vite build` | **sucesso** (16/10/2026) |
| GitHub Actions (`CI`) — banco | PostgreSQL 17 descartável no próprio executor: `tools/run-sql-tests.sh` (migrações + suíte 00–09 + concorrência com conexões paralelas) | **sucesso** (16/10/2026) |

Reproduza tudo com:

```bash
bash tools/run-sql-tests.sh   # recria o banco, aplica migrações + seeds e roda 00–09
npm test && npm run build
```

Detalhes e limitações em [`docs/TESTES.md`](docs/TESTES.md).

## 7. Interface (design system)

A interface usa um design system próprio em `src/components/ui.tsx` + `src/components/icons.tsx`.
Para trocar cores, cantos, sombras, fonte ou movimento, veja **[`docs/IDENTIDADE.md`](docs/IDENTIDADE.md)** —
é o manual de estilo do sistema (nenhuma tela tem cor fixa).

Princípios aplicados (revisão de 15/10/2026, sobre os padrões de dashboard de 2026):

- **Cor é acento.** `brand` (vermelho de osteria) só em ação, foco e seleção; neutros quentes `ink` sustentam
  o resto. A única exceção é a faixa fina no alto do cartão de mesa, que o garçom lê à distância.
- **Sombra é elevação.** Cartão = borda de 1 px + sombra quase invisível; sombra forte só no que flutua
  (modal, aviso).
- **Raio externo ≠ interno** (14 px no cartão, 8–10 px no que fica dentro dele).
- **Escala curta de texto** (seis tamanhos) e espaçamento sempre em passos de 4 px.
- **Faixa de indicadores com 4 números**; o restante virou lista de conferência dentro de um cartão.
- **Movimento de 150–220 ms**, respeitando `prefers-reduced-motion`.

- **Cores:** escala `brand` (vermelho da casa) para ação e `ink` (neutro quente) para estrutura,
  definidas em `tailwind.config.js` — nenhuma cor solta nas telas.
- **Ícones:** SVG inline, traço 1,75 px, sem CDN e sem fonte de ícones — funcionam no balcão, no tablet e quando
  a internet cai (o bundle leva tudo).
- **Componentes:** `Button`, `IconButton`, `Card`, `StatTile`, `Badge`, `StatusPill`, `Callout`, `EmptyState`,
  `Field`/`Input`/`Select`/`Textarea`/`Checkbox`, `SearchInput`, `SegmentedControl`, `QtyStepper`, `Modal`
  (com armadilha de foco e `aria-modal`), `ConfirmDialog`, `DataTable` (cabeçalho fixo, navegação por teclado),
  `ToastProvider` e esqueletos de carregamento.
- **Layout:** sidebar com grupos (Operação / Gestão / Sistema), cabeçalho com o estado do tempo real e barra
  inferior no celular — o garçom navega com o polegar.
- **Acessibilidade:** foco visível em tudo, `aria-*` nos diálogos e avisos, alvos de toque com 40 px ou mais e
  respeito a `prefers-reduced-motion`.

## 8. Documentação

- [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) — modelo de dados, regras, fluxos financeiros, segurança.
- [`docs/SETUP.md`](docs/SETUP.md) — Supabase, Vercel, GitHub, Edge Function, variáveis de ambiente, Realtime.
- [`docs/TESTES.md`](docs/TESTES.md) — como os testes rodam e o que eles provam.
- [`docs/IDENTIDADE.md`](docs/IDENTIDADE.md) — manual de estilo: onde mudar cores, cantos, sombras, fonte e movimento.
- [`docs/ENTREGA.md`](docs/ENTREGA.md) — resumo da entrega: funcionalidades, pendências manuais, limitações e próximos passos.
- [`PLANO.md`](PLANO.md) — plano de execução por etapas (com estado atual).

## 9. Estado atual

- **Código:** publicado em `github.com/ivandoplay/pizzaria-gestao-v2` (**repositório público**, a pedido do
  administrador; `vercel.json` expõe apenas URL do Supabase e chave publishable, que são públicas por natureza —
  os dados continuam protegidos por RLS).
- **Banco:** migrações, RLS, Realtime e Edge Function **aplicados e verificados no Supabase real**
  (projeto da org *Pizzaria*, `sa-east-1`) com a suíte de testes rodando contra a nuvem. Na base estão
  os três perfis de trabalho (`admin`, `caixa`, `garcom`), o **cardápio demonstrativo** (removível por
  `supabase/seed/remove_cardapio_EXEMPLO.sql`) e duas contas de apoio dos robôs
  (`robo.caixa`, `robo.garcom`) mais duas contas de teste desativadas (`robo.troca.senha`, `robo.dbg`) —
  todas desativáveis na tela de funcionários, nenhuma exclusão é feita.
- **Site publicado:** <https://pizzaria-gestao-v2.vercel.app> (deploy automático a cada push no `main`).
  As três variáveis `VITE_*` ficam em `vercel.json` → `build.env` (são valores públicos; ver `.env.example`).
- **Conferência do site publicado:** `bash tools/smoke-deploy.sh https://pizzaria-gestao-v2.vercel.app admin 'senha'`
  verifica rotas, cabeçalhos, presença das variáveis, ausência de credencial privilegiada e faz um login real.
- **Falta:** cadastrar o cardápio real (o demonstrativo está na base e pode ser removido com
  `supabase/seed/remove_cardapio_EXEMPLO.sql`). As senhas temporárias de caixa e garçom são trocadas no
  primeiro acesso de cada um, na tela obrigatória.
  Veja [`docs/ENTREGA.md`](docs/ENTREGA.md), seções 5 e 7.

### Licença e uso

Repositório **público para consulta** — não há licença de reuso concedida: o código, o banco e a
documentação continuam sendo do estabelecimento. Se quiser abrir o uso (MIT, Apache 2.0, uso interno
formal…), basta escolher a licença e eu adiciono o arquivo `LICENSE` e a seção correspondente aqui.
