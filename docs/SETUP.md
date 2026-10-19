# Setup e deploy — Supabase + Vercel + GitHub

Este é o passo a passo para preparar o ambiente (banco → administrador → Edge Function → Vercel).

> **Neste projeto as seções 1 a 5 já foram executadas** — projeto na org *Pizzaria* com as 25 migrações
> aplicadas, administrador criado, Edge Function publicada e Realtime ativo (detalhes em
> [`ENTREGA.md`](ENTREGA.md), seção 5). Este guia serve para conferir o que foi feito, reproduzir em
> outro projeto ou recuperar o ambiente.

Tempo estimado do zero: 20–30 minutos.

---

## 1. Criar o projeto no Supabase

1. Acesse <https://supabase.com> → **New project**.
2. Escolha a organização, um nome (ex.: `pizzaria-producao`) e uma **senha forte para o banco**
   (guarde no seu gerenciador de senhas — ela **não** vai para o repositório).
3. Região: a mais próxima do restaurante (para o Brasil, `South America (São Paulo)`).
4. Aguarde o provisionamento.

Depois, em **Project Settings → API**, anote:

| Item | Onde está | Para que serve |
|---|---|---|
| `Project URL` | Settings → API | `VITE_SUPABASE_URL` |
| `anon public` | Settings → API | `VITE_SUPABASE_ANON_KEY` (pode ficar no navegador) |
| `service_role` | Settings → API | **Só** na Edge Function. **Nunca** no front, nunca no GitHub. |

> `service_role` ignora RLS. Trate como senha mestra.

## 2. Aplicar as migrações

No **SQL Editor** do Supabase, abra e execute um arquivo por vez, **na ordem**:

```
supabase/migrations/20260101000001_foundation.sql
supabase/migrations/20260101000002_menu.sql
supabase/migrations/20260101000003_cash.sql
supabase/migrations/20260101000004_customers.sql
supabase/migrations/20260101000005_operations.sql
supabase/migrations/20260101000006_rls.sql
supabase/migrations/20260101000007_rpc.sql
supabase/migrations/20260101000008_reports.sql
supabase/migrations/20260101000009_troca_senha_obrigatoria.sql
supabase/migrations/20260101000010_fila_pedidos_prontos.sql
supabase/migrations/20260101000011_garcom_recebe_e_fecha.sql
supabase/migrations/20260101000012_fechamento_seguro_e_caixa.sql
supabase/migrations/20260101000013_precos_em_lote.sql
supabase/migrations/20260101000014_ultimo_acesso.sql
supabase/migrations/20260101000015_configs_com_efeito.sql
supabase/migrations/20260101000016_cancelar_item_com_pagamento.sql
supabase/migrations/20260101000017_saldo_de_cancelado.sql
supabase/migrations/20260101000018_realtime_cardapio.sql
supabase/migrations/20260101000019_execute_somente_autenticado.sql
supabase/migrations/20260101000020_senha_obrigatoria_no_servidor.sql
supabase/migrations/20260101000021_desconto_abaixo_do_pago.sql
supabase/migrations/20260101000022_fechar_caixa_idempotente.sql
```

Se preferir a CLI: `supabase link --project-ref SEU_REF` e `supabase db push`.

Em seguida rode o seed **estrutural** (mesas, formas de pagamento, horários):

```
supabase/seed/seed_structure.sql
```

> ⚠️ **Não** rode `supabase/seed/seed_demo_DESENVOLVIMENTO.sql` em produção. Ele cria dados de
> demonstração prefixados com `[DEMO]` e existe apenas para desenvolvimento/apresentação.

### 2.1 Conferência pós-migração

Rode no SQL Editor para confirmar que a segurança entrou:

