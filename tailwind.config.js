/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      /**
       * Cor: dois eixos apenas.
       *  · `ink`  — neutros quentes (papel/pedra) que sustentam a interface;
       *  · `brand`— vermelho de osteria, usado como ACENTO (ação, foco, seleção).
       * Os tons semânticos (verde/âmbar/céu/rosa) aparecem só em selos e avisos.
       */
      colors: {
        brand: {
          50: '#fef5f3',
          100: '#fce7e3',
          200: '#f8cfc7',
          300: '#f2ac9e',
          400: '#e8806c',
          500: '#db5a41',
          600: '#c43a20',
          700: '#a32d18',
          800: '#872716',
          900: '#712316',
          950: '#3d0f08',
        },
        ink: {
          25: '#fbfaf9',
          50: '#f7f6f4',
          100: '#f1efec',
          200: '#e7e4df',
          300: '#d6d2cb',
          400: '#a8a29a',
          500: '#7c766e',
          600: '#5c574f',
          700: '#403c36',
          800: '#2a2723',
          900: '#1a1815',
          950: '#121110',
        },
        /** Papel da tela (canvas) e da superfície elevada. */
        papel: '#faf9f7',
        superficie: '#ffffff',
      },
      fontFamily: {
        /**
         * Uma família só, com os melhores cortes de cada sistema.
         * A fonte do sistema carrega instantaneamente e não depende de internet —
         * o balcão não pode ficar esperando fonte baixar.
         */
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI Variable Text"',
          '"Segoe UI"',
          'Inter',
          'Roboto',
          '"Helvetica Neue"',
          'Arial',
          'sans-serif',
        ],
        num: [
          'ui-monospace',
          '"SF Mono"',
          '"Cascadia Mono"',
          '"Roboto Mono"',
          '"Segoe UI Mono"',
          'monospace',
        ],
      },
      /**
       * Escala tipográfica curta de propósito: cinco tamanhos cobrem todo o
       * sistema. Variedade vem de peso, cor e espaço — não de mais tamanhos.
       */
      fontSize: {
        micro: ['11px', { lineHeight: '1.35', letterSpacing: '0.07em' }],
        pequeno: ['13px', { lineHeight: '1.45' }],
        base: ['15px', { lineHeight: '1.55' }],
        titulo: ['21px', { lineHeight: '1.25', letterSpacing: '-0.015em' }],
        numero: ['28px', { lineHeight: '1.1', letterSpacing: '-0.02em' }],
        display: ['34px', { lineHeight: '1.05', letterSpacing: '-0.025em' }],
      },
      borderRadius: {
        /* Raio externo nunca é igual ao de dentro (pesquisa de padrão 2026). */
        card: '14px',
        control: '10px',
        interno: '8px',
      },
      boxShadow: {
        /* Sombra é elevação, não decoração: bordas fazem a separação. */
        card: '0 1px 2px rgba(26, 24, 21, 0.04)',
        raised: '0 2px 6px -1px rgba(26, 24, 21, 0.06), 0 1px 2px rgba(26, 24, 21, 0.04)',
        float: '0 12px 32px -8px rgba(26, 24, 21, 0.18), 0 2px 8px -2px rgba(26, 24, 21, 0.08)',
        focus: '0 0 0 3px rgba(196, 58, 32, 0.16)',
        /* Brilho interno do topo do botão — dá o toque "físico" sem exagero. */
        brilho: 'inset 0 1px 0 rgba(255, 255, 255, 0.14)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(10px) scale(0.99)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'slide-in-right': {
          from: { opacity: '0', transform: 'translateX(14px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        'slide-in-left': {
          from: { opacity: '0', transform: 'translateX(-20px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.98)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        'fade-in': 'fade-in 180ms ease-out both',
        'slide-up': 'slide-up 220ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'slide-in-right': 'slide-in-right 200ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'slide-in-left': 'slide-in-left 200ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'scale-in': 'scale-in 150ms ease-out both',
      },
      transitionTimingFunction: {
        smooth: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      maxWidth: {
        tela: '1440px',
      },
    },
  },
  plugins: [],
}
