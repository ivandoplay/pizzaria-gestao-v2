/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Vermelho "osteria": quente, profundo e elegante (sem ser berrante).
        brand: {
          50: '#fef5f3',
          100: '#fde7e2',
          200: '#fbd2c9',
          300: '#f7b0a1',
          400: '#f18169',
          500: '#e55540',
          600: '#cc321d',
          700: '#a92413',
          800: '#8b2115',
          900: '#742017',
          950: '#3f0d06',
        },
        // Neutros levemente quentes para combinar com o vermelho.
        ink: {
          50: '#f8f8f7',
          100: '#f1f1ef',
          200: '#e4e4e1',
          300: '#d1d1cc',
          400: '#9d9d95',
          500: '#71716a',
          600: '#565650',
          700: '#3f3f3b',
          800: '#2a2a27',
          900: '#1c1c1a',
          950: '#121211',
        },
      },
      fontFamily: {
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
      borderRadius: {
        card: '14px',
        control: '10px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(28, 28, 26, 0.04), 0 1px 3px rgba(28, 28, 26, 0.06)',
        raised: '0 4px 12px -2px rgba(28, 28, 26, 0.10), 0 2px 4px -2px rgba(28, 28, 26, 0.06)',
        float: '0 18px 40px -12px rgba(28, 28, 26, 0.28)',
        focus: '0 0 0 3px rgba(204, 50, 29, 0.18)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in-right': {
          from: { opacity: '0', transform: 'translateX(16px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        'slide-in-left': {
          from: { opacity: '0', transform: 'translateX(-24px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.97)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 180ms ease-out both',
        'slide-up': 'slide-up 220ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'slide-in-right': 'slide-in-right 220ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'slide-in-left': 'slide-in-left 200ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'scale-in': 'scale-in 160ms ease-out both',
      },
      transitionTimingFunction: {
        smooth: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [],
}
