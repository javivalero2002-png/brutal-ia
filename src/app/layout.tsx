import type { Metadata, Viewport } from 'next'
import { cookies } from 'next/headers'
import { Syne, Figtree } from 'next/font/google'

// ─────────────────────────────────────────────────────────────────────────────
// LAS TIPOGRAFÍAS, SERVIDAS DESDE AQUÍ. Esto era el parpadeo al abrir la app.
//
// Estaban con un `@import` de Google Fonts DENTRO de globals.css, y eso encadena
// tres saltos de red antes de que se vea la letra de verdad:
//
//   HTML (0,65 s) → CSS de la app (0,35 s) → CSS de Google (0,15 s) → 13 ficheros
//
// El navegador no descubre el `@import` hasta que ha bajado y leído nuestro CSS,
// así que la petición a Google ni siquiera puede empezar antes. Con `display=swap`,
// mientras tanto el texto se pinta con la fuente del sistema y CAMBIA DE GOLPE
// cuando llegan. Medido: el cambio cae alrededor del segundo — exactamente donde
// Javi lo describía («clicas, pasa un segundo, ocurre el parpadeo»).
//
// `next/font` las descarga en el BUILD y las sirve desde nuestro propio dominio:
// desaparecen los dos saltos externos, van en woff2 en vez de .ttf, se precargan, y
// —lo que de verdad mata el salto— Next calcula una fuente de reserva con las
// métricas ajustadas, así que el texto de antes y el de después ocupan lo mismo.
// ─────────────────────────────────────────────────────────────────────────────

const syne = Syne({
  subsets: ['latin'],
  // Variable: un solo fichero cubre todos los pesos que usa la app.
  variable: '--fuente-syne',
  display: 'swap',
})

const figtree = Figtree({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  variable: '--fuente-figtree',
  display: 'swap',
})
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
    <html lang="es" className={[syne.variable, figtree.variable, claro ? 'theme-light' : ''].filter(Boolean).join(' ')}>
      <body className="font-figtree bg-nexus-bg text-nexus-white antialiased">
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  )
}
