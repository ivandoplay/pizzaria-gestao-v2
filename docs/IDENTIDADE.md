# Identidade visual — como mudar o visual do sistema

Documento prático: **onde** mexer para trocar cores, cantos, sombras, tipografia e
movimento. Nenhuma tela tem cor fixa — tudo vem dos tokens abaixo.

---

## 1. Onde vivem as decisões

| O que você quer mudar | Arquivo | O que editar |
|---|---|---|
| Cores da marca, neutros, cor do papel | `tailwind.config.js` | `colors.brand`, `colors.ink`, `colors.papel`, `colors.superficie` |
| Arredondamento dos cantos | `tailwind.config.js` | `borderRadius.card` (cartão), `.control` (campo/botão), `.interno` |
| Sombras | `tailwind.config.js` | `boxShadow.card`, `.raised`, `.float`, `.focus`, `.brilho` |
| Tamanhos de texto | `tailwind.config.js` | `fontSize.micro/pequeno/base/titulo/numero/display` |
| Velocidade das animações | `tailwind.config.js` | `animation`, `keyframes`, `transitionTimingFunction.smooth` |
| Fonte | `tailwind.config.js` | `fontFamily.sans` |
| Aparência da lateral (menu) | `src/styles.css` | classe `.lateral` |
| Fundo das telas | `src/styles.css` | classe `.papel-da-tela` |
| Campos de formulário | `src/styles.css` | classe `.campo` |
| Botão principal | `src/styles.css` | classe `.botao-primario` |
| Desenhos dos ícones | `src/components/icons.tsx` | um traço SVG por nome (`NomeIcone`) |
| Peças reutilizadas (cartão, selo, tabela, modal…) | `src/components/ui.tsx` | cada componente em um só lugar |
| **Marca da casa (emblema)** | `src/components/Logo.tsx` | as formas SVG do emblema (`Emblema`) e a placa clara (`EmblemaEmPlaca`) |
| Ícone da aba do navegador | `index.html` | `link rel="icon"` com o mesmo emblema em data-URI |

---

## 1.1 A marca da casa

O emblema é uma **fatia de pizza dentro de um anel**, desenhada em vetor (`src/components/Logo.tsx`),
e aparece em três lugares: a tela de entrada (placa grande), a lateral do sistema (placa de 36 px) e o
ícone da aba do navegador (mesmo desenho em mini escala).

Decisões por trás dele:

1. **Vetor, nunca imagem.** Um PNG de marca teria de ser baixado em cada abertura do sistema — e o
   celular do garçom não pode esperar download para mostrar a tela de entrada. Em SVG o emblema é
   desenhado na hora e continua nítido do ícone de 16 px ao painel de 140 px.
2. **Cores da identidade, nenhuma nova.** Massa no vermelho `brand` (`#c43a20`), borda assada no
   `brand-800`, anel no `brand-700`, mussarela no tom do papel (`#fdf7f0`) e um único verde de manjericão
   (`#4a7f42`) como acento. Quem trocar a paleta em `tailwind.config.js` deve revisar esses hexadecimais
   dentro do `Logo.tsx` — é o único arquivo de marca com cor fixa, de propósito: a marca não deve mudar
   de cor sozinha quando alguém ajustar um token de interface.
3. **Formas chapadas, traço grosso, sem sombra nem degradê.** O emblema precisa funcionar bordado no
   avental, impresso no cardápio e reduzido no favicon — efeito de luz não sobrevive a nenhum dos três.
4. **Sobre fundo escuro, sempre na placa clara** (`EmblemaEmPlaca`): o anel vermelho sumiria no painel
   vermelho da entrada e no carvão da lateral.

### Tela de entrada

A tela de entrada é a única tela com tratamento de vitrine — é a primeira impressão do cliente e do
funcionário. Estrutura: painel de marca (luz, textura de grão e a lista do que o sistema faz) à esquerda
no computador; no celular o mesmo painel vira uma **faixa fina no topo** com o cartão de acesso subindo
por cima dela. As telas internas seguem exatamente o que já foi aprovado (cartões brancos de borda fina,
lateral quase preta, raios 14/10/8) — bonito não pode competir com legibilidade no meio do turno.

---

## 2. Princípios que o sistema segue (e por quê)

