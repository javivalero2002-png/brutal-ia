import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { nivelTarea, NIVELES_TAREA } from '@/components/shared/helpers'

// ─────────────────────────────────────────────────────────────────────────────
// El contrato entre el hook de datos y las secciones.
//
// Durante meses las 16 secciones recibieron sus props como `any`. Con eso,
// cuando useNexusData y una sección divergían, `tsc` no veía NADA: te enterabas
// cuando reventaba en pantalla. Así se colaron ocho métodos sin implementar en
// /preview, y así vivió cada pareja de bugs idénticos que se arreglaba en una
// copia y seguía viva en la otra.
//
// Este test no comprueba qué pinta cada sección: fija la REGLA. Una sección
// nueva que reciba `data` sin tiparlo pone el build en rojo, sin que nadie
// tenga que acordarse de mirarlo en la revisión.
// ─────────────────────────────────────────────────────────────────────────────

const DIR = 'src/components/sections'
const secciones = readdirSync(DIR).filter(f => f.endsWith('.tsx'))
const leer = (f: string) => readFileSync(join(DIR, f), 'utf8')

describe('contrato de datos de las secciones', () => {
  it('hay secciones que revisar (el test no se ha quedado sin objetivo)', () => {
    expect(secciones.length).toBeGreaterThan(10)
  })

  it('ninguna sección declara sus props como `any`', () => {
    const culpables = secciones.filter(f => /\)\s*:\s*any\s*\)\s*\{/.test(leer(f)) || /\}:\s*any\)/.test(leer(f)))
    expect(culpables, `Declaran props como any: ${culpables.join(', ')}`).toEqual([])
  })

  // Diez secciones declaraban `onNavigate: any`. La regla de arriba no las veía,
  // porque solo mira el objeto de props ENTERO — un prop suelto tipado `any` se
  // le escapa, y este era justo el que cruza la frontera hacia la navegación.
  //
  // Lo que costaba: `onNavigate('proyecto')` en singular compilaba sin una queja
  // y en ejecución dejaba la app en una sección que no existe. Al ponerle el tipo
  // aparecieron cuatro sitios que le pasaban un `string` ancho.
  it('toda sección que recibe `onNavigate` lo tipa con IrASeccion', () => {
    const fallan = secciones.filter(f => /^\s*onNavigate\??:\s*any\s*$/m.test(leer(f)))
    expect(fallan, `Declaran onNavigate como any: ${fallan.join(', ')}`).toEqual([])
  })

  // Y que el tipo no se quede en la firma: las listas de `{..., nav:'tareas'}`
  // se ensanchan a `string` si nadie las tipa, y entonces el tipo del prop no
  // comprueba nada en el sitio donde de verdad se escribe el nombre.
  it('las listas con `nav:` van tipadas, no ensanchadas a string', () => {
    const HOY = readFileSync(join(DIR, 'HoySection.tsx'), 'utf8')
    expect(/type BItem = \{[^}]*nav:\s*Section/.test(HOY), 'BItem.nav volvió a ser string').toBe(true)
    expect(/railStats:\s*\{[^}]*nav:\s*Section\}\[\]/.test(HOY), 'railStats perdió su tipo').toBe(true)
    const REP = readFileSync(join(DIR, 'ReportesSection.tsx'), 'utf8')
    // `satisfies` y no `as`: con `as` el tipo se AFIRMA sin comprobarse. Se probó
    // metiendo nav:'proyecto' y tsc pasaba igual.
    expect(/satisfies \{[^}]*nav:\s*Section\}\[\]/.test(REP), 'los KPI de Reportes no están tipados con satisfies').toBe(true)
  })

  // Reportes NO tiene entrada en el menú: se llega solo por la pestaña de
  // Ajustes, y ahí recibía `onNavigate={()=>{}}`. Sus seis KPI son botones, se
  // ven como botones, y no hacían nada por la única ruta que existe para verlos.
  it('Ajustes pasa un onNavigate de verdad a Reportes', () => {
    const AJ = readFileSync(join(DIR, 'AjustesSection.tsx'), 'utf8')
    const linea = AJ.split('\n').find(l => l.includes('<ReportesSection')) || ''
    expect(linea, 'Ajustes ya no monta ReportesSection: sobra esta regla').not.toBe('')
    expect(/onNavigate=\{\s*\(\s*\)\s*=>\s*\{\s*\}\s*\}/.test(linea),
      'vuelve a pasar un onNavigate vacío: los KPI de Reportes no navegan').toBe(false)
  })

  it('toda sección que recibe `data` lo tipa con NexusData', () => {
    const fallan = secciones.filter(f => {
      const src = leer(f)
      // ¿Desestructura `data` en la firma del componente?
      const firma = src.match(/^(?:export default )?function \w+\(\{([^}]*)\}/m)
      if (!firma) return false
      const props = firma[1].split(',').map(p => p.trim())
      if (!props.includes('data')) return false
      return !/\bdata:\s*NexusData\b/.test(src)
    })
    expect(fallan, `Reciben \`data\` sin tiparlo: ${fallan.join(', ')}`).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// El nivel de una tarea creada por Harvey.
//
// Harvey emite [ACCION:tarea|texto|nivel|persona] y ese `nivel` es literalmente
// lo que haya escrito el modelo. El prompt le pide «urgent, high, normal» en
// inglés dentro de una conversación entera en español, y `tasks.level` tiene
// CHECK (level in ('urgent','high','normal')): cualquier otra cosa hace que el
// INSERT rebote y la tarea NO se cree — después de que Harvey haya dicho en voz
// alta que la creaba.
//
// Estaba sin validar en las dos secciones que confirman la acción, y en HoySection
// el error de tipo estaba tapado con `as any`.
// ─────────────────────────────────────────────────────────────────────────────

describe('nivelTarea — lo que escribe el modelo nunca llega crudo a la base', () => {
  it('deja pasar los tres válidos', () => {
    for (const n of NIVELES_TAREA) expect(nivelTarea(n)).toBe(n)
  })

  it('traduce lo que el modelo escribe en español', () => {
    expect(nivelTarea('urgente')).toBe('urgent')
    expect(nivelTarea('crítica')).toBe('urgent')
    expect(nivelTarea('alta')).toBe('high')
    expect(nivelTarea('importante')).toBe('high')
    expect(nivelTarea('media')).toBe('normal')
    expect(nivelTarea('baja')).toBe('normal')
  })

  it('no le importan mayúsculas ni espacios de más', () => {
    expect(nivelTarea('  URGENTE ')).toBe('urgent')
    expect(nivelTarea('Normal')).toBe('normal')
  })

  it('cae en «high» con lo vacío o lo irreconocible, nunca en algo que rompa el CHECK', () => {
    for (const raro of ['', '   ', null, undefined, 'muy importante ya', '3', 'P1', '🔥']) {
      expect(NIVELES_TAREA).toContain(nivelTarea(raro as string))
    }
    expect(nivelTarea(undefined)).toBe('high')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Una sección nueva está cableada del todo, o no está.
//
// Registrarla en SECCIONES y olvidar pintarla deja una entrada de menú que no
// hace nada; pintarla sin registrarla la deja inalcanzable por `?s=`. Las dos
// mitades fallan en silencio, así que se comprueban juntas.
// ─────────────────────────────────────────────────────────────────────────────
describe('Diario · cableado completo', () => {
  const leerCod = (f: string) =>
    readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

  it('está declarada como sección', () => {
    expect(/'diario'/.test(leerCod('src/components/shared/secciones.ts'))).toBe(true)
  })

  it('el dashboard la pinta y la ofrece en el menú', () => {
    const D = leerCod('src/components/NexusDashboard.tsx')
    expect(/section === 'diario' &&/.test(D), 'la sección no se pinta: el menú llevaría a una pantalla vacía').toBe(true)
    expect(/navItem\('diario'/.test(D), 'no hay entrada de menú: sería inalcanzable salvo por ?s=').toBe(true)
  })

  it('sus rutas de API resuelven al usuario antes de tocar el admin client', () => {
    for (const f of ['src/app/api/diario/route.ts', 'src/app/api/diario/extraer/route.ts']) {
      const src = leerCod(f)
      const auth = src.indexOf('auth.getUser()')
      const admin = src.indexOf('createAdminClient()')
      expect(auth, `${f}: no resuelve al usuario`).toBeGreaterThan(-1)
      if (admin > -1) expect(auth, `${f}: usa el service role antes de comprobar la sesión`).toBeLessThan(admin)
    }
  })

  it('el día y el autor los pone el servidor, no el cuerpo de la petición', () => {
    const R = leerCod('src/app/api/diario/route.ts')
    // Si `dia` o `user_id` salieran del body, cualquiera podría escribir en el día
    // de otro o retocar un día ya cerrado.
    expect(/pick\(body, \['entrada', 'cierre'\]\)/.test(R),
      'la allowlist deja pasar más que los dos textos: el día o el autor podrían venir del cliente').toBe(true)
    expect(/const dia = todayKey\(\)/.test(R), 'el día no se calcula en el servidor con todayKey()').toBe(true)
  })

  it('la extracción propone, no crea', () => {
    const E = leerCod('src/app/api/diario/extraer/route.ts')
    expect(/createTask|from\('tasks'\)/.test(E),
      'la ruta de extracción escribe tareas: tiene que proponer y que decida una persona').toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// La demo (/preview y /preview-boot) en producción: solo el propietario.
//
// Devolvía 404 sin más, con el motivo escrito «nunca expone datos ni UI sin auth
// en el entorno real». Ese motivo sigue valiendo, así que al abrirla hay que
// mantenerlo: no hay ni un dato real dentro —PreviewClient trae su propio juego
// de muestra— y encima exige sesión y rol owner, resuelto en el servidor.
// ─────────────────────────────────────────────────────────────────────────────
describe('la demo no queda abierta en producción', () => {
  const leerCod2 = (f: string) =>
    readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

  for (const f of ['src/app/preview/page.tsx', 'src/app/preview-boot/page.tsx']) {
    it(`${f.split('/')[2]} exige owner en producción`, () => {
      const src = leerCod2(f)
      expect(/NODE_ENV === 'production'/.test(src), 'ya no distingue producción').toBe(true)
      // El rol, del servidor. Nunca de la URL ni de una cabecera.
      expect(/getAuthCtx\(\)/.test(src), 'no resuelve el rol en el servidor').toBe(true)
      expect(/role !== 'owner'[\s\S]{0,40}notFound\(\)/.test(src),
        'la demo queda accesible en producción a quien no es propietario').toBe(true)
    })
  }

  it('la demo no lee datos reales', () => {
    const P = leerCod2('src/app/preview/PreviewClient.tsx')
    expect(/useNexusData\(/.test(P),
      'PreviewClient engancha el hook de datos reales: dejaría de ser una demo').toBe(false)
  })
})

// El bug que hizo inservible la primera versión del Diario: cambiar de sección
// desmonta el componente y el borrador moría con él. Un diario que te pierde lo
// escrito no se usa dos veces.
describe('Diario · no se pierde lo escrito', () => {
  const D = readFileSync('src/components/sections/DiarioSection.tsx', 'utf8')

  it('se autoguarda mientras escribes', () => {
    expect(/borrador: true/.test(D), 'ya no hay autoguardado: se vuelve a perder al cambiar de sección').toBe(true)
    expect(/setTimeout\([\s\S]{0,80}guardarBorrador/.test(D), 'guarda en cada tecla, sin retardo').toBe(true)
  })

  it('y guarda lo pendiente al desmontarse', () => {
    expect(/keepalive: true/.test(D),
      'al salir de la sección lo tecleado en el último segundo se pierde: el navegador cancela la petición').toBe(true)
  })

  it('el autoguardado no ficha la hora', () => {
    const R = readFileSync('src/app/api/diario/route.ts', 'utf8')
    expect(/esBorrador/.test(R),
      'un guardado automático pondría la hora de entrada en cada pulsación').toBe(true)
  })

  it('las tareas salen solas, sin botón', () => {
    expect(/diario\/extraer/.test(D)).toBe(true)
    // Se dispara desde un efecto sobre el texto, no desde un onClick.
    const i = D.indexOf('diario/extraer')
    expect(/useEffect/.test(D.slice(Math.max(0, i - 1200), i)),
      'la extracción vuelve a depender de que el usuario pulse un botón').toBe(true)
  })
})
