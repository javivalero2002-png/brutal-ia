import type { Metadata, Viewport } from 'next'
import { cookies } from 'next/headers'

// ─────────────────────────────────────────────────────────────────────────────
// AQUÍ NO SE CARGA NINGUNA TIPOGRAFÍA, Y ES A PROPÓSITO. LEE ESTO ANTES DE
// «ARREGLARLO», PORQUE PARECE UN OLVIDO Y NO LO ES.
//
// La app se diseñó con Syne (rótulos) y Figtree (texto). Pero el 2026-08-09 se
// añadió la CSP de `next.config.ts`, y lleva dos directivas que las matan:
//
//     style-src 'self' 'unsafe-inline'     ← bloquea el CSS de fonts.googleapis.com
//     font-src  'self' data:               ← bloquea los .woff2 de fonts.gstatic.com
//
// …mientras `globals.css` seguía pidiéndolas con un `@import` a Google. O sea que
// durante trece días la app se pintó ENTERA con la fuente del sistema, y nadie lo
// vio: una fuente bloqueada no da error, simplemente cae al siguiente nombre de la
// pila. Es el mismo modo de fallo silencioso que el resto del repo persigue.
//
// El 2026-08-22 se migró a `next/font` para quitar un parpadeo. next/font sirve los
// ficheros desde nuestro propio dominio, o sea `'self'`, o sea que la CSP ya no los
// bloquea — y Syne apareció por primera vez en meses. No era una fuente nueva: era
// la de siempre, cargando por fin. Medido en el navegador: «ANALIZAR CON IA BRUTAL»
// pasó de 527 px a 870 px, un 65% más ancha. De ahí que se notara tantísimo.
//
// Javi la vio y no le gusta. Así que se vuelve a lo que había: las pilas apuntan a
// las fuentes del sistema y no se descarga ninguna. Eso deja la app EXACTAMENTE
// como estaba (mismos glifos, mismas métricas) y de paso se ahorra la descarga.
//
// Si algún día se quiere recuperar Syne o Figtree, el camino es `next/font` otra vez
// —NO el `@import` de Google, que la CSP volvería a bloquear en silencio—. Y hay un
// test que impide reintroducir una familia que no se carga: ver
// `src/lib/__tests__/tipografia.test.ts`.
// ─────────────────────────────────────────────────────────────────────────────

import './globals.css'
import ServiceWorkerRegister from '@/components/ServiceWorkerRegister'

export const metadata: Metadata = {
  title: 'BRUTAL.IA',
  description: 'Centro de inteligencia artificial para el equipo de Brutal Studios',
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'BRUTAL.IA',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#030308',
}

// El tema se lee de una COOKIE, no de localStorage, y se aplica aquí — en el
// HTML que sale del servidor.
//
// Antes se aplicaba en un `useEffect` del dashboard, o sea DESPUÉS del primer
// pintado: quien tuviera el modo claro veía un destello oscuro en cada carga,
// hasta que hidrataba React. localStorage no sirve para esto porque el servidor
// no puede leerlo; una cookie sí.
//
// La alternativa habitual es un <script> inline que ponga la clase antes de
// pintar, pero eso mete el primer `dangerouslySetInnerHTML` del repo, que es
// justo el motivo por el que CSP con nonce está fuera de alcance en CLAUDE.md.
// La cookie evita esa deuda.
//
// Coste: `cookies()` vuelve dinámico el layout raíz, así que /preview y
// /reset-password dejan de ser estáticas. La raíz ya era dinámica y esto es una
// app interna de 7 personas — a esta escala no se nota.
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const claro = (await cookies()).get('nx_theme')?.value === 'light'
  return (
    <html lang="es" className={claro ? 'theme-light' : undefined}>
      <head>
        {/* La insignia del arranque, PEDIDA YA.
            La pantalla de arranque pinta dos <img> —el logo oscuro y el claro— y el
            CSS oculta uno. Pero el navegador descarga LOS DOS, y como son peticiones
            que solo arrancan después del CSS, el círculo se queda vacío hasta que
            llegan: el logo aparece de golpe medio segundo después de pintarse la
            pantalla. Eso es el destello que quedaba.
            Con el `preload` la petición sale a la vez que el HTML, en paralelo con el
            CSS en lugar de detrás. Y se precarga SOLO el que se va a ver: el servidor
            ya sabe el tema por la cookie, así que no hay que adivinarlo ni descargar
            30 KB del que está oculto. */}
        <link rel="preload" as="image" type="image/svg+xml"
          href={claro ? '/logo-claro.svg' : '/logo-oscuro.svg'} />
      </head>
      <body className="font-figtree bg-nexus-bg text-nexus-white antialiased">
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  )
}
