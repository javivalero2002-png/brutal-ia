import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/server'
import { APP_URL } from '@/lib/appUrl'
import { firmarUrl } from '@/lib/storageFirmado'

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

    // `firmarUrl` devuelve null si no puede firmar, a propósito: un enlace roto que
    // parece bueno confunde más que un hueco. Aquí eso significa tarjeta sin imagen,
    // que es exactamente lo correcto.
    const portadaFirmada = await firmarUrl(admin, data.cover_url)

    return {
      title: titulo,
      description: descripcion,
      robots: { index: false, follow: false },
      openGraph: {
        title: titulo,
        description: descripcion,
        url: `${APP_URL}/review/${token}`,
        type: 'article',
        // FIRMADA, o ninguna.
        //
        // Esta condición estaba justo del revés en la práctica. Excluía las URLs
        // firmadas (`token=`) y dejaba pasar las «públicas» — pero lo que la base
        // guarda ES la dirección pública, y el bucket `content-videos` es PRIVADO
        // desde que se cerró. O sea que la única imagen que llegaba a publicarse
        // era justo la que siempre responde 400. La vista previa salía rota
        // siempre, y el comentario decía que se hacía para evitar eso.
        //
        // La firma caduca, sí. Pero WhatsApp y Slack piden la imagen UNA vez, al
        // pegar el enlace, y se la quedan: para lo que dura una tarjeta de vista
        // previa, una firma vale. Una que no carga nunca, no.
        ...(portadaFirmada ? { images: [portadaFirmada] } : {}),
      },
      twitter: { card: portadaFirmada ? 'summary_large_image' : 'summary', title: titulo, description: descripcion },
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
