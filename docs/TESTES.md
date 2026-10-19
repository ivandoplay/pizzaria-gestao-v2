# Testes — como rodam e o que provam

Todos os números abaixo são de execuções **reais** nesta entrega, em PostgreSQL 17 local com o shim
que emula o ambiente Supabase. Nada aqui é estimativa.

---

## 1. Como rodar

```bash
# ── Banco (recria o banco, aplica migrações + seed + suíte 00..08) ──
bash tools/run-sql-tests.sh

# ── Aplicação ──
npm test          # Vitest
npm run typecheck # tsc -b
npm run build     # build de produção
```

A esteira **CI** (`.github/workflows/ci.yml`) roda dois trabalhos:

1. **aplicação** — a cada push no `main`, pull request e execução manual:
   `npm ci` → `typecheck` → `test` → `build`;
2. **banco** — sobe um **PostgreSQL 17 descartável** no próprio executor e roda
   `tools/run-sql-tests.sh` inteiro: shim, as 20 migrações, seed e a suíte
   `00`…`09` + o teste de concorrência com conexões paralelas de verdade.

Só o que depende de **segredo ou de produção** continua rodando à mão: os robôs de
navegador contra o Supabase real e o `smoke-deploy.sh` — de propósito, para que
um pull request de terceiros não toque em dados de produção.

### 1.1 O que `run-sql-tests.sh` faz

1. `drop database if exists pizzaria_test` + `create database pizzaria_test owner postgres`
   (sempre do zero — rodar sem recriar gera erro de chave duplicada nas fixtures).
   Localmente os comandos usam `sudo -u postgres`; onde houver conexão direta
   (como o serviço PostgreSQL da esteira) basta `PSQL_SUDO=""` com `PGHOST`,
   `PGUSER` e `PGPASSWORD` definidos;
2. aplica `tools/local_pg_shim.sql` (emula `auth.uid()`, `auth.role()`, roles
   `anon`/`authenticated`/`service_role`, `supabase_realtime`, extensões);
3. aplica as 20 migrações em ordem;
4. aplica `supabase/seed/seed_structure.sql`;
5. aplica `supabase/tests/00_setup.sql` (infra de teste + fixtures);
6. roda `01`…`06`, depois `08`, `09`, `10` e `11` e, no fim, `07_concurrency.sh` (script bash com conexões paralelas de verdade).

O contador de asserções lê as mensagens `NOTICE: OK` emitidas por `tests.ok/eq_int/eq_text/eq_bool`.

> O shim **não** deve ser aplicado em um projeto Supabase real: ele existe só para reproduzir o
> ambiente localmente.

---

## 2. Suíte do banco (00–11) — resultado: **VERDE**

Execução final (após a auditoria de 17/10): **426 asserções, todas aprovadas** — 19 arquivos numerados (00–19) mais o teste de concorrência
(`07`) —, sem `ERROR` e sem `ASSERT FALHOU`.

