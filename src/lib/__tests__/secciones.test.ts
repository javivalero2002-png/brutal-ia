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
    expect(/setTimeout\([\s\S]{0,120}vaciarPendiente\(\)/.test(D), 'guarda en cada tecla, sin retardo').toBe(true)

    // TODO lo pendiente se manda junto, no solo el campo que armó el temporizador.
    // Los dos campos comparten temporizador: mandando uno solo, escribir el
    // balance justo después de un objetivo cancelaba el guardado del objetivo.
    const iV = D.indexOf('const vaciarPendiente')
    expect(iV, 'ya no existe vaciarPendiente: revisa esta regla').toBeGreaterThan(-1)
    const cuerpoV = D.slice(iV, D.indexOf('\n  }, [', iV))
    expect(/entrada !== undefined \? \{ entrada \}/.test(cuerpoV) && /cierre !== undefined \? \{ cierre \}/.test(cuerpoV),
      'solo se manda uno de los dos campos: escribir el balance cancelaría el guardado de los objetivos').toBe(true)

    // Y al CAMBIAR DE DÍA se vacía antes, con el día viejo. Tirarlo era perder lo
    // recién tecleado si el retardo aún no había saltado.
    const iD = D.indexOf('}, [dia])')
    const efectoDia = D.slice(Math.max(0, iD - 700), iD)
    expect(/vaciarPendiente\(\)/.test(efectoDia),
      'al cambiar de día se tira lo pendiente en vez de mandarlo: se pierde lo que acabas de escribir').toBe(true)
    // El temporizador se anula al dispararse. Sin esto queda «pendiente» para
    // siempre y el guardado de salida reenvía lo que ya estaba escrito — que es
    // justo por donde se colaba el borrado del día.
    // El temporizador lo limpia `vaciarPendiente`, que es quien manda. Antes esa
    // limpieza estaba en el cuerpo del setTimeout y por ahí se coló el fallo: al
    // anularlo, el guardado de salida —que hasta entonces corría SIEMPRE— dejó de
    // correr, y con él la red que tapaba que solo se mandara un campo.
    const iV2 = D.indexOf('const vaciarPendiente')
    const cuerpoV2 = D.slice(iV2, D.indexOf('\n  }, [', iV2))
    expect(/clearTimeout\(guardadoTimer\.current\)[\s\S]{0,60}guardadoTimer\.current = null/.test(cuerpoV2),
      'vaciarPendiente no anula el temporizador: lo pendiente se mandaría dos veces').toBe(true)
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
        // El MISMO criterio que el botón, no otro. Con dos criterios distintos —el
    // botón por el vínculo, `fichar` por el texto— el botón decía «CREA 0 TAREAS»
    // y creaba una duplicada en cuanto alguien había retocado el texto.
    const iF = D.indexOf('const fichar = async')
    expect(iF, 'ya no existe fichar: revisa esta regla').toBeGreaterThan(-1)
    const cuerpoF = D.slice(iF, D.indexOf('\n  const ', iF + 10))
    expect(/filter\(o => !tareaDe\(o\)\)/.test(cuerpoF),
      'fichar empareja con un criterio distinto al del botón: prometería «CREA 0» y duplicaría').toBe(true)
    // Y contra el conjunto ACOTADO, no contra `data.tasks` entero.
    //
    // Esta regla decía antes lo contrario —exigía comparar contra `data.tasks`—
    // y con eso en verde convivían tres fallos: si otra persona tenía tu mismo
    // texto no se creaba tu tarea y tu casilla marcaba la suya; un objetivo
    // recurrente salía tachado antes de empezar; y destacharlo borraba el
    // completado del día en que se hizo de verdad. La regla protegía el bug.
    // Sobre el CUERPO de `misTareasDelDia`, no sobre una ventana de caracteres:
    // la forma de la comprobación cambió (de `=== profile?.id` a una guarda con
    // `!==`) y una regla atada a la forma se rompe sin que el invariante falle.
    const iM = D.indexOf('const misTareasDelDia')
    expect(iM, 'ya no existe misTareasDelDia: revisa esta regla').toBeGreaterThan(-1)
    const cuerpoM = D.slice(iM, D.indexOf('\n  })', iM))
    expect(/profile\?\.id/.test(cuerpoM),
      'el conjunto contra el que se empareja no se acota a mis tareas: el objetivo de uno se tacharía con el trabajo de otro').toBe(true)
    expect(/=== dia/.test(cuerpoM),
      'el conjunto no se acota al día: un objetivo recurrente casaría con la tarea de otro día').toBe(true)
    expect(/data\.tasks[\s\S]{0,120}normalizar\(t\.text/.test(D),
      'vuelve a emparejar contra las tareas de todo el equipo desde siempre').toBe(false)
  })

  it('el pasado es de solo lectura, el futuro se planifica', () => {
    // /api/tasks sella `completed_at` con el instante ACTUAL, así que crear una
    // tarea ya hecha mientras repasas el jueves apunta ese trabajo al viernes.
    //
    // Pero la guarda tiene que ser `esPasado`, NO `!esHoy`: con `!esHoy` se cerró
    // también el FUTURO, que es justo para lo que existe el calendario de esta
    // sección — planificar la semana. Un arreglo que se pasa de frenada.
    for (const fn of ['const fichar = async', 'const crearTodas']) {
      const i = D.indexOf(fn)
      expect(i, `ya no existe ${fn}: revisa esta regla`).toBeGreaterThan(-1)
      const cabeza = D.slice(i, i + 460)
      expect(/if \(esPasado\)/.test(cabeza),
        `${fn} no cierra el pasado: repasar un día pasado lo reescribiría`).toBe(true)
      expect(/if \(!esHoy\)/.test(cabeza),
        `${fn} cierra también el futuro: no se podría planificar la semana`).toBe(false)
    }
    // Y en un día futuro nada nace ya hecho: aún no ha pasado.
    expect(/done: esFuturo \? false/.test(D),
      'planificar el jueves crearía tareas ya completadas').toBe(true)
  })

  it('el vínculo con la tarea sobrevive a que cambie el texto', () => {
    // Emparejar por texto tiene un caso que ningún filtro arregla: `text` es
    // editable desde la sección Tareas. En cuanto alguien lo retoca, el objetivo
    // deja de encontrar su tarea, la burbuja sale sin tachar aunque esté hecha, y
    // al tocarla se crea una SEGUNDA tarea con el texto viejo. Dos tareas para un
    // trabajo, dos completadas en Reportes.
    expect(/diario_objetivo/.test(D),
      'el Diario vuelve a emparejar solo por texto: retocar el texto de la tarea duplicaría el trabajo').toBe(true)

    // Y se ESCRIBE al crear, no solo se lee: sin esto el vínculo nace vacío y
    // todo sigue cayendo al respaldo por texto sin que nada falle.
    const creaciones = [...D.matchAll(/createTask\(\{[^}]*\}/g)].map(m => m[0])
    expect(creaciones.length, 'ya no se crean tareas desde el Diario: revisa esta regla').toBeGreaterThan(0)
    const sinVinculo = creaciones.filter(c => !/diario_dia:/.test(c) || !/diario_objetivo:/.test(c))
    expect(sinVinculo,
      'alguna creación no guarda de qué línea de diario nació: esa tarea solo podrá emparejarse por texto').toEqual([])
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
    expect(/!tareaDe\(o\)/.test(rama),
      'fichar no comprueba las que ya existen con el mismo criterio que el botón: prometería «CREA 0» y duplicaría').toBe(true)
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

  it('cada navegador tiene su propio camino para instalar', () => {
    // Chrome ofrece `beforeinstallprompt` y ahí basta un botón. Safari NO lo
    // implementa y no lo va a implementar (WebKit lo cerró como WONTFIX), así que
    // ahí las instrucciones son lo único que hay.
    //
    // Y no basta con "tener instrucciones": el fallo real fue meter TODO iOS en
    // una rama con los pasos de Safari. En iPhone el botón está en sitios
    // distintos —Safari en la barra, Chrome en su menú de tres puntos— así que
    // media plantilla habría estado buscando un botón que no está donde se le
    // dice. Por eso se exige que los dos caminos de iOS sean DISTINTOS entre sí.
    const m = /const CAMINOS[^=]*=\s*\{([\s\S]*?)\n\}/.exec(P)
    expect(m, 'ya no existe CAMINOS: revisa esta regla').not.toBeNull()

    const trozo = (clave: string) => {
      const a = m![1].indexOf(`'${clave}':`) >= 0 ? m![1].indexOf(`'${clave}':`) : m![1].indexOf(`${clave}: {`)
      expect(a, `no hay camino para «${clave}»`).toBeGreaterThan(-1)
      const resto = m![1].slice(a)
      const fin = resto.indexOf('],')
      return resto.slice(0, fin > -1 ? fin : resto.length)
    }

    const iosSafari = trozo('ios-safari')
    const iosOtro = trozo('ios-otro')
    const mac = trozo('safari-mac')

    expect(mac.includes('Dock'),
      'Safari del Mac no instala desde el menú del navegador: es Archivo → Añadir al Dock').toBe(true)
    expect(iosSafari.includes('share'),
      'el camino de Safari en iPhone no dibuja el icono de Compartir, que es el que hay que reconocer').toBe(true)

    // Los pasos, sin lo que los rodea. Si los dos caminos de iOS dicen lo mismo,
    // es que se ha vuelto a lumpar todo iPhone en uno.
    const pasos = (t: string) => t.replace(/\s+/g, ' ').replace(/'ios-[a-z]+':|donde:[^,]*,/g, '').trim()
    expect(pasos(iosSafari),
      'Safari y Chrome en iPhone tienen las MISMAS instrucciones: el botón no está en el mismo sitio en los dos')
      .not.toBe(pasos(iosOtro))
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

  it('se puede volver a ver, o nadie podría comprobar qué ve el equipo', () => {
    // `onboarding_at` es de una sola vez: en cuanto se marca, la pantalla no
    // vuelve. Sin una puerta para reabrirla, quien se saltó un paso no puede
    // rehacerlo, y el dueño no puede ver qué se va a encontrar su equipo antes de
    // darles acceso — que es justo lo que hacía falta el día del despliegue.
    const A = readFileSync('src/components/sections/AjustesSection.tsx', 'utf8')
    expect(/onClick=\{onVerPuestaEnMarcha\}/.test(A),
      'Operativa ya no tiene el botón para volver a ver la puesta en marcha').toBe(true)

    const N = readFileSync('src/components/NexusDashboard.tsx', 'utf8')
    const m = /onVerPuestaEnMarcha=\{([^}]*\}[^}]*)\}/.exec(N)
    expect(m, 'el dashboard no cablea onVerPuestaEnMarcha').not.toBeNull()
    // Las DOS cosas, y por separado: reabrirla sin olvidar el paso guardado te
    // deja donde lo dejaste la última vez en vez de al principio, que para
    // «ver qué verá el equipo» no sirve de nada.
    expect(/setPuestaHecha\(false\)/.test(m![1]),
      'el botón no reabre el recorrido').toBe(true)
    expect(/olvidarPasoGuardado\(\)/.test(m![1]),
      'reabre sin olvidar el paso guardado: aparecería a mitad del recorrido').toBe(true)
  })

  it('la marca es de la persona, no del aparato', () => {
    const M = readFileSync('src/app/api/me/route.ts', 'utf8')
    expect(/onboarding_at/.test(M),
      '/api/me no devuelve onboarding_at: la bienvenida se enseñaría siempre o nunca').toBe(true)
    const R = readFileSync('src/app/api/onboarding/route.ts', 'utf8')
    expect(/eq\('id', user\.id\)/.test(R), 'se marca una fila que no sale de la sesión').toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Los objetivos del Diario: lo que se ve es lo que estás escribiendo.
//
// Dos fallos distintos que producían la misma sensación —«esto no responde»— y
// que la lista por filas no arregla sola:
//
//  · `objetivosDeHoy` salía de `miEntrada?.entrada || objetivos`, o sea que en
//    cuanto fichabas ganaba lo GUARDADO: añadías un objetivo y no aparecía en
//    «¿lo completé?» hasta recargar. La sección se contradecía a sí misma.
//  · Antes había un <textarea> cuya existencia dependía de su propio contenido,
//    así que se desmontaba al teclear la primera letra. Ahora son filas
//    independientes y ese fallo no puede volver por esa vía — pero sí volvería
//    si alguien reintrodujera una condición sobre el contenido.
// ─────────────────────────────────────────────────────────────────────────────
describe('diario · los objetivos responden al escribirlos', () => {
  const D = readFileSync('src/components/sections/DiarioSection.tsx', 'utf8')

  it('lo que se pinta sale del valor vivo, no del último guardado', () => {
    const i = D.indexOf('const objetivosDeHoy')
    expect(i, 'ya no existe objetivosDeHoy: revisa esta regla').toBeGreaterThan(-1)
    const linea = D.slice(i, D.indexOf('\n', i))
    expect(/miEntrada\?\.entrada \|\| objetivos/.test(linea),
      'lo guardado vuelve a ganar sobre lo que estás escribiendo: un objetivo nuevo no aparecería hasta recargar').toBe(false)
    expect(/sembrado\.current \? objetivos/.test(linea),
      'no se prefiere el valor vivo').toBe(true)
  })

  it('cada objetivo es una fila propia, no un párrafo', () => {
    expect(/filas\.map\(/.test(D),
      'los objetivos vuelven a ser texto corrido: no se puede quitar el tercero sin seleccionar su línea a mano').toBe(true)
    // Toda mutación pasa por `cambiarFilas`, que es quien ADEMÁS guarda. Escribir
    // un `setFilas` suelto cambiaría la lista en pantalla sin guardarla.
    const sueltos = (D.match(/setFilas\(/g) || []).length
    expect(sueltos,
      'hay setFilas fuera de cambiarFilas/siembra: esa fila se vería pero no se guardaría').toBeLessThanOrEqual(3)
    const iC = D.indexOf('const cambiarFilas')
    expect(iC, 'ya no existe cambiarFilas: revisa esta regla').toBeGreaterThan(-1)
    expect(/alEscribir\('entrada'/.test(D.slice(iC, D.indexOf('\n  }', iC))),
      'cambiar la lista no guarda: lo escrito se perdería al salir').toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Harvey tiene que acordarse de lo que se acaba de decir.
//
// El caso real: le pides una tarea, él pregunta de qué va, respondes «urgente,
// editar vídeos» — y le llega esa frase suelta, sin la pregunta que la provocó.
// Vuelve a preguntar lo mismo y la tarea no se crea nunca.
//
// La causa NO era el prompt ni el servidor, que ya recibía y saneaba el
// historial: era que dos de los cinco llamantes del cliente —el de VOZ y el
// precargado— no pasaban historial y caían al `conversation` de la clausura,
// que va un turno por detrás. Medido contra el modelo real: sin historial la
// tarea se crea 1 de cada 3 veces; con historial, 3 de 3.
//
// La regla no comprueba que la voz lo haga bien: comprueba que NADIE pueda
// volver a saltárselo, que es lo que hace que no vuelva a pasar.
// ─────────────────────────────────────────────────────────────────────────────
describe('harvey · no pierde el hilo de la conversación', () => {
  // Sin comentarios: este fichero explica sus decisiones, y un comentario que
  // mencione `askHarvey(` haría que la regla lo contara como un llamante.
  const H = readFileSync('src/components/sections/HarveySection.tsx', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

  it('solo `preguntar` habla con Harvey', () => {
    // Se cuentan las LLAMADAS, no la declaración (que es `const askHarvey =`).
    // Tiene que haber exactamente una, y dentro de `preguntar`: cualquier otra es
    // un llamante saltándose el único sitio que compone el historial.
    const llamadas = [...H.matchAll(/askHarvey\(/g)].map(m => m.index!)
    expect(llamadas.length,
      'alguien llama a askHarvey() por su cuenta: ese camino manda el historial atrasado y Harvey pierde el hilo')
      .toBe(1)

    const ini = H.indexOf('const preguntar')
    const fin = H.indexOf('\n  }', ini)
    expect(ini, 'ya no existe `preguntar`: revisa esta regla').toBeGreaterThan(-1)
    expect(llamadas[0] > ini && llamadas[0] < fin,
      'la llamada a askHarvey() está fuera de `preguntar`').toBe(true)
  })

  it('el historial sale del espejo, no del estado', () => {
    expect(/historial \?\? conversationRef\.current/.test(H),
      'el respaldo vuelve a leer `conversation`, que va un turno por detrás cuando lo lee el mismo manejador que acaba de cambiarlo').toBe(true)
    expect(/conversationRef\.current = nuevo/.test(H),
      '`preguntar` no actualiza el espejo a mano: el turno recién añadido no llegaría a la misma llamada').toBe(true)
  })

  it('el mensaje actual no viaja también en el historial', () => {
    const i = H.indexOf('const preguntar')
    expect(i, 'ya no existe `preguntar`: revisa esta regla').toBeGreaterThan(-1)
    const cuerpo = H.slice(i, H.indexOf('\n  }', i))
    expect(/askHarvey\(texto, previos\)/.test(cuerpo),
      'manda `nuevo` en vez de `previos`: el servidor ya añade el mensaje actual, así que iría duplicado').toBe(true)
  })

})

// ─────────────────────────────────────────────────────────────────────────────
// El arranque de semana: el DATO antes que la IA.
//
// HOY y SEMANA miran hacia atrás y se piden al servidor. ARRANQUE mira hacia
// adelante y se compone de lo que YA está cargado — `data.tasks` y
// `data.calendarEvents` — así que no cuesta una ruta, ni una llamada al modelo,
// ni un céntimo. La lectura de Harvey es un botón encima, no el mecanismo.
//
// Si algún día esto pasara a pedirle el resumen a la IA para PODER pintarlo, un
// lunes con la API caída dejaría al equipo sin su parte. El dato tiene que estar
// aunque la IA no conteste.
// ─────────────────────────────────────────────────────────────────────────────
describe('diario · el arranque de semana no depende de la IA', () => {
  const D = readFileSync('src/components/sections/DiarioSection.tsx', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

  it('se compone de lo que ya está cargado, sin pedir nada', () => {
    const i = D.indexOf('const arranque = useMemo')
    expect(i, 'ya no existe `arranque`: revisa esta regla').toBeGreaterThan(-1)
    const cuerpo = D.slice(i, D.indexOf('\n  }, [', i))
    expect(/data\.tasks/.test(cuerpo) && /data\.calendarEvents/.test(cuerpo),
      'el arranque ya no sale de los datos cargados').toBe(true)
    expect(/fetch\(/.test(cuerpo),
      'el arranque pide algo al servidor: era gratis y ahora cuesta una ruta').toBe(false)
  })

  it('la lectura de Harvey es opcional, no el mecanismo', () => {
    // `onAskHarvey` va con `?`: sin él la sección sigue enseñando el arranque.
    expect(/onAskHarvey\?:/.test(D),
      'onAskHarvey dejó de ser opcional: sin él la sección no podría pintar el arranque').toBe(true)
    expect(/\{onAskHarvey && \(/.test(D),
      'el botón no está guardado: sin la prop reventaría en vez de omitirse').toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Todo objetivo escrito acaba siendo una tarea. También los tardíos.
//
// Las tareas se creaban SOLO al fichar, y ese botón desaparece en cuanto fichas.
// Un objetivo escrito después se quedaba como texto en el diario: no salía en la
// carga de nadie, no contaba en Reportes, y al día siguiente no aparecía en
// «vienen de antes» —que lee TAREAS—, así que desaparecía sin más. Javi lo vio
// con «Prueba top»: la escribió, no la cerró, y al día siguiente no estaba.
//
// El único camino que quedaba era tacharla, y entonces nacía ya COMPLETADA: solo
// se podía registrar lo que sí hiciste, justo al revés de para lo que sirve.
// ─────────────────────────────────────────────────────────────────────────────
describe('diario · un objetivo escrito después de fichar también es una tarea', () => {
  const D = readFileSync('src/components/sections/DiarioSection.tsx', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

  it('salir de la fila crea su tarea', () => {
    const i = D.indexOf('const crearTareaDe')
    expect(i, 'ya no existe crearTareaDe: revisa esta regla').toBeGreaterThan(-1)
    const cuerpo = D.slice(i, D.indexOf('\n  }', i))
    // Pendiente, no completada: el objetivo se escribe ANTES de hacerlo.
    expect(/done: false/.test(cuerpo),
      'la tarea del objetivo nace ya completada: solo se podría registrar lo que ya hiciste').toBe(true)
    // Y con el vínculo, o no emparejaría con su objetivo.
    expect(/diario_dia: dia/.test(cuerpo) && /diario_objetivo: o/.test(cuerpo),
      'la tarea nace sin vínculo: no emparejaría con su objetivo ni podría arrastrarse').toBe(true)

    // Cableada al SALIR de la fila, no al teclear: con el retardo del autoguardado
    // se crearía una tarea «Prue» a mitad de escribir y el vínculo se quedaría así.
    const iF = D.indexOf('value={fila}')
    expect(iF, 'ya no existe la fila de objetivo: revisa esta regla').toBeGreaterThan(-1)
    expect(/onBlur=\{\(\) => crearTareaDe\(fila\)\}/.test(D.slice(iF, D.indexOf('/>', iF))),
      'la fila no crea su tarea al salir: un objetivo escrito tras fichar no llegaría nunca a Tareas').toBe(true)
  })

  it('no crea nada en un día pasado ni antes de fichar', () => {
    const i = D.indexOf('const crearTareaDe')
    const guarda = D.slice(i, i + 420)
    expect(/esPasado/.test(guarda),
      'crearía tareas al repasar un día pasado, y se apuntarían a hoy').toBe(true)
    expect(/miEntrada\?\.entrada_at/.test(guarda),
      'crea antes de fichar: el botón FICHAR las crea todas de golpe y prometería lo que ya está').toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Crear una tarea en Tareas también es marcar tu día.
//
// Escribir un objetivo en el Diario y crear una tarea en Tareas son dos formas de
// decir lo mismo —esto es de mi día—, pero el Diario solo miraba la primera: si
// te organizabas desde Tareas, tu día salía vacío y el anillo decía «0 de 2»
// ignorando lo que sí habías cerrado. Dos modalidades que no se hablaban.
// ─────────────────────────────────────────────────────────────────────────────
describe('diario · el día cuenta también lo creado desde Tareas', () => {
  const D = readFileSync('src/components/sections/DiarioSection.tsx', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

  it('el anillo mide el día entero, no solo los objetivos', () => {
    expect(/const totalDelDia = objetivosDeHoy\.length \+ otrasDelDia\.length/.test(D),
      'el anillo vuelve a contar solo objetivos: un día trabajado desde Tareas marcaría 0 %').toBe(true)
    expect(/const hechasDelDia/.test(D), 'no cuenta las hechas del día entero').toBe(true)
  })

  it('van aparte y etiquetadas, no mezcladas con los objetivos', () => {
    // Fundirlas borraría la distancia entre lo que uno se PROPUSO y lo que fue
    // apareciendo, que es justo lo que el Diario existe para enseñar.
    const i = D.indexOf('const otrasDelDia')
    expect(i, 'ya no existe otrasDelDia: revisa esta regla').toBeGreaterThan(-1)
    const cuerpo = D.slice(i, D.indexOf('\n\n', i))
    expect(/!objetivosDeHoy\.some/.test(cuerpo),
      'no excluye las que ya son objetivo: cada objetivo se contaría dos veces').toBe(true)
    expect(/TAMBIÉN HOY/.test(D),
      'las tareas del día se mezclan con los objetivos sin distinguirlas').toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Las fuentes de Harvey se OFRECEN, no se dicen.
//
// Javi lo pidió expresamente: «no quiero que lo diga, como mucho un botón de
// revisar fuentes». Y tiene razón técnica además de de gusto — esto se reproduce
// EN VOZ ALTA, así que citar notas convertiría cada respuesta en una bibliografía
// leída. El botón deja comprobar de dónde salió a quien dude, sin estorbar a
// quien no.
// ─────────────────────────────────────────────────────────────────────────────
describe('harvey · las fuentes son un botón, no parte de la respuesta', () => {
  const H = readFileSync('src/components/sections/HarveySection.tsx', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

  it('se guardan con el turno y se pintan aparte', () => {
    expect(/fuentes:fuentesRef\.current/.test(H),
      'el turno no guarda de qué notas salió: no se podrían revisar después').toBe(true)
    expect(/REVISAR FUENTES/.test(H), 'ya no hay botón de fuentes').toBe(true)
  })

  it('el prompt NO le pide que las cite', () => {
    // Si se le pidiera en el system prompt, las diría en voz alta — que es
    // exactamente lo que se descartó.
    const R = readFileSync('src/app/api/harvey/chat/route.ts', 'utf8')
    expect(/cita (la|las) fuente|di de qué nota|menciona la nota/i.test(R),
      'se le pide a Harvey que cite las fuentes: las leería en voz alta').toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// La racha del diario: personal, y sin morir cada sábado.
//
// Dos decisiones que la hacen útil en vez de decorativa:
//
//  · Es MÍA, no una tabla comparativa en Equipo. En un estudio de siete personas
//    que se conocen, un contador público de rachas convierte una herramienta de
//    hábito en un marcador, y romperla pasa a ser un fracaso delante de los demás.
//    La señal que necesita un jefe —quién no lo usa— ya está en Reportes.
//  · Los fines de semana se SALTAN. Aquí se trabaja de lunes a viernes: una racha
//    que muere cada sábado no mide nada y desmotiva en vez de motivar.
// ─────────────────────────────────────────────────────────────────────────────
describe('diario · la racha es personal y salta los fines de semana', () => {
  const S = readFileSync('src/components/shared/SemanaDiario.tsx', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

  it('salta sábados y domingos en vez de romper', () => {
    const i = S.indexOf('const racha = useMemo')
    expect(i, 'ya no existe la racha: revisa esta regla').toBeGreaterThan(-1)
    const cuerpo = S.slice(i, S.indexOf('\n  }, [', i))
    // 0 = domingo, 6 = sábado. `continue`, no `break`: saltar, no cortar.
    expect(/d === 0 \|\| d === 6[\s\S]{0,80}continue/.test(cuerpo),
      'el fin de semana rompe la racha: moriría cada sábado y no mediría nada').toBe(true)
  })

  it('es de una persona, no un ranking del equipo', () => {
    expect(/p\.id === miId/.test(S),
      'la racha dejó de ser personal: un marcador público convierte el hábito en competición').toBe(true)
    // Y no se pinta en Equipo, que es donde sería comparativa.
    //
    // SIN COMENTARIOS, o la regla miente: «seguidos» aparece en un comentario de
    // esa sección («TRES viajes a Supabase seguidos») y la daba por infringida.
    // Es la trampa que CLAUDE.md tiene escrita — una regla que un comentario
    // puede satisfacer, o romper, no comprueba código: comprueba prosa.
    const E = readFileSync('src/components/sections/EquipoSection.tsx', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    expect(/racha|SEGUIDOS/i.test(E),
      'la racha aparece en Equipo: ahí es una tabla comparativa, que es justo lo que se descartó').toBe(false)
  })
})
