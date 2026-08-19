import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// ─────────────────────────────────────────────────────────────────────────────
// Reglas estructurales de las rutas API.
//
// Las 58 rutas no tenían NINGÚN test, y son la barrera de seguridad de verdad:
// RLS es defensa en profundidad, pero quien decide qué puede hacer cada persona
// es el código de estas rutas.
//
// Estos tests no comprueban qué devuelve cada ruta —eso serían 58 tests que
// envejecen mal y no cubren la 59—: comprueban las REGLAS del proyecto sobre
// TODAS las rutas, incluidas las que se escriban mañana. Una ruta nueva que se
// salte una regla pone el build en rojo sin que nadie tenga que acordarse.
//
// Cada excepción va en una lista con su motivo escrito. Si algún día sobra, se
// nota: el test avisa de las entradas de la lista que ya no existen.
// ─────────────────────────────────────────────────────────────────────────────

const RAIZ = 'src/app/api'

function rutas(dir = RAIZ, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) rutas(p, out)
    else if (e === 'route.ts') out.push(p)
  }
  return out
}

const TODAS = rutas()
/**
 * El fichero SIN comentarios.
 *
 * Este fichero leía el texto crudo mientras `regresiones.test.ts` ya quitaba los
 * comentarios, y eso abre el agujero en las dos direcciones: un comentario puede
 * SATISFACER una regla —que es el fallo grave, porque tapa código que no
 * cumple— y también puede DISPARARLA en falso. Lo segundo pasó de verdad: un
 * comentario que explicaba por qué NO se corta un ISO por posición hizo saltar la
 * regla que prohíbe cortarlo.
 *
 * En un repo que comenta tanto como este, una regla que mira la prosa no mira el
 * código.
 */
const leer = (f: string) =>
  readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const nombre = (f: string) => f.replace(`${RAIZ}/`, '').replace('/route.ts', '')

// ── Excepciones, cada una con su motivo ──────────────────────────────────────

/** No resuelven usuario porque su barrera es otra, no porque se olvidara. */
const SIN_SESION: Record<string, string> = {
  'cron/sync-colabs': 'la ejecuta Vercel, no una persona: se autentica con CRON_SECRET',
  'cron/backup': 'la ejecuta Vercel, no una persona: se autentica con CRON_SECRET',
  'whatsapp': 'webhook entrante: valida la firma del proveedor, no una sesión',
  'review/[token]': 'página pública de revisión para clientes: el token ES la credencial',
  'auth/callback': 'canjea el código OAuth; todavía no hay sesión que resolver',
  'agenda/[id]/upload-video': 'devuelve 400 siempre — la subida de vídeos está desactivada',
}

