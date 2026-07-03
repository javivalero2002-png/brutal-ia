import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Nexus OS · Brutal Studios',
  description: 'Centro de operaciones IA para el equipo de Brutal Studios',
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
