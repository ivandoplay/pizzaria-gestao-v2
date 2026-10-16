# Registro de decisões

Toda decisão que muda comportamento (e que alguém vai querer revisitar depois) fica registrada aqui.
Formato: **decisão — motivo — como mudar, se for o caso**.

---

## 1. Acesso e credenciais

### 1.1 Escrita operacional apenas por RPC
**Decisão:** pedidos, pagamentos, caixa, contas e delivery são escritos exclusivamente por funções RPC
(`security definer`, perfil validado no banco).
**Motivo:** regra única, impossível de contornar pelo navegador; um `UPDATE` direto no `orders` poderia
mudar total ou status sem passar por validação.
**Exceções conscientes:** admin mantém escrita direta no cardápio/configurações (operações de cadastro,
sem cálculo financeiro) — sempre auditadas por trigger.

### 1.2 Login sem e-mail
**Decisão:** o operador digita `ana`, `carlos`… e o front converte para `ana@pizzaria.local`
(Supabase Auth exige e-mail).
**Motivo:** operação de balcão — ninguém quer digitar e-mail em tablet.
**Como mudar:** trocar a constante de domínio em `src/context/AuthContext.tsx` e cadastrar os usuários
com o e-mail real; o banco guarda os dois campos (`profiles.login` para exibição, `auth.users.email`
para autenticação).

### 1.3 Defesa em profundidade nos privilégios
**Decisão:** nas tabelas em que toda a escrita passa por RPC, o GRANT de INSERT/UPDATE/DELETE é
revogado de `authenticated` (além de não existir política de escrita).
**Motivo:** RLS sozinha depende de nunca existir uma política permissiva criada por engano. Revogando
o privilégio, o PostgreSQL nega a operação antes de avaliar a RLS — duas camadas independentes.
**Como verificar:** consulta em `docs/SETUP.md`, seção 2.1 (deve retornar 0 privilégios de escrita).
**Atenção:** as RPCs continuam funcionando porque são `security definer` (executam como o dono).

### 1.4 `service_role` só na Edge Function
**Decisão:** a chave administrativa vive apenas em `supabase/functions/admin-create-employee`, lida de
variável de ambiente do Supabase.
**Motivo:** criar usuário exige privilégio que não pode existir no navegador. O front usa só a `anon`.

### 1.5 Perfis desta versão
**Decisão:** `admin`, `manager` (caixa) e `waiter` (garçom). Perfil de cozinha **não** existe nesta versão.
**Motivo:** escopo definido pelo prompt. A cozinha acompanha pelo status do pedido nas telas do salão/caixa.
**Como mudar:** se um dia entrar cozinha, o caminho é um perfil `kitchen` com política de leitura em
`orders` e permissão apenas para `advance_order_status` entre `confirmed → preparing → ready`.

---

### 1.6 Troca obrigatória de senha no primeiro acesso

**O problema:** a coluna `profiles.must_change_password` existia, era marcada ao criar funcionário e
aparecia como aviso na tela de equipe — mas **nada obrigava** a troca. O operador seguia trabalhando com
a senha temporária que o administrador conhecia, e a policy `profiles_update_admin` só permitia ao próprio
administrador limpar a flag (ninguém mais conseguia baixá-la).

**A decisão:** a flag é do banco, mas a **imposição** é do app, em três partes:

1. `public.complete_password_change()` (migração `0009`) — `security definer`, **sem parâmetros**, só
   mexe no perfil da sessão, idempotente e auditada (`profile.password_changed`). Sem parâmetros porque
   assim não existe como apontar para outro perfil.
2. `TrocarSenhaPage` + portão `TrocaObrigatoria` no `App.tsx` — com a flag marcada, o layout inteiro
   (menu, rotas, atalhos) não é montado: só existe a tela de troca. Bloquear só a rota inicial deixaria
   o operador entrar digitando `/dashboard` na barra de endereços.
