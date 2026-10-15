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

Esses três últimos passos rodam sozinhos a cada push no `main` (e em cada pull
request): é a esteira **CI** em `.github/workflows/ci.yml` — `npm ci` →
`typecheck` → `test` → `build`. O que depende de segredo ou de serviço de
produção (suíte do banco, robôs de navegador, `smoke-deploy.sh`) continua sendo
rodado à mão, e o cabeçalho do arquivo diz isso com todas as letras.

### 1.1 O que `run-sql-tests.sh` faz

1. `drop database if exists pizzaria_test` + `create database pizzaria_test owner postgres`
   (sempre do zero — rodar sem recriar gera erro de chave duplicada nas fixtures);
2. aplica `tools/local_pg_shim.sql` (emula `auth.uid()`, `auth.role()`, roles
   `anon`/`authenticated`/`service_role`, `supabase_realtime`, extensões);
3. aplica as 9 migrações em ordem;
4. aplica `supabase/seed/seed_structure.sql`;
5. aplica `supabase/tests/00_setup.sql` (infra de teste + fixtures);
6. roda `01`…`06`, depois `08` e, no fim, `07_concurrency.sh` (script bash com conexões paralelas de verdade).

O contador de asserções lê as mensagens `NOTICE: OK` emitidas por `tests.ok/eq_int/eq_text/eq_bool`.

> O shim **não** deve ser aplicado em um projeto Supabase real: ele existe só para reproduzir o
> ambiente localmente.

---

## 2. Suíte do banco (00–08) — resultado: **VERDE**

Execução final: **288 asserções, todas aprovadas**, sem `ERROR` e sem `ASSERT FALHOU`.

| Arquivo | O que testa | Asserções notáveis |
|---|---|---|
| `00_setup.sql` | infra `tests.*`, fixtures determinísticas, view `tests.fx` | grants, `login()`/`logout()`, helpers de asserção |
| `01_auth_permissions.sql` | autenticação, perfis, RLS e privilégios | anônimo bloqueado; garçom não escreve; admin sim; `guard_profiles` (`SELF_ROLE_CHANGE`, `LAST_ADMIN`); escrita direta nas tabelas RPC-only recusada pelo próprio PostgreSQL (`permission denied`) |
| `02_menu.sql` | cardápio e **cálculo de preço** | 2× meio a meio A+B G + catupiry + queijo = **11600**; regra `average` = 4500; reajuste não altera pedido antigo (snapshot); erros `ITEMS_REQUIRED`, `INVALID_QUANTITY`, `PRODUCT_UNAVAILABLE`, `FLAVOR_SIZE_UNAVAILABLE`, `MODIFIER_REQUIRED`, `MODIFIER_LIMIT_EXCEEDED`, `FLAVORS_NOT_ALLOWED` |
| `03_tables_orders.sql` | mesas, sessões, pedidos, estados | abertura idempotente; cancelar 1 item de 3 ajusta subtotal (7400 → 6700); fluxo até entrega gera **6 linhas** de histórico; `table_overview` = soma dos pedidos não cancelados; cancelamento exige motivo; `delivered_to_table` não pode ser cancelado (`INVALID_TRANSITION`) |
| `04_cash_payments.sql` | caixa, pagamentos, contas | pix 3000 em conta de 5300 → saldo 2300; dinheiro 2300 com 5000 entregues → **troco 2700**; gaveta esperada **12300** (fundo 10000 + 2300 líquidos); desconto 10 % = 530; desconto de valor 300; fechamento 5000; sangria 5000; divergência de −1000 exige justificativa; desconto acima de 10 % → `DISCOUNT_LIMIT_EXCEEDED`; teto de 20 % |
| `05_delivery.sql` | clientes, endereços, taxas, fluxo do delivery | taxa por zona 800 → totais 2200 e 6100; bairro sem zona usa taxa padrão 500 → 1200; **dedupe** por telefone ("(86) 98888-7777" ≡ "86 98888.7777"); troco no delivery (2000 para 1200 → 800); `ADDRESS_REQUIRED`, `CUSTOMER_PHONE_INVALID`, `PAYMENT_REFUND_REQUIRED`, `ORDER_CANCELLED`, `BALANCE_PENDING`, `REASON_REQUIRED`, `FORBIDDEN`; taxa ajustada pelo admin (1000 → total 1700); fechamento forçado com motivo; garçom não enxerga delivery |
| `06_reports.sql` | relatórios, painéis e auditoria | cada indicador comparado com **consulta independente às tabelas** (líquido, recebido, pendente, cancelado, ticket médio, salão+delivery, top produtos, formas de pagamento, sessões de caixa, painel operacional); filtros por modalidade/funcionário; busca do histórico por telefone, parcial e nome; 13 eventos de auditoria presentes; auditoria sem senha/token; somente-adição |
| `08_troca_senha.sql` | troca obrigatória de senha (migração `0009`) | visitante sem sessão **não** baixa flag (`permission denied`); o funcionário baixa **a própria** flag; a flag de outro perfil não é tocada; chamar de novo **não** gera evento repetido de auditoria; evento `profile.password_changed` gravado com autor e alvo; funcionário **desativado** recebe `AUTH_REQUIRED` e continua com a flag de pé |
| `07_concurrency.sh` | corrida real entre duas conexões | 2ª abertura na mesma mesa → `TABLE_ALREADY_OPEN` (e nenhuma sessão órfã); mesmo `client_uuid` de pagamento em paralelo → **1 pagamento de 1400, troco 600 uma única vez**; 2º fechamento em paralelo → `SESSION_NOT_OPEN`; conta fechada **e auditada uma vez**; mesa volta a `available`; nenhum atendimento sobrando |

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

