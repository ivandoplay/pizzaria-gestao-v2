/**
 * Tela exibida quando as variáveis de ambiente do Supabase ainda não foram
 * configuradas. Ela NÃO simula o sistema: apenas explica exatamente o que falta
 * para conectar o painel ao banco real (evita "telas bonitas sem lógica").
 */
import { Icon } from '../components/icons'

const PASSOS = [
  {
    numero: '1',
    icone: 'config' as const,
    titulo: 'Configure as variáveis públicas do Supabase',
    texto:
      'Crie o arquivo .env.local na raiz do projeto (e cadastre as mesmas variáveis na Vercel) com os valores abaixo.',
    codigo: `VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=sua-chave-anon-publica
VITE_TIMEZONE=America/Fortaleza`,
    aviso:
      'A chave service_role NUNCA vai no frontend — ela é usada apenas pela Edge Function admin-create-employee.',
  },
  {
    numero: '2',
    icone: 'cofre' as const,
    titulo: 'Aplique as migrações no Supabase',
    texto:
      'Os arquivos em supabase/migrations/ criam tabelas, políticas RLS, relatórios e as funções de negócio. Depois aplique o seed estrutural.',
    codigo: `supabase link --project-ref SEU_REF
supabase db push
psql "$DATABASE_URL" -f supabase/seed/seed_structure.sql`,
  },
  {
    numero: '3',
    icone: 'equipe' as const,
    titulo: 'Crie o primeiro administrador',
    texto:
      'Crie o usuário no painel do Supabase (Authentication → Users) e execute o SQL de ativação descrito em docs/SETUP.md. Os demais funcionários são criados pelo próprio painel, em Funcionários.',
    codigo: null,
  },
]

export default function SetupPage() {
  return (
    <div className="min-h-screen bg-ink-950 px-4 py-10 text-ink-300">
      <div className="mx-auto max-w-3xl">
        <header className="text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-raised">
            <Icon nome="pizza" className="h-7 w-7" />
          </span>
          <h1 className="mt-4 text-xl font-semibold tracking-tight text-white sm:text-2xl">
            Gestão da Pizzaria — configuração pendente
          </h1>
          <p className="mx-auto mt-2 max-w-xl text-sm text-ink-400">
            A interface está pronta, mas ainda não está conectada a um banco de dados. Siga os três passos abaixo
            para colocar o sistema em funcionamento. Nada aqui é simulado: sem banco, o painel não opera.
          </p>
        </header>

        <div className="mt-8 space-y-4">
          {PASSOS.map((passo) => (
            <section key={passo.numero} className="rounded-card border border-white/10 bg-white/[0.04] p-5">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white">
                  <Icon nome={passo.icone} className="h-[18px] w-[18px]" />
                </span>
                <div className="min-w-0">
                  <h2 className="text-[15px] font-semibold text-white">
                    {passo.numero}. {passo.titulo}
                  </h2>
                  <p className="mt-1 text-sm leading-relaxed text-ink-400">{passo.texto}</p>

                  {passo.codigo && (
                    <pre className="scroll-thin mt-3 overflow-x-auto rounded-lg border border-white/10 bg-black/40 p-3 text-xs leading-relaxed text-emerald-300">
                      {passo.codigo}
                    </pre>
                  )}

                  {passo.aviso && (
                    <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-400/20 bg-amber-400/10 p-2.5 text-xs leading-relaxed text-amber-200">
                      <Icon nome="alerta" className="mt-0.5 h-4 w-4 shrink-0" />
                      {passo.aviso}
                    </p>
                  )}
                </div>
              </div>
            </section>
          ))}
        </div>

        <p className="mt-8 text-center text-xs text-ink-500">
          O passo a passo completo está em <strong className="text-ink-300">docs/SETUP.md</strong> e{' '}
          <strong className="text-ink-300">README.md</strong> do projeto.
        </p>
      </div>
    </div>
  )
}