3. O fluxo exige a **senha atual** antes de gravar a nova: se alguém só achasse o aparelho aberto, não
   conseguiria trocar a senha sem saber a antiga. A senha nova vai direto para o Auth do Supabase
   (`updateUser`); ela nunca passa pelo banco.

**Ordem importa:** primeiro o Auth grava a senha, depois o banco baixa a flag. Se a segunda parte falhar,
o sistema continua pedindo a troca — melhor pedir de novo do que liberar o acesso com a senha antiga.

**Verificação:** `supabase/tests/08_troca_senha.sql` (banco, inclui o caso do funcionário desativado, que
recebe `AUTH_REQUIRED` em vez de se liberar) e `tools/teste-troca-senha.mjs` (navegador, de ponta a ponta).

### 1.7 Nenhum cabeçalho próprio no cliente Supabase

**O problema (achado só em navegador real):** o cliente Supabase era criado com
`global.headers = { 'x-application-name': 'pizzaria-gestao' }`. Esse cabeçalho ia junto em **toda**
requisição, inclusive na chamada da Edge Function `admin-create-employee`. A função responde ao CORS com
uma lista fechada de cabeçalhos (`authorization, x-client-info, apikey, content-type`), então o
*preflight* recusava o cabeçalho extra e o navegador bloqueava a chamada: **criar funcionário e redefinir
senha falhavam em produção**, com um erro de rede que parece "Edge Function fora do ar".

Por que não apareceu antes: testes de função por linha de comando (curl) **não passam por CORS** — só o
navegador passa. Foi um robô de navegador contra o site publicado que expôs a falha.

**A decisão:** o cabeçalho foi removido (ele não tinha função além de rótulo). A alternativa — abrir o
cabeçalho na lista da função — deixaria a armadilha de pé para as próximas funções, porque o cabeçalho
global vale para todas as chamadas.

**Lição registrada:** qualquer cabeçalho customizado no cliente Supabase precisa entrar também na lista
de CORS de cada Edge Function. O caminho barato é não ter cabeçalho customizado.

## 2. Dinheiro

### 2.1 Tudo em centavos inteiros
**Decisão:** colunas monetárias são `integer` em centavos; nunca `float`/`real`.
**Motivo:** `0.1 + 0.2 ≠ 0.3` em ponto flutuante; centavo perdido em caixa é divergência real de gaveta.
**Conversão:** `parseMoneyToCents`/`formatMoney` (`src/lib/format.ts`), com NBSP no padrão BRL.

### 2.2 Preço calculado no servidor, sempre
**Decisão:** `create_order` relê o cardápio e calcula; a tela apenas pré-visualiza.
**Motivo:** celular com cardápio velho em cache não pode gerar cobrança errada.
**Consequência:** item e sabor guardam snapshot (nome e preço) — reajuste não reescreve o passado.

### 2.3 Regra do meio a meio configurável
**Decisão:** `business_settings.half_and_half_price_rule` = `highest` (padrão) ou `average`.
**Motivo:** é decisão comercial da casa; o sistema não deve impor.

### 2.4 Troco não é receita
**Decisão:** dinheiro guarda `tendered_cents` e `change_cents`; a gaveta recebe o valor **líquido**.
**Motivo:** somar o valor entregue pelo cliente inflaria a receita e a contagem da gaveta.
**Testado:** relatório por forma de pagamento separa recebido de troco.

### 2.5 Descontos com dois limites
**Decisão:** `max_discount_pct_without_auth` (o caixa pode aplicar até aqui sozinho) e
`max_discount_pct_hard` (teto absoluto, recusado até para admin).
**Motivo:** flexibilidade comercial sem porta aberta para desvio.
**Sempre:** justificativa obrigatória e registro na auditoria.

### 2.6 Pagamentos nunca são apagados
**Decisão:** estorno marca `status='reversed'` + motivo + autor; o registro original permanece.
**Motivo:** quem estornou, quando e por quê é informação de controle.

