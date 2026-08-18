// ─────────────────────────────────────────────────────────────────────────────
// El evento de instalación de Chrome se dispara UNA VEZ, y no espera a nadie.
//
// `beforeinstallprompt` llega cuando el navegador decide que la app es
// instalable — tras leer el manifiesto y ver el service worker. En una visita
// repetida el service worker ya está registrado de antes, así que eso puede
// pasar ANTES de que monte el componente que enseña el botón. Y el evento no se
// vuelve a emitir: quien no estuviera escuchando en ese instante se queda sin él
// para siempre en esa carga.
//
// Por eso el oyente vive aquí, en el ámbito del módulo, y no dentro de un
// `useEffect`: se engancha en cuanto se ejecuta el chunk, que es lo más pronto
// que puede correr código de cliente sin meter un <script> en línea (el layout
// evita a propósito el primer `dangerouslySetInnerHTML` del repo). Lo importa
// `ServiceWorkerRegister`, que ya está en el layout raíz.
//
// El componente pregunta por `promptGuardado()` al montar y además se suscribe,
// así funciona tanto si llegó antes como si llega después.
//
// OJO EN DESARROLLO: no sale nunca. El service worker se desregistra adrede en
// dev (ver ServiceWorkerRegister), y sin él Chrome no considera la app
// instalable. Que no aparezca el botón en localhost NO es un fallo.
// ─────────────────────────────────────────────────────────────────────────────

export interface PromptInstalacion { prompt: () => Promise<void> }

let guardado: PromptInstalacion | null = null
const suscriptores = new Set<(p: PromptInstalacion | null) => void>()

function emitir() { for (const f of suscriptores) f(guardado) }

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault()   // sin esto Chrome pinta su propio aviso y se pisan
    guardado = e as unknown as PromptInstalacion
    emitir()
  })
  window.addEventListener('appinstalled', () => { guardado = null; emitir() })
}

export const promptGuardado = () => guardado

/** Devuelve la función para desuscribirse. */
export function alCambiarPrompt(f: (p: PromptInstalacion | null) => void) {
  suscriptores.add(f)
  return () => { suscriptores.delete(f) }
}

/** Lanza el instalador. El evento es de un solo uso: se descarta pase lo que pase. */
export async function lanzarInstalacion() {
  const p = guardado
  if (!p) return
  try { await p.prompt() } catch {}
  guardado = null
  emitir()
}
