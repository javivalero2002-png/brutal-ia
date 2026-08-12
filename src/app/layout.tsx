import type { Metadata, Viewport } from 'next'
import { cookies } from 'next/headers'
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
      <body className="font-figtree bg-nexus-bg text-nexus-white antialiased">
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  )
}