### 2.7 Cancelar pedido pago exige estorno antes
**Decisão:** `PAYMENT_REFUND_REQUIRED` bloqueia o cancelamento enquanto houver valor recebido.
**Motivo:** força a sequência correta (devolver → cancelar), em vez de deixar dinheiro "sumido".

### 2.8 Fechamento forçado só pelo admin
**Decisão:** `close_table_account`/`close_delivery_account` aceitam `force` apenas para admin, com motivo.
**Motivo:** mesa que "ficou aberta" no fim do turno é cenário real; a saída existe, mas é rastreável.

---

## 3. Consistência e concorrência

### 3.1 `client_uuid` em toda criação
**Decisão:** pedidos, pagamentos, sessões, turnos e movimentos recebem UUID gerado no cliente.
**Motivo:** clique duplo, retry de rede e tablet com toque repetido são rotina — o segundo envio
precisa ser reconhecido, não duplicado.
**Provado:** `supabase/tests/07_concurrency.sh` com duas conexões simultâneas.

### 3.2 Índices únicos parciais
**Decisão:** uma sessão aberta por mesa e um turno de caixa aberto por vez (índices únicos parciais).
**Motivo:** a corrida mais perigosa é a abertura duplicada; o banco resolve, não a aplicação.

### 3.3 Pedido cancelado preserva o valor
**Decisão:** cancelamento marca status e motivo, mantém `total_cents`; as **views** é que ignoram
cancelados nos totais.
**Motivo:** auditoria; esconder o valor apagaria o rastro de uma operação que existiu.

### 3.4 Entidades financeiras separadas
**Decisão:** atendimento (`table_sessions`), pedido (`orders`), conta (fechamento) e pagamento
(`payments`) são coisas distintas que se referenciam.
**Motivo:** exigência de consistência — uma mesa pode ter 4 pedidos, 2 pagamentos parciais e um
fechamento. Fundir tudo em "venda" impede relatório e devolução parciais.

---

## 4. Dados e histórico

### 4.1 Nada com histórico é excluído
**Decisão:** desativar (`is_active=false`); exclusão física só para o que nunca foi usado.
**Motivo:** um produto desativado que aparece em pedidos antigos precisa continuar legível.

### 4.2 Cliente deduplicado por telefone
**Decisão:** `customers.phone_digits` (só dígitos) é a chave de busca; o telefone original é preservado
como o cliente informou.
**Motivo:** delivery por telefone — "(86) 98888-7777" e "86 98888.7777" são a mesma pessoa.

### 4.3 Endereço copiado para o pedido
**Decisão:** o pedido guarda snapshot de rua/número/bairro.
**Motivo:** o cliente muda de endereço; o pedido antigo precisa mostrar para onde foi entregue.

### 4.4 Auditoria append-only
**Decisão:** `audit_logs` só recebe inserção — nem admin altera ou apaga (testado).
**Motivo:** trilha de auditoria que pode ser editada não é trilha de auditoria.

---

## 5. Interface e infraestrutura

### 5.1 Sem tela decorativa
**Decisão:** todo botão executa uma operação real; estados de vazio/carregando/erro tratados.
**Motivo:** pedido do prompt: sistema operacional, não protótipo.

### 5.2 Navegação por perfil, permissão no banco
**Decisão:** o menu esconde o que não é da função, mas a autoridade é do banco.
**Motivo:** menu é usabilidade; RLS e `require_role` são segurança.

### 5.3 Realtime como aceleração, não como verdade
**Decisão:** canal `painel-sync` invalida consultas com debounce de 350 ms.
**Motivo:** pico de mudanças não pode virar enxurrada de requisições; se o socket cair, navegar/recarregar
resolve.

### 5.4 Testes de banco em PostgreSQL local com shim
**Decisão:** `tools/local_pg_shim.sql` emula `auth.uid()`, `auth.role()`, roles do Supabase e a
publicação de Realtime para rodar a suíte sem depender de conta em nuvem.
**Motivo:** permitir 311 asserções reais de RLS/RPC/concorrência nesta entrega.
**Atenção:** o shim é **exclusivo de teste** — nunca aplicar num projeto Supabase real.

