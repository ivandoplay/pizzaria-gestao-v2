# Plano de execução — Sistema de Gestão para Pizzaria

Prompt mestre lido em `/home/user/uploads/prompt_completo_sistema_pizzaria.txt` (776 linhas, 19 seções).
Projeto novo → arquitetura definida do zero, compatível com **Vercel + Supabase + GitHub**.

## Ordem de implementação (seção 18 do prompt)

- [x] Análise do prompt e definição das decisões de negócio (`docs/DECISIONS.md`)
- [x] **Etapa 1 — Fundação:** estrutura, migrações SQL (0001), perfis, permissões, políticas RLS (0006),
  autenticação (`AuthContext`), login/setup.
- [x] **Etapa 2 — Cardápio:** categorias, produtos, tamanhos, variações de preço, adicionais (0002),
  tela de administração do cardápio, prévia de preço testada (`src/lib/pricing.ts`).
- [x] **Etapa 3 — Atendimento:** mesas, sessões, pedidos, itens, estados, histórico e sincronização
  em tempo real (0005 + 0007), telas de mesas e da mesa.
- [x] **Etapa 4 — Caixa:** pagamentos, fechamento de contas, parciais, turnos e movimentações
  (0003 + 0007), telas de caixa e de controle de caixa.
- [x] **Etapa 5 — Delivery:** clientes, endereços, taxas por bairro, acompanhamento (0004 + 0007),
  tela de delivery.
- [x] **Etapa 6 — Administração:** dashboard, relatórios (0008), funcionários (Edge Function),
  configurações, auditoria e histórico.
- [x] **Etapa 7 — Qualidade:** suíte SQL real (00–07) no PostgreSQL 17 local, 25 testes Vitest,
  typecheck, build de produção e documentação (README + `docs/`).

## Revisão de interface e correções (14/10/2026) — concluída

Design system próprio (`src/components/ui.tsx`, `src/components/icons.tsx`, tokens em `tailwind.config.js`),
12 correções de bugs reais (forma de pagamento exibida como UUID, diálogo usado como formulário, fechamento de
caixa sem valor contado, `window.prompt` em operações sensíveis, endereço incompleto no delivery, campo de dinheiro
"pulando" o cursor, impressão existente e nunca usada etc.) e bundle dividido por tela. Detalhes na seção 5.5 de
`docs/ENTREGA.md`. **Nenhuma alteração de banco, RPC, RLS ou regra de negócio.**

## Verificações executadas (resultados reais)

| Verificação | Resultado |
|---|---|
| Migrações 0001–0008 em banco limpo | aplicam sem erro |
| `bash tools/run-sql-tests.sh` (00–07) | **280 asserções, 0 falhas** (inclui concorrência real) |
| `npm test` (Vitest) | **35/35** |
| `npm run typecheck` (tsc) | exit 0 |
| `npx vite build` | exit 0 — `dist/` (chunk principal 479 kB / 138 kB gzip + chunk por tela) |
| `npm run dev` | telas servidas (HTTP 200) |

## Decisões de ambiente (sem credenciais externas nesta sessão)

- Não há acesso às contas Supabase/Vercel/GitHub → todo o código, as migrações e a Edge Function ficam
  prontos; o que depende de configuração manual está em `docs/SETUP.md` e em `docs/ENTREGA.md`.
- Validação real do banco: PostgreSQL 17 local com `tools/local_pg_shim.sql`, que emula `auth.uid()`,
  `auth.role()`, as roles `anon/authenticated/service_role` e a publicação `supabase_realtime`.
  **O shim é exclusivo de teste — nunca aplicar num projeto Supabase real.**
- A suíte recria o banco a cada execução (rodar sem recriar gera chave duplicada nas fixtures).

## Documentação entregue

- `README.md` — visão geral, perfis, stack, como rodar, mapa das migrações e testes.
- `docs/ARQUITETURA.md` — modelo de dados, RPCs, regras de preço, estados, segurança, decisões.
- `docs/SETUP.md` — Supabase, migrações, primeiro admin, Edge Function, Realtime, Vercel, GitHub, checklist.
- `docs/TESTES.md` — o que cada suíte prova, resultados reais e limitações.
- `docs/ENTREGA.md` — resumo final: funcionalidades, RLS, env vars, pendências manuais e próximos passos.
- `docs/DECISIONS.md` — registro das decisões e alternativas descartadas.

## Execução real (14/10/2026)

- [x] Repositório publicado: `ivandoplay/pizzaria-gestao-v2` (privado), commit `7791d98`.
- [x] Supabase: backup do schema anterior, 8 migrações aplicadas, seed estrutural, RLS/Realtime conferidos.
- [x] Suíte de testes executada **contra o Supabase real** (00–06 sem falhas) e banco deixado limpo.
- [x] Edge Function `admin-create-employee` publicada e testada (401 sem token, criação/duplicidade/reset).
- [x] Administrador criado e login validado pela API real; anônimo bloqueado (RLS + `AUTH_REQUIRED`).

## Execução real (14/10/2026) — continuação

- [x] Deploy na Vercel publicado (`pizzaria-gestao-v2.vercel.app`) com as variáveis `VITE_*` no
  `vercel.json`; conferência automatizada por `tools/smoke-deploy.sh`.
- [x] Cardápio de exemplo aplicado: 72 itens, 138 preços, 32 adicionais, 8 bairros com taxa
  (`supabase/seed/seed_cardapio_EXEMPLO.sql`, removível por `remove_cardapio_EXEMPLO.sql`).
- [x] Funcionários criados pela Edge Function: um caixa (`manager`) e um garçom (`waiter`), logins testados.
- [x] Fluxo ponta a ponta validado em produção (garçom lança → caixa conduz → garçom entrega → caixa
  recebe e fecha → admin confere), dentro de transação desfeita no fim: **zero resíduo**.

## Pendências (dependem de ação manual — não são código)

1. Trocar as senhas iniciais (admin, caixa, garçom) — passaram pelo chat.
2. Substituir o cardápio de exemplo pelo cardápio real e preencher as Configurações.
3. Rotacionar os tokens usados nesta sessão (GitHub e Supabase).