| Arquivo | O que testa | Asserções notáveis |
|---|---|---|
| `00_setup.sql` | infra `tests.*`, fixtures determinísticas, view `tests.fx` | grants, `login()`/`logout()`, helpers de asserção |
| `01_auth_permissions.sql` | autenticação, perfis, RLS e privilégios | anônimo bloqueado; garçom não escreve; admin sim; `guard_profiles` (`SELF_ROLE_CHANGE`, `LAST_ADMIN`); escrita direta nas tabelas RPC-only recusada pelo próprio PostgreSQL (`permission denied`) |
| `02_menu.sql` | cardápio e **cálculo de preço** | 2× meio a meio A+B G + catupiry + queijo = **11600**; regra `average` = 4500; reajuste não altera pedido antigo (snapshot); erros `ITEMS_REQUIRED`, `INVALID_QUANTITY`, `PRODUCT_UNAVAILABLE`, `FLAVOR_SIZE_UNAVAILABLE`, `MODIFIER_REQUIRED`, `MODIFIER_LIMIT_EXCEEDED`, `FLAVORS_NOT_ALLOWED` |
| `03_tables_orders.sql` | mesas, sessões, pedidos, estados | abertura idempotente; cancelar 1 item de 3 ajusta subtotal (7400 → 6700); fluxo até entrega gera **6 linhas** de histórico; `table_overview` = soma dos pedidos não cancelados; cancelamento exige motivo; `delivered_to_table` não pode ser cancelado (`INVALID_TRANSITION`) |
| `04_cash_payments.sql` | caixa, pagamentos, contas — agora **entregando o pedido antes de fechar** (regra da migração `0012`) | pix 3000 em conta de 5300 → saldo 2300; dinheiro 2300 com 5000 entregues → **troco 2700**; gaveta esperada **12300** (fundo 10000 + 2300 líquidos); desconto 10 % = 530; desconto de valor 300; fechamento 5000; sangria 5000; divergência de −1000 exige justificativa; desconto acima de 10 % → `DISCOUNT_LIMIT_EXCEEDED`; teto de 20 % |
| `05_delivery.sql` | clientes, endereços, taxas, fluxo do delivery | taxa por zona 800 → totais 2200 e 6100; bairro sem zona usa taxa padrão 500 → 1200; **dedupe** por telefone ("(86) 98888-7777" ≡ "86 98888.7777"); troco no delivery (2000 para 1200 → 800); `ADDRESS_REQUIRED`, `CUSTOMER_PHONE_INVALID`, `PAYMENT_REFUND_REQUIRED`, `ORDER_CANCELLED`, `BALANCE_PENDING`, `REASON_REQUIRED`, `FORBIDDEN`; taxa ajustada pelo admin (1000 → total 1700); fechamento forçado com motivo; garçom não enxerga delivery |
| `06_reports.sql` | relatórios, painéis e auditoria | cada indicador comparado com **consulta independente às tabelas** (líquido, recebido, pendente, cancelado, ticket médio, salão+delivery, top produtos, formas de pagamento, sessões de caixa, painel operacional); filtros por modalidade/funcionário; busca do histórico por telefone, parcial e nome; 13 eventos de auditoria presentes; auditoria sem senha/token; somente-adição |
| `08_troca_senha.sql` | troca obrigatória de senha (migração `0009`) | visitante sem sessão **não** baixa flag (`permission denied`); o funcionário baixa **a própria** flag; a flag de outro perfil não é tocada; chamar de novo **não** gera evento repetido de auditoria; evento `profile.password_changed` gravado com autor e alvo; funcionário **desativado** recebe `AUTH_REQUIRED` e continua com a flag de pé |
| `09_fila_prontos.sql` | fila de pedidos prontos (migração `0010`) | `ready_at` e `session_status` na view; fila só com pedido pronto de salão; entrega válida; entrega repetida → `NO_STATUS_CHANGE`; não-pronto e delivery → `INVALID_TRANSITION`; garçom **entrega** mas não marca `confirmed`/`preparing` → `FORBIDDEN`; sessão encerrada → `SESSION_NOT_OPEN`; conta fechada → `ORDER_ACCOUNT_CLOSED`; histórico registra de/para/quem/quando |
| `10_garcom_recebe_e_fecha.sql` | dinheiro: garçom vê/recebe/fecha (migração `0011`) | garçom **recebe** (dinheiro com troco) e o valor entra no turno em curso; **fecha** a conta quitada e libera a mesa; auditoria registra `payment.register`/`table_account.close` com `actor_role='waiter'`; limites do garçom: fechar com saldo pendente → `FORBIDDEN`, estorno → `FORBIDDEN`, desconto → `FORBIDDEN`, abrir/fechar caixa → `FORBIDDEN`; caixa continua recebendo e fechando (regressão coberta); fechar com pedido em produção → `ORDERS_IN_PROGRESS` |
| `07_concurrency.sh` | corrida real entre duas conexões | 2ª abertura na mesma mesa → `TABLE_ALREADY_OPEN` (e nenhuma sessão órfã); mesmo `client_uuid` de pagamento em paralelo → **1 pagamento de 1400, troco 600 uma única vez**; **pedido entregue antes do fechamento**, então 2º fechamento em paralelo → `SESSION_NOT_OPEN`; conta fechada **e auditada uma vez**; mesa volta a `available`; nenhum atendimento sobrando |
| `11_fechamento_seguro.sql` | fechamento seguro e caixa vivo (migração `0012`) | fechar com pedido em `received`/`confirmed`/`preparing`/`ready`/`out_for_delivery` → **`ORDERS_IN_PROGRESS`** e a mesa **continua aberta**; depois de entregar, o fechamento normal passa; fechamento excepcional com justificativa curta → `REASON_REQUIRED`, e sem ser administrador → `FORBIDDEN`; com justificativa, os pendentes são **cancelados com histórico e auditoria `on_session_close`** e `orders_cancelled_on_close` volta no retorno; pendente **com dinheiro recebido** → `PAYMENT_REFUND_REQUIRED`; `cash_session_is_open()` responde para admin/gerente/garçom |
| `12_precos_em_lote.sql` | preços do cardápio em lote (migração `0013`, achado A3) | preço em branco **não** vira zero; tamanho escondido continua escondido; preço zero, tamanho inexistente e lote com item inválido são recusados; **tudo ou nada** no lote; caixa/garçom/anon não alteram preço |
| `13_ultimo_acesso.sql` | último acesso por perfil (migração `0014`, achado A5) | caixa e garçom registram o próprio `last_login_at`; o acesso de um não mexe no perfil do administrador; UPDATE direto em `profiles` continua bloqueado; anon não executa |
| `14_configs_com_efeito.sql` | configurações com efeito (migração `0015`, achado A6) | delivery abaixo do mínimo → `DELIVERY_MINIMUM_NOT_MET` e **nenhum pedido gravado**; taxa de entrega não conta para o mínimo; mínimo 0 desliga; com `split_payment_enabled = false`, segunda **forma** → `SPLIT_PAYMENT_DISABLED`, mas parcelas na **mesma** forma passam; religado, duas formas somam |
| `15_cancelar_item_com_pagamento.sql` | cancelamento parcial com dinheiro (migração `0016`, achado A8) | cancelar item que deixaria o total abaixo do recebido → `PAYMENT_REFUND_REQUIRED` (sem erro cru de constraint) e item intacto; cancelar 1 de 2 unidades permitido, total recalculado e valor recebido preservado |
| `16_saldo_de_cancelado.sql` | cancelado não tem saldo (migração `0017`, achado A9) | `order_overview.balance_cents = 0` para cancelado; total/recebido continuam visíveis; a soma “a receber” cai exatamente o valor do pedido cancelado |
| `17_realtime_cardapio.sql` | realtime do cardápio (migração `0018`, achado A18) | tabelas de cardápio/configuração publicadas; `orders` continua publicada (sem regressão) |
| `18_execute_somente_autenticado.sql` | EXECUTE de RPC (migração `0019`, achado A15) | **nenhuma** função pública executável por `anon`; `authenticated` continua podendo `create_order`/`register_payment`; chamada anônima real → `permission denied` |
| `19_senha_obrigatoria.sql` | senha temporária no servidor (migração `0020`, achado A16) | RPC recusada com `PASSWORD_CHANGE_REQUIRED`; `complete_password_change()` continua sendo o caminho de saída; operação volta depois da troca; admin sem flag não é afetado |