### 5.5 Sem integrações inventadas
**Decisão:** nada de WhatsApp API, Pix automático, adquirente, impressora térmica ou integração com
plataformas de entrega.
**Motivo:** o prompt proíbe inventar integração. Pix e cartão são registrados manualmente com
confirmação consciente do caixa, e o delivery é lançado na mão.

### 5.6 Fuso horário do negócio
**Decisão:** banco guarda UTC; exibição e agrupamentos usam `business_settings.timezone`
(padrão `America/Fortaleza`).
**Motivo:** relatório fechado à meia-noite não pode cortar o dia no fuso errado.

## 6. Duas experiências na mesma base: computador para o caixa, celular para o garçom

**Contexto real da pizzaria:** o caixa trabalha sentado, com teclado e mouse, e vive dentro de
listas e de contas para receber. O garçom trabalha em pé, com o celular na mão, andando entre as
mesas. Otimizar os dois com a mesma tela obriga os dois a perder tempo.

### 6.1 Computador: menu enxuto + teclado (desktop de verdade)

**Decisão:** acrescentar uma camada de produtividade para quem opera no computador, sem tirar nada
de quem não usa:
* **paleta de comandos** (`Ctrl+K`, feita no projeto, sem biblioteca nova) que busca telas e ações
  do perfil logado, com navegação por setas, `Enter` para abrir e `Esc` para fechar;
* **painel de atalhos** aberto por `?` e pela própria paleta;
* gatilho visível no cabeçalho ("Buscar ou ir para… Ctrl K") — atalho escondido ninguém usa;
* `/` pula direto para o campo de busca da tela aberta (histórico, auditoria, cardápio…);
* **tabelas mais densas** a partir de 1024px (mesma informação, menos rolagem de mouse);
* **Enter confirma** a ação principal de qualquer janela: em toda janela do sistema, `Enter` num
  campo de texto aciona o botão principal do rodapé (cadastro de produto, funcionário, abertura de
  caixa, novo delivery, recebimento). Nunca dispara de dentro de área de texto (onde Enter quebra
  linha) e **nunca** quando o botão principal é destrutivo — fechar conta, cancelar pedido,
  desativar funcionário e estornar ficam de fora, de propósito.

**Guardas:** os atalhos são ignorados quando há campo de texto focado ou qualquer janela aberta —
nunca trocam o contexto de quem está no meio de um atendimento.

**Motivo:** a paleta complementa o menu lateral (que continua lá, para quem não usa teclado) e é o
padrão que os operadores de PDV já conhecem.

### 6.2 Celular: toque, polegar e um toque por item

**Decisão:**
* item de **tamanho único e sem escolha obrigatória entra na lista com um toque** (selo `+` no
  cartão e confirmação curta na tela); pizza, tamanhos e adicionais continuam abrindo a montagem;
* alvos de toque maiores no celular: botões `44px` de altura no telefone e `40px` a partir de
  `sm`, `IconButton` e seletor de quantidade idem (áreas menores só no computador);
* categorias em pílulas mais altas; cartões de produto com altura mínima de 88px;
* barra de envio permanece fixa na parte de baixo, acima da barra de navegação (zona do polegar);
* **corrigida a rolagem lateral** da conta da mesa: em 390px de tela a página media 862px de
  largura e a tela inteira arrastava para o lado (ver `tools/checar-rolagem.mjs`).

**Motivo:** no salão cheio o gargalo é o número de toques e a chance de errar o alvo. Nada de
função depender de `hover` (que não existe no dedo).

### 6.3 Base de referência (pesquisa, 15/10/2026)

