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
- Funcionários: criar, ativar/desativar, trocar função, redefinir senha (via Edge Function) e **troca
  obrigatória de senha no primeiro acesso**: quem recebeu senha temporária só vê a tela de definir a senha
  definitiva até concluir a troca (a baixa da flag fica registrada na auditoria).
- Configurações: identidade da casa, fuso, regra do meio a meio, descontos, taxas, pedido mínimo,
  aceitar salão/delivery, horários e formas de pagamento.
- Auditoria append-only com autor, data/hora, valor e motivo por operação.

### Por dispositivo (15/10/2026)
- **Computador (caixa e administração):** paleta de comandos `Ctrl+K` que busca telas e ações do
  perfil, painel de atalhos (`?`), tabelas mais densas a partir de 1024px e `Enter` para confirmar
  o recebimento na janela de pagamento. Atalhos ficam inertes com campo de texto focado ou janela
  aberta.
- **Celular (garçom):** item de tamanho único e sem escolha obrigatória entra na lista com **um
  toque**; alvos de toque de 44px; barra de envio fixa acima da navegação (zona do polegar); e a
  conta da mesa não tem mais rolagem lateral (era 862px de conteúdo numa tela de 390px).
- **Varredura de todas as telas:** as 28 leituras de tela (todas as rotas dos 3 perfis, no celular e
  no computador) passam sem rolagem lateral, sem erro de console e sem alvo de toque abaixo de
  44px no celular — conferido por `tools/auditar-telas.mjs`, que também guarda uma captura de cada
  tela em `artifacts/auditoria/`.

## 2. Migrações e tabelas

9 migrações versionadas em `supabase/migrations/` (**25 tabelas**), aplicadas em ordem:

| Migração | Conteúdo |
|---|---|
| `0001_foundation` | `profiles`, `business_settings`, `business_hours`, `payment_methods`, `audit_logs`, schema `app_private`, triggers de auditoria e de usuário novo |
| `0002_menu` | `categories`, `product_sizes`, `products`, `product_variants`, `modifier_groups`, `modifier_options`, `product_modifier_groups` |
| `0003_cash` | `cash_sessions`, `cash_movements` |
| `0004_customers` | `customers`, `customer_addresses`, `delivery_fee_zones` |
| `0005_operations` | `restaurant_tables`, `table_sessions`, `orders`, `order_items`, `order_item_flavors`, `order_item_modifiers`, `order_status_history`, `payments`, `recalc_order_totals` |
| `0006_rls` | RLS + grants em todas as tabelas, **revogação de escrita nas tabelas RPC-only**, `guard_profiles`, 4 views (`security_invoker`), publicação de Realtime |
| `0007_rpc` | 14 RPCs operacionais |
| `0008_reports` | 8 funções de relatório/indicadores |
| `0009_troca_senha_obrigatoria` | `public.complete_password_change()` — baixa a própria flag de senha temporária, idempotente, com auditoria (23 funções no total) |

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
| Suíte do banco (00–08), local | `bash tools/run-sql-tests.sh` | **288 asserções aprovadas**, 0 falhas |
| Suíte do banco (00–08), **no Supabase real** | `tools/supabase-cloud-sql.sh` | **nenhuma falha** (falha em qualquer asserção aborta o arquivo) |
| Concorrência real (07) | idem (duas conexões em paralelo) | **verde**: abertura dupla bloqueada, clique duplo → 1 pagamento, fechamento duplo → recusado |
| Testes unitários | `npm test` (Vitest) | **48/48** |
| Tipos | `npm run typecheck` | **exit 0** |
| Build de produção | `npx vite build` | **exit 0** (chunk principal 479 kB / 138 kB gzip + 1 chunk por tela) |
| Interface em navegador real | `node tools/e2e-telas.mjs <URL>` (Playwright, contra o **site publicado**) | **0 falhas**: login dos 3 perfis, 11 telas do administrador, percurso completo do salão, bloqueio de permissão conferido, nenhum erro de console/rede |
| Troca obrigatória de senha | `node tools/teste-troca-senha.mjs <URL>` (Playwright, contra o **site publicado**) | **0 falhas**: senha temporária não abre o sistema (nem pela rota), validações da troca, senha antiga deixa de funcionar, evento na auditoria e conta de teste desativada |
| Conferência do deploy | `bash tools/smoke-deploy.sh <URL> admin '<senha>'` | **tudo certo** (rotas, cabeçalhos, variáveis no bundle, ausência de credencial privilegiada, login real) |