### 2.1 Detalhes de método

- **Asserção de escrita bloqueada:** RLS silenciosa (0 linhas afetadas) usa `assert_blocked_write`;
  erro real (`permission denied`) usa `expect_denied`. Confundir os dois produz falso verde — foi o
  que aconteceu ao endurecer os privilégios: as asserções de `audit_logs` viraram `expect_denied`,
  porque a recusa passou a vir do GRANT, antes da RLS.
- **Asserções de auditoria** rodam como admin (`login('ana.admin')`) — a trilha não é legível pelos demais.
- **Garçom não avança status**: as transições de estado são verificadas como caixa/admin
  (o garçom só faz `ready → delivered_to_table`).
- **Valores da mesa** são comparados de forma **dinâmica** (soma dos pedidos válidos da sessão aberta),
  nunca com constante — as suítes rodam em sequência no mesmo banco.

---

## 3. Testes da aplicação — resultado: **70/70**

`npm test` (Vitest, sem ambiente de navegador):

| Arquivo | Testes | Cobre |
|---|---|---|
| `src/lib/pricing.test.ts` | 11 | preço simples, meio a meio (`highest`/`average`), arredondamento, adicionais por unidade, bordas de entrada |
| `src/lib/format.test.ts` | 16 | BRL com NBSP, `parseMoneyToCents` (vírgula/ponto), datas com fuso `America/Fortaleza`, `duracaoDesde` (tempo de mesa/pedido), `plural` (1 pedido / 2 pedidos), `newClientUuid`, CSV |
| `src/lib/errors.test.ts` | 5 | tradução de códigos do banco, códigos desconhecidos, mensagens do Supabase |
| `src/lib/supabase.test.ts` | 3 | importar o módulo não cria cliente (regressão do WebSocket em Node), `CONFIGURACAO_PENDENTE` sem env e fuso padrão |
| `src/lib/senha.test.ts` | 13 | troca de senha: senha atual obrigatória, mínimo de 8 caracteres, senha só de espaços, nova igual à atual, repetição diferente, nível de força (fraca/razoável/forte) e lista de senhas óbvias |
| `src/lib/focoDeModal.test.ts` | 14 | foco e teclado dos modais (regressão da correção de 16/10/2026): pilha de modais (só o **topo** responde a teclado, fechar o de cima devolve o teclado para o de baixo, fechar fora de ordem não deixa fantasma), foco inicial (só quando o modal é o do topo **e** ninguém já está digitando dentro dele), devolução do foco (só quando ele ficou solto ou preso num campo que saiu da tela — nunca roubando o foco de outro modal) e **2 testes que leem `src/components/ui.tsx` como texto** e travam o defeito: o efeito de abertura do `Modal` não pode listar `onClose` nas dependências e tem de ler o `onClose` mais recente por `ref` |
| `src/lib/fila.test.ts` | 8 | fila de prontos: só entra pedido `ready` de salão com conta aberta; nada de delivery, cancelado ou já entregue; ordem pelo `ready_at` (e não pelo horário do pedido), sem depender da ordem que o banco devolveu; pedido sem horário confiável vai para o fim sem sumir; detalhes do item (tamanho, sabores, adicionais, observação) sem repetir sabor único nem inventar detalhe de item simples |

