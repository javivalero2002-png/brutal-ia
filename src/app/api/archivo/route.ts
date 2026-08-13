import { createClient, createAdminClient } from '@/lib/supabase/server'
import { isOwnStorageUrl } from '@/lib/safeFetch'
import { firmarUrl } from '@/lib/storageFirmado'
import { NextRequest, NextResponse } from 'next/server'

// Un enlace ESTABLE a un fichero del Storage, que además exige sesión.
//
// Por qué hace falta: casi todo lo que sale del bucket se firma al leer, en la
// ruta que devuelve la fila (ver src/lib/storageFirmado.ts). Pero hay un caso que
// no encaja ahí — MemoriaSection guarda el enlace del documento DENTRO del texto
// de la nota («📎 Documento: …»). Eso no se puede firmar al leer sin ponerse a
// parsear texto libre, y guardarlo ya firmado sería peor: la firma caduca en una
// hora y el enlace quedaría escrito y muerto.
//
// La solución es no guardar el fichero, sino el camino hasta él: la nota apunta
// aquí, y aquí se comprueba la sesión y se redirige a una firma recién hecha.
// El enlace guardado no caduca nunca y no sirve de nada a quien no tenga cuenta.
//
// Es además lo que permite cerrar el bucket: sin esto, el primer PDF que alguien
// suba a Memoria genera un enlace que morirá en cuanto se cierre.

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  // 401 y no una redirección al login: esto se abre en una pestaña nueva desde un
  // enlace, y mandar a /login desde ahí deja al usuario en una pestaña huérfana
  // sin saber qué ha pasado.
  if (!user) return NextResponse.json({ error: 'Necesitas iniciar sesión para abrir este archivo' }, { status: 401 })

  const u = request.nextUrl.searchParams.get('u')

  // Sin esta comprobación esto sería un redirector abierto: cualquiera con sesión
  // podría montar un enlace de brutalia.tech que lleva a donde quiera, y eso es
  // exactamente lo que hace creíble un phishing. Solo se redirige al Storage
  // propio.
  if (!isOwnStorageUrl(u)) {
    return NextResponse.json({ error: 'Enlace no válido' }, { status: 400 })
  }

  const admin = await createAdminClient()
  const firmada = await firmarUrl(admin, u)
  if (!firmada) {
    // El fichero ya no está: se borró la nota, o el objeto. Mejor decirlo que
    // mandar al usuario a un error crudo de Supabase.
    return NextResponse.json({ error: 'El archivo ya no está disponible' }, { status: 404 })
  }

  // 307 y no 301/308: la firma cambia en cada petición, así que esta respuesta no
  // se puede cachear ni en el navegador ni en la CDN. Un 301 dejaría al navegador
  // reusando para siempre una firma que caduca en una hora.
  return NextResponse.redirect(firmada, {
    status: 307,
    headers: { 'Cache-Control': 'no-store' },
  })
}