Padrões usados como referência: guias de UI para restaurante e de alvo de toque (≥48px com 8px de
folga, zona do polegar no terço inferior, `@media (any-pointer: coarse)`), guias de navegação
inferior (3–5 itens, ícone + rótulo), paleta de comandos (ARIA combobox, `>` para comandos, `?`
para ajuda — mesmo desenho do GitHub) e um POS de restaurante em React usado como referência de
atalhos de teclado protegidos contra campos de texto e janelas abertas. Nenhuma dependência nova
foi adicionada por causa disso.

## 7. Fila de pedidos prontos (16/10/2026)

### 7.1 A fila é uma leitura, não um subsistema
**Decisão:** a tela `/pedidos-prontos` não tem tabela, status, autenticação nem canal de Realtime
próprios. Ela lê `order_overview` (`status = ready`, `service_mode = dine_in`, conta aberta) e entrega
pela RPC `advance_order_status(id, 'delivered_to_table')` — a mesma usada em todo o sistema.
**Motivo:** dois fluxos paralelos para o mesmo pedido criam divergência; o banco continua sendo a única
fonte de verdade e o histórico/auditoria seguem intactos.

### 7.2 Espera medida por `ready_at`, nunca por `created_at`
**Decisão:** `orders.ready_at` (gravado pelo banco desde a `0005`) passa a ser exposto na view e é o
único critério de ordenação e de tempo de espera. Pedido sem esse horário confiável mostra
"Horário indisponível" e vai para o fim da fila.
**Motivo:** o tempo desde a criação não é tempo de espera na mesa; usar `created_at` como se fosse
seria inventar um número operacional. O tempo é calculado por **diferença entre instantes**, o que não
depende do fuso do aparelho.

### 7.3 Conta e sessão conferidas dentro da transação, com a ordem de locks do fechamento
**Decisão:** em `advance_order_status`, no caminho `delivered_to_table`, o banco confere se o atendimento
da mesa continua `open` e se a conta não foi fechada (`SESSION_NOT_OPEN` / `ORDER_ACCOUNT_CLOSED`). A
sessão é lida **sem lock** só para decidir o caminho e é travada (`for update`) **antes** do pedido —
a mesma ordem de `close_table_account` (sessão → pedidos), o que evita impasse.
**Motivo:** a tela pode estar alguns segundos atrasada; quem decide continua sendo o PostgreSQL. A
validação também roda no caminho raro em que o pedido ainda não estava pronto na primeira leitura, para
que nenhuma entrega passe sem a sessão conferida — nesse caso a ordem dos locks se inverte e um impasse
eventual é resolvido abortando uma das transações, com erro claro para o operador.
**Efeito colateral testado:** a recusa de um pedido de delivery continua sendo `INVALID_TRANSITION`, não
`SESSION_NOT_OPEN` (a suíte `09` trava isso).

### 7.4 Sem contador de prontos na navegação
**Decisão:** o item “Prontos” do menu não mostra número de pendentes. A contagem aparece na própria tela
(“N pedidos prontos · mais antigo há X”).
**Motivo:** um contador no menu obrigaria **toda** navegação do garçom a carregar a fila de pedidos junto
— uma consulta a mais em cada tela, no celular, só para desenhar um número. A fila já se atualiza por
Realtime e por releitura de minuto em minuto, então quem precisa do número abre a tela e o vê no topo.

### 7.5 A tela de troca obrigatória mantém a URL
**Decisão:** quando a conta está com troca de senha pendente, o sistema mostra **apenas** a tela de troca
no lugar do conteúdo — sem navegar para outra rota. Quem for automatizar telas deve olhar o **conteúdo**
da página, não o endereço.
**Motivo:** o guard não pode depender de rota digitada à mão (`/dashboard` também cai na troca, e isso é
proposital). Em 16/10/2026 isso enganou um robô de auditoria: ele "passou" por todas as telas medindo a
mesma tela de troca. Hoje `auditar-telas.mjs`, `checar-rolagem.mjs` e `e2e-telas.mjs` falham de propósito quando detectam
a tela de troca (este último passou a ter a guarda em 16/10/2026).