describe('rutas API · toda ruta que use el service role resuelve antes al usuario', () => {
  // createAdminClient se salta RLS por completo. Usarlo sin haber resuelto quién
  // llama deja la tabla entera expuesta a cualquiera que sepa la URL. Ya pasó.
  it.each(TODAS.map(f => [nombre(f), f]))('%s', (_n, f) => {
    const s = leer(f)
    const usaAdmin = /createAdminClient|ctx\.admin/.test(s)
    if (!usaAdmin) return

    const resuelveUsuario = /getAuthCtx|requireOwner|auth\.getUser\(/.test(s)
    if (resuelveUsuario) return

    const motivo = SIN_SESION[nombre(f)]
    expect(motivo, `${nombre(f)} usa el service role sin resolver al usuario y no está en la lista de excepciones`).toBeTruthy()
  })
})

describe('rutas API · nadie puede ascenderse a owner', () => {
  // profiles.role es la ÚNICA señal de autorización del servidor. Si una ruta
  // deja que el rol llegue en el cuerpo de la petición, cualquiera se hace owner.
  const escribenProfiles = TODAS.filter(f => /from\('profiles'\)[\s\S]{0,120}(update|insert|upsert)\(/.test(leer(f)))

  it('hay rutas que escriben en profiles (si no, este test no protege nada)', () => {
    expect(escribenProfiles.length).toBeGreaterThan(0)
  })

  it.each(escribenProfiles.map(f => [nombre(f), f]))('%s no mete `role` sin comprobar quién llama', (_n, f) => {
    // Las listas de columnas de un .select() se quitan antes de mirar: un select no
    // escribe nada, y nombrar `role` ahi es lo normal. Sin esto, poner una allowlist
    // explicita —que es justo lo que se quiere— disparaba este test.
    const s = leer(f).replace(/\.select\(['"][^'"]*['"]\)/g, '.select()')
    const tocaRole = /\brole\b\s*[,:]/.test(s)
    if (!tocaRole) return
    // Si toca el rol, la ruta tiene que exigir owner. admin/team lo hace con
    // requireOwner; cualquier otra que aparezca tendrá que hacer lo propio.
    expect(/requireOwner|role\s*!==\s*'owner'|ctx\.role\s*===\s*'owner'/.test(s),
      `${nombre(f)} escribe en profiles tocando 'role' sin exigir owner`).toBe(true)
  })
})

describe('rutas API · el cuerpo de la petición nunca se vuelca entero en la base', () => {
  // Volcar el body permite escribir columnas que el cliente no debería tocar
  // (created_by, role, id). O se filtra con pick(), o se construye campo a campo.
  it.each(TODAS.map(f => [nombre(f), f]))('%s', (_n, f) => {
    const s = leer(f)
    const vuelca = /\.(insert|update|upsert)\(\s*\{\s*\.\.\.\s*body\s*[,}]/.test(s)
      || /\.(insert|update|upsert)\(\s*body\s*\)/.test(s)
    expect(vuelca, `${nombre(f)} escribe el body sin filtrar: usa pick() o construye el objeto campo a campo`).toBe(false)
  })
})

describe('rutas API · las fechas de negocio son de Madrid', () => {
  // Cortar los 10 primeros caracteres de un ISO da el día UTC, no el de Madrid.
  //
  // La primera versión de esta regla solo buscaba el literal exacto
  // `new Date().toISOString().slice(0,10)` y se le escapó
  // `(email.received_at || new Date().toISOString()).slice(0,10)` en el sync de
  // Gmail, que creaba las tareas de reunión con la fecha de AYER —vencidas de
  // nacimiento— para cualquier correo llegado entre las 00:00 y las 02:00. Así
  // que la regla mira el .slice(0,10), venga de donde venga.
  //
  // Un slice anclado a medianoche UTC a propósito (`...T00:00:00Z`) sí es
  // correcto y queda exento: ahí el corte es exacto por construcción.
  const CORTE = /\.slice\(\s*0\s*,\s*10\s*\)/g

  it.each(TODAS.map(f => [nombre(f), f]))('%s', (_n, f) => {
    const s = leer(f)
    for (const m of s.matchAll(CORTE)) {
      const contexto = s.slice(Math.max(0, m.index! - 160), m.index!)
      const anclado = /T00:00:00Z|dayKeyToUTC/.test(contexto)
      expect(anclado,
        `${nombre(f)} corta un ISO para sacar un día (.slice(0,10)) sin anclarlo a medianoche UTC: usa todayKey() o localDayKey()`).toBe(true)
    }
  })
})

describe('UI vs API · lo que se ofrece es lo que se permite', () => {
  // El fallo que esto vigila ya ha pasado DOS veces:
  //   · "Guardar perfil" en Ajustes iba a /api/admin/team (owner-only), así que
  //     los 6 miembros veían "Error actualizando perfil" al cambiar su propio
  //     nombre
  //   · el menú rápido del móvil ofrecía crear una REGLA a cualquiera, con un
  //     comentario al lado afirmando que la API ya no exigía owner. Sí lo exigía:
  //     rellenabas el formulario entero y al guardar salía "Forbidden"
  //
  // La regla: si POST /api/reglas exige owner, ningún sitio de la UI puede
  // ofrecer crear reglas sin comprobar isOwner. Se verifica el par concreto
  // porque es el que se rompió; comprobar "toda la UI contra toda la API" en
  // texto plano daría falsos positivos sin fin.
  const rutaReglas = readFileSync('src/app/api/reglas/route.ts', 'utf8')
  const dashboard = readFileSync('src/components/NexusDashboard.tsx', 'utf8')
  const seccion = readFileSync('src/components/sections/AutomatizacionesSection.tsx', 'utf8')

  const crearExigeOwner = /export async function POST[\s\S]*?role\s*!==\s*'owner'[\s\S]*?403/.test(rutaReglas)

  it('POST /api/reglas sigue siendo owner-only (si cambia, revisa la UI)', () => {
    expect(crearExigeOwner).toBe(true)
  })

  it('el menú rápido del móvil no ofrece crear reglas a un member', () => {
    if (!crearExigeOwner) return
    const ofreceRegla = /label:'Regla'/.test(dashboard)
    if (!ofreceRegla) return
    expect(/modal!=='regla'\s*\|\|\s*isOwner|isOwner\s*&&[^\n]*'regla'/.test(dashboard),
      'NexusDashboard ofrece crear una regla sin filtrar por isOwner, pero POST /api/reglas devuelve 403 a los members').toBe(true)
  })

  it('la sección de Automatizaciones gatea crear con isOwner', () => {
    if (!crearExigeOwner) return
    expect(/isOwner\s*&&[\s\S]{0,400}onOpenModal\('regla'\)|e\.key === 'n' && isOwner/.test(seccion),
      'AutomatizacionesSection ofrece crear reglas sin comprobar isOwner').toBe(true)
  })
})

describe('rutas API · las excepciones anotadas siguen existiendo', () => {
  // Una lista de excepciones que nadie repasa acaba tapando rutas que ya no son
  // excepcionales. Si una desaparece o deja de necesitar la exención, se avisa.
  it.each(Object.keys(SIN_SESION).map(k => [k]))('%s sigue siendo una ruta real', (clave) => {
    expect(TODAS.map(nombre), `«${clave}» está en la lista de excepciones pero ya no existe: bórrala`).toContain(clave)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// "Mis tareas" tiene que significar lo mismo en toda la app.
//
// Una tarea puede tener responsable (assigned_to) y CO-responsable
// (co_assigned_to). Tareas y Hoy siempre contaron las dos, pero el campanario de
// notificaciones filtraba solo por assigned_to y Equipo comparaba por nombre de
// responsable: te asignaban algo urgente como co-responsable y no te avisaba
// nadie, y en Equipo salias con cero tareas.
//
// Son dos vistas del mismo dato diciendo cosas distintas, que es peor que un
// error: nadie sospecha de un contador.
describe('rutas API · co_assigned_to cuenta como tuya', () => {
  it('ningun filtro de "mis tareas" se olvida del co-responsable', () => {
    const olvidos: string[] = []
    for (const f of TODAS) {
      const s = leer(f)
      // Filtros del tipo .or(`assigned_to.eq.X,...`) o .eq('assigned_to', user.id)
      for (const m of s.matchAll(/\.or\(`([^`]*assigned_to\.eq[^`]*)`\)/g)) {
        if (!m[1].includes('co_assigned_to')) olvidos.push(`${nombre(f)}: .or(${m[1].slice(0, 70)}…)`)
      }
      for (const m of s.matchAll(/\.eq\('assigned_to',\s*user\.id\)/g)) {
        // Excepcion con su motivo escrito, como pide CLAUDE.md.
        //
        // `diario/arrastrar` MUEVE `diario_dia`, y esa columna es UNA sola
        // compartida por los dos responsables: arrastrar a mi hoy una tarea de la
        // que solo soy co-responsable se la quitaria del dia al principal, y su
        // diario y sus reportes dejarian de cuadrar sin que el hiciera nada.
        //
        // Aqui «mis tareas» significa a proposito «las que tengo asignadas a mi»,
        // que es distinto de «en las que participo». No es un olvido: es la unica
        // lectura que no rompe el dia de otra persona.
        if (f.includes('diario/arrastrar')) continue
        olvidos.push(`${nombre(f)}: .eq('assigned_to', user.id) sin co_assigned_to`)
      }
    }
    expect(olvidos).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// "No hay filas" y "la consulta revento" no pueden dar la misma respuesta.
//
// supabase-js NO lanza al fallar: devuelve { data: null, error }. Cuatro rutas
// hacian `if (error) return NextResponse.json([], { status: 200 })` sin registrar
// nada, asi que la UI se quedaba diciendo "aun no hay notas" para siempre y nadie
// podia saber que estaba rota. Es la misma trampa que motivo src/lib/queryLog.ts.
//
// La excepcion legitima es 42P01 (la tabla aun no existe): ahi devolver vacio SI
// es correcto, porque la funcionalidad es opcional.
describe('rutas API · un fallo de consulta no se disfraza de lista vacia', () => {
  it('ninguna ruta devuelve [] con 200 al fallar la consulta', () => {
    const culpables: string[] = []
    for (const f of TODAS) {
      const s = leer(f)
      for (const m of s.matchAll(/if \(error\)[^\n]*NextResponse\.json\(\[\][^\n]*\)/g)) {
        culpables.push(`${nombre(f)}: ${m[0].trim().slice(0, 80)}`)
      }
      // La forma con bloque: if (error) { ... return NextResponse.json([]) }
      for (const m of s.matchAll(/if \(error\) \{([\s\S]{0,400}?)\n  \}/g)) {
        const bloque = m[1]
        if (!/NextResponse\.json\(\[\]\)/.test(bloque)) continue
        // Se permite si es el caso de tabla ausente Y hay otra rama que si falla.
        const soloTablaAusente = /42P01/.test(bloque) && /status:\s*500/.test(bloque)
        if (!soloTablaAusente) culpables.push(`${nombre(f)}: devuelve [] dentro de if (error) sin distinguir 42P01`)
      }
    }
    expect(culpables).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Ningun secreto puede viajar al navegador.
//
// La tabla `profiles` guarda gmail_refresh_token y gmail_colabs_refresh_token. Un
// refresh token da acceso COMPLETO al Gmail de esa persona y no caduca solo.
//
// GET /api/me hacia select('*') y devolvia el perfil entero: el token quedaba en el
// estado de React, en la pestaña de red de las devtools y en cualquier volcado de
// sesion. GET /api/admin/team era peor — select('*') sobre TODOS los perfiles
// entregaba los tokens de las siete personas en una sola respuesta.
//
// El asterisco es el problema: escribirlo no dice que columnas hay, asi que el dia
// que se añade una columna sensible se filtra sola.
describe('rutas API · los secretos no salen al cliente', () => {
  const SECRETOS = ['gmail_refresh_token', 'gmail_colabs_refresh_token']

  it('ninguna ruta hace select(*) sobre profiles', () => {
    const culpables: string[] = []
    for (const f of TODAS) {
      const s = leer(f)
      // .from('profiles') ... .select('*')  — en una linea o en varias
      for (const m of s.matchAll(/from\(['"]profiles['"]\)[\s\S]{0,60}?\.select\((['"])\*\1\)/g)) {
        culpables.push(`${nombre(f)}: ${m[0].replace(/\s+/g, ' ').slice(0, 60)}`)
      }
    }
    expect(culpables).toEqual([])
  })

  // La segunda mitad: aunque no sea con asterisco, un select explicito tampoco
  // puede nombrar una columna de token.
  it('ningun select nombra un token de refresco', () => {
    const culpables: string[] = []
    for (const f of TODAS) {
      const s = leer(f)
      for (const m of s.matchAll(/\.select\(['"]([^'"]*)['"]\)/g)) {
        for (const secreto of SECRETOS) {
          if (!m[1].includes(secreto)) continue
          // Las rutas que SI necesitan el token para hablar con Google lo leen y lo
          // usan en el servidor; se permiten solo si no devuelven ese objeto tal cual.
          const devuelveDirecto = new RegExp(`NextResponse\\.json\\(\\s*(profile|profiles|data)\\b`).test(s)
          if (devuelveDirecto) culpables.push(`${nombre(f)}: select con ${secreto} y devuelve el objeto entero`)
        }
      }
    }
    expect(culpables).toEqual([])
  })
})