## 3. Testes da aplicação — resultado: **48/48**

`npm test` (Vitest, sem ambiente de navegador):

| Arquivo | Testes | Cobre |
|---|---|---|
| `src/lib/pricing.test.ts` | 11 | preço simples, meio a meio (`highest`/`average`), arredondamento, adicionais por unidade, bordas de entrada |
| `src/lib/format.test.ts` | 16 | BRL com NBSP, `parseMoneyToCents` (vírgula/ponto), datas com fuso `America/Fortaleza`, `duracaoDesde` (tempo de mesa/pedido), `plural` (1 pedido / 2 pedidos), `newClientUuid`, CSV |
| `src/lib/errors.test.ts` | 5 | tradução de códigos do banco, códigos desconhecidos, mensagens do Supabase |
| `src/lib/supabase.test.ts` | 3 | importar o módulo não cria cliente (regressão do WebSocket em Node), `CONFIGURACAO_PENDENTE` sem env e fuso padrão |
| `src/lib/senha.test.ts` | 13 | troca de senha: senha atual obrigatória, mínimo de 8 caracteres, senha só de espaços, nova igual à atual, repetição diferente, nível de força (fraca/razoável/forte) e lista de senhas óbvias |

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

| `node tools/auditar-telas.mjs <URL>` | varre **todas as rotas de todos os perfis** no celular (390px) e no computador (1440px): rolagem lateral, alvos de toque abaixo de 44px, erro de console, tela sem título, esqueleto preso, e salva captura de cada tela em `artifacts/auditoria/` | **0 falhas, 0 avisos** (28 leituras de tela: 15 do celular e 13 do computador) |
| `node tools/checar-rolagem.mjs <URL>` | mede `scrollWidth` × `clientWidth` em 390px nas telas do garçom e do caixa (inclusive dentro da conta da mesa): pega a rolagem lateral que faz a tela inteira arrastar no dedo | **0 falhas** (local e site publicado) |
| `bash tools/esperar-deploy.sh <URL> [commit]` | espera o site publicado estar na versão nova (lê o carimbo do rodapé) antes de rodar os testes de ponta a ponta | — depois do push |
| `node tools/teste-troca-senha.mjs <URL>` | prova a **troca obrigatória de senha** de ponta a ponta com um funcionário de teste: cria a conta (senha temporária), confere que a senha temporária **não abre** o sistema (nem digitando `/dashboard` na mão), que senha atual errada / senha curta / repetição diferente / senha igual à anterior são recusadas, conclui a troca, confere que a senha antiga morre e a nova entra, vê o evento na auditoria e **desativa** a conta de teste no fim (nada é apagado). Rode contra a URL **publicada**: a criação de funcionário passa por Edge Function que só aceita a origem do site | **0 falhas** |

Os dois primeiros exigem `npm i --no-save playwright && npx playwright install chromium && npx playwright install-deps chromium`.
As senhas vêm do ambiente (`PZ_ADMIN_PASSWORD`, `PZ_CAIXA_PASSWORD`, `PZ_GARCOM_PASSWORD`) — nunca do arquivo.

## 4. Build e verificação de tipos — resultado: **exit 0**

| Comando | Resultado |
|---|---|
| `npm run typecheck` (`tsc -b`) | exit 0, sem erros (com `noUnusedLocals`) |
| `npx vite build` | exit 0 — `dist/index.html` + CSS (42 kB / 7,9 kB gzip) + **chunk principal** 490 kB (141 kB gzip) + **um chunk por tela** (6–24 kB cada) |

Desde a revisão de 14/10/2026 as telas são carregadas com `React.lazy`: o garçom baixa o mapa de mesas sem
carregar cardápio, relatórios e auditoria. O aviso de chunk acima de 500 kB deixou de aparecer.

---

## 5. Execução contra o Supabase real (14/10/2026)

Além da execução local, a suíte foi rodada **no projeto Supabase de produção** (`sa-east-1`,
PostgreSQL 17.11) usando `tools/supabase-cloud-sql.sh`:

| Etapa | Resultado |
|---|---|
| 8 migrações aplicadas em ordem | sem erro |
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
2. **Robôs de navegador existem, mas não há CI.** As telas são varridas por Playwright
   (`auditar-telas`, `checar-rolagem`, `e2e-telas`, `teste-login`, `teste-troca-senha`) rodando **à mão**
   contra o site publicado — não há pipeline automatizado nem execução agendada.
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