1. **Cor é acento, não decoração.** O vermelho (`brand`) aparece em ação, foco e
   seleção. O resto é neutro quente (`ink`), que cansa menos e deixa o número
   importante saltar. *Exceção permitida:* a faixa fina no alto do cartão de mesa e
   o ponto dos selos de situação — o garçom identifica a mesa ocupada à distância.
2. **Sombra é elevação.** Cartões usam borda de 1 px + sombra quase invisível; sombra
   forte fica reservada para o que flutua (modal, aviso).
3. **Raio externo ≠ raio interno.** Cartão 14 px, elemento dentro do cartão 8–10 px.
   Cantos iguais aninhados parecem erro de desenho.
4. **Escala curta de texto.** Seis tamanhos (`micro` 11, `pequeno` 13, `base` 15,
   `titulo` 21, `numero` 28, `display` 34). Variedade vem de peso, cor e espaço.
5. **Faixa de indicadores com 4 números.** O dono lê quatro números de longe; o resto
   vira lista de conferência dentro de um cartão.
6. **Espaço em passos de 4.** 12/16/20/24 px. Nunca um valor "solto" no meio da tela.
7. **Menos bordas, mais contraste.** Divisórias de 1 px entre linhas, não caixas
   dentro de caixas.
8. **Movimento curto e com propósito.** 150–220 ms, sempre respeitando
   `prefers-reduced-motion` (quem pediu menos movimento no sistema recebe menos).

Referências usadas na revisão de 15/10/2026 (padrões de 2026 do mercado):
levantamento de dashboards (Linear/Stripe/Vercel/Grafana), regras de tipografia de
interface e a lista de "pequenos ajustes que fazem um produto parecer premium"
(espaçamento, menos tamanhos de fonte, menos bordas, raio consistente).

---

## 3. Receita: mudar a cor da pizzaria

Exemplo — trocar o vermelho por verde-oliva mantendo todo o resto:

```js
// tailwind.config.js
brand: {
  50: '#f6f8f2', 100: '#e9efdf', 200: '#d3dfc0', 300: '#b3c795',
  400: '#8fac6c', 500: '#6f8f4d', 600: '#577238', 700: '#455a2d',
  800: '#394927', 900: '#313f24', 950: '#182110',
}
```

Nada mais precisa mudar: botões, foco, seleção, selos e gráficos passam a usar o novo
tom automaticamente.

## 4. Receita: deixar os cantos mais retos ou mais arredondados

```js
borderRadius: { card: '10px', control: '8px', interno: '6px' }  // mais sério
borderRadius: { card: '18px', control: '12px', interno: '10px' } // mais amigável
```

## 5. Receita: fonte própria (ex.: Inter)

```js
fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] }
```

Baixe a fonte para `public/fonts/` e declare `@font-face` em `src/styles.css` — assim o
sistema continua funcionando **sem internet** (requisito do balcão). Fonte hospedada em
CDN externo não é usada de propósito.

## 6. Por dispositivo: computador do caixa × celular do garçom

A mesma identidade, dois ajustes de **área de toque e densidade** (decisão completa em
`docs/DECISIONS.md` §6):

| Item | Computador | Celular |
|---|---|---|
| Altura de botão (`Button`, `md`) | 40px | 44px |
| Botão pequeno e botão de ícone (`sm`) | 32px | 44px |
| Seletor de quantidade | 36px por botão | 44px por botão |
| Filtros/abas (`SegmentedControl`) | 32px, uma linha | 44px, **quebra linha** em vez de cortar a última opção |
| Pílulas de categoria do pedido | 34px | 44px |
| Caixa de seleção (rótulo clicável) | altura do texto | 44px |
| Linhas de tabela (`DataTable`) | 10px de respiro vertical | 14px |
| Cartão de produto no pedido | 2–3 colunas | 2 colunas, mínimo 88px de altura |
| Item de tamanho único e sem escolha | clique abre a montagem | **um toque** adiciona (selo `+`) |
| Aviso com botão (`Callout` + ação) | botão à direita | botão **embaixo**, largura cheia |

Regras que valem nos dois: nada de função dependente de `hover`; ação destrutiva nunca colada no
polegar; a barra de envio do pedido fica fixa acima da barra de navegação; e a tela **não pode**
ter rolagem lateral nem alvo de dedo abaixo de 44px no celular — as duas coisas são medidas, tela
por tela, por `tools/checar-rolagem.mjs` e `tools/auditar-telas.mjs`.

## 7. Tela "Mesas" — leitura de salão em um relance (16/10/2026)