```sql
-- devem existir 25 tabelas, todas com RLS e force RLS
select count(*) as tabelas,
       count(*) filter (where c.relrowsecurity)      as com_rls,
       count(*) filter (where c.relforcerowsecurity) as com_force_rls
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r';
-- esperado: 25 | 25 | 25

-- devem existir 23 funções (14 operacionais + 8 de relatório + 1 de senha)
select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f';
-- esperado: 22

-- confirma o endurecimento: nas tabelas que só aceitam escrita por RPC,
-- o perfil autenticado deve ter apenas SELECT (nenhum INSERT/UPDATE/DELETE)
select count(*) as privilegios_de_escrita_que_nao_deveriam_existir
from information_schema.table_privileges
where table_schema = 'public' and grantee = 'authenticated'
  and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  and table_name in ('orders', 'order_items', 'order_item_flavors', 'order_item_modifiers',
                     'order_status_history', 'payments', 'table_sessions', 'cash_sessions',
                     'cash_movements', 'audit_logs');
-- esperado: 0
```

## 3. Criar o primeiro administrador

O sistema não tem cadastro público: o primeiro admin é criado por você.

1. **Authentication → Users → Add user → Create new user**.
   - E-mail: `admin@pizzaria.local` (o sufixo `@pizzaria.local` é o padrão interno do sistema:
     o login digitado na tela vira `login@pizzaria.local`).
   - Senha: forte. Marque **Auto Confirm User**.
2. Depois do usuário criado, rode no SQL Editor (troque o nome e a senha **no seu ambiente**):

```sql
insert into public.profiles (auth_user_id, full_name, login, role, is_active)
select id, 'Seu Nome', 'admin', 'admin', true
from auth.users
where email = 'admin@pizzaria.local'
on conflict (auth_user_id) do update
  set role = 'admin', is_active = true, login = 'admin';

select pg_notify('pgrst', 'reload schema');
```

3. Entre no sistema com o login `admin` e a senha definida.

> A partir daí, crie os demais funcionários **pela tela Funcionários** (que usa a Edge Function) —
> não é preciso mexer no painel do Supabase de novo.

### 3.1 Ajustes iniciais recomendados (tela Configurações)

- Nome da pizzaria, telefone, fuso horário (padrão `America/Fortaleza`).
- Regra do meio a meio (`highest` ou `average`).
- Limites de desconto do caixa e teto absoluto.
- Taxa de entrega padrão, bairros com taxa própria, pedido mínimo.
- Ligar/desligar salão e delivery; endereço/logo (se houver).
- Cadastrar o cardápio: categorias → tamanhos → produtos → preços por tamanho → adicionais.

## 4. Publicar a Edge Function

Necessária para criar funcionários e redefinir senha sem expor a `service_role`.

```bash
npm i -g supabase
supabase login
supabase link --project-ref SEU_REF
supabase functions deploy admin-create-employee
```

**Nada de segredo precisa ser cadastrado à mão:** o Supabase injeta automaticamente `SUPABASE_URL`,
`SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` nas funções publicadas — são exatamente os nomes que o
código lê. Cadastre algo manualmente (Project Settings → Edge Functions → Secrets) apenas se a função
passar a precisar de outra variável.

> ⚠️ Nunca coloque a `service_role` em variáveis `VITE_*` nem em arquivo versionado. Ela existe apenas
> dentro da função, no servidor.

Confirme também que a origem da sua aplicação é aceita pelo CORS do projeto (Settings → API).

### 4.1 Alternativa sem a CLI (aplicar migrações e rodar os testes na nuvem)

O repositório inclui `tools/supabase-cloud-sql.sh`, que executa SQL pelo Management API — útil para
aplicar as migrações em ordem e rodar a suíte de testes contra o banco real:

```bash
export SUPABASE_ACCESS_TOKEN=...   # token pessoal: Account → Access Tokens
export SUPABASE_PROJECT_REF=...
bash tools/supabase-cloud-sql.sh supabase/migrations/20260101000001_foundation.sql   # ...e as demais, na ordem
bash tools/supabase-cloud-sql.sh supabase/tests/00_setup.sql                        # ...e 01..06
```

## 5. Ativar o Realtime

Realtime é o que mantém os painéis sincronizados (garçom lança → caixa vê na hora).

No SQL Editor, confira/garanta a publicação (a migração `0006` já faz isso):

```sql
select tablename from pg_publication_tables where pubname = 'supabase_realtime';
```

