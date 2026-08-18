import { describe, it, expect, beforeAll } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// Que un evento que llega ANTES de que nadie escuche no se pierda.
//
// `beforeinstallprompt` se emite una sola vez por carga y no se repite. En una
// visita repetida el service worker ya está registrado de antes, así que el
// navegador puede decidir que la app es instalable antes de que monte la
// pantalla de puesta en marcha. Si el oyente viviera dentro de esa pantalla, el
// evento se habría ido ya y el botón «INSTALAR AHORA» no saldría NUNCA en
// Chrome: el caso normal, no el raro. Y sin ruido en consola, porque no falla
// nada — simplemente no aparece.
//
// Esto se comprueba por conducta y no por forma: se dispara el evento SIN
// suscriptores y se exige que el módulo lo tenga guardado igual. Meter el
// oyente dentro de una función pone esto en rojo.
// ─────────────────────────────────────────────────────────────────────────────

type Mod = typeof import('@/lib/instalarPwa')
let mod: Mod
let ventana: EventTarget

function eventoDeInstalacion() {
  const e = new Event('beforeinstallprompt') as Event & { prompt: () => Promise<void>; llamado?: boolean }
  e.prompt = async () => { e.llamado = true }
  return e
}

beforeAll(async () => {
  ventana = new EventTarget()
  ;(globalThis as unknown as { window: EventTarget }).window = ventana
  // Después de poner el doble: el oyente se engancha al importar, que es el
  // punto de todo esto.
  mod = await import('@/lib/instalarPwa')
})

describe('el instalador de la PWA', () => {
  it('guarda el evento aunque no lo estuviera escuchando nadie', () => {
    const e = eventoDeInstalacion()
    ventana.dispatchEvent(e)
    expect(mod.promptGuardado(),
      'el evento llegó antes de que montara la pantalla y se ha perdido: el botón no saldrá nunca')
      .toBe(e)
  })

  it('quien se suscribe después también se entera', () => {
    let visto: unknown = 'nada'
    const dejar = mod.alCambiarPrompt(p => { visto = p })
    const e = eventoDeInstalacion()
    ventana.dispatchEvent(e)
    expect(visto, 'el suscriptor no recibió el evento').toBe(e)
    dejar()
  })

  it('el evento es de un solo uso y se descarta al usarlo', async () => {
    const e = eventoDeInstalacion()
    ventana.dispatchEvent(e)
    await mod.lanzarInstalacion()
    expect(e.llamado, 'no llegó a llamar al instalador del navegador').toBe(true)
    expect(mod.promptGuardado(),
      'se queda guardado: volver a lanzarlo con el mismo evento revienta').toBeNull()
  })

  it('si la app queda instalada, deja de ofrecerse', () => {
    ventana.dispatchEvent(eventoDeInstalacion())
    ventana.dispatchEvent(new Event('appinstalled'))
    expect(mod.promptGuardado(),
      'sigue ofreciendo instalar una app que ya está instalada').toBeNull()
  })
})