Detalhes, valores esperados e limitações em [`TESTES.md`](TESTES.md).

## 5. Estado do build e do deploy

Atualizado em **14/10/2026**, depois da execução com as credenciais reais.

### 5.1 GitHub — **executado**

- Repositório **`ivandoplay/pizzaria-gestao-v2`** (tornado **público** a pedido do administrador), branch `main`.
  Nenhum segredo real no histórico: a varredura em todos os commits não encontrou token, senha ou chave
  privilegiada — só textos de documentação citando `service_role`/`sb_secret_`.
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

### 5.3 Cardápio de exemplo e funcionários — **aplicado a pedido do administrador**

> ⚠️ **Isto é material de demonstração dentro do projeto de produção.** Foi aplicado porque o
> administrador pediu um cardápio completo para testar o sistema antes de cadastrar o cardápio real.
> Está identificado e é removível em um comando — o projeto manda não misturar demonstração com dados
> reais, então: use para testar, depois apague com `supabase/seed/remove_cardapio_EXEMPLO.sql`
> (se algum item já tiver sido vendido, o script apenas o desativa, preservando o histórico).

- **72 itens** em 7 categorias: 14 pizzas salgadas (P/M/G/Família), 5 pizzas doces, 19 bebidas,
  8 bebidas alcoólicas, 11 lanches (avulso e combo), 9 porções, 6 sobremesas.
- **138 preços** (produto × tamanho), **32 adicionais** em 4 grupos (borda, extras, lanche, molhos) e
  **8 bairros** de Teresina com taxa de entrega (Centro R$ 5,00 a Dirceu R$ 12,00); taxa padrão de
  bairro não cadastrado definida em R$ 7,00 (só porque estava zerada).
- **Funcionários criados e testados:** um perfil de **caixa** (`manager`) e um de **garçom** (`waiter`),
  ambos ativos, criados pela Edge Function `admin-create-employee` — o mesmo caminho que a tela
  Funcionários usa. As senhas **não** ficam no repositório nem na documentação.

**Teste de fumaça com o cardápio real, dentro de uma transação desfeita no fim** (zero resíduo no banco):

| Perfil | Ação | Resultado |
|---|---|---|
| Garçom | Abriu a mesa 3 e lançou o pedido | pedido com pizza meio a meio Média + borda cheddar + 2× Coca-Cola 2L = **R$ 84,00** |
| Garçom | Tentou confirmar o pedido | **bloqueado pelo banco** (permissão negada) |
| Caixa | Conduziu o preparo | `received → confirmed → preparing → ready` |
| Garçom | Entregou na mesa | `delivered_to_table`, **5 mudanças registradas** no histórico |
| Caixa | Recebeu no Pix e fechou a conta | mesa voltou a `available`; painel do dia: **R$ 84,00** |
| Admin | Conferiu o relatório | 1 pedido, vendas R$ 84,00, recebido R$ 84,00, pendente R$ 0,00, ticket R$ 84,00 |

### 5.4 Vercel — **publicado**

- **Endereço:** <https://pizzaria-gestao-v2.vercel.app> (projeto ligado ao GitHub, deploy automático a
  cada push no `main`).