Devem aparecer, entre outras: `orders`, `order_items`, `order_status_history`, `payments`,
`table_sessions`, `restaurant_tables`, `cash_sessions`, `cash_movements`, `delivery_fee_zones`.

Se faltar alguma:

```sql
alter publication supabase_realtime add table public.orders;   -- repita para as demais
```

⚠️ Realtime **não** é a fonte da verdade: se ele cair, os dados continuam corretos (as telas
atualizam ao navegar/recarregar). Ele é aceleração, não dependência.

## 6. Variáveis de ambiente

### 6.1 Front-end (Vercel e `.env.local`)

| Variável | Exemplo de formato | Segredo? |
|---|---|---|
| `VITE_SUPABASE_URL` | `https://xxxxx.supabase.co` | não |
| `VITE_SUPABASE_ANON_KEY` | `eyJhbGciOi...` (longa) | não (pública; RLS protege) |
| `VITE_TIMEZONE` | `America/Fortaleza` | não (opcional; este é o padrão) |

> **Nunca** coloque `service_role` em variável `VITE_*`: tudo que começa com `VITE_` é embutido no
> JavaScript e fica visível para qualquer visitante.

### 6.2 Edge Function

| Variável | Onde configurar |
|---|---|
| `SUPABASE_URL` | Segredos da Edge Function |
| `SUPABASE_ANON_KEY` | Segredos da Edge Function |
| `SERVICE_ROLE_KEY` | Segredos da Edge Function |

## 7. Deploy na Vercel

1. Suba o repositório para o GitHub (seção 8).
2. <https://vercel.com> → **Add New → Project** → importe o repositório.
3. A Vercel detecta Vite automaticamente. Confirme:
   - Framework: **Vite**
   - Build Command: `npm run build`
   - Output Directory: `dist`
   - Install Command: `npm install`
4. Em **Environment Variables**, cadastre `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` e
   `VITE_TIMEZONE` (esta última opcional) — marque para *Production*, *Preview* e *Development*.
5. **Deploy**. O `vercel.json` já cuida do roteamento SPA (todas as rotas caem em `index.html`) e
   envia cabeçalhos de segurança (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`).
6. Depois do deploy, abra a URL e faça login com o admin criado no passo 3.

### 7.1 Vários ambientes

Recomendado separar:

| Ambiente | Branch | Projeto Supabase | Observação |
|---|---|---|---|
| Produção | `main` | `pizzaria-producao` | dados reais |
| Preview | demais branches | `pizzaria-staging` (opcional) | nunca apontar para produção com dados reais |

Cada ambiente tem seu próprio conjunto de variáveis na Vercel.

## 8. GitHub

```bash
cd pizzaria
git init
git add .
git commit -m "Sistema de gestão para pizzaria: banco, RLS, RPCs, telas e testes"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/pizzaria.git
git push -u origin main
```

Antes de subir, confirme que **nada sensível** entra no commit:

```bash
git status --short
grep -rn "service_role\|eyJhbGciOi" --include="*.ts" --include="*.tsx" --include="*.json" src/ vercel.json
```

- `.gitignore` já exclui `node_modules`, `dist`, `.env`, `.env.local` e derivados.
- O repositório versiona apenas `.env.example` (com marcadores, sem valores reais).
- As migrações vão para o Git — é o histórico do banco.

## 9. Checklist final antes de operar

- [ ] Migrações 0001–0022 aplicadas na ordem.
- [ ] Conferência da seção 2.1 retornou 25/25/25.
- [ ] Seed estrutural aplicado (mesas, formas de pagamento, horários) — **sem** o seed de demonstração.
- [ ] Administrador criado e login funcionando.
- [ ] Tela Configurações revisada (fuso, descontos, taxas, modo de serviço).
- [ ] Cardápio cadastrado com preços por tamanho.
- [ ] Edge Function publicada e com os 3 segredos.
- [ ] Realtime ativo nas tabelas operacionais.
- [ ] Variáveis configuradas na Vercel (sem `service_role` no front).
- [ ] Teste de fumaça: abrir mesa → lançar pedido → fechar conta → conferir caixa → ver relatório.
- [ ] Backup: Supabase → Database → Backups (verifique a política do seu plano).
