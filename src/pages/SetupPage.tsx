/**
 * Tela exibida quando as variáveis de ambiente do Supabase ainda não foram
 * configuradas. Ela NÃO simula o sistema: apenas explica exatamente o que falta
 * para conectar o painel ao banco real (evita "telas bonitas sem lógica").
 */
export default function SetupPage() {
  return (
    <div className="min-h-screen bg-slate-900 p-4 text-slate-200">
      <div className="mx-auto max-w-2xl space-y-4 py-10">
        <header className="text-center">
          <div className="text-4xl" aria-hidden>
            🍕
          </div>
          <h1 className="mt-2 text-xl font-semibold text-white">Gestão da Pizzaria — configuração pendente</h1>
          <p className="mt-1 text-sm text-slate-400">
            O painel está pronto, mas ainda não está conectado ao banco de dados.
          </p>
        </header>

        <section className="rounded-lg bg-slate-800 p-5 text-sm leading-relaxed">
          <h2 className="mb-2 font-semibold text-white">1. Configure as variáveis públicas do Supabase</h2>
          <p className="text-slate-300">
            Crie o arquivo <code className="rounded bg-slate-900 px-1">.env.local</code> na raiz do projeto (e as
            mesmas variáveis na Vercel) com:
          </p>
          <pre className="mt-2 overflow-x-auto rounded bg-slate-950 p-3 text-xs text-emerald-300">{`VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=sua-chave-anon-publica
VITE_TIMEZONE=America/Fortaleza`}</pre>
          <p className="mt-2 text-xs text-amber-300">
            A chave <strong>service_role</strong> NUNCA vai no frontend — ela é usada apenas pela Edge Function
            <code className="mx-1 rounded bg-slate-900 px-1">admin-create-employee</code>.
          </p>
        </section>

        <section className="rounded-lg bg-slate-800 p-5 text-sm leading-relaxed">
          <h2 className="mb-2 font-semibold text-white">2. Aplique as migrações no Supabase</h2>
          <p className="text-slate-300">
            Os arquivos em <code className="rounded bg-slate-900 px-1">supabase/migrations/</code> criam tabelas,
            políticas RLS, relatórios e as funções de negócio. Depois aplique também o seed estrutural.
          </p>
          <pre className="mt-2 overflow-x-auto rounded bg-slate-950 p-3 text-xs text-emerald-300">{`supabase link --project-ref SEU_REF
supabase db push
psql "$DATABASE_URL" -f supabase/seed/seed_structure.sql`}</pre>
        </section>

        <section className="rounded-lg bg-slate-800 p-5 text-sm leading-relaxed">
          <h2 className="mb-2 font-semibold text-white">3. Crie o primeiro administrador</h2>
          <p className="text-slate-300">
            Crie o usuário no painel do Supabase (Authentication → Users) e depois execute o SQL de ativação
            descrito em <code className="rounded bg-slate-900 px-1">docs/SETUP.md</code>. Novos funcionários são
            criados pelo próprio painel, em <strong>Funcionários</strong>, que chama a Edge Function.
          </p>
        </section>

        <p className="text-center text-xs text-slate-500">
          O passo a passo completo está em <strong>docs/SETUP.md</strong> e <strong>README.md</strong> do projeto.
        </p>
      </div>
    </div>
  )
}
