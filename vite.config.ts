import { loadEnv } from 'vite'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Carimbo de versão do build.
 *
 * Existe por um motivo prático: quando alguém diz "o sistema está com problema",
 * a primeira pergunta é *qual versão* está aberta naquele aparelho. O carimbo
 * aparece no rodapé da tela de entrada e nas configurações, então dá para conferir
 * na hora se a pessoa está na versão nova ou numa aba antiga (ou em outro endereço).
 *
 * O identificador do commit vem do ambiente da Vercel; localmente fica 'local'.
 */
function carimboDeVersao(mode: string): string {
  const ambiente = loadEnv(mode, '.', '')
  const commit = (ambiente.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7) || 'local'
  const quando = new Date().toISOString().slice(0, 16).replace('T', ' ')
  return `${commit} · ${quando}Z`
}

// Configuração compatível com Vercel (build estático em dist/).
export default defineConfig(({ mode }) => ({
  define: {
    __VERSAO_DO_APP__: JSON.stringify(carimboDeVersao(mode)),
  },
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    // Permite abrir o dev server por um domínio de preview (iframe/host externo).
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
}))
