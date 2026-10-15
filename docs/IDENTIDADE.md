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

## 7. Checklist antes de publicar uma mudança visual

```bash
npm run typecheck      # tipos
npm test               # regras de preço/formatação
npx vite build         # build de produção
bash tools/run-sql-tests.sh                      # (só se mexer em banco)
node tools/e2e-telas.mjs  http://localhost:4173  # telas, permissões e capturas
node tools/teste-login.mjs http://localhost:4173 # entrar, recarregar, trocar de conta
```

O robô de telas salva capturas em `artifacts/e2e/` — é a forma mais rápida de conferir
se algo saiu do lugar em todas as telas de uma vez.
