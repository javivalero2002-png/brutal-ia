// ─────────────────────────────────────────────────────────────────────────────
// Activar los avisos en ESTE aparato. Una sola copia, a propósito.
//
// Conceder el permiso del navegador NO activa nada. Es solo la mitad: hace falta
// además registrar el service worker, crear una `PushSubscription` con la clave
// VAPID y mandarla al servidor, que es lo único que le dice a dónde empujar. Sin
// esa fila, `sendPushToUser` no encuentra destinatario y no sale ni un aviso.
//
// La puesta en marcha tenía escrita solo la primera mitad, así que decía «Avisos
// activados» en verde y no llegaba nada — y encima dejaba el permiso concedido,
// que es el estado en el que el navegador ya no vuelve a preguntar. Era un
// gemelo de manual: la misma operación escrita dos veces, correcta en una copia
// (Operativa) y a medias en la otra. La clase de fallo dominante de este repo.
//
// Por eso vive aquí y no en un componente: para que la próxima pantalla que
// necesite activar avisos no tenga que volver a acertar.
// ─────────────────────────────────────────────────────────────────────────────

export type ResultadoPush =
  | { ok: true }
  | { ok: false; motivo: 'sin-soporte' | 'denegado' | 'fallo'; mensaje: string }

export function haySoportePush() {
  return typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window
}

function claveVapid(bruta: string) {
  const cruda = atob(bruta.replace(/-/g, '+').replace(/_/g, '/'))
  return new Uint8Array([...cruda].map(c => c.charCodeAt(0)))
}

export async function activarPush(): Promise<ResultadoPush> {
  if (!haySoportePush()) {
    return { ok: false, motivo: 'sin-soporte', mensaje: 'Este navegador no admite avisos' }
  }
  try {
    const reg = await navigator.serviceWorker.register('/sw.js')
    await navigator.serviceWorker.ready

    const permiso = await Notification.requestPermission()
    if (permiso !== 'granted') {
      return { ok: false, motivo: 'denegado', mensaje: 'Permiso denegado — actívalo en los ajustes del navegador' }
    }

    // Si ya hay una suscripción de antes se reutiliza: volver a suscribir con la
    // misma clave devuelve la misma, pero pedirla de nuevo es una llamada de red
    // que puede fallar sola.
    const sub = await reg.pushManager.getSubscription() ||
      await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: claveVapid(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || ''),
      })

    const r = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON(), userAgent: navigator.userAgent }),
    })
    // Se comprueba `ok`: un 401 por sesión caducada no lanza, así que sin esto la
    // pantalla diría que están activados con el servidor sin enterarse.
    if (!r.ok) return { ok: false, motivo: 'fallo', mensaje: 'No se pudieron activar. Inténtalo de nuevo.' }

    return { ok: true }
  } catch {
    return { ok: false, motivo: 'fallo', mensaje: 'No se pudieron activar. Inténtalo de nuevo.' }
  }
}
