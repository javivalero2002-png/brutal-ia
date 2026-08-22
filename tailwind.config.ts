import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      // POR LA VARIABLE, no por el nombre.
      //
      // Aquí estaba EL fallo de la tipografía. Al pasar a `next/font` la familia
      // real deja de llamarse «Syne»: pasa a ser un nombre generado en el build.
      // Estas dos clases seguían pidiendo `Syne` y `Figtree` a secas, y como nadie
      // tiene esas fuentes instaladas, el navegador caía a la del sistema.
      //
      // Y ganaban: `globals.css` sí apuntaba a las variables, pero las utilidades
      // de Tailwind pesan más en la cascada. O sea que la app entera —que usa
      // `font-syne`/`font-figtree` por todas partes— llevaba desde el cambio con la
      // letra del sistema. Javi lo vio enseguida: «no me gusta nada ese tipo de
      // letra que has añadido».
      //
      // No era un cambio de estilo. Era la fuente sin cargar.
      fontFamily: {
        syne: ['var(--fuente-syne)', 'Syne', 'sans-serif'],
        figtree: ['var(--fuente-figtree)', 'Figtree', 'system-ui', 'sans-serif'],
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
