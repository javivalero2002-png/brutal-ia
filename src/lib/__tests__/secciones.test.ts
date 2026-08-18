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

  // El DÍA sí puede venir del cuerpo —se rellena el lunes el martes, que es lo
  // normal cuando se te pasa—. Lo que no puede venir nunca es el AUTOR: eso es lo
  // que impide escribir en el día de otro. Y no se puede escribir en el futuro,
  // que ni es un diario ni debe permitir inventarse un histórico.
  it('el autor sale de la sesión, nunca del cuerpo', () => {
    const R = leerCod('src/app/api/diario/route.ts')
    expect(/pick\(body, \['entrada', 'cierre'\]\)/.test(R),
      'la allowlist deja pasar más que los dos textos: el autor podría venir del cliente').toBe(true)
    expect(/user_id: user\.id/.test(R), 'el autor no sale de la sesión').toBe(true)
  })

  // Un día futuro se PLANIFICA, no se ficha. Se guardan los objetivos —planificar
  // la semana es la mitad de para qué sirve esto— pero NO la hora de entrada:
  // fichar es haber estado, y el jueves todavía no has estado. Poner la hora ahí
  // convertiría un plan en un registro de trabajo falso.
  it('un día futuro se planifica, pero no ficha la hora', () => {
    const R = leerCod('src/app/api/diario/route.ts')
    expect(/const esFuturo = dia > hoy/.test(R), 'ya no se distingue un día futuro').toBe(true)
    expect(/!esFuturo && campos\.entrada[\s\S]{0,60}entrada_at = ahora/.test(R),
      'un día futuro fichará hora de entrada: un plan quedaría como trabajo hecho').toBe(true)
    expect(/!esFuturo && campos\.cierre[\s\S]{0,60}cierre_at = ahora/.test(R),
      'un día futuro fichará hora de cierre').toBe(true)
    // Y la forma se valida antes: entra en un filtro de la consulta.
    expect(/\\d\{4\}-\\d\{2\}-\\d\{2\}/.test(R), 'el día del cuerpo no se valida').toBe(true)
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
      // Sesión, no rol: dentro no hay datos reales, así que exigir owner dejaba
      // fuera a medio equipo de una pantalla hecha para enseñarles la app. Lo que
      // no puede caer es la parte de «nunca sin auth».
      expect(/if \(!ctx\) notFound\(\)/.test(src),
        'la demo queda accesible en producción sin haber iniciado sesión').toBe(true)
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

// Al escribir el balance para cerrar el día, el extractor releía los objetivos de
// la mañana y volvía a ofrecer las tareas que acababas de aceptar.
describe('Diario · no repite tareas ya creadas', () => {
  const D = readFileSync('src/components/sections/DiarioSection.tsx', 'utf8')

  it('filtra contra las tareas que ya existen', () => {
    expect(/yaSon\.has\(/.test(D),
      'vuelve a proponer lo que ya es una tarea: al cerrar el día se duplica todo').toBe(true)
    // Contra data.tasks y no contra una lista en memoria: así sigue funcionando
    // tras recargar la página.
    expect(/data\.tasks[\s\S]{0,120}normalizar/.test(D),
      'compara contra una lista en memoria, que se pierde al recargar').toBe(true)
  })

  it('y lo que quitas a mano no vuelve', () => {
    expect(/rechazadas\.current\.add/.test(D),
      'quitar una propuesta no la recuerda: la siguiente relectura la resucita').toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// El diario cierra el círculo: los objetivos SON las tareas.
//
// Escribir un objetivo por línea y luego tener que aceptar una a una lo que ya
// habías escrito era trabajo repetido. Al fichar se crean; al cerrar, las que
// tachaste se completan.
// ─────────────────────────────────────────────────────────────────────────────
describe('Diario · fichar crea tareas y cerrar las completa', () => {
  const D = readFileSync('src/components/sections/DiarioSection.tsx', 'utf8')

  it('fichar la entrada crea una tarea por objetivo', () => {
    // Anclado a `fichar`, no al primer `if (campo === 'entrada')` del fichero:
    // ese está en `alEscribir` (el autoguardado) y la ventana no llegaba hasta
    // aquí, así que la regla fallaba con el código correcto delante.
    const f = D.indexOf('const fichar = async')
    expect(f, 'ya no existe fichar: revisa esta regla').toBeGreaterThan(-1)
    const cuerpo = D.slice(f, f + 2600)
    const i = cuerpo.indexOf("if (campo === 'entrada')")
    expect(i, 'fichar ya no distingue entrada de cierre').toBeGreaterThan(-1)
    const rama = cuerpo.slice(i, i + 900)
    expect(/createTask\(/.test(rama), 'fichar la entrada ya no crea las tareas').toBe(true)
    // Fichar dos veces no puede duplicar la lista.
    expect(/yaSon\.has\(/.test(rama), 'no comprueba las que ya existen: fichar dos veces duplicaría todo').toBe(true)
  })

  // Marcar un objetivo escribe en LA TAREA, no en un estado de React.
  //
  // Antes `cumplidos` era un Set en memoria: al recargar se perdía y ningún
  // compañero lo veía. Y eso no es un detalle de implementación — el diario solo
  // sirve si lo que marcas está donde lo mira todo el equipo.
  it('marcar un objetivo se guarda en la tarea, no en memoria', () => {
    expect(/useState<Set<string>>/.test(D),
      'vuelve el estado local de cumplidos: se pierde al recargar y no lo ve nadie más').toBe(false)

    const i = D.indexOf('const alternarObjetivo')
    expect(i, 'ya no existe alternarObjetivo: revisa esta regla').toBeGreaterThan(-1)
    const cuerpo = D.slice(i, i + 600)
    expect(/updateTask\([\s\S]{0,50}done: !t\.done/.test(cuerpo),
      'marcar ya no escribe en la tarea: el tachado dejaría de sincronizarse').toBe(true)
  })

  it('y lo que se pinta tachado sale de la tarea', () => {
    expect(/const estaHecho = \(o: string\) => !!tareaDe\(o\)\?\.done/.test(D),
      'el tachado se calcula de otra fuente: puede discrepar de lo que hay en Tareas').toBe(true)
  })
})

// El briefing es una vista AGREGADA del trabajo de otras personas. En una app
// donde todo lo demás es compartido a propósito, esto sí es distinto: leer el
// diario de un compañero es una cosa, y un panel de rendimiento de todos es otra.
describe('briefing del equipo · solo el propietario', () => {
  const B = readFileSync('src/app/api/diario/briefing/route.ts', 'utf8')

  it('corta con 403 a quien no es owner', () => {
    expect(/getAuthCtx\(\)/.test(B), 'no resuelve el rol en el servidor').toBe(true)
    expect(/role !== 'owner'[\s\S]{0,160}403/.test(B),
      'cualquiera con sesión puede leer el panel de rendimiento de todo el equipo').toBe(true)
  })

  it('y resuelve al usuario antes de usar el service role', () => {
    const auth = B.indexOf('auth.getUser()')
    const admin = B.indexOf('createAdminClient()')
    expect(auth).toBeGreaterThan(-1)
    expect(auth, 'usa el service role antes de comprobar la sesión').toBeLessThan(admin)
  })

  it('ningún fallo de consulta se disfraza de equipo sin actividad', () => {
    expect(/errDiario \|\| errEquipo \|\| errTareas/.test(B),
      '«nadie hizo nada» y «no se pudo leer» se verían igual').toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// La puesta en marcha: lo primero que ve cada persona del equipo.
//
// Es la pantalla con más riesgo de toda la app, porque es la única que se
// interpone entre alguien y su herramienta de trabajo. Si falla, no falla una
// sección: falla el acceso.
// ─────────────────────────────────────────────────────────────────────────────
describe('puesta en marcha · no puede dejar a nadie fuera', () => {
  const P = readFileSync('src/components/PuestaEnMarcha.tsx', 'utf8')

  it('todos los pasos se pueden saltar', () => {
    expect(/SALTAR/.test(P),
      'no hay forma de saltar: quien no pueda conectar Gmail se queda fuera de la app el primer día').toBe(true)
  })

  it('no vuelve a preguntar el tema, que ya se elige al arrancar', () => {
    // `NexusBootScreen` enseña «Elige tu versión» con las dos insignias cuando no
    // hay cookie `nx_theme` — o sea, ANTES de esta pantalla. Un paso de aspecto
    // aquí es la misma pregunta dos veces en el primer minuto, y la segunda peor
    // presentada. Se quitó a propósito; esta regla evita que vuelva sin querer.
    const B = readFileSync('src/components/NexusBootScreen.tsx', 'utf8')
    expect(/nx-boot-insignia|logo-claro\.svg/.test(B),
      'el arranque ya no elige tema: entonces este paso SÍ hace falta y hay que reponerlo').toBe(true)
    expect(/theme-light|onTema/.test(P),
      'la puesta en marcha vuelve a preguntar el tema, que el arranque ya preguntó').toBe(false)
  })

  it('el instalador no se escucha desde el componente, que llega tarde', () => {
    // `beforeinstallprompt` se emite UNA vez y puede llegar antes de que monte
    // esta pantalla (en visita repetida el service worker ya está registrado).
    // Un `addEventListener` dentro del componente se lo pierde y el botón no sale
    // nunca en Chrome — el caso normal, no el raro.
    expect(/addEventListener\(\s*['"]beforeinstallprompt/.test(P),
      'escucha el evento desde el componente: si llegó antes de montar, se pierde').toBe(false)
    expect(/promptGuardado\(\)/.test(P),
      'no consulta el prompt ya guardado al montar').toBe(true)
    // Que el oyente del módulo se enganche a tiempo NO se comprueba aquí por
    // forma: lo hace por conducta `instalarPwa.test.ts`, disparando el evento sin
    // suscriptores. Una regla de texto sobre «está dentro de una función» casaba
    // con la propia flecha del oyente y pasaba en verde con el fallo puesto.
  })

  it('el paso de instalar cubre a Safari, que no da instalador', () => {
    // Chrome ofrece `beforeinstallprompt` y ahí basta un botón. Safari no lo
    // implementa NI en iPhone NI en Mac: si solo hubiera botón, media plantilla
    // se queda sin instalar la app y sin saber por qué.
    const i = P.indexOf('ACCESO DIRECTO')
    expect(i, 'ya no existe el paso de instalar: revisa esta regla').toBeGreaterThan(-1)
    const paso = P.slice(i, P.indexOf('{paso === 4', i))
    for (const [caso, pista] of [['ios', 'pantalla de inicio'], ['safari-mac', 'Dock']] as const) {
      expect(paso.includes(caso), `el paso de instalar no contempla «${caso}»`).toBe(true)
      expect(paso.includes(pista),
        `«${caso}» no tiene instrucciones propias: sin instalador y sin pasos, no hay salida`).toBe(true)
    }
  })

  it('un fallo al guardar no bloquea la entrada', () => {
    const i = P.indexOf('const terminar')
    expect(i, 'ya no existe terminar: revisa esta regla').toBeGreaterThan(-1)
    // Hasta el cierre de la función, no una ventana a ojo.
    const cuerpo = P.slice(i, P.indexOf('}, [onTerminar, showToast])', i))
    // El catch de la PETICIÓN, y hace falta puntería: el `try {…} catch {}` VACÍO
    // de localStorage va justo antes, y como cadena `'} catch {'` casa también con
    // él. Anclando ahí la ventana empezaba en el catch vacío y seguía viendo el
    // `onTerminar()` de la línea siguiente, así que la regla pasaba con el bug
    // puesto. Se exige un salto de línea detrás, que es lo que solo tiene el real.
    const m = /\}\s*catch\s*\{\s*\n/.exec(cuerpo)
    expect(m, 'no se encontró el catch de la petición').not.toBeNull()
    const enCatch = cuerpo.slice(m!.index)
    expect(/onTerminar\(\)/.test(enCatch),
      'si falla el guardado no se entra: la bienvenida se convierte en un muro').toBe(true)
  })

  it('el paso se recuerda para volver de Google', () => {
    // Conectar Gmail sale de la app (OAuth). Sin guardar el paso, al volver se
    // empieza de cero y hay que repetirlo todo.
    expect(/localStorage\.setItem\(CLAVE_PASO/.test(P), 'no se recuerda el paso al ir a Google').toBe(true)
  })

  it('la marca es de la persona, no del aparato', () => {
    const M = readFileSync('src/app/api/me/route.ts', 'utf8')
    expect(/onboarding_at/.test(M),
      '/api/me no devuelve onboarding_at: la bienvenida se enseñaría siempre o nunca').toBe(true)
    const R = readFileSync('src/app/api/onboarding/route.ts', 'utf8')
    expect(/eq\('id', user\.id\)/.test(R), 'se marca una fila que no sale de la sesión').toBe(true)
  })
})
