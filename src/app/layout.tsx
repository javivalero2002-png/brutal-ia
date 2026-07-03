import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'BRUTAL.IA',
  description: 'Centro de inteligencia artificial para el equipo de Brutal Studios',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="font-figtree bg-nexus-bg text-nexus-white antialiased">
        {children}
      </body>
    </html>
  )
}
