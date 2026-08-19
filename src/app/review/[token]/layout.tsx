import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/server'
import { APP_URL } from '@/lib/appUrl'

// ─────────────────────────────────────────────────────────────────────────────
// La tarjetita que sale al pegar el enlace en WhatsApp, Slack o un correo.
//
// Sin esto heredaba la del sitio: al cliente le llegaba «Nexus · BRUTAL.IA — app
// interna de Brutal Studios». Ese enlace es, casi siempre, el primer contacto de
// un cliente con nuestro trabajo, y presentaba la herramienta en vez de la pieza.
//
// Se resuelve en el SERVIDOR, en un layout, porque la página es de cliente y una
// vista previa la pide un robot que no ejecuta JavaScript: si el título se pusiera
// desde React, la tarjeta seguiría saliendo genérica.
//
// Ojo con lo que se pone aquí: esta descripción viaja a los servidores de
// WhatsApp y Slack, así que solo el título de la pieza — nunca las notas internas
// ni el nombre del cliente.
// ─────────────────────────────────────────────────────────────────────────────

export async function generateMetadata(
  { params }: { params: Promise<{ token: string }> },
): Promise<Metadata> {
  const generica: Metadata = {
    title: 'Revisión de contenido',
    description: 'Échale un vistazo y dinos qué te parece.',
    // El enlace es de un solo uso conceptualmente y no debe acabar en Google.
    robots: { index: false, follow: false },
  }

  try {
    const { token } = await params
    // Sin UUID no se consulta: un token con cualquier otra forma haría a la base
    // trabajar por cada robot que pase.
    if (!/^[0-9a-f-]{36}$/i.test(token)) return generica

    const admin = await createAdminClient()
    const { data } = await admin
      .from('content_agenda')
      // Solo el título y la portada. Nada interno.
      .select('title, cover_url, platform')
      .eq('id', token)
      .single()

    if (!data?.title) return generica

    const titulo = `${data.title} — ¿qué te parece?`
    const descripcion = data.platform
      ? `Contenido para ${data.platform}, listo para tu revisión.`
      : 'Contenido listo para tu revisión.'

    return {
      title: titulo,
      description: descripcion,
      robots: { index: false, follow: false },
      openGraph: {
        title: titulo,
        description: descripcion,
        url: `${APP_URL}/review/${token}`,
        type: 'article',
        // La portada solo si es pública de verdad: las firmadas caducan, y una
        // vista previa con la imagen rota es peor que una sin imagen.
        ...(data.cover_url && !data.cover_url.includes('token=') ? { images: [data.cover_url] } : {}),
      },
      twitter: { card: data.cover_url ? 'summary_large_image' : 'summary', title: titulo, description: descripcion },
    }
  } catch {
    // Que la vista previa falle no puede tumbar la página: el cliente tiene que
    // poder abrir el enlace aunque la tarjetita salga genérica.
    return generica
  }
}

export default function ReviewLayout({ children }: { children: React.ReactNode }) {
  return children
}