`pricing.ts` merece destaque: é a **prévia** do navegador espelhando o cálculo do banco. Se ela divergir,
o valor mostrado é substituído pelo oficial — mas manter os dois alinhados evita confusão no balcão, e
os testes travam esse alinhamento.

## 3.1 Fluxos de entrada conferidos no navegador (14/10/2026)

| Fluxo | Resultado |
|---|---|
| Entrar do zero com os três perfis no site publicado | **ok** (admin → `/dashboard`, caixa → `/caixa`, garçom → `/mesas`) |
| Recarregar a página com sessão salva | **ok** (antes travava em "Carregando seu acesso…") |
| Abrir `/login` já conectado | mostra *"Você já está conectado"* com **Continuar** e **Entrar com outra conta** |
| Trocar de conta no mesmo aparelho | **ok** (limpa a sessão e volta ao formulário) |
| "Limpar dados deste aparelho" | **ok** (limpa a sessão local e recarrega) |
| Rodapé com endereço + versão do build | **ok** (serve para identificar app/versão errados) |

## 3.2 Robôs de interface (Playwright)

| Ferramenta | O que faz | Resultado |
|---|---|---|
| `node tools/e2e-telas.mjs <URL>` | entra com os 3 perfis, percorre as telas de cada um, confere os bloqueios de permissão, executa o percurso do salão (abrir mesa, montar pedido, conferir conta — **sem gravar nada**), confere que `Enter` confirma o cadastro e **não** confirma ação destrutiva, detecta erro de console/rede e salva capturas em `artifacts/e2e/`. `PERFIL=admin` roda só um perfil | **0 falhas** (local e site publicado) |
| `node tools/teste-login.mjs <URL>` | entrar com cada perfil, recarregar com sessão salva, abrir `/login` conectado, trocar de conta, **sessão velha/corrompida no navegador** (o caso que trava o operador) e login pelo celular | **0 falhas** |