- **Configuração das variáveis:** declaradas em `vercel.json` → `build.env`
  (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_TIMEZONE`). Decisão consciente: são valores
  **públicos** — a URL do projeto e a chave *publishable* que qualquer navegador recebe ao abrir o app,
  protegida pela RLS. Nenhuma credencial privilegiada (`service_role`/`sb_secret_`) entra no repositório
  ou no navegador: ela existe somente dentro da Edge Function.
- **Conferência automatizada:** `tools/smoke-deploy.sh` valida o site publicado a cada deploy —
  página e rotas do SPA, cabeçalhos de segurança, presença das variáveis no bundle, ausência de
  credencial privilegiada e login real pelo Auth.

### 5.5 Revisão de interface e correções — **executado em 14/10/2026**

Revisão completa do front-end a pedido do administrador ("a interface está simples demais e abaixo do padrão
profissional"). O banco, as RPCs, as políticas RLS e as regras de negócio **não foram alterados**.

**Design system novo** (substituindo o visual genérico anterior):

| Antes | Depois |
|---|---|
| Paleta só com um vermelho e cinzas padrão do Tailwind | Escalas `brand` (ação) e `ink` (neutra quente) com tons semânticos para sucesso/atenção/erro |
| Ícones em emoji (🍕💰📊…) | `src/components/icons.tsx`: 50 ícones SVG inline, sem CDN e sem dependência externa |
| Sidebar escura simples, sem hierarquia | Sidebar com grupos (Operação / Gestão / Sistema), cartão do usuário, menu lateral no celular **e** barra inferior de acesso rápido |
| Cards cinza com `shadow-sm` | Superfícies com borda suave, sombra em duas camadas, cantos de 14 px e cabeçalho com ícone |
| Sem estados de carregamento consistentes | Esqueletos com brilho, estados vazios ilustrados por ícone e `Callout` para avisos/erros |
| Modal sem foco gerenciado | Modal com `aria-modal`, armadilha de foco, fechamento por `Esc`/clique fora e animação curta |
| Avisos em texto cru | `ToastProvider` com ícone, título, tempo maior para erro e botão de fechar |

**Bugs reais corrigidos** (todos com causa identificada antes da correção):

1. **Forma de pagamento aparecia como UUID** em três telas (recebimento, conta da mesa e histórico) — agora exibe o
   rótulo real da forma de pagamento.
2. **"Nova mesa" usava `ConfirmDialog` como formulário** (um diálogo de confirmação com campos dentro): virou um
   modal próprio, com número, nome de exibição e lugares.
3. **Fechamento de caixa aceitava campo vazio** e registrava divergência de 100%: agora exige o valor contado,
   mostra sobra/falta em tempo real e só fecha com justificativa quando há divergência.
4. **Cards de delivery travavam todos juntos** (um `busy` global): o estado passou a ser por pedido, então um
   recebimento não bloqueia os outros cartões.
5. **`window.prompt` para motivo de estorno, cancelamento e ajuste de taxa**: substituído por diálogos do sistema
   com campo obrigatório e mínimo de 3 caracteres.
6. **Campos de dinheiro nas configurações saltavam o cursor** (recalculavam a cada tecla): passaram a aceitar texto
   livre e normalizar ao sair do campo.
7. **Tipo de pagamento exibido como código** (`credit_card`): traduzido para o nome que o operador lê.
8. **Endereço de entrega incompleto**: o entregador via só o bairro. A tela do delivery agora carrega o snapshot do
   endereço (rua, número, complemento, referência) gravado no pedido.
9. **`printReceipt` existia e nunca era chamado**: agora imprime comanda de produção, comanda de entrega, recibo do
   cliente e comprovante de fechamento de caixa (via janela do navegador — não é impressora térmica).
10. **Listas e filtros sem feedback**: filtros de período por atalho (hoje/ontem/7/30 dias), busca com ícone,
    ordenação visual e rodapé com totais nos relatórios.
11. **Bundle único de 587 kB**: cada tela virou um chunk carregado sob demanda (o salão abre antes das telas
    administrativas).
12. **Sem indicador de "há quanto tempo" atualizado**: a duração das mesas/pedidos é recalculada a cada 30 s por um
    helper testado (`duracaoDesde`).

**Segunda passada da mesma revisão** (encontrados ao testar o sistema publicado em navegador real):

13. **Recarregar a página travava o sistema** em "Carregando seu acesso…" (nenhuma requisição saía): o callback de
    `onAuthStateChange` aguardava uma consulta ao banco *dentro* da inicialização do Auth, e a consulta depende do
    próprio Auth — impasse que só terminava fechando a aba. O trabalho passou a ser reagendado fora do callback, a
    confirmação da sessão tem prazo máximo de 12 s e a tela bloqueada oferece **Tentar de novo** e
    **Sair e entrar com outra conta** (antes, tela em branco silenciosa).
14. **Gráfico "Evolução das vendas" não desenhava nada** quando havia um único dia (altura em `%` dentro de coluna de
    altura automática): passou a calcular a altura em pixels; com poucos pontos os valores aparecem no topo.
15. **Formas de pagamento apareciam como código** (`credit_card`) também nos cartões de configuração — traduzidas.
16. **Largura de campo ignorada**: a classe `w-full` do campo vencia o `className` da página (fuso horário ocupava
    meia tela e os horários de funcionamento ficavam achatados). O campo virou classe de componente (`.campo`),
    que pode ser sobreposta por utilitário — o mesmo problema poderia atingir qualquer tela.
17. **Tabelas dentro de cartão estreito cortavam a coluna de ações**: `DataTable` ganhou `minW` e `tamanho`
    (linhas compactas), e a coluna virou botão de ícone com título acessível.
18. **Plural "1 pedido(s)"** espalhado pelas telas: helper testado `plural()` usado em 10 telas.
19. **"Administrador · Administrador"** no cabeçalho e no menu → mostra o nome de exibição e o login; o tipo de
    produto no cardápio deixou de ser uma frase longa e virou selo curto.
20. **Tela branca era o único sintoma de erro**: cada rota ganhou uma `ErrorBoundary` que explica o que aconteceu,
    avisa que nada foi perdido (tudo está no banco) e oferece tentar de novo, recarregar ou voltar ao início.

**Blindagem contra "não consigo entrar" (14/10/2026, madrugada):**

22. **Endereço errado**: `https://pizzaria-gestao.vercel.app` (sem o `-v2`) continua no ar, mas é **outro
    sistema** ("Pizzaria — Gestão de Estoque"), sem as contas do cardápio — quem abrir um favorito antigo
    conclui que "o login quebrou". O rodapé da tela de entrada e as configurações agora mostram
    **endereço + carimbo de versão do build**, então dá para saber na hora qual app e qual versão estão abertos.
23. **Sessão velha no aparelho**: entrou a opção "Problemas para entrar? Limpar dados deste aparelho"
    (limpa a sessão salva e recarrega), disponível na tela de entrada e na tela de bloqueio. O botão Sair
    também passou a ter prazo máximo: se o servidor não responder, o aparelho é limpo e o operador volta
    para a entrada — nunca fica preso.
24. **Quem já está conectado não é mais jogado para dentro às cegas**: abrir `/login` com sessão ativa mostra
    *"Você já está conectado como X (função, login)"* com **Continuar** e **Entrar com outra conta** — é o
    caminho explícito para trocar de usuário no mesmo aparelho (balcão, tablet compartilhado).

**Terceira passada — refinamento visual com pesquisa de padrões (15/10/2026):**

Pedido do administrador: *"tá usável mas não tá bonito"*. Foram aplicados os padrões que dashboards de
referência usam hoje, e não efeitos da moda:

| Mudança | Motivo |
|---|---|
| Lateral (menu) em carvão quase preto, item ativo discreto (fundo leve + barra de acento vermelha) em vez de bloco vermelho | Cor de marca como acento; o bloco vermelho competia com os botões de ação da tela |
| Cartões sempre brancos, com borda de 1 px; sombra reduzida a quase nada | Sombra é elevação, não decoração; borda separa melhor em qualquer tela |
| Cartão de mesa sem fundo colorido cheio: fio de 3 px da cor da situação no topo + selo com ponto | O salão fica legível: a cor identifica a situação sem tingir tudo |
| Faixa de indicadores reduzida a **4 números** (Painel, Caixa, Mesas, Relatórios); o resto virou lista de conferência | Números demais na faixa = nenhum número lido |
| Escala de texto curta (6 tamanhos) e espaçamento só em passos de 4 | Consistência é o que faz parecer profissional, mais do que enfeite |
| Raios: 14 px no cartão, 8–10 px no que fica dentro dele | Cantos iguais aninhados parecem descuido |
| Botão principal com brilho interno no topo e "afunda" 1 px ao clicar; foco com anel de 3 px | Retorno tátil sem exagero |
| Fundo do sistema em papel quente com halo suave; conteúdo centralizado (máx. 1440 px) | Menos "tela de administração crua" |
| Animação curta de entrada ao trocar de tela (180 ms) | Dá orientação espacial, sem chamar atenção |
| Avisos e selos: fundos suaves sem anel escuro ao redor | Menos caixas, mais respiro |

Tudo isso saiu de tokens (`tailwind.config.js` + `src/styles.css`) — nenhuma tela recebeu cor fixa. O manual
de estilo está em [`IDENTIDADE.md`](IDENTIDADE.md).

**Como foi conferido (navegador real, contra o site publicado):**

```
npm i --no-save playwright && npx playwright install chromium && npx playwright install-deps chromium
PZ_ADMIN_PASSWORD='…' PZ_CAIXA_PASSWORD='…' PZ_GARCOM_PASSWORD='…' \
  node tools/e2e-telas.mjs https://pizzaria-gestao-v2.vercel.app
```

O robô entra com os três perfis, percorre as telas de cada um, confere que as telas administrativas barram caixa e
garçom, executa o percurso do salão (abrir mesa, montar pedido, conferir a conta — **sem gravar nada no banco**),
verifica erro de console/rede e salva capturas em `artifacts/e2e/`. Resultado: **0 falhas**. As capturas não vão para
o repositório (`artifacts/` está no `.gitignore`).

**Onde mexer depois:** os primitivos ficam em `src/components/ui.tsx`; as cores, sombras e animações em
`tailwind.config.js`; os ícones em `src/components/icons.tsx`. Trocar a identidade visual da pizzaria é editar
esses três arquivos — nenhuma tela tem cor fixa.

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

1. ~~Deploy na Vercel~~ — **feito** (seção 5.4).
2. **Trocar as senhas iniciais** de administrador, caixa e garçom — todas passaram pelo chat e devem ser
   consideradas expostas (use *Funcionários → Redefinir senha*).
3. **Substituir o cardápio de exemplo pelo real:** apague o exemplo
   (`supabase/seed/remove_cardapio_EXEMPLO.sql`) e cadastre seus produtos, preços e bairros.
4. **Preencher a tela Configurações** (nome da casa, telefone, descontos, taxa padrão, horários de
   funcionamento e modo de serviço).
5. Revisar a política de backup do plano contratado.
6. **Rotacionar os tokens** usados nesta sessão (GitHub e Supabase) — eles trafegaram no chat.

## 8. Limitações conhecidas

- Sem teste de fumaça contra o Supabase real nem E2E de navegador (detalhes em `TESTES.md`, seção 5).
- Sem perfil de cozinha, sem impressão térmica, sem estoque avançado, sem emissão fiscal, sem gateway
  de pagamento e sem integrações externas (WhatsApp, aplicativos de entrega) — fora do escopo definido;
  Pix e cartão são registrados manualmente com confirmação do caixa.
- Carga e desempenho não medidos com volume alto de pedidos (o bundle já é dividido por tela).
- A revisão visual foi validada por tipos, build e testes automatizados; a conferência de aparência em cada
  dispositivo (celular/tablet) ainda depende de uso real no salão.
- Impressão de comanda/recibo usa a janela de impressão do navegador (exige permitir pop-up) — não há integração
  com impressora térmica.
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
| Testes | executados, verdes (280 asserções SQL locais + suíte repetida na nuvem + 28 unitários + concorrência real) |
| Build | verde |
| GitHub | **publicado** (`ivandoplay/pizzaria-gestao-v2`, repositório público) |
| Supabase | **configurado e verificado na nuvem** (migrações, RLS, Realtime, Edge Function, 3 perfis, fluxo ponta a ponta) |
| Cardápio | **72 itens de exemplo** aplicados (removíveis em um comando) + 8 bairros com taxa de entrega |
| Deploy Vercel | **pendente** — importar o repositório + 3 variáveis de ambiente |
| Pronto para venda real? | **falta pouco:** deploy na Vercel, troca da senha do admin e cadastro do cardápio real. O banco e as permissões já estão verificados em produção. |