Redesenho feito **primeiro no papel**, depois no código (recaptura em `artifacts/mesas-novas/`,
comparação em `mesas-antes-e-depois.png`):

* **Grade de 2 colunas no celular** (antes, uma coluna por cartão): a rolagem para ver as 12 mesas caiu
  de 2.269 px para 1.462 px — o salão inteiro se lê quase sem rolar.
* **Faixa de situação** de 3 px na borda esquerda do cartão (livre, ocupada, conta pedida, produção
  travada) em vez de moldura colorida: a cor fica no canto que o olho varre primeiro, sem pintar o cartão
  inteiro e sem depender só dela (o texto continua dizendo "LIVRE"/"OCUPADA").
* **Faixa de resumo** no topo: no celular é uma grade 2×2 compacta; no computador, quatro quadros
  (`StatTile`). Os dois mostram os mesmos números — a diferença é só tamanho.
* **Um toque para agir:** o cartão da mesa ocupada tem um atalho no rodapé — "Conta e receber"
  (administrador/caixa) ou "Abrir atendimento" (mesa livre). Ninguém precisa abrir a mesa para descobrir
  que é ali que se continua o atendimento.

## 8. Tela "Mesa aberta" (conta da mesa) — 16/10/2026

Fila depois de "Mesas". A regra de dinheiro já estava certa; o **arranjo** é que não se sustentava. Duas
quebras encontradas com captura real (comparação em `mesa-aberta-antes-e-depois.png`):

1. **No computador, o cardápio ficava ilegível.** O compositor de pedido (`OrderComposer`) foi feito para
   viver numa faixa larga (~900 px) e entrava aqui numa coluna de ~620 px. A grade tentava três colunas de
   ~70 px e o nome do produto quebrava letra por letra ("Á-g-u-a"). A correção **não** foi espremer mais:
   `OrderComposer` ganhou a opção `empilhado` — catálogo em cima, lista do pedido embaixo, na largura toda.
   É a mesma tela do celular, que já era empilhada por natureza; mudou só a forma de arranjar.
2. **No celular, a conta ficava abaixo da dobra.** Quatro cartões grandes de resumo ocupavam a primeira
   tela inteira. Agora é uma **faixa compacta 2×2** (`grid-cols-2`, visível só no celular) e os quatro
   quadros grandes aparecem apenas a partir de `lg`. Os detalhes que não cabem na faixa (pedidos, itens,
   troco e o aviso de saldo) viram uma linha de texto logo abaixo dela. Rolagem: 7.608 px → 7.365 px.

Dois ajustes que apareceram no caminho e valem como regra geral:

* **Barra fixa é para a ação, não para o texto.** A barra de envio do pedido tinha duas linhas de texto e
  a nota de idempotência; no celular ela ficava parada na frente do cardápio e o garçom não enxergava os
  produtos enquanto escolhia. Agora ela é **fina** (total + botão na mesma linha) e só aparece quando há
  item na lista — no computador continua sempre visível. A nota de idempotência mudou para dentro da
  "Lista do pedido", onde vale nos dois tamanhos.
* **Contador no cabeçalho não pode cair sozinho.** No `Card` do sistema, o bloco do título passou a ocupar
  o espaço que sobra (`flex-1`) e as ações não quebram linha: o número de pedidos fica na mesma linha do
  título em vez de aparecer sozinho embaixo dele no celular.

O cartão de cada pedido ganhou a **faixa de 3 px na cor da situação** — a mesma linguagem de "Mesas" — no
lugar das bolinhas do selo. Nada foi escondido: os mesmos quatro números, os mesmos botões e as mesmas
travas (inclusive o aviso de que o fechamento é recusado com pedido em andamento).

## 9. Checklist antes de publicar uma mudança visual

```bash
npm run typecheck      # tipos
npm test               # regras de preço/formatação
npx vite build         # build de produção
bash tools/run-sql-tests.sh                      # (só se mexer em banco)
node tools/e2e-telas.mjs  http://localhost:4173  # telas, permissões e capturas
node tools/teste-login.mjs http://localhost:4173 # entrar, recarregar, trocar de conta
PZ_GARCOM_PASSWORD=... node tools/e2e-garcom-recebe.mjs http://localhost:4173 # garçom vê/recebe/fecha
```

O robô de telas salva capturas em `artifacts/e2e/` — é a forma mais rápida de conferir
se algo saiu do lugar em todas as telas de uma vez.