| `PZ_ADMIN_PASSWORD=… node tools/e2e-digitar.mjs <URL>` | **digitação com foco** (regressão de 16/10/2026, o defeito que trocava o texto de campo): reproduz **o cenário do relato passo a passo** (digitar “João” no nome, clicar no Número, digitar “9” e depois “8” — o foco e o texto não podem voltar para o nome), depois digita **tecla por tecla** “João”/“987654” em cada campo do pedido de delivery (nome, telefone, rua, número, complemento, bairro, referência, observações), alterna vários campos em sequência, confere o mapa de valores do formulário, prende o **Tab/Shift+Tab** (91 controles), abre um modal dentro do modal (busca de sabor) e fecha/abre 3×; no controle de caixa digita decimal (“1234,56”) e prova que `Enter` não dispara ação destrutiva; em Funcionários testa campo com `autoFocus` e **Escape**. Falha se algum caractere cair em outro campo ou sumir | **0 falhas, 0 avisos** (16/10/2026, `localhost`, antes: 16 falhas e 2 avisos) |
| `node tools/auditar-telas.mjs <URL>` | varre **todas as rotas de todos os perfis** no celular (390px) e no computador (1440px) — inclusive `/pedidos-prontos`: rolagem lateral, alvos de toque abaixo de 44px, erro de console, tela sem título, esqueleto preso, e salva captura de cada tela em `artifacts/auditoria/`. Se a conta cair na tela de troca obrigatória, **falha com o motivo** em vez de medir a tela errada | **0 falhas, 0 avisos** |
| `node tools/preparar-contas-robo.mjs <URL> "login=Senha"` | deixa uma conta de apoio pronta pelo caminho do sistema: cria pela tela de funcionários (se não existir), reativa, gera senha temporária pelo botão “Senha”, confirma que a troca obrigatória aparece e conclui a troca, provando no fim que a senha definitiva entra direto. Nenhuma senha fica no repositório | **0 falhas** (`robo.caixa`, `robo.garcom`) |
| `node tools/e2e-fila.mjs <URL>` | ciclo da **fila de prontos**: o garçom abre a mesa e lança um pedido com observação, o caixa avança Confirmado → Em preparação → Pronto, o garçom confere o cartão na fila e confirma a entrega; o robô verifica que o cartão sai da lista **pelo servidor** e que o pedido não volta para a fila | **0 falhas** (local: mesa 12 / pedido #39; publicado: mesa 11 / pedido #41) |
| `node tools/limpar-contas-teste.mjs <URL>` | fecha as contas que os robôs deixam abertas, **pelo caminho do sistema**: o caixa conduz os pendentes até "Pronto", o garçom entrega pela fila, registra os recebimentos que faltam e fecha. Sem `PZ_FECHAR=sim` só **lista** o que encontrou (simulação) — nada é apagado | usado para limpar a base depois das rodadas: **6 contas fechadas**, base sem mesa aberta |
| `node tools/checar-rolagem.mjs <URL>` | mede `scrollWidth` × `clientWidth` em 390px nas telas do garçom e do caixa (inclusive dentro da conta da mesa): pega a rolagem lateral que faz a tela inteira arrastar no dedo | **0 falhas** (local e site publicado) |
| `bash tools/esperar-deploy.sh <URL> [commit]` | espera o site publicado estar na versão nova (lê o carimbo do rodapé) antes de rodar os testes de ponta a ponta | — depois do push |
| `node tools/teste-troca-senha.mjs <URL>` | prova a **troca obrigatória de senha** de ponta a ponta com um funcionário de teste: cria a conta (senha temporária), confere que a senha temporária **não abre** o sistema (nem digitando `/dashboard` na mão), que senha atual errada / senha curta / repetição diferente / senha igual à anterior são recusadas, conclui a troca, confere que a senha antiga morre e a nova entra, vê o evento na auditoria e **desativa** a conta de teste no fim (nada é apagado). Rode contra a URL **publicada**: a criação de funcionário passa por Edge Function que só aceita a origem do site | **0 falhas** |

Os dois primeiros exigem `npm i --no-save playwright && npx playwright install chromium && npx playwright install-deps chromium`.
As senhas vêm do ambiente (`PZ_ADMIN_PASSWORD`, `PZ_CAIXA_PASSWORD`, `PZ_GARCOM_PASSWORD`) — nunca do arquivo.

## 4. Build e verificação de tipos — resultado: **exit 0**

| Comando | Resultado |
|---|---|
| `npm run typecheck` (`tsc -b`) | exit 0, sem erros (com `noUnusedLocals`) |
| `npx vite build` | exit 0 — `dist/index.html` + CSS (50 kB / 8,1 kB gzip) + **chunk principal** 493 kB (142 kB gzip) + **um chunk por tela** (12–27 kB cada) |

Desde a revisão de 14/10/2026 as telas são carregadas com `React.lazy`: o garçom baixa o mapa de mesas sem
carregar cardápio, relatórios e auditoria. O aviso de chunk acima de 500 kB deixou de aparecer.

---

## 5. Execução contra o Supabase real (14/10/2026)

Além da execução local, a suíte foi rodada **no projeto Supabase de produção** (`sa-east-1`,
PostgreSQL 17.11) usando `tools/supabase-cloud-sql.sh`:

| Etapa | Resultado |
|---|---|
| 8 migrações aplicadas em ordem (a rodada de 16/10 aplicou a `0012` na nuvem) | sem erro |
| `tests/00_setup.sql` (infra + fixtures no `auth.users` real) | OK |
| `tests/01…06` | **nenhuma falha** — cada arquivo aborta na primeira asserção falha, então "sem erro" = todas passaram |
| Efeitos conferidos no banco depois da suíte | 12 pedidos, 13 itens, 23 linhas de histórico, 5 recebimentos, 3 movimentos de caixa, 3 clientes, 215 eventos de auditoria |
| Limpeza após os testes | schema recriado pelas migrações + seed; usuários de teste removidos do Auth; banco final com 0 pedidos e apenas o admin |

O que **não** roda na nuvem por limitação da API de consulta: o teste de concorrência
(`07_concurrency.sh`), que precisa de duas conexões simultâneas — esse roda localmente (`tools/run-sql-tests.sh`).

Teste de fumaça após a configuração, direto contra a API do Supabase:

| Verificação | Resultado |
|---|---|
| Login `admin` via `/auth/v1/token` | token emitido |
| Leitura de `profiles` via PostgREST com token | retorna o perfil (RLS aplicada) |
| RPC `get_operational_summary` com token | dados reais (fuso, mesas livres, caixa) |
| Mesma tabela/RPC **sem** token | `[]` e erro `42501 AUTH_REQUIRED` |
| Edge Function sem token | HTTP 401 |
| Edge Function criando funcionário / logando com ele / redefinindo senha | tudo OK |

## 6. Conferência do site publicado

`bash tools/smoke-deploy.sh https://pizzaria-gestao-v2.vercel.app [login senha]` roda contra o deploy
e verifica: página inicial, as 5 rotas principais do SPA (rewrite), cabeçalhos de segurança, presença
das variáveis `VITE_*` no bundle, ausência de credencial privilegiada e — se você passar login e senha —
um **login real** pelo Auth do Supabase. Rode isso depois de cada alteração para não descobrir problema
no meio do movimento.

## 7. O que **não** foi testado (limitações honestas)

1. ~~Nada contra o Supabase real~~ — **resolvido**: a suíte rodou no projeto de produção e o teste de
   fumaça (login, RLS, RPC, anônimo bloqueado, Edge Function) foi executado na nuvem (seção 5).
   Continua não testado: RLS de `storage` (o sistema ainda não usa Storage) e o Realtime em uso real
   por dois navegadores ao mesmo tempo.
2. **Os robôs de navegador rodam à mão; a suíte de banco está na esteira.** As telas são varridas por
   Playwright (`auditar-telas`, `checar-rolagem`, `e2e-telas`, `teste-login`, `teste-troca-senha`,
   `e2e-fila`, `e2e-digitar`) rodando **à mão** contra o site publicado, com as senhas no ambiente — não há execução
   agendada. **Desde 16/10/2026 a suíte de banco (00–11 + concorrência) roda sozinha na esteira**, em
   um PostgreSQL 17 descartável (trabalho `banco` do `CI`), junto com tipos, testes unitários e build.
3. **Edge Function deployada, mas fora da suíte de banco** — `admin-create-employee` roda no projeto
   real (cria funcionário e recusa login duplicado) e é exercitada pelo robô `teste-troca-senha.mjs`;
   ela não entra na suíte SQL porque depende de `service_role`. Dois detalhes de ambiente: rodando o
   site em `localhost` a criação de funcionário é barrada por **CORS** (a função só aceita a origem
   publicada), então esse robô roda contra a URL publicada; e foi exatamente esse robô que expôs, em
   15/10/2026, a criação de funcionário **quebrada no site publicado** — um cabeçalho próprio do cliente
   (`x-application-name`) era recusado no *preflight* da função. Corrigido removendo o cabeçalho (ver
   `DECISIONS.md` §1.7). Testes de função por `curl` não passam por CORS e por isso não pegaram.
4. **Realtime não exercitado em nuvem** — a lógica de invalidação é local; o socket real só existe
   depois do Supabase configurado.
5. **Carga/desempenho não medidos** — sem teste de stress com muitos pedidos simultâneos.
6. **Concorrência testada nos 3 pontos críticos** (abertura, pagamento repetido, fechamento) — não em
   todos os pares possíveis de operação simultânea.

Nada nessas limitações impede operar — mas as cinco primeiras exigem o teste de fumaça no ambiente real
descrito no checklist antes de considerar o sistema em produção.