### 7.6 A suíte de banco entrou na esteira (e o runner ganhou `PSQL_SUDO`)
**Decisão:** o `CI` passou a ter um segundo trabalho, `banco`, que sobe um **PostgreSQL 17 descartável**
no executor e roda `tools/run-sql-tests.sh` inteiro — shim, 10 migrações, seed, suíte `00`…`09` e o
teste de concorrência. Para isso o runner deixou de chamar `sudo -u postgres` fixo e passou a usar
`SUDO_PG="${PSQL_SUDO-sudo -u postgres}"`: sem variável nada muda no desenvolvimento local; na esteira
`PSQL_SUDO=""` faz a conexão direta (usuário e senha do serviço).
**Motivo:** a suíte de banco é onde moram as regras de negócio (preço, concorrência, permissão, RLS).
Ela era o único pedaço grande do sistema que só rodava à mão — um `push` podia publicar migração
quebrada com a esteira verde. Banco **descartável** e **sem segredo de produção**: o trabalho roda
igual para qualquer pull request, sem tocar no Supabase real.
**O que continua fora:** robôs de navegador e `smoke-deploy.sh`, por dependerem do site e das contas de
produção.

## 8. Senhas simplificadas na fase de teste (16/10/2026)

**Decisão:** durante a fase de demonstração, as senhas das contas `admin`, `caixa` e `garcom` foram
trocadas para **o próprio login** e a marcação de troca obrigatória (`profiles.must_change_password`)
foi baixada nas três — a pedido explícito do administrador, para entrar e sair rápido enquanto ele
confere as telas. A reversão está prevista para quando o sistema sair da fase de teste.

**Como foi feito:** o hash da senha é gravado no `auth.users` com o mesmo algoritmo que o Supabase usa
(bcrypt, `extensions.crypt(…, extensions.gen_salt('bf'))`) e a flag de troca é baixada em `profiles`.
Nenhuma tabela, política ou regra de negócio mudou; nenhum segredo privilegiado entrou no repositório.

**Risco aceito, conscientemente:** o sistema está publicado em endereço público e as senhas são
trivialmente adivinháveis. Enquanto os dados forem de demonstração o risco é baixo; **antes de cadastrar
cardápio/preços reais é obrigatório redefinir as três senhas** (a pendência continua registrada em
`ENTREGA.md`, seção 7). O fluxo de troca de senha no primeiro acesso segue intacto: contas novas criadas
pelo sistema continuam nascendo com `must_change_password = true`.

**Evidência:** login real conferido nos três perfis contra o site publicado (`e2e-telas.mjs`, 0 falhas e
0 avisos, com a guarda que falha se a tela de troca obrigatória aparecer).

## 9. Marca própria e tela de entrada redesenhada (16/10/2026)

**Decisão:** o sistema ganhou uma **marca desenhada em vetor** (fatia de pizza dentro de um anel) e a
tela de entrada foi reconstruída em torno dela. A marca aparece em três pontos: entrada (placa grande),
lateral do sistema (placa de 36 px) e ícone da aba do navegador. Nenhuma tela interna foi redesenhada —
o padrão visual aprovado continua o mesmo.

**Como a marca foi escolhida:** o administrador pediu "uma logo mais bonita". Foram geradas duas opções
de emblema, ele escolheu uma, e o desenho escolhido foi **redesenhado à mão em SVG** (não é a imagem
gerada colada no sistema) para virar código: nítido em qualquer tamanho, ~1 kB, sem requisição de rede.
As formas foram simplificadas em relação à referência — o desenho precisa sobreviver a 16 px no favicon.

**Motivo de mexer só na entrada:** é a primeira impressão e não tem concorrência de conteúdo. Cartões,
tabelas e botões das telas de trabalho seguem intocados, porque ali o critério é legibilidade no meio do
turno, não vitrine. A textura de grão é SVG em data-URI (sem CDN) e a tela mantém a regra de sempre:
nada de rolagem lateral no celular.

