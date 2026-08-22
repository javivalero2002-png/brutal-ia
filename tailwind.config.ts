import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      // LA FUENTE DEL SISTEMA, Y ES A PROPÓSITO.
      //
      // Aquí ponía Syne y Figtree, que es con lo que se diseñó la app. Pero la CSP
      // de `next.config.ts` (`style-src 'self'` + `font-src 'self'`) lleva desde el
      // 2026-08-09 bloqueando Google Fonts, mientras `globals.css` seguía pidiéndolas
      // ahí. Una fuente bloqueada no da error: cae al siguiente nombre de la pila.
      // Así que la app entera se pintó con la del sistema durante trece días.
      //
      // Al migrar a `next/font` el 2026-08-22 pasaron a servirse desde nuestro
      // dominio —o sea `'self'`— y Syne apareció por primera vez en meses. Medido en
      // el navegador: «ANALIZAR CON IA BRUTAL» pasó de 527 px a 870 px. A Javi no le
      // gustó, y esto devuelve exactamente lo que había.
      //
      // Si se recupera alguna, va por `next/font`, NUNCA por el `@import` de Google:
      // la CSP lo volvería a tirar sin decir nada. Lo vigila una regla de
      // `regresiones.test.ts` («la app no nombra ninguna tipografia que no cargue»).
      fontFamily: {
        syne: ['sans-serif'],
        figtree: ['system-ui', 'sans-serif'],
      },
      colors: {
        nexus: {
          bg: '#040409',
          surface: '#0C0C15',
          surfaceHigh: '#14142A',
          blue: '#1B5FFA',
          red: '#E51D2A',
          white: '#F0F0F8',
        },
      },
      keyframes: {
        ticker: { '0%': { transform: 'translateX(0)' }, '100%': { transform: 'translateX(-50%)' } },
        glowPulse: { '0%,100%': { opacity: '1', boxShadow: '0 0 6px #1B5FFA' }, '50%': { opacity: '0.5', boxShadow: '0 0 2px #1B5FFA' } },
        riseT: { from: { opacity: '0', transform: 'translateX(-50%) translateY(12px)' }, to: { opacity: '1', transform: 'translateX(-50%) translateY(0)' } },
        pls: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.3' } },
        dot1: { '0%,80%,100%': { transform: 'scale(0)' }, '40%': { transform: 'scale(1)' } },
        dot2: { '0%,100%': { transform: 'scale(0)' }, '40%': { transform: 'scale(0)' }, '60%': { transform: 'scale(1)' }, '80%': { transform: 'scale(0)' } },
        dot3: { '0%,60%,100%': { transform: 'scale(0)' }, '80%': { transform: 'scale(1)' } },
      },
      animation: {
        ticker: 'ticker 28s linear infinite',
        glowPulse: 'glowPulse 2.5s ease-in-out infinite',
        riseT: 'riseT 0.3s ease-out',
        pls: 'pls 1.5s ease-in-out infinite',
        dot1: 'dot1 1.2s infinite ease-in-out',
        dot2: 'dot2 1.2s infinite ease-in-out',
        dot3: 'dot3 1.2s infinite ease-in-out',
      },
    },
  },
  plugins: [],
}

export default config
