import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Configuração compatível com Vercel (build estático em dist/).
export default defineConfig({
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
})