**Ícone da aba:** o mesmo emblema em `data:image/svg+xml` no `index.html` — sem arquivo em `public/`,
sem rota nova, sem cache antigo de favicon para limpar.

## 10. Quem vê dinheiro (16/10/2026 — **corrigido no mesmo dia**)

### 10.1 Primeira versão (substituída)

O pedido original foi: *"os garçons e o caixa não precisa saber quanto é que eu vou receber total… quanto
que tem aberto em todas as mesas; apenas o administrador precisa."* Isso foi lido como "garçom não vê
dinheiro nenhum": o valor de cada conta ficou com **administrador e caixa**, e o garçom via só contagem de
itens e produção. Foi para o ar em `a12c637` — e ficou **só na interface** (nenhuma política do banco mudou).

### 10.2 A correção do administrador (regra vigente)

Pouco depois, o próprio administrador corrigiu: *"eu quero que o garçom veja o valor total de cada conta e
que ele consiga receber o valor também e fechar a conta."* Regra vigente, em **três níveis**:

| Informação | Quem vê |
|---|---|
| **Soma de todas as contas** ("Consumido no salão", "A receber") — informação de gestão | **só administrador** |
| **Valor de cada conta** (cartão da mesa, falta receber, Total/Recebido/Falta receber na tela da mesa) | administrador, caixa e **garçom** |
| **Receber** o pagamento da mesa (o valor entra no caixa do turno aberto) | administrador, caixa e **garçom** |
| **Fechar** a conta **quitada** e liberar a mesa | administrador, caixa e **garçom** |
| **Fechar com saldo pendente** (excepcional, com justificativa) | **só administrador** |
| **Estorno** de recebimento e **desconto** no pedido | administrador e caixa |

### 10.3 Agora é regra no banco, não ocultação de tela

A v1 era exibição: qualquer chamada direta à API devolveria o número que a RLS já liberava. A v2 resolve na
origem — migração **`20260101000011_garcom_recebe_e_fecha.sql`** recria `register_payment` e
`close_table_account` com o papel `waiter` autorizado (mesmas validações, mesmos cálculos, só a linha do
`require_role` mudou; **nenhuma política de RLS e nenhum GRANT foi tocado**). A suíte de banco ganhou o
arquivo **`supabase/tests/10_garcom_recebe_e_fecha.sql`** (26 asserções): garçom recebe, entra no turno em
curso e fecha a conta quitada; continua **barrado** em fechar com saldo, estornar, descontar, abrir/fechar
caixa e ver o agregado do salão.

### 10.4 O que a interface precisou mudar junto

* `PaymentPanel`: o botão "Registrar" era bloqueado quando a tela não via um caixa aberto
  (`caixaFechado`). O garçom **não lê** `cash_sessions` (é leitura de caixa/administrador), então ficaria
  travado para sempre. Agora esse bloqueio vale só para quem lê a gaveta; para os demais a janela explica
  que o valor entra no turno aberto e **quem decide é o banco** (que responde `CASH_SESSION_REQUIRED` com
  mensagem clara se ninguém abriu o caixa).
* `TableSessionPage`: "Receber" e "Fechar conta" deixam de exigir caixa/administrador; o fechamento com
  saldo pendente continua com o administrador (botão e justificativa).
* `TablesPage`: o valor de cada conta volta ao cartão e à janela de detalhes para todos; o agregado do
  salão continua escondido para caixa e garçom (essa é a única parte escondida — e é de gestão).

**Limite honesto (o que ainda não é verdade):** a lista de **comprovantes** de cada pedido vem da tabela
`payments`, cuja leitura é de caixa/administrador (`is_manager()`). O garçom registra o recebimento e vê
total/recebido/falta somados (vêm das views de conta), mas **não abre a lista de comprovantes** — para isso
seria preciso mudar política de `payments`, o que não foi pedido nem autorizado. Se for desejado, é uma
migração pequena e separada.
