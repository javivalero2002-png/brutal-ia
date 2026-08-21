import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { estadoDeadline, dlLabel } from '@/components/shared/helpers'
import { SECCIONES } from '@/components/shared/secciones'

// ─────────────────────────────────────────────────────────────────────────────
// Las clases de bug de la auditoría, cerradas con llave.
//
// La auditoría de agosto encontró 79 fallos y el hallazgo de fondo fue que más
// de la mitad de los graves eran GEMELOS: el mismo error escrito dos veces,
// arreglado en una copia y vivo en la otra durante semanas.
//
// Arreglar las dos copias no impide que aparezca una tercera. Estos tests fijan
// la REGLA sobre todo el código —el de hoy y el que se escriba mañana— en vez de
// comprobar los sitios concretos que ya se arreglaron.
//
// Todas las reglas de este fichero tenían CERO violaciones al escribirse. Si una
// falla, no es deuda vieja: es un gemelo nuevo recién nacido.
//
// Cada excepción va en una lista con su motivo escrito.
// ─────────────────────────────────────────────────────────────────────────────

const ficheros = (dir: string, ext: string[], out: string[] = []): string[] => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (p.includes('__tests__')) continue
    if (statSync(p).isDirectory()) ficheros(p, ext, out)
    else if (ext.some(x => e.endsWith(x))) out.push(p)
  }
  return out
}

const TS = ficheros('src', ['.ts', '.tsx'])
const RUTAS = TS.filter(f => f.endsWith('route.ts') && f.startsWith('src/app/api'))
const CLIENTE = TS.filter(f => f.endsWith('.tsx'))
const leer = (f: string) => readFileSync(f, 'utf8')

// Igual que `leer`, pero sin comentarios.
//
// Hace falta porque este proyecto comenta MUCHO, y explicar en un comentario lo
// que se acaba de quitar —«antes: updateAgenda(id, { cover_url: json.url })»— hace
// que una regla que busca ese patrón lo encuentre y falle. Pasó al escribir la
// regla de abajo. El fallo grave es el simétrico: una regla que un comentario
// puede SATISFACER no comprueba código, comprueba prosa.
/**
 * Los ficheros que sincronizan correo EN BUCLE.
 *
 * `api/inbox/reanalizar` tambien llama a `analyzeEmail`, pero queda fuera a
 * proposito y por tres motivos, cada uno suficiente:
 *   · es UNA llamada pedida a mano, con alguien mirando la pantalla — no un bucle
 *     que pueda solaparse consigo mismo, asi que no necesita cerrojo ni
 *     presupuesto de tiempo;
 *   · se salta la criba A PROPOSITO: existe justo para analizar lo que la criba
 *     omitio, o seria imposible deshacer una omision;
 *   · y no inserta, actualiza una fila que ya existe.
 * Si algun dia esa ruta pasa a iterar, hay que sacarla de esta exencion.
 */
const REANALISIS = 'src/app/api/inbox/reanalizar/route.ts'
const buclesDeSync = (todos: string[]) =>
  todos.filter(f => f !== REANALISIS && /await analyzeEmail\(/.test(leerCodigo(f)))

const leerCodigo = (f: string) =>
  leer(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

// ── 1. Los avisos push ───────────────────────────────────────────────────────
//
// El bug: `sendPushToUser(...).catch(() => {})` sin await, con el `return` en la
// línea siguiente. En serverless eso es una lotería — la instancia se congela o
// se recicla en cuanto responde, y al envío aún le quedaban una consulta a
// `reglas`, un insert en `notification_log` y las llamadas a FCM/APNs.
//
// Lo que lo hacía grave: `canSendPush()` YA había escrito la ventana de 90s, así
// que el aviso perdido no se reintentaba nunca. Estaba en tres sitios.

describe('avisos push · nunca se lanzan sin esperarlos', () => {
  const usos = TS
    .filter(f => f !== 'src/lib/push.ts')
    .flatMap(f => leer(f).split('\n').map((l, i) => ({ f, i: i + 1, l })))
    .filter(({ l }) => /\bsendPushTo(User|All)\s*\(/.test(l) && !/^\s*(import|\/\/|\*)/.test(l))

  it('hay llamadas que revisar (el test no se ha quedado sin objetivo)', () => {
    expect(usos.length).toBeGreaterThan(3)
  })

  it('toda llamada va precedida de await', () => {
    const sinAwait = usos.filter(({ l }) => !/await\s+sendPushTo/.test(l))
    expect(sinAwait.map(u => `${u.f}:${u.i}`), 'Push lanzado sin await').toEqual([])
  })

  it('toda ruta que espera un push declara maxDuration', () => {
    const sinTope = RUTAS.filter(f => /await\s+sendPushTo/.test(leer(f)) && !/export const maxDuration/.test(leer(f)))
    expect(sinTope, 'Esperan un push sin ampliar el tope de duración').toEqual([])
  })
})

// ── 2. El Storage no lanza ───────────────────────────────────────────────────
//
// La API de Storage de supabase-js devuelve { data, error } igual que la de la
// base: NO lanza. Un `await ...remove([...])` dentro de un try/catch da una falsa
// sensación de estar cubierto — el catch solo ve el `new URL()`, nunca el borrado.
//
// Consecuencia real: la fila del adjunto se borraba y el fichero se quedaba en
// `content-videos`, que es un bucket PÚBLICO con contratos y presupuestos.
// Huérfano, accesible por URL y ya imposible de inventariar desde la app.

describe('Supabase Storage · el resultado de un borrado siempre se mira', () => {
  const usos = TS.flatMap(f => leer(f).split('\n').map((l, i) => ({ f, i: i + 1, l })))
    .filter(({ l }) => /\.storage\.from\([^)]*\)\.remove\(/.test(l))

  it('hay borrados que revisar', () => {
    expect(usos.length).toBeGreaterThan(0)
  })

  it('ningún borrado descarta su error', () => {
    const ciegos = usos.filter(({ l }) => !/\{\s*(data\s*:\s*\w+\s*,\s*)?error\s*(:\s*\w+\s*)?\}\s*=/.test(l))
    expect(ciegos.map(u => `${u.f}:${u.i}`), 'Borran del Storage sin comprobar el error').toEqual([])
  })
})

// ── 3. Un deadline es un DÍA, no un instante ─────────────────────────────────
//
// El bug más repetido de todos, y el que más veces volvió: contar días restando
// timestamps y dividiendo entre 86.400.000. Eso cuenta bloques de 24 HORAS, que
// no es lo mismo que días naturales.
//
// Síntomas reales: un proyecto atrasado desde ayer decía «0d» toda la mañana; una
// tarea que vencía hoy se marcaba vencida desde las 02:00 de Madrid; el briefing
// anunciaba «vence en 1d» de algo que vencía hoy.
//
// La aritmética de milisegundos sigue siendo correcta para VENTANAS (últimas 24h,
// retención de 30 días). Lo que no vale es para contar días de un deadline: para
// eso están daysBetweenKeys() y estadoDeadline(), que comparan claves de día.

describe('fechas · ningún deadline se mide restando timestamps', () => {
  const sospechosas = TS.flatMap(f => leer(f).split('\n').map((l, i) => ({ f, i: i + 1, l })))
    .filter(({ l }) => /86400000/.test(l) && /deadline|due_date|vence/i.test(l) && !/^\s*(\/\/|\*)/.test(l))

  it('nadie calcula los días que faltan para un deadline con milisegundos', () => {
    expect(sospechosas.map(u => `${u.f}:${u.i}`),
      'Usa aritmética de timestamps sobre un deadline: usa estadoDeadline() o daysBetweenKeys()').toEqual([])
  })

  it('el día de hoy nunca se saca en UTC para lógica de negocio', () => {
    // `new Date().toISOString().slice(0,10)` da el día en UTC: a partir de las
    // ~22:00 de Madrid salta al día siguiente. Para eso está todayKey().
    const malas = TS.flatMap(f => leer(f).split('\n').map((l, i) => ({ f, i: i + 1, l })))
      .filter(({ l }) => /new Date\(\)\.toISOString\(\)\.slice\(\s*0\s*,\s*10\s*\)/.test(l) && !/^\s*(\/\/|\*)/.test(l))
    expect(malas.map(u => `${u.f}:${u.i}`), 'Día en UTC: usa todayKey() de shared/helpers').toEqual([])
  })
})

// ── 4. fetch no lanza ────────────────────────────────────────────────────────
//
// `fetch` no lanza ante un 400 ni un 500: la respuesta llega como cualquier otra.
// Si nadie mira `ok`, el cuerpo del error se usa como si fueran datos.
//
// Esto corrompía lo que había en pantalla —el objeto de error SUSTITUÍA a la
// subtarea en la lista, que se quedaba sin texto y sin id— y, peor, daba
// diagnósticos falsos: un fallo del servicio de voz decía «No te escuché», así
// que repetías la frase en vez de mirar el servicio.

describe('cliente · toda respuesta de la API se comprueba antes de usarla', () => {
  const usos = CLIENTE.flatMap(f => {
    const L = leer(f).split('\n')
    return L.map((l, i) => ({ f, i: i + 1, l, ventana: L.slice(i, i + 22).join('\n') }))
  }).filter(({ l }) => /(?:const|let)\s+\w+\s*=\s*await fetch\(\s*[`'"]\/api/.test(l))

  it('hay llamadas que revisar', () => {
    expect(usos.length).toBeGreaterThan(20)
  })

  it('ninguna usa el cuerpo sin mirar antes si la petición fue bien', () => {
    const ciegas = usos.filter(({ l, ventana }) => {
      const v = /(?:const|let)\s+(\w+)\s*=/.exec(l)![1]
      // Vale tanto `r.ok` como la forma en línea `.then(r => r.ok ? ...)`.
      return !new RegExp(`\\b${v}\\.ok\\b`).test(ventana) && !/=>\s*\w+\.ok\s*\?/.test(ventana)
    })
    expect(ciegas.map(u => `${u.f}:${u.i}`), 'Usa la respuesta sin comprobar .ok').toEqual([])
  })
})

// ── 5. `as any` sobre los campos con CHECK en la base ────────────────────────
//
// `tasks.level` y `projects.status` tienen CHECK en Postgres. Un valor de fuera
// de la lista no da un error de tipo: da un INSERT rechazado en tiempo de
// ejecución, después de que la interfaz haya dicho que se creó.
//
// En HoySection el error de tipo del nivel que escribe Claude estaba TAPADO con
// `as any` — por eso vivió tanto. El molde es siempre el mismo: silenciar al
// compilador justo donde el dato viene de fuera y nadie lo valida.

// ── 6. La URL de la app ──────────────────────────────────────────────────────
//
// `https://brutalstudios-ia.vercel.app` estaba escrita a mano en cuatro sitios, y
// tres de ellos son texto que LEE una persona: las instrucciones que se le mandan
// a un compañero nuevo para que entre, y la URL del webhook que se copia y se pega
// en el panel de Meta.
//
// El día que la app tenga dominio propio, esos textos pasan a mentir sin que nada
// falle: nadie ve un error, simplemente el compañero no puede entrar. Por eso vive
// en src/lib/appUrl.ts y se deriva de NEXT_PUBLIC_APP_URL.

describe('la URL de la app vive en un solo sitio', () => {
  it('nadie vuelve a escribir el dominio de despliegue a mano', () => {
    const malos = TS
      .filter(f => f !== 'src/lib/appUrl.ts')
      .flatMap(f => leer(f).split('\n').map((l, i) => ({ f, i: i + 1, l })))
      .filter(({ l }) => /brutalstudios[a-z0-9-]*\.vercel\.app/.test(l) && !/^\s*(\/\/|\*)/.test(l))
    expect(malos.map(u => `${u.f}:${u.i}`),
      'Dominio escrito a mano: usa APP_URL / APP_HOST / rutaApp de @/lib/appUrl').toEqual([])
  })
})

// ── 7. Cuándo Gmail está desconectado ────────────────────────────────────────
//
// La detección estaba escrita CUATRO veces y las cuatro miraban solo
// `invalid_grant`. Los logs de producción del 2026-08-13 enseñaron a Google
// devolviendo `unauthorized_client`: no casaba en ninguna, caía como error
// genérico, y `gmail_connected` seguía en true — la pantalla decía «CONECTADO»
// sobre un buzón que llevaba días sin sincronizar.

// ── 8. Enlaces que salen de la app ───────────────────────────────────────────
//
// `window.location.origin` da el dominio por el que ha entrado QUIEN mira, no el
// de la app. El enlace de revisión que se le manda a un cliente se construía así,
// y como el equipo tiene la PWA instalada desde brutalstudios-ia.vercel.app y la
// app vive en brutalia.tech, el mismo botón daba una URL distinta según la
// persona que lo pulsara.
//
// La excepción legítima es «vuelve donde estabas» —el redirect del reset de
// contraseña—, que sí debe respetar el origen del usuario.

describe('enlaces para terceros · siempre el dominio canónico', () => {
  const EXCEPCIONES: Record<string, string> = {
    'src/app/login/page.tsx':
      'El redirectTo del reset de contraseña debe devolver al usuario al dominio por el que ENTRÓ, ' +
      'no al canónico. Los dos están en la allowlist de Supabase, así que funciona desde cualquiera.',
  }

  it('ningún enlace compartible se construye con window.location.origin', () => {
    const malos = CLIENTE
      .filter(f => !(f in EXCEPCIONES))
      .flatMap(f => leer(f).split('\n').map((l, i) => ({ f, i: i + 1, l })))
      .filter(({ l }) => /window\.location\.origin/.test(l) && !/^\s*(\/\/|\*)/.test(l))
    expect(malos.map(u => `${u.f}:${u.i}`),
      'Enlace atado al dominio de quien navega: usa rutaApp() de @/lib/appUrl').toEqual([])
  })

  it('las excepciones anotadas siguen existiendo', () => {
    const fantasmas = Object.keys(EXCEPCIONES)
      .filter(f => !CLIENTE.includes(f) || !/window\.location\.origin/.test(leer(f)))
    expect(fantasmas, 'Excepción que ya no hace falta: quítala').toEqual([])
  })
})

describe('Gmail · la detección de conexión rota vive en un solo sitio', () => {
  /** Cada excepción, con su motivo. Si sobra, el test de abajo lo canta. */
  const EXCEPCIONES: Record<string, string> = {
    'src/app/api/calendar/events/route.ts':
      'Su `isNoScope` no detecta una conexión muerta sino la FALTA DE PERMISO de calendario ' +
      '(403 / insufficientPermissions), y mira invalid_grant como una señal más entre varias. ' +
      'Es otra pregunta, no una copia. Candidato a unificar el día que se toque el calendario.',
  }

  it('nadie vuelve a comparar contra invalid_grant a mano', () => {
    const malos = TS
      .filter(f => f !== 'src/lib/gmailAuth.ts' && !(f in EXCEPCIONES))
      .flatMap(f => leer(f).split('\n').map((l, i) => ({ f, i: i + 1, l })))
      .filter(({ l }) => /invalid_grant/.test(l) && !/^\s*(\/\/|\*)/.test(l))
    expect(malos.map(u => `${u.f}:${u.i}`),
      'Detecta el token caducado a mano: usa esTokenMuerto/esConexionRota de @/lib/gmailAuth').toEqual([])
  })

  it('las excepciones anotadas siguen existiendo', () => {
    const fantasmas = Object.keys(EXCEPCIONES).filter(f => !TS.includes(f) || !/invalid_grant/.test(leer(f)))
    expect(fantasmas, 'Excepción que ya no hace falta: quítala de la lista').toEqual([])
  })
})

// ── 9. La identidad del remitente de un DM ───────────────────────────────────
//
// `inbox_messages.from_name` es para MOSTRAR. La identidad es `from_user_id`.
//
// Emparejar hilos por nombre fue el agujero mas grave de la auditoria:
// `profiles.name` no es unique y cualquiera se lo cambia con PATCH /api/profile,
// asi que renombrandote como un compañero, GET /api/inbox/thread te devolvia los
// DM que EL le habia mandado a un tercero. Se cerro del todo con la columna
// `from_user_id` (migracion 20260813).

describe('mensajes directos · el hilo se empareja por id, nunca por nombre', () => {
  const THREAD = 'src/app/api/inbox/thread/route.ts'

  it('la ruta del hilo existe (el test no se ha quedado sin objetivo)', () => {
    expect(TS).toContain(THREAD)
  })

  it('ningun filtro de la consulta usa from_name', () => {
    const malos = leer(THREAD).split('\n').map((l, i) => ({ i: i + 1, l }))
      .filter(({ l }) => /\.eq\(\s*['"]from_name['"]|ilike\(\s*['"]from_name['"]/.test(l))
    expect(malos.map(u => `${THREAD}:${u.i}`),
      'El hilo vuelve a emparejar por nombre: usa from_user_id').toEqual([])
  })

  it('filtra por from_user_id en las dos direcciones', () => {
    const src = leer(THREAD)
    expect((src.match(/\.eq\(\s*['"]from_user_id['"]/g) || []).length,
      'Faltan filtros por from_user_id (deben ser dos: recibidos y enviados)').toBe(2)
  })

  it('quien envia un DM guarda su id, no solo su nombre', () => {
    expect(/from_user_id:\s*user\.id/.test(leer('src/app/api/inbox/route.ts')),
      'POST /api/inbox no guarda from_user_id: los hilos nuevos saldrian vacios').toBe(true)
  })
})

// ── 10. El `!` sobre estadoDeadline ──────────────────────────────────────────
//
// `estadoDeadline()` devuelve **null** con los deadlines heredados en texto libre
// ('ago 2026', 'finales de mes'), que siguen en la base. Escribir
// `estadoDeadline(x)!` es afirmarle a TypeScript que eso no pasa nunca — y el
// compilador se calla justo donde hace falta que hable.
//
// Paso de verdad, y lo introdujo el propio arreglo del 2026-08-13 que hizo que la
// funcion devolviera null: cuatro sitios la llamaban con `!`. En ProyectosSection
// eso reventaba el render de la FILA, o sea que un solo proyecto con deadline en
// texto libre tumbaba la seccion entera contra el SectionErrorBoundary, y
// REINTENTAR volvia a fallar porque los datos eran los mismos.
//
// Se permite donde un filtro previo ya excluye el null (HoySection usa
// `?.pronto` antes de ordenar), y por eso la regla mira el `!`, no la llamada.

describe('fechas · nadie afirma que estadoDeadline no puede ser null', () => {
  /** Se permite donde un filtro previo ya excluyo el null. Con su motivo. */
  const EXCEPCIONES: Record<string, string> = {
    'src/components/sections/HoySection.tsx':
      'Su lista se construye filtrando con `estadoDeadline(p.deadline)?.pronto`, que ya deja fuera ' +
      'los nulos; el `!` del sort y del briefing opera sobre esa lista ya limpia.',
  }

  it('ningun sitio la llama con `!` sin haber filtrado antes', () => {
    const malos = TS
      .filter(f => !(f in EXCEPCIONES))
      .flatMap(f => leer(f).split('\n').map((l, i) => ({ f, i: i + 1, l })))
      .filter(({ l }) => /estadoDeadline\s*\([^)]*\)\s*!/.test(l) && !/^\s*(\/\/|\*)/.test(l))
    expect(malos.map(u => `${u.f}:${u.i}`),
      'Afirma que estadoDeadline no es null: con un deadline en texto libre revienta el render').toEqual([])
  })

  it('las excepciones anotadas siguen existiendo', () => {
    const fantasmas = Object.keys(EXCEPCIONES)
      .filter(f => !TS.includes(f) || !/estadoDeadline\s*\([^)]*\)\s*!/.test(leer(f)))
    expect(fantasmas, 'Excepcion que ya no hace falta: quitala').toEqual([])
  })

  it('un deadline en texto libre da null, y hay con que pintarlo', () => {
    // La funcion de verdad, no una copia: si algun dia vuelve a devolver un objeto
    // con NaN en vez de null, este test lo canta.
    for (const libre of ['ago 2026', 'finales de mes', 'cuando cierre']) {
      expect(estadoDeadline(libre)).toBeNull()
      // dlLabel SI sabe con que sustituirlo: interpreta el texto y da una fecha
      // legible ('ago 2026' -> '28 ago'), o el original si no lo entiende.
      expect(typeof dlLabel(libre)).toBe('string')
      expect(dlLabel(libre).length).toBeGreaterThan(0)
    }
  })
})

// ── 11. Atajos de seccion con un modal abierto ───────────────────────────────
//
// Las secciones escuchan el teclado en `window` y se protegen mirando si el foco
// esta en un INPUT o TEXTAREA. Esa guarda deja de valer con un modal abierto: el
// modal se pinta como HERMANO de la seccion —que sigue montada y escuchando— y si
// no enfoca nada, el foco se queda en BODY y pasan TODAS las teclas.
//
// Trazado letra por letra el 2026-08-13: escribiendo «kickoff clientes semanal»
// en el titulo de una tarea nueva, la 'k' seleccionaba una tarea de fondo, la 'c'
// le daba la vuelta a `done` y la 's' llamaba a guardar. Un PATCH contra una tarea
// que el usuario ni miraba.
//
// Se arregla por los dos lados y aqui se fijan los dos: el modal enfoca su primer
// campo (con lo que la guarda por tagName vuelve a funcionar), y ademas las
// secciones consultan `hayModalAbierto()` — que cubre el caso de hacer clic en una
// zona del modal que no es un campo y devolver el foco a BODY.

describe('atajos de teclado · un modal abierto los desactiva', () => {
  const CON_LISTENER = TS.filter(f =>
    (f.startsWith('src/components/sections/') || f === 'src/components/NexusDashboard.tsx') &&
    /window\.addEventListener\(\s*'keydown'/.test(leer(f)))

  it('hay listeners que revisar', () => {
    expect(CON_LISTENER.length).toBeGreaterThan(10)
  })

  it('todos consultan hayModalAbierto()', () => {
    const sinGuarda = CON_LISTENER.filter(f => !/hayModalAbierto\(\)/.test(leer(f)))
    expect(sinGuarda, 'Escucha el teclado sin comprobar si hay un modal abierto').toEqual([])
  })

  it('el modal avisa de que esta abierto y enfoca su primer campo', () => {
    const m = leer('src/components/CreateModal.tsx')
    expect(/marcarModalAbierto\(\)/.test(m), 'el modal no avisa de que se abre').toBe(true)
    expect(/marcarModalCerrado\(\)/.test(m), 'el modal no avisa de que se cierra').toBe(true)
    expect(/\.focus\(\)/.test(m), 'el modal no enfoca nada: el foco se queda en BODY').toBe(true)
    expect(/role="dialog"/.test(m), 'falta role="dialog"').toBe(true)
  })
})

describe('uniones con CHECK en la base · nadie las silencia con `as any`', () => {
  it('ni el nivel de una tarea ni el estado de un proyecto se castean', () => {
    const malos = TS.flatMap(f => leer(f).split('\n').map((l, i) => ({ f, i: i + 1, l })))
      .filter(({ l }) => /\b(level|status)\s*:\s*[^,;]*\bas any\b/.test(l))
    expect(malos.map(u => `${u.f}:${u.i}`),
      'Castea a any un campo con CHECK: normalízalo (ver nivelTarea) en vez de silenciarlo').toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Un formulario a medio escribir no se descarta sin avisar.
//
// Tres sitios lo hacían, y ninguno es un fallo que el usuario atribuya a un bug:
// escribes, desaparece, y das por hecho que no lo escribiste.
// ─────────────────────────────────────────────────────────────────────────────
describe('nada de perder lo que el usuario ha escrito', () => {
  it('el clic en el fondo del modal pasa por su propia comprobacion', () => {
    const m = leer('src/components/CreateModal.tsx')
    // El fondo NO puede compartir manejador con Cancelar y la X: esos dos
    // descartan a proposito —el usuario lo ha pedido— y el fondo es el gesto que
    // se hace sin querer. Un solo `onClose` para los tres significa que el fondo
    // se llevaba el formulario entero en silencio.
    const fondo = m.split('\n').find(l => /className="fixed inset-0 z-\[100\]/.test(l)) || ''
    expect(fondo, 'no se encontró el fondo del modal').not.toBe('')
    expect(/onClick=\{onDismiss/.test(fondo),
      'el fondo vuelve a usar onClose: descarta el formulario sin avisar').toBe(true)

    const d = leer('src/components/NexusDashboard.tsx')
    const i = d.indexOf('onDismiss=')
    expect(i, 'el dashboard ya no pasa onDismiss').toBeGreaterThan(-1)
    expect(/sin guardar/.test(d.slice(i, i + 400)),
      'el onDismiss del dashboard no comprueba si hay algo escrito').toBe(true)
  })

  it('cambiar de tarea no borra las notas a medio escribir', () => {
    const t = leer('src/components/sections/TareasSection.tsx')
    const i = t.indexOf('const openTask =')
    expect(i, 'openTask ya no existe: revisa esta regla').toBeGreaterThan(-1)
    const cuerpo = t.slice(i, i + 500)
    expect(/hayCambios\(\)/.test(cuerpo),
      'openTask recarga el panel sin mirar si hay cambios sin guardar').toBe(true)
    expect(/return/.test(cuerpo.slice(cuerpo.indexOf('hayCambios()'))),
      'detecta los cambios pero sigue adelante igual').toBe(true)
  })

  // Esta regla existe porque el arreglo del modal ROMPIO Escape: la guarda de
  // hayModalAbierto() se puso al principio del manejador global, y ese manejador
  // es justo el que cierra el modal con Escape. Con el modal abierto, Escape ya
  // no hacía nada — y el modal es a pantalla completa.
  it('Escape sigue cerrando el modal: la guarda va DESPUES', () => {
    const d = leer('src/components/NexusDashboard.tsx')
    const esc = d.indexOf("e.key === 'Escape'")
    const guarda = d.indexOf('hayModalAbierto()')
    expect(esc, "no se encontró la rama de Escape").toBeGreaterThan(-1)
    expect(guarda, 'el dashboard ya no consulta hayModalAbierto()').toBeGreaterThan(-1)
    expect(guarda, 'la guarda está ANTES de Escape: con un modal abierto, Escape no lo cierra')
      .toBeGreaterThan(esc)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// El calendario se LEE de todos los calendarios y se ESCRIBÍA solo en uno.
//
// La sincronización recorre `calendarList` entera, así que en la sección salen
// eventos de cualquier calendario. Editar y borrar iban fijos a 'primary': todos
// esos eventos daban 404 con los botones perfectamente visibles.
// ─────────────────────────────────────────────────────────────────────────────
describe('calendario · escribir donde de verdad está el evento', () => {
  const GMAIL = leer('src/lib/gmail.ts')

  it('editar y borrar no fijan el calendario a primary', () => {
    const malos = GMAIL.split('\n')
      .map((l, i) => ({ i: i + 1, l }))
      .filter(({ l }) => /events\.(delete|patch|get)\(\{\s*calendarId:\s*'primary'/.test(l))
    expect(malos.map(u => `gmail.ts:${u.i}`),
      "vuelve a escribir en 'primary' fijo: los eventos de otros calendarios dan 404").toEqual([])
  })

  it('cada evento sabe de qué calendario sale', () => {
    // Mirar `calendarId: calId` en el fichero entero NO vale: `events.list` ya lo
    // lleva, así que el test pasaba en verde con mapEvent roto. Comprobado
    // quitándoselo a mapEvent. Se acota al cuerpo de mapEvent, que es quien
    // construye el evento que acaba en la UI.
    const i = GMAIL.indexOf('const mapEvent =')
    expect(i, 'ya no existe mapEvent: revisa esta regla').toBeGreaterThan(-1)
    const cuerpo = GMAIL.slice(i, GMAIL.indexOf('})', i))
    expect(/calendarId:\s*calId/.test(cuerpo),
      'los eventos ya no llevan su calendarId: editar y borrar no pueden acertar').toBe(true)
    expect(/editable:/.test(cuerpo), 'los eventos no dicen si se pueden editar').toBe(true)
    expect(/mapEvent\(e,\s*calendarIds\[/.test(GMAIL),
      'mapEvent recibe el calendario pero nadie se lo pasa de verdad').toBe(true)
  })

  it('la UI no ofrece editar lo que Google no deja tocar', () => {
    const CAL = leer('src/components/sections/CalendarioSection.tsx')
    expect(/editable === false/.test(CAL),
      'un calendario compartido en solo lectura vuelve a enseñar EDITAR y ELIMINAR: Google contesta 403').toBe(true)
  })

  // El tipo estaba escrito dos veces, byte a byte igual. Añadir un campo a una
  // copia y no a la otra no lo ve tsc: las dos siguen siendo válidas.
  it('CalendarEvent está declarado una sola vez', () => {
    const veces = TS.filter(f => /export interface CalendarEvent \{/.test(leer(f)))
    expect(veces, `CalendarEvent declarado en: ${veces.join(', ')}`).toHaveLength(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Sincronizar un buzón cuesta dinero, así que no puede correr dos veces a la vez.
//
// Encontrado el 2026-08-13 en los logs de producción, no leyendo código:
// /api/gmail/colabs-sync se llamó 4 veces en 12 minutos. El freno del cliente
// funciona —15 min— pero vive en localStorage, o sea que es POR DISPOSITIVO,
// y el buzón de colabs es UNO para las siete personas. Más el cron de la hora en
// punto, que tampoco pedía cerrojo: el de sync-colabs solo cubre la purga diaria.
//
// Al solaparse dos, el dedup no salva: lee los gmail_id guardados ANTES del bucle
// y luego analiza e inserta uno a uno, así que entre la lectura y el insert cabe
// otra ejecución entera. Las dos mandan el mismo correo a Claude y las dos pagan.
// ─────────────────────────────────────────────────────────────────────────────
describe('sincronizar un buzón · nunca dos a la vez', () => {
  // Vale para el codigo que se escriba manana: quien analice correo con Claude
  // tiene que pedir cerrojo, sea una copia nueva o una que ya existe.
  // Fuera `ai.ts` (es quien lo define) y fuera la ruta de reanálisis: esa es UNA
  // llamada pedida a mano, no un bucle que pueda solaparse consigo mismo, así que
  // el cerrojo no la protege de nada — y sí la haría fallar si el cron está
  // sincronizando en ese momento, que es justo cuando alguien mira la bandeja.
  const ANALIZAN = TS.filter(f =>
    /\banalyzeEmail\s*\(/.test(leer(f))
    && !f.endsWith('src/lib/ai.ts')
    && f !== 'src/app/api/inbox/reanalizar/route.ts')

  it('hay ficheros que revisar', () => {
    // Era `> 1` cuando sincronizar un buzon personal estaba escrito DOS veces. Al
    // borrar la copia de /api/gmail/sync —que ahora delega en la libreria— queda
    // un solo fichero que llama a analyzeEmail, y eso es una mejora, no un fallo.
    expect(ANALIZAN.length, 'ya nadie analiza correo: revisa esta regla en vez de borrarla').toBeGreaterThan(0)
  })

  it('todo el que analiza correo con Claude toma cerrojo', () => {
    const sinCerrojo = ANALIZAN.filter(f => !/acquireLock\s*\(/.test(leer(f)))
    expect(sinCerrojo,
      'Analiza correo con Claude sin cerrojo: dos ejecuciones solapadas pagan el mismo email dos veces').toEqual([])
  })

  it('y lo suelta', () => {
    const sinSoltar = ANALIZAN.filter(f => !/releaseLock\s*\(/.test(leer(f)))
    expect(sinSoltar, 'Toma el cerrojo y no lo suelta: el buzón se queda bloqueado hasta que caduque').toEqual([])
  })

  // La parte que de verdad hace que funcione, y la que se rompe sola: sincronizar
  // un buzon personal esta escrito DOS veces —la ruta que dispara el navegador y
  // syncPersonalInbox, que dispara el cron—. Solo se excluyen si usan la MISMA
  // clave. Dos claves distintas es tener cerrojo y seguir teniendo el problema.
  it('el sync personal se toma el cerrojo en UN solo sitio', () => {
    // Antes esta regla exigia que las DOS copias usaran la misma clave, porque
    // sincronizar un buzon personal estaba escrito dos veces. Ya no: la ruta
    // delega en `syncPersonalInbox`, asi que el cerrojo se pide una vez y la
    // exclusion es por construccion en vez de por coincidencia de cadenas.
    //
    // La regla se queda para vigilar que no vuelva a aparecer una segunda copia:
    // si alguien reescribe el bucle en la ruta, tendra que pedir cerrojo alli y
    // esto se pondra rojo.
    const clave = /sync-personal-\$\{[a-zA-Z.]+\}/
    const RUTA = leer('src/app/api/gmail/sync/route.ts')
    const LIB = leer('src/lib/colabsSync.ts')
    expect(clave.test(LIB), 'colabsSync no usa la clave sync-personal-<id>').toBe(true)
    expect(clave.test(RUTA),
      'la ruta ha vuelto a pedir cerrojo por su cuenta: eso significa que tiene su propia copia del bucle otra vez')
      .toBe(false)
  })

  it('un sync saltado no se cuenta como sincronizado', () => {
    // `saltado` tiene que llegar hasta arriba. Si se queda por el camino, la
    // respuesta es `synced: 0, total: 0`, que es identica a "no habia correo".
    expect(/saltado/.test(leer('src/lib/colabsSync.ts')), 'colabsSync no marca los saltados').toBe(true)
    expect(/saltado/.test(leer('src/app/api/gmail/colabs-sync/route.ts')), 'la ruta de colabs se come el saltado').toBe(true)
    expect(/saltado/.test(leer('src/hooks/useNexusData.ts')), 'el cliente no distingue saltado de vacío').toBe(true)
    expect(/saltado/.test(leer('src/app/api/cron/sync-colabs/route.ts')), 'el cron cuenta un saltado como sincronizado').toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Lo que se PINTA de un campo de Storage no es lo que hay GUARDADO en él.
//
// La base guarda la URL pública como IDENTIFICADOR estable, y las rutas de
// lectura la sustituyen por una firma temporal antes de mandarla (storageFirmado).
// O sea: el formulario enseña una firma con token. Reenviarla al guardar rompe de
// dos maneras, y la segunda destruye datos:
//
//  · el PATCH pisa el identificador con una firma que caduca;
//  · si firmarUrl() falla devuelve null A PROPÓSITO —un enlace roto que parece
//    bueno confunde más que un hueco—, el input se pinta vacío, y guardar escribe
//    null encima. El fichero se queda en el bucket y la app olvida dónde está.
//
// Encontrado el 2026-08-13 en ContenidoSection, donde bastaba con escribir una
// nota y darle a guardar.
// ─────────────────────────────────────────────────────────────────────────────
describe('campos de Storage · no se reenvía lo que solo se estaba viendo', () => {
  const CONTENIDO = leerCodigo('src/components/sections/ContenidoSection.tsx')

  it('saveNotes no manda cover_url ni video_url sin que se hayan tocado', () => {
    const i = CONTENIDO.indexOf('const saveNotes =')
    expect(i, 'ya no existe saveNotes: revisa esta regla').toBeGreaterThan(-1)
    const cuerpo = CONTENIDO.slice(i, i + 1600)

    // Si aparecen en el objeto `updates` sin pasar por la marca de "tocado",
    // volvemos a mandar la firma —o el hueco que dejó una firma fallida—.
    const enPayloadSuelto = /const updates[^\n]*\b(cover_url|video_url)\s*:/.test(cuerpo)
    expect(enPayloadSuelto,
      'cover_url/video_url vuelven al payload sin condición: guardar una nota pisa el identificador').toBe(false)

    expect(/if \(coverTocada\.current\)/.test(cuerpo), 'falta la guarda de cover_url').toBe(true)
    expect(/if \(videoTocado\.current\)/.test(cuerpo), 'falta la guarda de video_url').toBe(true)
  })

  it('las marcas se reinician al abrir otra pieza', () => {
    const i = CONTENIDO.indexOf('const openItem =')
    const cuerpo = CONTENIDO.slice(i, i + 700)
    expect(/coverTocada\.current = false/.test(cuerpo) && /videoTocado\.current = false/.test(cuerpo),
      'las marcas se quedan puestas de la pieza anterior: se reenviaría su URL a otra distinta').toBe(true)
  })

  it('subir una portada desmarca el campo', () => {
    // La subida deja el input con la firma que devuelve el servidor. Si el usuario
    // habia tecleado antes en PORTADA la marca seguia puesta, y el siguiente
    // GUARDAR mandaba esa firma pisando el identificador.
    const i = CONTENIDO.indexOf('aplicarAgendaLocal')
    expect(i, 'ya no se refresca la rejilla tras subir: revisa esta regla').toBeGreaterThan(-1)
    expect(/coverTocada\.current = false/.test(CONTENIDO.slice(Math.max(0, i - 300), i + 60)),
      'la subida no desmarca coverTocada: un teclazo previo hace que el siguiente guardado pise el identificador').toBe(true)
  })

  it('subir una portada no vuelve a escribirla en la base', () => {
    // upload-cover YA guarda el identificador en el servidor y devuelve la fila
    // firmada. Un PATCH extra desde el cliente solo sirve para pisarlo.
    expect(/updateAgenda\([^)]*cover_url:\s*json\.url/.test(CONTENIDO),
      'la subida vuelve a hacer PATCH con la URL firmada: pisa el identificador que acaba de guardar el servidor').toBe(false)
    expect(/aplicarAgendaLocal/.test(CONTENIDO),
      'la rejilla ya no se refresca tras subir la portada').toBe(true)
  })

  it('el servidor sigue guardando la pública y devolviendo la firmada', () => {
    const UP = leerCodigo('src/app/api/agenda/[id]/upload-cover/route.ts')
    expect(/update\(\{ cover_url: publicUrl \}\)/.test(UP),
      'upload-cover ya no guarda la URL pública como identificador').toBe(true)
    expect(/firmarUrl\(admin, publicUrl\)/.test(UP),
      'upload-cover devuelve la pública sin firmar: con el bucket cerrado no pinta nada').toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// El buzón compartido es de la EMPRESA: solo el propietario lo conecta.
//
// La regla no dice «/api/gmail/connect comprueba el rol», porque esa fue
// exactamente la trampa. Se puso ahí el 2026-08-13 —simetría con disconnect, que
// ya lo exigía— y el agujero seguía abierto una puerta más adentro: quien ESCRIBE
// el token es /api/gmail/callback, y allí el `account` sale del `state`, que lo
// controla el cliente.
//
// El nonce no cubre esto. Impide que un extraño fabrique un state; no impide que
// el dueño legítimo de ese nonce lo edite. Un miembro pide conectar su Gmail
// personal (permitido para cualquiera), cambia `personal` por `colabs` al volver
// de Google, y su nonce sigue casando porque es el suyo — igual que `user.id`.
// Resultado: el buzón de la empresa apuntando a su correo personal, y su correo
// personal en el inbox de las siete personas.
//
// Por eso la regla persigue la ESCRITURA, no la ruta: cualquier puerta nueva que
// escriba ese token queda cubierta sola.
// ─────────────────────────────────────────────────────────────────────────────
describe('buzón compartido · solo el propietario puede apuntarlo a un Gmail', () => {
  // Solo las que APUNTAN el buzón a un Gmail. Ponerlo a `null` es lo contrario:
  // es limpiar un token que Google ya ha dado por muerto, y eso lo hace el propio
  // sistema (gmail/status y colabsSync) sin humano delante. Exigir owner ahí
  // dejaría el token muerto pegado hasta que pasara el propietario.
  const APUNTAN = TS.filter(f =>
    /gmail_colabs_refresh_token\s*:\s*(?!null)[A-Za-z_$]/.test(leerCodigo(f)))

  it('hay puertas que revisar', () => {
    expect(APUNTAN.length).toBeGreaterThan(0)
  })

  it('todas comprueban el rol antes de escribir el token', () => {
    const sinRol = APUNTAN.filter(f => {
      const src = leerCodigo(f)
      const i = src.search(/gmail_colabs_refresh_token\s*:\s*(?!null)[A-Za-z_$]/)
      // El rol tiene que resolverse ANTES de la escritura, y del servidor.
      return !/role\s*!==\s*'owner'|role\s*===\s*'owner'/.test(src.slice(0, i))
    })
    expect(sinRol,
      'Escribe el token del buzón compartido sin comprobar que quien lo pide es owner').toEqual([])
  })

  it('el rol sale del servidor, nunca del state ni del body', () => {
    for (const f of APUNTAN) {
      expect(/getAuthCtx\(\)/.test(leerCodigo(f)), `${f} no resuelve el rol por servidor`).toBe(true)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Lo que escribe el modelo no entra crudo en una columna de union cerrada.
//
// Ya pasó con `tasks.level`: el prompt va entero en español y pide los valores en
// inglés, el modelo contesta «urgente», el INSERT rebota y la tarea no se crea
// después de que Harvey haya dicho en voz alta que la creaba. `nivelTarea()` lo
// arregló ahí — y el GEMELO seguía vivo en `inbox_messages.ai_urgency`, que sale
// igual de `parseJsonLoose` y se inserta en tres sitios.
//
// La regla mira la FRONTERA (donde se parsea la respuesta del modelo) y no los
// inserts: normalizar en cada insert es exactamente como se arregla uno y
// sobreviven los otros dos.
// ─────────────────────────────────────────────────────────────────────────────
describe('salida del modelo · normalizada en la frontera', () => {
  it('analyzeEmail normaliza la urgencia antes de devolverla', () => {
    const AI = leerCodigo('src/lib/ai.ts')
    const i = AI.indexOf('parseJsonLoose(text)')
    expect(i, 'ya no se parsea así: revisa esta regla').toBeGreaterThan(-1)
    expect(/nivelTarea\(/.test(AI.slice(i, i + 400)),
      'la urgencia del modelo vuelve a salir cruda hacia ai_urgency, que es una unión cerrada').toBe(true)
  })

  it('y los inserts la consumen ya normalizada, sin repetir la lógica', () => {
    // Si alguno normaliza por su cuenta es que la frontera dejó de hacerlo, y
    // volvemos a tener el mismo arreglo escrito N veces — el patrón que este
    // proyecto ya ha pagado más de una vez.
    const INSERTAN = TS.filter(f => /ai_urgency\s*:/.test(leerCodigo(f)))
    expect(INSERTAN.length).toBeGreaterThan(1)
    const conLogicaPropia = INSERTAN.filter(f => /ai_urgency\s*:\s*nivelTarea/.test(leerCodigo(f)))
    expect(conLogicaPropia,
      'normaliza en el insert en vez de en la frontera: así nacen los gemelos').toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Tres cosas que se cuentan mal y no se ven.
// ─────────────────────────────────────────────────────────────────────────────
describe('lo que se lee de una API se lee entero', () => {
  // El `timeout` del SDK de Anthropic es POR INTENTO. Con maxRetries:1 son dos
  // intentos + backoff ≈ 31 s, y el presupuesto del bucle se comprueba ANTES de la
  // llamada: pasar en t=44,9 s y encadenar 30,5 s termina en t=75,4 contra un
  // maxDuration de 60. Estaba escrito a mano y distinto en tres sitios (45/25/12) y
  // solo el 45 no cabia — el numero correcto ya estaba en los otros dos.
  // La primera version de esto bajaba el PRESUPUESTO de 45 s a 25 s. La
  // verificacion adversarial lo tumbo con razon: el SDK obedece el `Retry-After`
  // de un 429 hasta 60 s, asi que UNA llamada puede costar ~75 s y ningun valor de
  // presupuesto sobrevive. El numero era la palanca equivocada.
  //
  // La regla persigue la forma correcta: preguntar si CABE la siguiente, no si ya
  // me he pasado — y pasarle ese plazo a la llamada, para que no pueda excederlo.
  it('los bucles de analyzeEmail preguntan si cabe la siguiente', () => {
    // Anclado a lo que el bucle HACE —llamar al modelo— y no a la forma del
    // `for`: la regla buscaba literalmente `for (const email of emails)` y se
    // quedo ciega en cuanto uno de los tres bucles paso a llevar indice. Una
    // regla que depende de la sintaxis vigila el estilo, no el invariante.
    const EN_BUCLE = buclesDeSync(TS)
    // `> 0` y no `> 1`: eran dos ficheros mientras /api/gmail/sync tenia su propia
    // copia del bucle. Ahora delega en la libreria y queda uno — con los dos
    // bucles dentro, el del buzon compartido y el personal.
    expect(EN_BUCLE.length, 'no se encontro ningun bucle de emails').toBeGreaterThan(0)
    for (const f of EN_BUCLE) {
      const src = leerCodigo(f)
      expect(/plazoRestante\(/.test(src), `${f} no mide el plazo restante`).toBe(true)
      expect(/MINIMO_UTIL_MS/.test(src), `${f} no corta cuando ya no cabe una llamada`).toBe(true)
      expect(/PRESUPUESTO_MS/.test(src),
        `${f} vuelve al presupuesto fijo: un 429 con Retry-After se lo salta`).toBe(false)
    }
  })

  it('y el plazo llega hasta la llamada, que es donde se aplica', () => {
    const AI = leerCodigo('src/lib/ai.ts')
    expect(/plazoMs\?:\s*number/.test(AI), 'analyzeEmail ya no acepta plazo').toBe(true)
    // El invariante, no el texto: el plazo tiene que ACOTAR el timeout normal
    // (Math.min), no sustituirlo — con solo un `Math.max` el suelo hacia que una
    // llamada colgada durase ~53 s en vez de ~30 y el bucle rindiera un correo en
    // vez de cinco. Y el reintento solo se permite si CABEN dos intentos enteros.
    const i = AI.indexOf('plazoMs\n')
    expect(i, 'ya no hay rama de plazo en la llamada').toBeGreaterThan(-1)
    const rama = AI.slice(i, i + 420)
    expect(/timeout:\s*Math\.min\(\s*TIMEOUT_MS/.test(rama),
      'el plazo sustituye al timeout en vez de acotarlo: una llamada colgada dura el plazo entero').toBe(true)
    expect(/maxRetries:\s*plazoMs\s*>=/.test(rama),
      'el reintento ya no depende de que quepa: o se pierde el backoff de los 5xx, o el reintento se sale del hueco').toBe(true)
    // TODAS las llamadas, no «que exista una». colabsSync.ts tiene DOS copias del
    // bucle y esta regla se satisfacia con cualquiera: se reintrodujo el bug exacto
    // en la segunda y la suite seguia en verde. En un repo cuya tesis es que mas de
    // la mitad de los fallos graves son gemelos, una regla que solo mira la primera
    // copia no sirve para nada.
    for (const f of TS.filter(f => /for \(const email of emails\)/.test(leerCodigo(f)))) {
      const src = leerCodigo(f)
      const llamadas = [...src.matchAll(/analyzeEmail\(/g)]
      expect(llamadas.length, `${f}: no se encontro ninguna llamada`).toBeGreaterThan(0)
      llamadas.forEach((m, i) => {
        expect(/plazo/.test(src.slice(m.index, m.index + 400)),
          `${f}: la llamada nº${i + 1} a analyzeEmail no recibe el plazo`).toBe(true)
      })
    }
  })

  // El fetch de Gmail y sus consultas tambien gastan del minuto. Medir desde
  // despues era contar solo una parte y creer que sobraba tiempo.
  // El reparto del cron —25 s el compartido y 12 s cada personal, 8 buzones en la
  // misma ejecucion— depende de estos dos topes. Se borraron una vez al cambiar de
  // palanca y CUATRO comentarios se quedaron describiendo un reparto que ya no
  // pasaba: con ~51 s por buzon en vez de 25, en un lunes con atraso arrancan 4 de
  // 7 y los otros 3 esperan una hora.
  it('los topes por buzón siguen ahí, y el reparto CABE', () => {
    const CS = leerCodigo('src/lib/colabsSync.ts')
    const CRON = leerCodigo('src/app/api/cron/sync-colabs/route.ts')
    const num = (re: RegExp, donde: string, que: string) => {
      const m = re.exec(donde)
      expect(m, `no se encuentra ${que}`).not.toBeNull()
      return Number(m![1].replace(/_/g, ''))
    }
    const colabs = num(/TOPE_COLABS_MS\s*=\s*([\d_]+)/, CS, 'el tope del buzón compartido')
    const personal = num(/TOPE_PERSONAL_MS\s*=\s*([\d_]+)/, CS, 'el tope de los buzones personales')
    const presupuesto = num(/PARA_BUZONES_MS\s*=\s*([\d_]+)/, CRON, 'el presupuesto del cron')

    // La ARITMÉTICA, no los números. Antes se fijaban los literales (25_000 y
    // 12_000), así que subir uno ponía la suite en rojo aunque el reparto siguiera
    // cabiendo, y —peor— dos cambios compensados podían dejarlo sin caber sin que
    // nadie se enterara. Lo que hay que proteger es que quepan los ocho buzones:
    // si no caben, los últimos de la lista se sincronizan una vez cada varias
    // horas y su dueño cree que la app está rota.
    const BUZONES_PERSONALES = 7
    const peorCaso = colabs + BUZONES_PERSONALES * personal
    expect(peorCaso,
      `el reparto no cabe: ${colabs / 1000}s + ${BUZONES_PERSONALES}×${personal / 1000}s = ${peorCaso / 1000}s contra ${presupuesto / 1000}s de presupuesto. Los últimos buzones se quedarían sin sincronizar`)
      .toBeLessThanOrEqual(presupuesto)
    // Declararlos no basta: tienen que entrar en el calculo del plazo.
    const usos = (CS.match(/Math\.min\(plazoRestante\([^)]*\),\s*TOPE_/g) || []).length
    expect(usos, 'los topes están declarados pero no acotan el plazo').toBe(2)
  })

  it('el reloj arranca antes del fetch de Gmail, en TODAS las copias', () => {
    // `indexOf` comparaba solo el PRIMER T0 con el PRIMER fetch, y colabsSync.ts
    // tiene dos parejas: el bug reintroducido en la segunda pasaba en verde.
    // Ahora se emparejan en orden — cada fetch con el T0 que lo precede.
    for (const f of TS.filter(f => /const T0 = Date\.now\(\)/.test(leerCodigo(f)))) {
      const src = leerCodigo(f)
      const t0s = [...src.matchAll(/const T0 = Date\.now\(\)/g)].map(m => m.index as number)
      const fetches = [...src.matchAll(/await getEmailsWithRefreshToken\(/g)].map(m => m.index as number)
      if (!fetches.length) continue
      expect(t0s.length, `${f}: hay ${fetches.length} fetch y ${t0s.length} relojes`).toBe(fetches.length)
      fetches.forEach((pos, i) => {
        expect(t0s[i], `${f}: el reloj nº${i + 1} arranca DESPUÉS de su fetch de Gmail`).toBeLessThan(pos)
      })
    }
  })

  // Google pagina. Con singleEvents:true cada serie se expande en instancias, asi
  // que un daily de laborables son ~65 en la ventana de 3 meses: pasar de 100 pide
  // 1,1 eventos/dia. Se devolvia la pagina 1 con nextPageToken y nadie lo leia, sin
  // un solo error — el mes lejano salia A MEDIAS y se leia como completo.
  it('los eventos de calendario se paginan', () => {
    const G = leerCodigo('src/lib/gmail.ts')
    expect(/nextPageToken/.test(G),
      'events.list vuelve a ignorar nextPageToken: la agenda se corta en silencio').toBe(true)
    expect(/pageToken,?\s*$/m.test(G) || /pageToken\s*[,}]/.test(G),
      'no se pasa pageToken en la peticion: paginar sin pedir la pagina no hace nada').toBe(true)
    // El default de Google son 250: un maxResults escrito a mano por DEBAJO de eso
    // es peor que no poner nada.
    const bajos = (G.match(/maxResults:\s*(\d+)/g) || []).filter(m => Number(m.split(':')[1]) < 250)
    expect(bajos, `maxResults por debajo del default de Google (250): ${bajos.join(', ')}`).toEqual([])
  })

  // El camino personal lo miraba y el del buzon compartido lo tiraba, cincuenta
  // lineas mas abajo en el mismo fichero.
  it('quien lee `synced` de un sync lee tambien `insertFailures`', () => {
    const SINC = leerCodigo('src/components/sections/SincronizacionSection.tsx')
    const sinced = (SINC.match(/result\??\.synced/g) || []).length
    const fallos = (SINC.match(/result\??\.insertFailures/g) || []).length
    expect(sinced).toBeGreaterThan(0)
    expect(fallos, 'hay un camino que lee synced sin mirar insertFailures: 20 analizados y 0 guardados se anuncian en VERDE')
      .toBeGreaterThanOrEqual(sinced)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Lo que se PINTA y lo que se MANDA AL SERVIDOR son dos cosas distintas.
//
// El PDF de un proyecto tiene dos consumidores con requisitos opuestos:
//  · el visor y los <a href> necesitan algo que el navegador pueda ABRIR — con el
//    bucket cerrado eso obliga a una firma, o a /api/archivo, que la pide fresca;
//  · /api/projects/analyze-pdf exige que la URL pase su isOwnStorageUrl, y un
//    enlace de brutalia.tech NO lo pasa.
//
// Por eso el arreglo obvio —envolver la URL y ya— arregla el visor y estropea el
// chat sobre el PDF. La trampa es que eso COMPILA: las dos son `string`.
// ─────────────────────────────────────────────────────────────────────────────
describe('PDF de proyecto · el identificador no es la URL que se pinta', () => {
  const PROY = leerCodigo('src/components/sections/ProyectosSection.tsx')

  it('lo que se manda a analyze-pdf es el identificador', () => {
    const alServidor = PROY.split('\n').filter(l =>
      /analyze-pdf/.test(l) || /analyzePdf\(/.test(l))
    // La declaracion de la propia funcion no cuenta.
    const llamadas = alServidor.filter(l => !/const analyzePdf\s*=/.test(l))
    expect(llamadas.length, 'ya no hay llamadas a analyze-pdf: revisa esta regla').toBeGreaterThan(0)
    const sinIdent = llamadas.filter(l => /pdfDoc[?.]*\.url/.test(l) && !/pdfDoc\.ident/.test(l))
    expect(sinIdent.map(l => l.trim().slice(0, 90)),
      'manda al servidor la URL de PINTAR: analyze-pdf la rechaza con 400 «URL de PDF no permitida»').toEqual([])
  })

  it('y lo que se pinta tras subir pasa por /api/archivo', () => {
    const i = PROY.indexOf('setPdfDoc({')
    expect(i, 'ya no se pinta el PDF recien subido: revisa esta regla').toBeGreaterThan(-1)
    const bloque = PROY.slice(i, i + 320)
    expect(/api\/archivo/.test(bloque),
      'vuelve a pintar el publicUrl crudo: con el bucket cerrado da 400 y no se autocorrige').toBe(true)
    expect(/ident:/.test(bloque), 'no guarda el identificador aparte: el chat del PDF se queda sin el').toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Un INSERT cuyo error se tira es una escritura que puede no haber ocurrido.
//
// supabase-js NO lanza: devuelve { data, error }. Ya hay una regla que cubre los
// `select` que se desestructuran solo por `data`; esta cubre la escritura, que es
// la mitad que faltaba. Se encontraron SEIS, y la peor contestaba «✅ Tarea
// creada» por WhatsApp sin haber escrito una sola fila.
//
// Se persigue la forma `await X.from(...).insert(` a secas: si el error se
// recoge, la linea empieza por `const {` y no casa.
// ─────────────────────────────────────────────────────────────────────────────
describe('escrituras · ningún insert descarta su error', () => {
  const CULPABLES = TS.flatMap(f =>
    leerCodigo(f).split('\n')
      .map((l, i) => ({ f, i: i + 1, l }))
      .filter(({ l }) => /^\s*await\s+\w+\s*\.from\([^)]*\)\s*\.insert\(/.test(l)))

  it('ninguno', () => {
    expect(CULPABLES.map(u => `${u.f}:${u.i}`),
      'Inserta sin mirar `error`: supabase-js no lanza, así que el fallo es indistinguible del éxito').toEqual([])
  })

  // Y el caso concreto que lo hacía visible: el webhook anunciaba la tarea antes
  // de saber si se habia escrito, y ademas fuera del `if` que comprueba que haya
  // un perfil enlazado.
  it('WhatsApp no confirma una tarea que no ha escrito', () => {
    const W = leerCodigo('src/app/api/whatsapp/route.ts')
    const i = W.indexOf('Tarea creada')
    expect(i, 'ya no existe ese mensaje: revisa esta regla').toBeGreaterThan(-1)
    // El mensaje tiene que estar detras de una condicion que dependa del insert.
    expect(/creada\s*$|creada\s*\?/m.test(W.slice(Math.max(0, i - 200), i + 40)),
      'vuelve a anunciar la tarea sin comprobar que se escribio').toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Ningún fetch de servidor sin plazo.
//
// El invariante ya estaba escrito en el repo —ai.ts dice que los timeouts se
// eligen por debajo del maxDuration «para que el fallo lo dé la ruta, con
// mensaje, y no la plataforma cortando la función a secas»— pero cinco fetch
// crudos se habían quedado fuera: Tavily, Anthropic (harvey/chat usa fetch en vez
// del SDK), Fish Audio y los dos de transcripción.
//
// Sin `signal` rigen los defaults de undici: 300 s, CINCO VECES el maxDuration de
// 60 s. Y el modo de fallo no es una caída —esa cae sola en segundos— sino un
// CUELGUE: la función se agota, Vercel la mata sin respuesta, y el camino de error
// cuidadosamente escrito más abajo no llega a ejecutarse nunca.
// ─────────────────────────────────────────────────────────────────────────────
describe('fetch de servidor · siempre con plazo', () => {
  // Solo codigo de SERVIDOR: src/lib y las rutas de API. Un fetch de cliente a
  // nuestra propia API (`/api/...`) no corre bajo undici ni tiene maxDuration que
  // agotar, asi que exigirle plazo seria ruido.
  const SERVIDOR = TS.filter(f => f.startsWith('src/lib/') || f.startsWith('src/app/api/'))

  // El patron viejo era /await fetch\('https:\/\// — comilla simple PEGADA al
  // parentesis. No veia los cuatro fetch de whatsapp.ts: dos con la URL en la
  // linea siguiente, uno con backtick y otro con una variable. O sea que la regla
  // afirmaba «cero violaciones» siendo falso, y cualquier fetch futuro escrito con
  // template literal —que es la forma natural de una URL interpolada— entraba
  // invisible. Ahora: TODO `await fetch(` cuenta, y solo se excluye el que apunta
  // a una ruta relativa literal, que no sale de nuestro propio origen.
  const sinPlazo = SERVIDOR.flatMap(f => {
    const src = leerCodigo(f)
    const fuera: string[] = []
    for (const m of src.matchAll(/await fetch\(/g)) {
      const i = m.index as number
      const tras = src.slice(i, i + 620)
      const relativa = /await fetch\(\s*[`'"]\//.test(tras)
      if (relativa) continue
      const init = tras.split('})')[0]
      if (!/signal\s*:/.test(init)) fuera.push(`${f}:${src.slice(0, i).split('\n').length}`)
    }
    return fuera
  })

  it('hay fetch que revisar', () => {
    const total = SERVIDOR.filter(f => /await fetch\(/.test(leerCodigo(f)))
    expect(total.length, 'no se encontro ningun fetch de servidor').toBeGreaterThan(3)
  })

  it('ninguno se queda sin signal', () => {
    expect(sinPlazo,
      'Un cuelgue de ese servicio agota la función entera: 300 s de undici contra el maxDuration de la ruta').toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Seis cosas que la interfaz decía mal. Cuatro son gemelos donde la copia BUENA
// ya estaba en el repo, así que la regla fija que sigan iguales.
// ─────────────────────────────────────────────────────────────────────────────
describe('la interfaz no dice cosas que no son', () => {
  it('el callback de Gmail no anuncia «conectado» sin haber escrito', () => {
    const CB = leerCodigo('src/app/api/gmail/callback/route.ts')
    // Las dos ramas (colabs y personal) tienen que mirar error Y filas: un update
    // que no casa ninguna fila NO es error, y dejaba el mismo anuncio falso.
    expect((CB.match(/count:\s*'exact'/g) || []).length,
      'una de las dos ramas no cuenta las filas actualizadas').toBe(2)
    expect((CB.match(/error:\s*err(Colabs|Personal)/g) || []).length,
      'una de las dos ramas descarta el error del update').toBe(2)
  })

  it('/api/me no devuelve un id que quizá no se guardó', () => {
    const ME = leerCodigo('src/app/api/me/route.ts')
    const i = ME.indexOf("update({ id: user.id })")
    expect(i, 'ya no revincula perfiles: revisa esta regla').toBeGreaterThan(-1)
    expect(/const \{ error/.test(ME.slice(Math.max(0, i - 220), i)),
      'devuelve el id nuevo sin comprobar que la fila se actualizó: el cliente se queda apuntando a un perfil fantasma').toBe(true)
  })

  // Esta regla no ataba nada: exigia que la cadena apareciera, y pasaba en verde
  // con la llamada en una rama muerta — de hecho paso en verde con el bug del
  // cuerpo leido dos veces DENTRO, introducido por el mismo commit. Ahora fija lo
  // que de verdad importa: el cuerpo se lee UNA vez por respuesta.
  it('el cuerpo de la respuesta de transcripción se lee una sola vez', () => {
    for (const f of ['HoySection', 'HarveySection']) {
      const src = leerCodigo(`src/components/sections/${f}.tsx`)
      const i = src.indexOf("fetch('/api/harvey/transcribe'")
      expect(i, `${f}: ya no llama a transcribe`).toBeGreaterThan(-1)
      const bloque = src.slice(i, i + 1600)
      expect((bloque.match(/await res\.json\(\)/g) || []).length,
        `${f}: lee el cuerpo dos veces — la segunda rechaza y el silencio se anuncia como caída del servicio`).toBeLessThan(2)
    }
  })

  it('el fallo de transcripción no se le echa al usuario', () => {
    for (const f of ['HoySection', 'HarveySection']) {
      const src = leerCodigo(`src/components/sections/${f}.tsx`)
      expect(/mensajeErrorTranscripcion\(/.test(src),
        `${f} no usa el traductor común: vuelve a decir «no se entendió el audio» ante un 503`).toBe(true)
    }
    // La rama del 402 era código muerto: esa ruta no devuelve 402 en ningún sitio.
    expect(/status === 402/.test(leerCodigo('src/components/sections/HoySection.tsx')),
      'vuelve la rama del 402, que no existe en el servidor').toBe(false)
  })

  it('Harvey no confunde «los que enseño» con «los que hay»', () => {
    const H = leerCodigo('src/components/sections/HarveySection.tsx')
    expect(/nSinLeer/.test(H), 'vuelve a etiquetar la lista recortada como «sin leer»').toBe(true)
    expect(/INBOX — \$\{unreadEmails\.length\} sin leer:/.test(H),
      'la lista lleva .slice(0,8): con más de 8 diría siempre exactamente 8').toBe(false)
  })

  // La tarjeta de confirmación es la última red antes de mandar invitaciones por
  // correo. HoySection ya enseñaba la hora; HarveySection no.
  it('las dos tarjetas de Harvey enseñan la hora', () => {
    for (const f of ['HoySection', 'HarveySection']) {
      const src = leerCodigo(`src/components/sections/${f}.tsx`)
      const fechas = (src.match(/\{pendingAction\.date\}/g) || []).length
      const horas = (src.match(/\{pendingAction\.date\}\{pendingAction\.time/g) || []).length
      expect(horas, `${f}: ${fechas - horas} tarjeta(s) pintan la fecha sin la hora`).toBe(fechas)
    }
  })

  it('abrir un correo sincroniza el que está abierto, no solo la lista', () => {
    const I = leerCodigo('src/components/sections/InboxSection.tsx')
    expect(/data\.markRead\(m\.id\)/.test(I),
      'vuelve a llamar a markRead a pelo: el reducer crea un objeto nuevo y `selected` se queda con is_read:false para siempre').toBe(false)
  })

  it('guardar una tarea manda solo lo que se ha cambiado', () => {
    const T = leerCodigo('src/components/sections/TareasSection.tsx')
    const i = T.indexOf('const saveTask =')
    const cuerpo = T.slice(i, i + 1400)
    expect(/updateTask\(activeTask\.id,\s*editing\)/.test(cuerpo),
      'vuelve a mandar `editing` entero: resucita una tarea completada desde otra pestaña y borra su completed_at').toBe(false)
    expect(/cambios/.test(cuerpo), 'no construye el diff de campos tocados').toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Dos errores MIOS de la tanda del 2026-08-13, los dos de la misma familia:
// anadir una comprobacion y cambiar de paso la semantica de al lado.
// ─────────────────────────────────────────────────────────────────────────────
describe('una comprobación no puede cambiar lo que ya funcionaba', () => {
  // Los turnos del chat son SECUENCIALES a proposito —lo dice el comentario justo
  // encima— para que `created_at` difiera y el orden quede determinado. Al anadir
  // la comprobacion de error se pusieron en Promise.all, y entonces la respuesta
  // puede leerse antes que la pregunta.
  it('los dos turnos del chat se escriben en orden', () => {
    const C = leerCodigo('src/app/api/chat/route.ts')
    // Anclado a los INSERT, no al primer `chat_messages` del fichero — ese es el
    // SELECT del historial y queda lejos, asi que la ventana no llegaba y la regla
    // pasaba en verde con los inserts en paralelo. Comprobado por mutacion.
    const idx: number[] = []
    const re = /from\('chat_messages'\)\.insert\(/g
    let m: RegExpExecArray | null
    while ((m = re.exec(C))) idx.push(m.index)
    expect(idx.length, 'ya no hay dos inserts de turno: revisa esta regla').toBe(2)
    const bloque = C.slice(Math.max(0, idx[0] - 260), idx[1] + 160)
    expect(/Promise\.all/.test(bloque),
      'los inserts del chat vuelven a ir en paralelo: created_at puede coincidir y el orden se pierde').toBe(false)
  })

  // El `count` de un UPDATE solo se rellena si PostgREST devuelve `content-range`.
  // Escribir `!count` en vez de `count === 0` convierte un chequeo defensivo en una
  // rotura total: si la cabecera no llega, la conexion de Gmail falla SIEMPRE, para
  // todo el mundo.
  it('el count de un update solo corta cuando es 0 de verdad', () => {
    const CB = leerCodigo('src/app/api/gmail/callback/route.ts')
    expect(/\|\|\s*!filas/.test(CB),
      'usa !count: si PostgREST no manda content-range, count es null y esto rompe la conexión de Gmail para todos').toBe(false)
    expect((CB.match(/filas\w*\s*===\s*0/g) || []).length,
      'alguna rama no comprueba el count de forma segura').toBe(2)
  })

  // Conceder el permiso del navegador NO activa los avisos: es la mitad. Falta
  // crear la PushSubscription y mandarla al servidor, que es lo unico que le dice
  // a que aparato empujar. La puesta en marcha tenia escrita solo la primera
  // mitad y decia «Avisos activados» en verde sin que llegara nada — y dejaba el
  // permiso concedido, que es el estado en el que el navegador ya no vuelve a
  // preguntar, asi que nadie se enteraba nunca.
  //
  // Gemelo de manual: la misma operacion escrita dos veces, correcta en una copia
  // (Operativa) y a medias en la otra. La regla no comprueba que la puesta en
  // marcha lo haga bien — comprueba que NADIE pueda escribir la segunda copia.
  it('nadie pide el permiso de avisos por su cuenta', () => {
    const infractores: string[] = []
    for (const ruta of TS) {
      if (ruta === 'src/lib/activarPush.ts') continue   // la única copia legítima
      if (/Notification\.requestPermission\(/.test(leerCodigo(ruta))) infractores.push(ruta)
    }
    expect(infractores,
      'piden el permiso a mano en vez de usar activarPush(): un permiso concedido sin suscripcion es una pantalla que promete avisos que no llegan')
      .toEqual([])
  })

  // El dia del diario es un dia de MADRID; `completed_at` es un instante UTC.
  // Compararlos como texto (`${dia}T00:00:00Z`) desplaza el dia dos horas en
  // verano: lo cerrado entre medianoche y las dos se apuntaba al dia anterior,
  // mientras Reportes —que si usa localDayKey— lo colocaba bien. Dos pantallas
  // dando dos respuestas del mismo trabajo. Estaba escrito en TRES sitios.
  it('ninguna ventana de tareas se construye pegando la Z a una clave de dia', () => {
    const infractores: string[] = []
    for (const ruta of TS) {
      const C = leerCodigo(ruta)
      // Solo cuando se usa para acotar `completed_at`: la cadena por si sola
      // aparece en sitios legitimos (calcular un dia, por ejemplo).
      if (/completed_at'[^)]*\$\{[a-zA-Z]+\}T00:00:00Z/.test(C)) infractores.push(ruta)
    }
    expect(infractores,
      'acota completed_at pegando la Z a una clave de dia: usa ventanaDelDia() y decide con localDayKey')
      .toEqual([])
  })

  // «Tarea de quien» estaba escrito de dos maneras: Reportes contaba tambien al
  // co-responsable y el Diario, el briefing y Harvey no. Una tarea compartida
  // sumaba en un comprobador y no en el otro.
  it('los cuatro sitios cuentan igual de quien es una tarea', () => {
    const infractores: string[] = []
    for (const ruta of TS) {
      if (!/api\/(diario|harvey)/.test(ruta)) continue
      if (/assigned_to === p\.id/.test(leerCodigo(ruta))) infractores.push(ruta)
    }
    expect(infractores,
      'compara assigned_to a pelo en vez de esTareaDe(): las tareas con co-responsable se cuentan distinto que en Reportes')
      .toEqual([])
  })

  // El calendario del Diario deja PLANIFICAR dias futuros a proposito. Sin tope
  // por arriba, Harvey leia esos planes y los contaba como trabajo hecho.
  it('harvey no lee dias del diario que aun no han pasado', () => {
    const C = leerCodigo('src/app/api/harvey/chat/route.ts')
    const i = C.indexOf("from('diario')")
    expect(i, 'harvey ya no lee el diario: revisa esta regla').toBeGreaterThan(-1)
    const consulta = C.slice(i, i + 260)
    expect(/lte\('dia'/.test(consulta),
      'la consulta del diario no tiene tope por arriba: Harvey contaria como hecho lo que solo esta planificado').toBe(true)
  })

  // `diario_dia` lo escribe el CLIENTE (lo manda el Diario al crear la tarea) y
  // luego el propio Diario filtra por esa columna. Un valor con otra forma se
  // quedaria ahi para siempre sin emparejar nada, y sin error visible. Es la
  // misma razon por la que existe `pick()`: lo que llega del cliente y acaba en
  // una columna se valida, no se confia.
  it('el dia de diario que manda el cliente se valida antes de guardarse', () => {
    const T = leerCodigo('src/app/api/tasks/route.ts')
    expect(/diario_dia/.test(T), 'la ruta ya no acepta diario_dia: revisa esta regla').toBe(true)
    expect(/\\d\{4\}-\\d\{2\}-\\d\{2\}/.test(T),
      'diario_dia entra sin comprobar la forma: una clave mal formada se guarda y no empareja con nada').toBe(true)
    // Y las dos columnas van juntas: un vinculo a medias no empareja y encima
    // parece que si, porque la columna existe.
    const i = T.indexOf('diario_dia !== undefined')
    expect(i, 'ya no se valida diario_dia: revisa esta regla').toBeGreaterThan(-1)
    expect(/delete fields\.diario_objetivo/.test(T.slice(i, i + 320)),
      'descarta el dia pero deja el objetivo: queda un vinculo a medias').toBe(true)
  })

  // El PATCH no debe dejar reescribir el vinculo: cambiarlo a mano moveria una
  // tarea al dia de otro y descuadraria los dos comprobadores.
  it('el vinculo con el diario no se puede reescribir desde el cliente', () => {
    const P = leerCodigo('src/app/api/tasks/[id]/route.ts')
    expect(/pick\(body, \[[^\]]*diario_/.test(P),
      'el PATCH deja cambiar diario_dia: se podria mover una tarea al dia de otra persona').toBe(false)
  })

  // El alta de un miembro hace TRES viajes a Supabase seguidos. Con el plazo del
  // cliente en 15 s, en frio se rendia con «Error de red» mientras el servidor
  // terminaba bien: habia que darle dos veces, y a la segunda ya existia la
  // cuenta. Un plazo de cliente MENOR que lo que tarda la ruta convierte un exito
  // en un error a la cara del usuario.
  it('el alta de miembro da plazo suficiente y lo declara en la ruta', () => {
    const E = leerCodigo('src/components/sections/EquipoSection.tsx')
    const i = E.indexOf("fetchWithTimeout('/api/admin/team'")
    expect(i, 'ya no se llama asi al alta: revisa esta regla').toBeGreaterThan(-1)
    const m = /timeoutMs: (\d+)_?(\d*)/.exec(E.slice(i, i + 900))
    expect(m, 'el alta no declara plazo').not.toBeNull()
    expect(Number(m![1] + (m![2] || '')),
      'el plazo del cliente es corto para tres viajes a Supabase en frio: se rendira con la cuenta ya creada')
      .toBeGreaterThanOrEqual(30_000)
    const R = leerCodigo('src/app/api/admin/team/route.ts')
    expect(/export const maxDuration/.test(R),
      'la ruta del equipo no declara maxDuration: un cuelgue no se distingue de un fallo').toBe(true)
  })

  // El enlace es lo UNICO que se le puede mandar a la persona nueva. Si su
  // generacion falla en silencio queda una cuenta creada sin nada que enviar, y
  // desde fuera eso es identico a «el alta no ha funcionado».
  it('un fallo al generar el enlace de invitacion no se traga', () => {
    const R = leerCodigo('src/app/api/admin/team/route.ts')
    const i = R.indexOf('async function generarEnlace')
    expect(i, 'ya no existe generarEnlace: revisa esta regla').toBeGreaterThan(-1)
    const cuerpo = R.slice(i, R.indexOf('\n}', i))
    // supabase-js no lanza: el error viaja en la respuesta y hay que mirarlo.
    expect(/if \(error\)/.test(cuerpo),
      'no mira el error de generateLink: un fallo saldria como enlace nulo sin motivo').toBe(true)
    expect(/motivo/.test(cuerpo), 'no devuelve el motivo del fallo').toBe(true)
  })

  // Dar de baja a un propietario esta permitido, pero hay dos bajas que no tienen
  // vuelta atras: la del ULTIMO propietario deja el workspace sin nadie que pueda
  // nombrar a otro (esta misma ruta exige ser owner), y la de UNO MISMO te deja
  // fuera de tu propia app a mitad de clic.
  it('no se puede borrar al ultimo propietario ni a uno mismo', () => {
    const R = leerCodigo('src/app/api/admin/team/route.ts')
    const i = R.indexOf('export async function DELETE')
    expect(i, 'ya no hay DELETE: revisa esta regla').toBeGreaterThan(-1)
    const cuerpo = R.slice(i)
    expect(/profile\.id === ctx\.user\.id/.test(cuerpo),
      'deja darse de baja a uno mismo: te quedas fuera sin otra puerta').toBe(true)
    expect(/count/.test(cuerpo),
      'no cuenta cuantos propietarios quedan: se podria borrar al ultimo').toBe(true)
    // Y un fallo al contar NO puede leerse como «hay de sobra».
    const iC = cuerpo.indexOf('errCuenta')
    expect(iC, 'no captura el error de la cuenta de propietarios').toBeGreaterThan(-1)
    expect(/status: 500/.test(cuerpo.slice(iC, iC + 400)),
      'un fallo al contar propietarios se trata como si hubiera de sobra: autorizaria borrar al ultimo').toBe(true)
  })

  // Un cliente detectado en un PDF se PROPONE, nunca se crea solo. Una lectura
  // dudosa que da de alta un cliente lo mete a la vez en Clientes, en Proyectos y
  // en Reportes, y sacarlo de los tres cuesta mucho mas que el clic que ahorra.
  it('el cliente que sale de un documento se propone, no se crea', () => {
    const R = leerCodigo('src/app/api/documents/route.ts')
    expect(/clientePropuesto/.test(R), 'la ruta ya no propone clientes: revisa esta regla').toBe(true)
    // La ruta NO puede escribir en clients: solo leer para comparar.
    expect(/from\('clients'\)\s*\.insert|from\('clients'\)\.insert/.test(R),
      'la ruta de documentos crea clientes por su cuenta: una lectura dudosa ensucia Clientes, Proyectos y Reportes').toBe(false)

    // Y un fallo al LEER los clientes no puede leerse como «no existe»: propondria
    // dar de alta uno que ya esta.
    const i = R.indexOf("from('clients')")
    expect(i, 'ya no consulta los clientes: revisa esta regla').toBeGreaterThan(-1)
    expect(/errCli/.test(R.slice(i, i + 700)),
      'no captura el error al leer clientes: un fallo propondria duplicar un cliente existente').toBe(true)
  })

  // El documento se analiza UNA vez y lo que se guarda es el resultado. Volver a
  // mandarle el PDF entero a Claude en cada pregunta seria pagar lo mismo cada dia
  // por leer algo que ya se leyo.
  it('un documento se lee una sola vez', () => {
    const H = leerCodigo('src/app/api/harvey/chat/route.ts')
    expect(/type: 'document'|media_type: 'application\/pdf'/.test(H),
      'Harvey manda documentos crudos al modelo: eso se paga en CADA pregunta').toBe(false)
  })

  // Preguntar «que ha hecho X» pide un JUICIO, no un inventario. Sin instruccion,
  // el modelo recita los titulos de las tareas uno por uno — medido: 130 palabras
  // y los 5 titulos literales, con listas y emojis, en algo que se lee EN VOZ ALTA.
  it('harvey resume el trabajo de alguien en vez de recitarlo', () => {
    const H = leerCodigo('src/app/api/harvey/chat/route.ts')
    expect(/CÓMO SE CUENTA LO QUE HA HECHO ALGUIEN/.test(H),
      'se quitó la instrucción de sintetizar: Harvey volvera a leer la lista entera en voz alta').toBe(true)
    expect(/MUESTRA, no la lista completa/.test(H),
      'no se avisa de que los ejemplos son una muestra: Harvey diria «solo ha hecho estas»').toBe(true)
  })

  // Arrastrar a hoy lo que quedo pendiente MUEVE `diario_dia`, que es la columna
  // por la que el Diario decide de que dia es cada tarea. Las tres condiciones
  // tienen que ir en el propio UPDATE, no en una comprobacion previa: entre mirar
  // y escribir hay un hueco, y ahi cabe mover el trabajo de otra persona.
  it('arrastrar solo mueve MIS tareas sin terminar, y siempre a hoy', () => {
    const A = leerCodigo('src/app/api/diario/arrastrar/route.ts')
    const i = A.indexOf("update({ diario_dia")
    expect(i, 'ya no existe el update de arrastrar: revisa esta regla').toBeGreaterThan(-1)
    const consulta = A.slice(i, i + 420)
    expect(/\.eq\('assigned_to', user\.id\)/.test(consulta),
      'no acota a mis tareas: se podria mover el trabajo de otra persona a mi dia').toBe(true)
    expect(/\.eq\('done', false\)/.test(consulta),
      'no excluye las terminadas: resucitaria trabajo ya cerrado y descuadraria los reportes').toBe(true)
    // El dia NO puede venir del cliente: siempre hoy.
    expect(/diario_dia: hoy/.test(A),
      'el dia de destino sale de otro sitio que no es todayKey(): se podria mover una tarea a cualquier dia').toBe(true)
    expect(/body\?\.dia|body\.dia/.test(A),
      'acepta el dia por el body: eso permite colocar trabajo en el dia que se quiera').toBe(false)
  })

  // La facturacion es TEXTO LIBRE y nadie la escribe igual. Un `parseFloat` sobre
  // la cadena limpia devuelve numeros mil veces menores sin avisar («12k» -> 12,
  // «1.2M» -> 12) y tira el periodo, asi que un contrato anual se suma al MRR
  // entero, doce veces mas de lo que es. Los importes que se leen mal no fallan:
  // simplemente enseñan otra cosa.
  it('los importes se leen con parseImporte, no con parseFloat a pelo', () => {
    const infractores: string[] = []
    for (const ruta of TS) {
      if (ruta === 'src/components/shared/helpers.ts') continue   // el intérprete
      const C = leerCodigo(ruta)
      // Un parseFloat cerca de `revenue` es el patron exacto que habia.
      if (/revenue[\s\S]{0,200}parseFloat|parseFloat[\s\S]{0,200}revenue/.test(C)) infractores.push(ruta)
    }
    expect(infractores,
      'lee la facturacion con parseFloat: «12k» saldria como 12 y lo anual se sumaria como mensual')
      .toEqual([])
  })

  it('el MRR suma el equivalente mensual, no el importe crudo', () => {
    const R = leerCodigo('src/components/sections/ReportesSection.tsx')
    expect(/parseImporte\([^)]*\)\.mensual/.test(R),
      'el MRR suma el importe tal cual: un contrato anual contaria doce veces lo que vale').toBe(true)
  })

  // Memoria solo sirve si esta TODO, y para que este todo tiene que entrar solo.
  // Pero «las 12 mas recientes» convertia eso en una trampa: cada documento que
  // entra echa fuera una decision o un aprendizaje escritos a mano, que son pocos
  // y son justo lo que dice COMO se trabaja aqui. Guardar mas haria saber menos.
  it('nadie arma contexto de memoria cortando por fecha', () => {
    // Esta regla miraba SOLO HarveySection, y ahi la logica ya estaba bien: el
    // bug vivia en HoySection, que cogia «las 12 mas recientes» y por tanto perdia
    // la doctrina del estudio en cuanto habia trece documentos subidos. Una regla
    // atada a un fichero no ve el gemelo del de al lado; esta mira a TODOS.
    //
    // El criterio en si —lo curado entra siempre, los documentos por relevancia—
    // tiene sus propios tests en src/lib/__tests__/memoriaRelevante.test.ts, que es
    // donde se puede comprobar de verdad. Aqui solo se vigila que nadie se lo salte.
    const infractores: string[] = []
    for (const ruta of TS) {
      if (ruta === 'src/lib/memoriaRelevante.ts') continue          // el que decide
      const C = leerCodigo(ruta)
      if (/data\.memoria[^\n]{0,40}\.slice\(\s*0\s*,\s*\d+\s*\)/.test(C)) infractores.push(ruta)
    }
    expect(infractores,
      'corta la memoria por fecha: cada PDF que se sube empuja fuera lo escrito a mano, y el modelo deja de saber como se trabaja aqui sin que se note')
      .toEqual([])

    // Y quien SI arma contexto, que use el de verdad.
    for (const ruta of ['src/components/sections/HarveySection.tsx', 'src/components/sections/HoySection.tsx']) {
      expect(leerCodigo(ruta).includes("from '@/lib/memoriaRelevante'"),
        `${ruta} arma contexto de memoria sin usar el selector comun: es como nacio el gemelo`).toBe(true)
    }

    // El contexto se construye SABIENDO que se ha preguntado, o no hay relevancia
    // que valga: sin la pregunta el selector solo puede caer a los recientes.
    expect(/buildContext\(userText\)/.test(leerCodigo('src/components/sections/HarveySection.tsx')),
      'el contexto se construye sin saber que se ha preguntado: no puede elegir por relevancia').toBe(true)
  })

  // Si la nota entra sola, tiene que poder entrar mil veces sin duplicar: abrir el
  // mismo proyecto tres veces dejaria tres notas identicas y Memoria pasaria de
  // ser conocimiento a ser ruido.
  it('llevar un documento a memoria es idempotente', () => {
    const P = leerCodigo('src/components/sections/ProyectosSection.tsx')
    const i = P.indexOf('const llevarAMemoria')
    expect(i, 'ya no existe llevarAMemoria: revisa esta regla').toBeGreaterThan(-1)
    const cuerpo = P.slice(i, i + 900)
    expect(/data\.memoria[\s\S]{0,120}m\.title === titulo/.test(cuerpo),
      'no comprueba si ya hay nota de ese proyecto: correr solo lo duplicaria en cada visita').toBe(true)
  })

  // Reportes es el COMPROBADOR: si no puede leer el diario del equipo tiene que
  // DECIRLO, no pintar ceros. «Nadie ha trabajado» y «no pude leerlo» son cosas
  // distintas, y confundirlas es como un error vive semanas en este repo — es la
  // misma trampa que motivo src/lib/queryLog.ts, ahora en el cliente.
  it('reportes no disfraza un fallo del diario de «nadie ficho»', () => {
    const R = leerCodigo('src/components/sections/ReportesSection.tsx')
    expect(/diario\/briefing/.test(R), 'Reportes ya no lee el diario: revisa esta regla').toBe(true)
    // Tres estados distintos, no dos: cargando, error y ok.
    expect(/briefEstado === 'error'/.test(R),
      'no distingue el fallo: un 500 se pintaria igual que una semana sin fichar').toBe(true)
    const i = R.indexOf('/api/diario/briefing')
    const carga = R.slice(Math.max(0, i - 400), i + 500)
    expect(/if \(!r\.ok\)/.test(carga),
      'no comprueba r.ok: un 403 o un 500 resuelven la promesa y se leerian como datos vacios').toBe(true)
  })

  // Buscar con `includes()` de la cadena entera en minusculas falla en los dos
  // casos que se dan de verdad escribiendo en espanol: «diseno» no encuentra
  // «diseño» (no normaliza) y «presupuesto nike» no encuentra «Presupuesto de
  // Nike» (busca la frase literal). Estaba escrito SIETE veces en seis ficheros,
  // y en Proyectos dos de ellas eran la lista y su RECUENTO: arreglando una sola,
  // el numero y lo que se ve dirian cosas distintas.
  it('ninguna busqueda vuelve al includes() sin normalizar', () => {
    const infractores: string[] = []
    for (const ruta of TS) {
      if (ruta === 'src/components/shared/helpers.ts') continue   // el helper
      const C = leerCodigo(ruta)
      // El patron exacto: comparar contra una variable de busqueda con includes.
      if (/toLowerCase\(\)\.includes\([a-zA-Z]*[Ss]earch[a-zA-Z]*\.toLowerCase\(\)\)/.test(C)) infractores.push(ruta)
    }
    expect(infractores,
      'busca con includes() sin normalizar: «diseno» no encontraria «diseño» ni dos palabras sueltas encontrarian la frase')
      .toEqual([])
  })
})

// ───────────────────────────────────────────────────────────────────────────────
// La tanda de la auditoría del 2026-08-19. Las cuatro se verificaron poniendo el
// fallo de vuelta y viendo la suite en rojo.
// ───────────────────────────────────────────────────────────────────────────────
describe('diario · auditoria del 19 de agosto', () => {

  // El gemelo puro: CalendarioDiario hacía `setDias(j.dias || {})` y SemanaDiario,
  // escrita después contra el MISMO endpoint, fusionaba la respuesta entera. La
  // tira salía muda en producción —sin iniciales, sin contador, la racha clavada
  // en 0— y en /preview se veía bien porque la rama demo se salta el fetch.
  it('todo el que lee /api/diario/mes saca su campo .dias', () => {
    const infractores: string[] = []
    for (const ruta of TS) {
      if (ruta.startsWith('src/app/api/')) continue        // la ruta que lo SIRVE
      const C = leerCodigo(ruta)
      if (!C.includes('/api/diario/mes')) continue
      if (!/\.dias\b/.test(C)) infractores.push(ruta)
    }
    expect(infractores,
      'lee /api/diario/mes sin sacar `.dias`: la ruta responde { mes, dias }, asi que el objeto entero no tiene NINGUNA clave de dia y todo sale vacio sin un solo error')
      .toEqual([])
  })

  // El día del borrador no puede cambiar mientras el texto sigue sin mandar: al
  // pulsar la flecha, React renderiza ANTES de correr el efecto de [dia], así que
  // lo tecleado en el día que dejabas se guardaba en el que abrías —pisando por
  // upsert un día que la propia UI declara de solo lectura—.
  it('el borrador pendiente del diario no cambia de dia conservando el texto', () => {
    const C = leerCodigo('src/components/sections/DiarioSection.tsx')
    expect(/pendiente\.current\s*=\s*\{\s*\.\.\.pendiente\.current\s*,\s*dia\s*\}/.test(C),
      'reescribe el dia del borrador CONSERVANDO el texto pendiente: lo escrito en un dia acaba guardado en otro')
      .toBe(false)
  })

  // Acotado al CUERPO del efecto de cambio de día: que exista `setPropuestas([])`
  // en el fichero no dice nada —hay uno en el botón de descartar—.
  it('cambiar de dia limpia las propuestas del dia anterior', () => {
    const C = leerCodigo('src/components/sections/DiarioSection.tsx')
    const cuerpo = C.split('vaciarPendiente()')[1]?.split('}, [dia])')[0] || ''
    expect(cuerpo.includes('setPropuestas([])'),
      'el efecto de [dia] no limpia `propuestas`: el panel sigue enseñando las del dia anterior y ACEPTAR las crea en el dia equivocado')
      .toBe(true)
  })

  // El texto que llega de la base de datos no es texto tecleado: pagar una llamada
  // al modelo por releerlo era una llamada por visita y por dia navegado.
  it('el texto sembrado desde la BD cuenta como ya extraido', () => {
    const C = leerCodigo('src/components/sections/DiarioSection.tsx')
    const cuerpo = C.split('if (sembrado.current || !miEntrada) return')[1]?.split('}, [miEntrada])')[0] || ''
    expect(cuerpo.includes('ultimoExtraido.current'),
      'la siembra no marca el texto como ya extraido: abrir el diario a MIRAR dispara una llamada al modelo con lo que ya estaba guardado')
      .toBe(true)
  })

  // Corregir el texto de una fila ya fichada creaba una tarea NUEVA y dejaba la
  // vieja huerfana y abierta: dos tareas para un solo trabajo, el anillo contando
  // dos, y la huerfana volviendo al dia siguiente. Y no hacia falta una errata:
  // bastaba con salir de la fila a medio escribir.
  it('corregir el texto de una fila renombra su tarea, no crea otra', () => {
    const C = leerCodigo('src/components/sections/DiarioSection.tsx')
    const i = C.indexOf('const alSalirDeFila')
    expect(i, 'ya no existe alSalirDeFila: revisa esta regla').toBeGreaterThan(-1)
    const cuerpo = C.slice(i, C.indexOf('\n  }', i))
    expect(/updateTask\(/.test(cuerpo),
      'salir de la fila solo sabe CREAR: corregir el texto deja la tarea vieja huerfana y abierta, y nace otra al lado')
      .toBe(true)
    // Y la comparacion va normalizada, o un acento o una mayuscula de mas cuentan
    // como objetivo distinto y vuelve a duplicar.
    expect(/normalizar\(antes\)\s*!==\s*normalizar\(nuevo\)/.test(cuerpo),
      'compara los textos en crudo: cambiar una tilde o una mayuscula creara una tarea duplicada')
      .toBe(true)
  })

  // Y la tarea renombrada tiene que seguir emparejando con su fila: el PATCH no
  // deja mover `diario_objetivo` (otra regla lo fija, y con motivo), asi que la
  // busqueda por texto no puede exigir que la tarea NO tenga vinculo.
  it('una tarea renombrada sigue emparejando con su objetivo', () => {
    const C = leerCodigo('src/components/sections/DiarioSection.tsx')
    const i = C.indexOf('const tareaDe')
    expect(i, 'ya no existe tareaDe: revisa esta regla').toBeGreaterThan(-1)
    const cuerpo = C.slice(i, C.indexOf('\n  }', i))
    expect(/!t\.diario_objetivo && normalizar\(t\.text/.test(cuerpo),
      'la busqueda por texto exige que la tarea no tenga vinculo: una tarea renombrada queda invisible para el diario y se crea otra')
      .toBe(false)
  })

  // El tramo del briefing es un ARRAY de claves de dia. Tratarlo como un numero no
  // lo caza TypeScript (res.json() es any) y sale impreso en el PDF de gestion.
  it('nadie trata el `dias` del briefing como si fuera un numero', () => {
    const infractores: string[] = []
    for (const ruta of TS) {
      if (ruta.startsWith('src/app/api/')) continue
      const C = leerCodigo(ruta)
      if (!C.includes('/api/diario/briefing')) continue
      if (/\bj\.dias\b/.test(C) && !/Array\.isArray\(j\.dias\)/.test(C)) infractores.push(ruta)
    }
    expect(infractores,
      'usa `j.dias` del briefing sin normalizarlo: es el array de claves de dia, y el `?? 7` no salta porque un array no es nullish')
      .toEqual([])
  })
})

// ───────────────────────────────────────────────────────────────────────────────
// Las mejoras del 2026-08-19. Cuatro de las seis eran GEMELOS —lo mismo arreglado
// en un sitio y viejo en el otro—, así que las reglas miran a TODOS los ficheros
// en vez de al que tenía el fallo: una regla atada a un fichero no ve a su gemelo.
// ───────────────────────────────────────────────────────────────────────────────
describe('mejoras del 19 de agosto', () => {

  // Pulsabas ALTA al crear y la tarea salía etiquetada MEDIA, porque el rótulo
  // estaba escrito de tres maneras. Y el filtro era `value="urgent"` con la
  // etiqueta «Alta»: filtrar por Alta devolvía las Urgentes.
  it('nadie se escribe su propio vocabulario de prioridades', () => {
    const infractores: string[] = []
    for (const ruta of TS) {
      if (ruta === 'src/components/shared/helpers.ts') continue      // donde vive
      if (ruta.startsWith('src/lib/__tests__/')) continue
      const C = leerCodigo(ruta)
      // El patrón exacto: traducir un `level` a un rótulo con un ternario.
      if (/level\s*===\s*'urgent'\s*\?\s*'[A-Za-zÁÉÍÓÚáéíóú]/.test(C)) infractores.push(ruta)
      // O un mapa propio de los tres niveles.
      if (/urgent\s*:\s*\{\s*label\s*:\s*'[A-Z]/.test(C)) infractores.push(ruta)
      // Y el vocabulario VIEJO, escrito como sea. Buscar la FORMA del mapa dejaba
      // pasar copias con otra forma —salieron dos escritas `l:` en vez de `label:`,
      // y una con solo el nivel `high` cambiado—; el rótulo en sí no se escapa.
      // «Media» y «Baja» no son niveles de esta app: los tres son Urgente/Alta/Normal.
      if (/['"](MEDIA|BAJA|Media|Baja)['"]/.test(C)) infractores.push(ruta)
    }
    expect([...new Set(infractores)],
      'traduce los niveles por su cuenta: asi es como «Urgente» acabo mostrandose como ALTA en una pantalla y como MEDIA en otra')
      .toEqual([])
  })

  // El importe lo escribe una persona a mano («12k/mes», «120k/año»), así que hay
  // un solo parser que sabe de sufijos y de anual. Clientes tenia el suyo, viejo, y
  // la MISMA pantalla decia «es lo que suma en Reportes» debajo de otra cifra.
  it('el dinero lo interpreta un solo parser', () => {
    const infractores: string[] = []
    for (const ruta of TS) {
      if (ruta === 'src/components/shared/helpers.ts') continue
      const C = leerCodigo(ruta)
      // Un parseFloat sobre `revenue` es siempre un parser casero: el bueno
      // devuelve { mensual, anual } y no se llama asi.
      if (/parseFloat\([^)]*revenue/i.test(C) || /const parse\w*\s*=\s*\([^)]*\)\s*(:\s*number\s*)?=>\s*\{?[^}]*parseFloat[^}]*replace\(\/\\\/\.\*/.test(C)) {
        infractores.push(ruta)
      }
    }
    expect(infractores,
      'interpreta importes por su cuenta: «12k» valdra 12 € y el MRR del estudio dependera de por que pantalla entres')
      .toEqual([])
  })

  // La insignia del menu contaba las urgentes del EQUIPO mientras la campana de al
  // lado contaba solo las tuyas: dos numeros del mismo concepto discrepando.
  it('el contador del menu cuenta las tareas de quien mira', () => {
    const C = leerCodigo('src/components/NexusDashboard.tsx')
    const i = C.indexOf('const urgentCount')
    expect(i, 'ya no existe urgentCount: revisa esta regla').toBeGreaterThan(-1)
    expect(/esTareaDe\(/.test(C.slice(i, i + 200)),
      'la insignia del menu cuenta las urgentes de todo el equipo mientras la campana de al lado cuenta las tuyas')
      .toBe(true)
  })

  // Repartir trabajo en un estudio es crear la tarea suelta y asignarla despues, y
  // ese camino —el PATCH— no avisaba a nadie. El co-responsable no se enteraba
  // nunca, ni al crear.
  it('entrar en una tarea avisa, se entre al crearla o al reasignarla', () => {
    const P = leerCodigo('src/app/api/tasks/[id]/route.ts')
    expect(/sendPushToUser\(/.test(P),
      'reasignar una tarea no avisa a nadie: el selector «ASIGNAR A» guarda por aqui').toBe(true)
    expect(/export const maxDuration/.test(P),
      'espera un push sin declarar maxDuration: un cuelgue no se distingue de un fallo').toBe(true)
    // Y con el ANTES, o avisaria por cualquier retoque de una tarea que ya era tuya.
    expect(/antes\?\.assigned_to/.test(P),
      'no mira quien la tenia antes: avisaria al tocar las notas de una tarea que ya era tuya, y eso ensena a ignorar los avisos').toBe(true)
    // Acotado al trozo que decide A QUIEN se avisa, no al fichero: `co_assigned_to`
    // aparece en el pick() y en el SELECT de las dos rutas, asi que buscarlo suelto
    // pasaba en verde con el aviso roto. Y el ancla es la LLAMADA, no la primera
    // aparicion del nombre — que es el import.
    for (const ruta of ['src/app/api/tasks/route.ts', 'src/app/api/tasks/[id]/route.ts']) {
      const C = leerCodigo(ruta)
      const i = C.indexOf('await sendPushToUser(')
      expect(i, `${ruta} ya no manda push: revisa esta regla`).toBeGreaterThan(-1)
      expect(/co_assigned_to/.test(C.slice(Math.max(0, i - 700), i)),
        `${ruta} decide a quien avisar sin mirar al co-responsable: no le llega nada`).toBe(true)
    }
  })

  // Cuatro secciones existian y no estaban en ningun menu. Memoria es «como se
  // hacen las cosas aqui»: la que mas sirve a quien acaba de entrar.
  it('toda seccion navegable esta en algun menu y tiene titulo', () => {
    const C = leerCodigo('src/components/NexusDashboard.tsx')
    // Operativa CUENTA como puerta: memoria, equipo, automatizaciones y reportes
    // son pestanas suyas, y ponerlas ademas en la barra lateral era duplicar la
    // entrada y alargar la lista — un menu con todo dentro no es mas accesible,
    // es mas dificil de recorrer.
    //
    // Lo que esta regla protege NO es «esta en la barra», es «se puede llegar sin
    // saberse un atajo de teclado». Contarlo mal la convertia en una regla de
    // diseno, y el diseno lo decide quien usa la app.
    const A = leerCodigo('src/components/sections/AjustesSection.tsx')
    const enOperativa = (x: string) => new RegExp(`ajTab === '${x}'`).test(A)
    const sinMenu = SECCIONES.filter(x =>
      !new RegExp(`navItem\\('${x}'`).test(C) && !new RegExp(`id:'${x}' as Section`).test(C)
      && !enOperativa(x) && x !== 'harvey')
    expect(sinMenu,
      'estas secciones existen y no hay forma de llegar a ellas salvo por atajo de teclado: quien no se sepa el atajo no vuelve a entrar')
      .toEqual([])
    // Y el rotulo de la cabecera del movil, que no tenia `diario` y ponia BRUTAL.IA.
    const mapa = C.slice(C.indexOf("{({hoy:'HOY'"), C.indexOf("{({hoy:'HOY'") + 700)
    const sinTitulo = SECCIONES.filter(x => !new RegExp(`${x}:'`).test(mapa))
    expect(sinTitulo, 'la cabecera del movil no sabe como se llama esta seccion y pone «BRUTAL.IA»').toEqual([])
  })

  // Archivar desde el movil no se podia deshacer desde el movil: la carpeta solo
  // existia en la columna de escritorio. Un archivado sin vuelta es un borrado.
  it('lo que se archiva se puede recuperar desde el mismo sitio', () => {
    const I = leerCodigo('src/components/sections/InboxSection.tsx')
    const tabs = I.slice(I.indexOf('const tabs = ['), I.indexOf('const tabs = [') + 1400)
    expect(/Archivados/.test(tabs),
      'la carpeta Archivados solo esta en escritorio: desde el movil se archiva y no hay forma de volver a verlo').toBe(true)
  })
})

// ───────────────────────────────────────────────────────────────────────────────
// Lo que no se cerró vuelve, exista la tarea o no.
//
// El arrastre del diario («VIENEN DE ANTES») se calculaba mirando TAREAS, así que
// dependía de que la tarea se hubiera creado: si la creación falló —o el objetivo
// se escribió antes de que eso funcionara— el objetivo desaparecía al día
// siguiente sin dejar rastro, y nadie se entera de lo que no se ve. Javi lo pilló
// con «Prueba top». La fuente honesta es el DIARIO, que es donde está escrito.
// ───────────────────────────────────────────────────────────────────────────────
describe('diario · el arrastre no depende de que la tarea exista', () => {
  const D = leerCodigo('src/components/sections/DiarioSection.tsx')

  it('el diario pregunta por los objetivos huerfanos, no solo por tareas', () => {
    expect(D.includes('/api/diario/pendientes'),
      'DiarioSection calcula «vienen de antes» solo desde tareas: un objetivo cuya tarea no se creo se pierde al cambiar de dia')
      .toBe(true)
  })

  it('la tarjeta de arrastre se abre tambien con huerfanos', () => {
    // Acotado al CONDICIONAL que monta la tarjeta: tenerlos en el estado no sirve
    // de nada si la tarjeta solo se pinta cuando hay tareas.
    const cond = D.match(/\{\(?vienenDeAntes\.length[^\n]*&&\s*\(/)?.[0] || ''
    expect(cond.includes('huerfanos'),
      'la tarjeta solo se pinta si hay TAREAS de antes: con un objetivo huerfano y ninguna tarea, no se pinta nada')
      .toBe(true)
  })
})

// ───────────────────────────────────────────────────────────────────────────────
// La base tiene que poder reconstruirse desde este repositorio.
//
// Era el riesgo numero uno del activo, y no una hipotesis: `client_comments` y
// `notification_log` se crearon a mano en el editor de Supabase y nunca llegaron
// aqui. Una instancia levantada desde el repo arrancaba, compilaba y se rompia al
// USARLA — en ejecucion y solo en la mitad de las pantallas. Es tambien lo que
// bloqueaba poder desplegar esto para otra empresa.
//
// El desajuste no se ve leyendo: hay que comparar dos listas que viven en sitios
// distintos. Eso es exactamente lo que sabe hacer un test.
// ───────────────────────────────────────────────────────────────────────────────
describe('el esquema se puede reconstruir desde el repo', () => {
  // Sin comentarios, por la misma razon que `leerCodigo()` los quita del TS: en
  // este repo se comenta mucho, y un comentario que EXPLICA una sentencia SQL la
  // parece. Sin esto, `job_locks` colaba una tabla fantasma llamada «if» desde la
  // frase «Con `create table if not exists`, una tabla preexistente con...».
  const sinComentarios = (sql: string) => sql.replace(/--.*$/gm, '')
  // TODO el SQL del repo, no solo `schema.sql` y `migrations/`.
  //
  // Esta lista se dejaba fuera `supabase/migration_*.sql`, que es donde vive el DDL
  // de ocho columnas en uso (`content_agenda.cover_url`, `.video_url`,
  // `.account_name`, `inbox_messages.shared`, `.attachments`, los tokens de Gmail
  // en `profiles`, `projects.pdf_analysis`). La regla pasaba en verde y a la vez
  // decia, sin querer, que esas columnas no existian: quien la creyera y no mirara
  // habria escrito migraciones duplicadas.
  const ddl = [
    readFileSync('supabase/schema.sql', 'utf8'),
    ...readdirSync('supabase').filter(f => f.endsWith('.sql') && f !== 'schema.sql')
      .map(f => readFileSync(join('supabase', f), 'utf8')),
    ...readdirSync('migrations').filter(f => f.endsWith('.sql'))
      .map(f => readFileSync(join('migrations', f), 'utf8')),
  ].map(sinComentarios).join('\n')

  // `create table [if not exists] [public.]nombre`
  const creadas = new Set(
    [...ddl.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/gi)]
      .map(m => m[1].toLowerCase()),
  )

  it('toda tabla que usa el codigo tiene su DDL aqui', () => {
    const usadas = new Set<string>()
    for (const ruta of TS) {
      if (ruta.startsWith('src/lib/__tests__/')) continue
      for (const m of leerCodigo(ruta).matchAll(/\.from\('([a-z_][a-z0-9_]*)'\)/g)) {
        usadas.add(m[1])
      }
    }
    // `auth.users` la crea Supabase, no nosotros.
    const sinDDL = [...usadas].filter(t => !creadas.has(t) && t !== 'users').sort()
    expect(sinDDL,
      'el codigo usa tablas que este repo NO sabe crear: una instancia nueva arranca, compila y se rompe al usarla. Anade su DDL en migrations/')
      .toEqual([])
  })

  it('toda COLUMNA que el codigo lee tiene su DDL aqui', () => {
    // La regla hermana comparaba TABLAS, y por eso decia «cerrado» sobre un riesgo
    // que seguia abierto: `tasks.co_assigned_to` y `projects.pdf_url` se habian
    // anadido a mano por el panel de Supabase y no existian en ningun .sql. En
    // produccion funcionaban; en una instancia nueva, 42703 — y con
    // `co_assigned_to` es peor, porque GET /api/tasks lleva el embed
    // `co_assignee:profiles!co_assigned_to` y sin la clave ajena devuelve 500.
    //
    // PRECISION ANTES QUE COBERTURA, como el checker de colores: solo se miran los
    // `.select('...')` con literal plano. Lo que lleva embed, alias, `*` o
    // interpolacion se calla, porque interpretarlo mal da falsos positivos y una
    // regla que grita sin motivo se acaba borrando entera.
    const columnas = new Set<string>()
    for (const ruta of TS) {
      if (ruta.startsWith('src/lib/__tests__/')) continue
      for (const m of leerCodigo(ruta).matchAll(/\.select\(\s*'([^'`$]*)'/g)) {
        for (const bruto of m[1].split(',')) {
          const c = bruto.trim()
          // Fuera: embeds `cliente:clients(...)`, joins `profiles!col`, `*`, y
          // cualquier cosa que no sea un nombre de columna a secas.
          if (!/^[a-z_][a-z0-9_]*$/.test(c)) continue
          columnas.add(c)
        }
      }
    }
    expect(columnas.size, 'no se encuentran columnas: revisa esta regla en vez de borrarla').toBeGreaterThan(20)

    // El DDL no esta separado por tabla, asi que se comprueba que el nombre EXISTA.
    // Es a proposito mas flojo de lo ideal: una columna que existe en otra tabla
    // pasaria. Se prefiere no cazar un caso raro a inventarse fallos.
    const declarada = (c: string) =>
      new RegExp(`add column[^;]*\\b${c}\\b|^\\s*${c}\\s+(text|uuid|boolean|jsonb|json|timestamptz|timestamp|date|int|integer|bigint|numeric|serial)`, 'im').test(ddl)

    const EXCEPCIONES: Record<string, string> = {
      id: 'la crea cada `create table` con su propia sintaxis (`primary key`)',
      created_at: 'idem: va con `default now()` en la definicion de cada tabla',
      updated_at: 'idem',
      count: 'no es una columna: es el `count` de PostgREST',
    }

    const sinDDL = [...columnas].filter(c => !declarada(c) && !EXCEPCIONES[c]).sort()
    expect(sinDDL,
      'el codigo lee columnas que este repo NO sabe crear: en produccion van porque se anadieron a mano, pero una instancia nueva se rompe al usarlas. Anade su DDL en migrations/')
      .toEqual([])
  })

  it('no hay DDL de tablas que ya no usa nadie', () => {
    // El desajuste al reves tambien miente: DDL de algo muerto hace creer que la
    // funcion existe. Con lista de excepciones y su motivo, como el resto.
    const VIVAS_SIN_USO_DIRECTO: Record<string, string> = {
      // Se leen por el join `profile:profiles(...)` o por auth, no por .from()
      // en el fichero donde aparecen — quitarlas romperia media app.
    }
    const usadas = new Set<string>()
    for (const ruta of TS) {
      for (const m of leerCodigo(ruta).matchAll(/\.from\('([a-z_][a-z0-9_]*)'\)/g)) usadas.add(m[1])
    }
    const huerfanas = [...creadas].filter(t => !usadas.has(t) && !(t in VIVAS_SIN_USO_DIRECTO)).sort()
    expect(huerfanas,
      'hay DDL de tablas que ningun codigo toca: o sobra, o alguien la dejo a medias. Si es deliberada, ponla en la lista con su motivo')
      .toEqual([])
  })
})

// ───────────────────────────────────────────────────────────────────────────────
// Nada que importe puede fallar en silencio.
//
// El patron que dominaba esta app no era romperse: era romperse SIN AVISAR. Los
// correos dejaban de entrar y te enterabas cuando un cliente preguntaba; el cron
// estuvo muerto un dia entero; un merge no desplego y no fallo. Estas reglas
// fijan las tres bocas por las que eso se sabe ahora.
// ───────────────────────────────────────────────────────────────────────────────
describe('lo que se cae, se dice', () => {

  it('cuando muere el token de Gmail, se avisa a quien lo sufre', () => {
    const C = leerCodigo('src/lib/colabsSync.ts')
    // Acotado a las ramas que BORRAN la conexion: que el fichero mencione el aviso
    // no dice nada si la rama que apaga el correo no lo llama.
    for (const campo of ['gmail_colabs_connected: false', 'gmail_connected: false']) {
      const i = C.indexOf(campo)
      expect(i, `ya no existe la rama de ${campo}: revisa esta regla`).toBeGreaterThan(-1)
      expect(/avisarConexionCaida\(/.test(C.slice(i, i + 400)),
        `apaga la conexion de Gmail sin avisar a nadie: los correos dejan de entrar en silencio, y con el modo de prueba de Google eso pasa cada 7 dias`)
        .toBe(true)
    }
  })

  it('todo proceso automatico deja latido, tambien cuando falla', () => {
    for (const ruta of ['src/app/api/cron/sync-colabs/route.ts', 'src/app/api/cron/backup/route.ts']) {
      const C = leerCodigo(ruta)
      expect(/marcarLatido\(/.test(C),
        `${ruta} no deja constancia de haber corrido: «hoy no ha pasado nada» y «lleva ocho horas parado» se verian igual`)
        .toBe(true)
    }
    // Y el de la copia, tambien en la rama de error: «corrio y se rompio» es
    // informacion distinta de «no corrio».
    const B = leerCodigo('src/app/api/cron/backup/route.ts')
    const iCatch = B.indexOf('} catch (e) {')
    expect(iCatch, 'ya no hay catch en el cron de copia: revisa esta regla').toBeGreaterThan(-1)
    expect(/marcarLatido\(/.test(B.slice(iCatch)),
      'la copia solo late cuando va bien: un fallo se veria igual que no haber corrido').toBe(true)
  })

  it('ninguna ruta que llama al modelo se queda sin tope', () => {
    const infractores: string[] = []
    for (const ruta of TS) {
      if (!ruta.startsWith('src/app/api/')) continue
      const C = leerCodigo(ruta)
      // Atada al IMPORT de `@/lib/ai`, no a nombres de funcion: buscar `generar\\w*`
      // marcaba `admin/team` por su `generarEnlace()`, que hace un enlace de
      // invitacion y no llama a ningun modelo. Quien importa el modulo del modelo
      // es exactamente quien puede gastar dinero.
      if (!/from '@\/lib\/ai'/.test(C)) continue
      if (!/check\w*RateLimit\(/.test(C)) infractores.push(ruta)
    }
    expect(infractores,
      'llama al modelo sin tope de peticiones: la mas expuesta es el webhook de WhatsApp, que invoca Meta desde internet contra la misma tarjeta')
      .toEqual([])
  })
})

// ───────────────────────────────────────────────────────────────────────────────
// Lo que se anade no puede cobrarse en la accion mas frecuente.
//
// Avisar al reasignar exige saber quien tenia la tarea ANTES, y eso es una
// consulta mas. Pero la peticion mas repetida de toda la app es marcar una tarea
// hecha, y esa NO toca el reparto: cobrarle una consulta a cada clic para un
// aviso que nunca va a mandar es pagar por nada, todos los dias.
// ───────────────────────────────────────────────────────────────────────────────
describe('lo que se anadio no ralentiza lo de siempre', () => {
  it('marcar una tarea hecha no paga la consulta del reparto', () => {
    const C = leerCodigo('src/app/api/tasks/[id]/route.ts')
    const i = C.indexOf("select('assigned_to,co_assigned_to,text')")
    expect(i, 'ya no se lee el estado anterior: revisa esta regla').toBeGreaterThan(-1)
    // Acotado a las 300 letras ANTERIORES a la consulta: es donde tiene que estar
    // su condicion. Que la palabra aparezca en el fichero no dice nada.
    expect(/tocaElReparto[\s\S]{0,120}\?/.test(C.slice(Math.max(0, i - 300), i)),
      'lee quien tenia la tarea antes en TODA peticion: marcar hecha —lo mas frecuente de la app— paga una consulta para un aviso que nunca manda')
      .toBe(true)
  })

  it('el push de reasignacion no se arma cuando no hay reparto', () => {
    const C = leerCodigo('src/app/api/tasks/[id]/route.ts')
    const i = C.indexOf('const reciennllegados')
    expect(i, 'ya no existe: revisa esta regla').toBeGreaterThan(-1)
    expect(/!tocaElReparto \? \[\]/.test(C.slice(i, i + 200)),
      'calcula los destinatarios aunque nadie haya cambiado de manos').toBe(true)
  })

  // El plan gratuito de Supabase da 1 GB de Storage compartido con TODO lo que
  // sube la app. Medido con datos variados: sin comprimir, 30 copias son 336 MB a
  // un ano y 1.008 MB a tres — el plan entero. Y cuando el Storage se llena no
  // fallan solo las copias: dejan de subirse adjuntos, portadas y documentos.
  it('las copias van comprimidas y su espacio esta acotado', () => {
    const C = leerCodigo('src/lib/copiaSeguridad.ts')
    expect(/gzipSync\(/.test(C),
      'la copia se sube sin comprimir: a tres anos las copias solas llenan el plan gratuito, y con el Storage lleno dejan de subirse adjuntos')
      .toBe(true)
    // Y la poda no puede ser «las ultimas N seguidas»: treinta dias consecutivos
    // no cubren «que decia el brief de aquel cliente en septiembre».
    const i = C.indexOf('export async function podarCopias')
    expect(i, 'ya no existe podarCopias: revisa esta regla').toBeGreaterThan(-1)
    expect(/mensuales/.test(C.slice(i)),
      'la poda solo guarda dias seguidos: no cubre volver meses atras, y guardar 30 consecutivos de hace un mes ocupa sin servir')
      .toBe(true)
  })

  it('arreglar los enlaces de Memoria es idempotente y no reescribe la nota', () => {
    const R = leerCodigo('src/app/api/admin/memoria-enlaces/route.ts')
    // Reemplazo puntual, no regeneracion: el texto de la nota lo escribio una
    // persona y el arreglo solo cambia las direcciones.
    expect(/\.replace\(CRUDA/.test(R),
      'regenera la nota en vez de sustituir solo las direcciones: es texto escrito por una persona').toBe(true)
    // Y no envuelve dos veces, que dejaria un enlace roto y silencioso.
    expect(/includes\(`u=\$\{encodeURIComponent/.test(R),
      'puede envolver dos veces la misma direccion: el enlace quedaria roto sin dar ningun error').toBe(true)
    // El error del update se mira: contar como arreglada una que no se guardo
    // diria que el bucket ya se puede cerrar cuando todavia no.
    expect(/if \(error\) fallos\.push/.test(R),
      'cuenta como arreglada una nota que no se guardo: diria que el bucket se puede cerrar cuando no').toBe(true)
  })
})

// ───────────────────────────────────────────────────────────────────────────────
// El reloj del cron y el reloj del panel tienen que ser el MISMO.
//
// Al pasar la copia de diaria a semanal, el cron cambió y la cadencia esperada en
// `/api/admin/latido` se quedó en 24 h. Con eso, desde el jueves hasta el
// miércoles siguiente el panel avisaría de una avería que no existe — y un aviso
// que salta sin motivo enseña a ignorar los avisos, que es exactamente lo
// contrario de para lo que ese panel se construyó.
//
// Son dos ficheros que no se miran entre sí y solo un humano ata: justo lo que un
// test hace mejor.
// ───────────────────────────────────────────────────────────────────────────────
describe('cron y latido dicen la misma hora', () => {
  it('lo que el panel espera cuadra con lo que vercel.json programa', () => {
    const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'))
    const L = leerCodigo('src/app/api/admin/latido/route.ts')

    // Cada ruta de cron declara su nombre de latido al llamar a `marcarLatido`.
    // Eso es lo que ata el fichero de configuración con el panel.
    const nombreDe = (ruta: string) => {
      const C = leerCodigo(`src/app${ruta}/route.ts`)
      return /marcarLatido\(\s*\w+\s*,\s*'([^']+)'/.exec(C)?.[1] || null
    }

    // Solo hacen falta los tres casos que se usan; con que el dia de la semana o
    // la hora no sean `*`, la cadencia queda determinada.
    const minutosDe = (expr: string) => {
      const [, hora, , , diaSemana] = expr.trim().split(/\s+/)
      if (diaSemana !== '*') return 7 * 24 * 60
      if (hora !== '*') return 24 * 60
      return 60
    }

    const desajustes: string[] = []
    for (const cron of vercel.crons || []) {
      const tarea = nombreDe(cron.path)
      if (!tarea) continue                       // no deja latido: otra regla lo cubre
      const esperado = minutosDe(cron.schedule)
      // La cadencia esta escrita como producto (`7 * 24 * 60`), asi que se evalua.
      const m = new RegExp(`['\"]?${tarea}['\"]?\\s*:\\s*([0-9*\\s]+),`).exec(L)
      if (!m) { desajustes.push(`${tarea}: el panel no sabe cada cuanto deberia correr`); continue }
      const declarado = m[1].split('*').reduce((a, b) => a * Number(b.trim()), 1)
      if (declarado !== esperado) {
        desajustes.push(`${tarea}: vercel.json dice ${esperado} min y el panel espera ${declarado}`)
      }
    }

    expect(desajustes,
      'el cron y el panel de latido no dicen la misma frecuencia: el panel avisara de una averia que no existe, y un aviso que salta sin motivo ensena a ignorar los avisos')
      .toEqual([])
  })
})

// ───────────────────────────────────────────────────────────────────────────────
// El nombre de una copia lo dice UN sitio.
//
// Lo usan cuatro: el que sube, el que lista, el que firma la descarga y el que
// poda. Si el que sube cambia la extensión y el que lista no, la pantalla dice
// «todavía no hay ninguna copia» mientras el bucket se llena — parecería que las
// copias dejaron de hacerse justo cuando sí se hacen. Silencioso y al revés de lo
// que pasa: el peor modo de fallo posible en un respaldo.
// ───────────────────────────────────────────────────────────────────────────────
describe('las copias se llaman igual en los cuatro sitios', () => {
  it('nadie escribe la extension a mano', () => {
    const infractores: string[] = []
    for (const ruta of TS) {
      if (ruta === 'src/lib/copiaSeguridad.ts') continue      // donde vive
      if (ruta.startsWith('src/lib/__tests__/')) continue
      const C = leerCodigo(ruta)
      // Un patron o una cadena con `.json` pegada a algo con forma de copia.
      if (/\.json(\\?\.gz)?['"`$]/.test(C) && /BUCKET_COPIAS|copiaSeguridad/.test(C)) {
        infractores.push(ruta)
      }
    }
    expect(infractores,
      'escribe el nombre de una copia a mano: si el que sube y el que lista dejan de coincidir, la pantalla dira que no hay copias mientras el bucket se llena')
      .toEqual([])
  })
})

// ───────────────────────────────────────────────────────────────────────────────
// La pantalla de Notificaciones no puede describir una app que no existe.
//
// Tenía una lista escrita a mano de TRES avisos mientras la app mandaba OCHO —
// tres de ellos añadidos el mismo día. Prometer de menos es peor que no prometer:
// quien lee «solo me avisa de tareas y correos» apaga los avisos sin saber que se
// pierde que un cliente respondió o que su Gmail lleva una semana caído.
// ───────────────────────────────────────────────────────────────────────────────
describe('los avisos que se mandan son los que se anuncian', () => {
  it('ningun aviso se manda sin declarar de que es', () => {
    // La firma de `PushPayload` ya lo exige y TypeScript lo comprueba, pero eso
    // solo vale mientras nadie escriba `as any` — que en este repo ya ha pasado.
    const infractores: string[] = []
    for (const ruta of TS) {
      if (ruta === 'src/lib/push.ts' || ruta.startsWith('src/lib/__tests__/')) continue
      const C = leerCodigo(ruta)
      for (const m of C.matchAll(/sendPushTo(?:User|All)\(/g)) {
        // La llamada ENTERA, contando parentesis. Una ventana de N letras no vale:
        // con 400 se quedaba fuera la categoria de los payloads largos, y con mas
        // se colaba la de la llamada siguiente y daba verde con el fallo dentro.
        let prof = 1, i = m.index! + m[0].length
        while (i < C.length && prof > 0) {
          if (C[i] === '(') prof++
          else if (C[i] === ')') prof--
          i++
        }
        const llamada = C.slice(m.index!, i)
        // Y si el payload se arma en una variable, se mira tambien lo de encima.
        const arriba = C.slice(Math.max(0, m.index! - 700), m.index!)
        if (!/categoria:/.test(llamada) && !/categoria:/.test(arriba)) {
          infractores.push(`${ruta}:${m.index}`)
        }
      }
    }
    expect(infractores,
      'manda un aviso sin categoria: no se puede saber si quien lo recibe lo ha silenciado, y la pantalla de Notificaciones se queda describiendo una lista que ya no es la de verdad')
      .toEqual([])
  })

  it('la pantalla saca la lista del catalogo, no la escribe a mano', () => {
    const N = leerCodigo('src/components/sections/NotificacionesTab.tsx')
    expect(/ORDEN_AVISOS\.map/.test(N),
      'la pantalla vuelve a escribir a mano de que avisa la app: se quedara atras a la primera que se anada, y prometer de menos hace que la gente apague avisos que necesita')
      .toBe(true)
    expect(/Cuando te asignan una tarea'/.test(N),
      'quedan restos de la lista escrita a mano').toBe(false)
  })

  it('la averia no se puede silenciar', () => {
    // Es el aviso de que los correos han dejado de entrar. Poder apagarlo seria
    // poder apagar la unica senal de una averia silenciosa — y esa averia pasa de
    // verdad cada siete dias mientras Google este en modo de prueba.
    const A = leerCodigo('src/lib/avisos.ts')
    const i = A.indexOf('averia: {')
    expect(i, 'ya no existe la categoria averia: revisa esta regla').toBeGreaterThan(-1)
    // Acotado a SU entrada, hasta la llave que la cierra. Con una ventana de N
    // letras se colaba en la siguiente —`prueba` tambien es `silenciable: false`—
    // y la regla daba verde con la averia silenciable. Verificado poniendola en
    // true: sin este corte, no se enteraba.
    const entrada = A.slice(i, i + A.slice(i).indexOf('\n  },'))
    expect(/silenciable: false/.test(entrada),
      'la averia se puede silenciar: se podria apagar la unica senal de que el correo ha dejado de entrar').toBe(true)
    // Y el servidor no puede fiarse de que la pantalla no lo mande.
    const R = leerCodigo('src/app/api/push/prefs/route.ts')
    expect(/ficha\?\.silenciable/.test(R),
      'la ruta guarda cualquier categoria que le manden: un cliente podria silenciar la averia saltandose la pantalla').toBe(true)
  })
})

// ───────────────────────────────────────────────────────────────────────────────
// Lo que sale del Storage sale FIRMADO.
//
// La base guarda la direccion publica como identificador estable y cada ruta de
// lectura la cambia por una firma temporal antes de responder. Con el bucket
// abierto, olvidarse era una fuga silenciosa; con el bucket cerrado —que es a
// donde vamos— es una imagen rota en la cara del usuario. En los dos casos es un
// fallo que solo se descubre usando la pantalla concreta que lo tiene.
//
// Se comprueba aqui porque son 65 rutas y nadie las repasa a mano dos veces.
// ───────────────────────────────────────────────────────────────────────────────
describe('nada del Storage sale sin firmar', () => {
  it('toda ruta que DEVUELVE una columna de fichero la firma', () => {
    // Las columnas que guardan una direccion del Storage, y las TABLAS que las
    // tienen. Las dos listas hacen falta: casi todas las rutas piden `select('*')`,
    // asi que la columna no aparece por su nombre en ningun sitio — y una regla
    // que solo buscara el nombre se saltaria justo las que mas ficheros sirven.
    // Verificado quitandole la firma a `agenda/route.ts`: sin las tablas, verde.
    const COLUMNAS = ['cover_url', 'video_url', 'pdf_url']
    const TABLAS_CON_FICHEROS = ['content_agenda', 'projects', 'task_attachments']

    // Las que LEEN una tabla con ficheros pero no devuelven la direccion. Cada una
    // con su motivo, y comprobadas abriendo el fichero — no dadas por buenas.
    const EXENTAS: Record<string, string> = {
      'src/app/api/clients/[id]/ai-advice/route.ts':
        'lee los proyectos del cliente para el prompt y devuelve lo que contesta el modelo, no las filas',
      'src/app/api/tasks/route.ts':
        'toca task_attachments solo en el borrado en lote, para llevarse los ficheros del Storage; el GET devuelve tareas, que no tienen columna de fichero',
    }
    const infractores: string[] = []

    for (const ruta of TS) {
      if (!ruta.startsWith('src/app/api/')) continue
      const C = leerCodigo(ruta)
      // Solo cuenta si la columna viaja en la RESPUESTA. Leerla para otra cosa no
      // es servirla: `tasks/route.ts` lee la url de un adjunto para BORRAR su
      // fichero, y `clients/[id]/ai-advice` mete la fila entera en el prompt pero
      // devuelve lo que contesta el modelo. Los dos daban falso positivo cuando
      // esto se miro a ojo, que es justo por lo que ahora lo mira un test.
      const porNombre = COLUMNAS.some(c => new RegExp(`select\\([^)]*\\b${c}\\b`, 's').test(C))
      const porAsterisco = /select\('\*[,')]/.test(C)
        && TABLAS_CON_FICHEROS.some(t => new RegExp(`from\\('${t}'\\)`).test(C))
      if (!porNombre && !porAsterisco) continue
      if (ruta in EXENTAS) continue
      if (!/firmarCampos|firmarUrl/.test(C)) infractores.push(ruta)
    }

    // Una excepcion que ya no aplica es tan mala como una que falta: se queda
    // tapando un fallo futuro sin que nadie lo sepa. Si la ruta desaparece o deja
    // de leer ficheros, la lista lo dice sola.
    const exentasMuertas = Object.keys(EXENTAS).filter(r => !TS.includes(r))
    expect(exentasMuertas, 'estas exenciones apuntan a rutas que ya no existen: quitalas').toEqual([])

    expect(infractores,
      'devuelve una direccion del Storage sin firmarla: con el bucket cerrado es una imagen rota, y con el abierto una fuga — y las dos solo se ven entrando en esa pantalla concreta')
      .toEqual([])
  })

  it('lo que se firma es lo que la consulta trae', () => {
    // El gemelo del anterior, y ya mordio en la pantalla de revision: `firmarCampos`
    // pedia `cover_url` y el `select` no la traia, asi que se firmaba una columna
    // que nunca llegaba y el cliente no veia la imagen. Sin error, sin nada.
    const infractores: string[] = []
    for (const ruta of TS) {
      if (!ruta.startsWith('src/app/api/')) continue
      const C = leerCodigo(ruta)
      const i = C.indexOf('firmarCampos(')
      if (i < 0) continue
      for (const campo of C.slice(i, i + 260).match(/'(\w+_url)'/g) || []) {
        const nombre = campo.replace(/'/g, '')
        // `select('*')` y `select('*, cliente:...)` traen la columna: el asterisco
        // vale igual con join detras. Comprobarlo solo con `'*'` marcaba en falso
        // las cuatro rutas que usan la forma con join — que son casi todas.
        const traeTodo = /select\('\*[,')]/.test(C)
        if (!new RegExp(`select\\([^)]*\\b${nombre}\\b`, 's').test(C) && !traeTodo) {
          infractores.push(`${ruta} firma «${nombre}» y no la trae`)
        }
      }
    }
    expect(infractores,
      'firma una columna que la consulta no devuelve: no da error, simplemente no se ve la imagen')
      .toEqual([])
  })
})

// ───────────────────────────────────────────────────────────────────────────────
// `main` SIEMPRE despliega.
//
// Los previews de PR no pueden construir nunca —las variables de entorno son solo
// de Production a propósito, porque un preview con credenciales de produccion
// escribe en la base de VERDAD— asi que se apagan en `vercel.json`. Pero ahi hay
// una trampa documentada por Vercel: cualquier rama NO especificada vale `true`,
// o sea que un `deploymentEnabled: false` a secas apaga tambien produccion.
//
// Y ese fallo es de los que no avisan: el merge entra, el check sale limpio, y
// produccion se queda sirviendo el commit anterior. Ya paso una vez por otra
// causa (la suscripcion suspendida) y costo un dia entero.
// ───────────────────────────────────────────────────────────────────────────────
describe('el despliegue de produccion no se puede apagar sin querer', () => {
  it('main sigue habilitado en vercel.json', () => {
    const v = JSON.parse(readFileSync('vercel.json', 'utf8'))
    const conf = v.git?.deploymentEnabled
    if (conf === undefined) return                    // sin configurar = todo activo
    expect(conf, 'apaga TODOS los despliegues, produccion incluida: los merges a main dejaran de publicar y el check saldra limpio').not.toBe(false)
    expect(conf.main, 'main no esta explicitamente habilitado: si un patron lo apaga, produccion deja de desplegarse en silencio').toBe(true)
  })
})

// ───────────────────────────────────────────────────────────────────────────────
// La criba del correo: una sola, y nunca decide si se guarda.
//
// El bucle que analiza correo esta escrito TRES veces —el sync personal, el del
// buzon compartido y el personal del cron— y ese es el patron de gemelos que
// CLAUDE.md documenta como mas de la mitad de los fallos graves de la auditoria.
// Si la criba se pone en dos de los tres, el tercero sigue pagando analisis de
// boletines para siempre y nadie lo nota.
//
// Y la segunda regla es la que de verdad importa: la criba decide a QUE correo se
// le paga un analisis, JAMAS si entra en la base. La primera version del plan
// borraba esa distincion sin darse cuenta y habria hecho desaparecer correo de
// clientes sin rastro y sin vuelta atras.
// ───────────────────────────────────────────────────────────────────────────────
describe('la criba del correo', () => {
  const CON_ANALISIS = buclesDeSync(TS)

  it('TODOS los bucles criban, no casi todos', () => {
    // Eran tres bucles en dos ficheros; ahora son dos bucles en uno, porque la
    // ruta manual dejo de tener su copia. Lo que la regla protege no cambia: que
    // ningun bucle analice sin cribar antes.
    expect(CON_ANALISIS.length, 'ya no son los mismos ficheros los que sincronizan: revisa esta regla').toBe(1)
    const sinCriba = CON_ANALISIS.filter(f => !/triar\(/.test(leerCodigo(f)))
    expect(sinCriba,
      'analiza correo sin cribar: ese buzon seguira pagando el analisis de cada boletin, y nadie lo notara porque los otros si criban')
      .toEqual([])
  })

  it('cada llamada al modelo va DENTRO de su criba', () => {
    // Acotado al sitio: que el fichero mencione `triar(` no dice nada si la
    // llamada esta fuera del `if`. Se comprueba que entre la criba y la llamada
    // no haya otra criba — o sea, que sean el mismo bloque.
    for (const f of CON_ANALISIS) {
      const C = leerCodigo(f)
      for (const m of C.matchAll(/await analyzeEmail\(/g)) {
        const antes = C.slice(Math.max(0, m.index! - 900), m.index!)
        expect(/const \{ analizar[\s\S]*if \(analizar\)/.test(antes),
          `${f}: hay una llamada al modelo que no esta dentro de su criba`).toBe(true)
      }
    }
  })

  it('la criba NUNCA decide si un correo se guarda', () => {
    // El invariante que mas importa de todo esto. Si `analizar` aparece como
    // condicion de un `continue` o rodeando un `insert`, el correo desaparece —
    // y como la ventana de Gmail no pagina, desaparece PARA SIEMPRE.
    for (const f of CON_ANALISIS) {
      const C = leerCodigo(f)
      expect(/if \(!analizar\)\s*continue/.test(C),
        `${f}: se salta el correo entero cuando no merece analisis. No se guardaria, y no hay forma de recuperarlo despues`)
        .toBe(false)
    }
  })

  it('lo que no se analiza se guarda con los campos de IA en NULL', () => {
    // Y no con el fallback inventado: ese sacaba el correo del filtro de Clientes
    // y del contador de Prioridad, Y hacia que la pantalla pintara un panel
    // «BRUTAL.IA — ANALISIS» sobre algo que la IA no habia visto nunca.
    for (const f of CON_ANALISIS) {
      const C = leerCodigo(f)
      expect(/ai_summary: analysis\?\.summary \?\? null/.test(C),
        `${f}: guarda un resumen inventado cuando no hubo analisis`).toBe(true)
      expect(/ai_estado:/.test(C),
        `${f}: no deja constancia de si el correo se analizo. Sin eso la criba no se puede auditar ni deshacer`).toBe(true)
    }
  })
})

// ───────────────────────────────────────────────────────────────────────────────
// El enlace de invitación se canjea en NUESTRA pantalla.
//
// `@supabase/ssr` cablea `flowType: 'pkce'` en el cliente del navegador —esta
// escrito en su codigo, no es una opcion nuestra— y PKCE exige un verificador
// guardado en el navegador QUE INICIO el proceso. Los enlaces de invitacion los
// genera el servidor, asi que ese verificador no existe: el canje automatico no
// puede funcionar NUNCA para ellos.
//
// Y era irrecuperable: la pagina de verificacion de Supabase consume el token al
// abrir el enlace, asi que para cuando la nuestra se rendia ya estaba gastado.
// Javi lo vio creando la cuenta, copiando el enlace y abriendolo el mismo.
// ───────────────────────────────────────────────────────────────────────────────
describe('el enlace de invitacion no se gasta antes de usarse', () => {
  it('el alta monta el enlace con el token en crudo', () => {
    const T = leerCodigo('src/app/api/admin/team/route.ts')
    expect(/hashed_token/.test(T),
      'vuelve a repartir el action_link de Supabase: su pagina de verificacion consume el token antes que la nuestra y el enlace muere al primer clic')
      .toBe(true)
    expect(/\/reset-password\?token_hash=/.test(T),
      'el enlace no apunta a nuestra pantalla').toBe(true)
  })

  it('la pantalla canjea el token a mano, sin fiarse de la libreria', () => {
    const R = leerCodigo('src/app/reset-password/page.tsx')
    expect(/verifyOtp\(\{ token_hash/.test(R),
      'no canjea el token: con flowType pkce cableado en @supabase/ssr, el canje automatico no funciona para enlaces generados en el servidor')
      .toBe(true)
    // Y las dos formas antiguas, para los enlaces que ya estuvieran repartidos.
    expect(/setSession\(\{ access_token/.test(R), 'no recoge los tokens del hash').toBe(true)
    expect(/exchangeCodeForSession\(/.test(R), 'no recoge el codigo del parametro').toBe(true)
  })
})

// ───────────────────────────────────────────────────────────────────────────────
// La contraseña se pide UNA vez, y el motivo que se da es verdad.
//
// Quien llega por el enlace de invitacion elige su contraseña en /reset-password
// y treinta segundos despues la puesta en marcha se la volvia a pedir diciendole
// «la que usas ahora te la dio otra persona, asi que la conoce alguien mas». Eso
// es FALSO por ese camino: se la acababa de poner el, y no la sabe nadie.
//
// No era solo repetir un paso. Era explicar un motivo que no existe, en la
// primera pantalla que ve alguien de la app.
// ───────────────────────────────────────────────────────────────────────────────
describe('la contraseña se pide una vez y con un motivo cierto', () => {
  it('elegir la contraseña al entrar deja constancia', () => {
    const R = leerCodigo('src/app/reset-password/page.tsx')
    const i = R.indexOf('setOk(true)')
    expect(i, 'ya no se guarda asi: revisa esta regla').toBeGreaterThan(-1)
    expect(/nx_clave_elegida/.test(R.slice(i, i + 700)),
      'no deja dicho que la contraseña ya se eligio: la puesta en marcha la volvera a pedir con un motivo falso')
      .toBe(true)
  })

  it('el paso de contraseña dice la verdad segun como se haya entrado', () => {
    const P = leerCodigo('src/components/PuestaEnMarcha.tsx')
    expect(/claveYaElegida/.test(P),
      'el paso no sabe como ha entrado la persona: dira «te la dio otra persona» a quien se la acaba de poner')
      .toBe(true)
    // Las dos cabeceras, y ELEGIDAS POR LA CONDICION — no basta con que los dos
    // textos esten en el fichero. Comprobarlo asi daba verde con la condicion
    // cableada a `false`, o sea con el texto falso saliendole a todo el mundo:
    // verificado poniendo `{false ? (` y viendo la regla en verde.
    const t = P.indexOf('claveYaElegida ?')
    expect(t, 'la cabecera ya no depende de como se haya entrado').toBeGreaterThan(-1)
    const ternario = P.slice(t, t + 700)
    expect(/Tu contraseña ya está puesta/.test(ternario), 'falta el texto para quien ya la eligio').toBe(true)
    // El texto de esta rama cambio cuando el paso paso a estar marcado OPCIONAL:
    // antes decia «te la dio otra persona», que es cierto solo para quien entra con
    // una temporal. Ahora lo dice condicionado —«por si no has tenido opcion»—
    // porque el camino normal es el enlace, y por ahi la contrasena ya esta puesta.
    expect(/no has tenido opción de elegirla/.test(ternario),
      'falta el texto para quien entra con una que le pasaron').toBe(true)
  })

  it('CUALQUIERA puede seguir sin escribir nada, tenga marca o no', () => {
    const P = leerCodigo('src/components/PuestaEnMarcha.tsx')
    // Anclado al BOTON, no a la primera aparicion de `paso === 2`: esa es el
    // bloque que pinta los campos, y el boton esta 150 lineas mas abajo. Anclar al
    // primer `indexOf` es el tropiezo que ya ha dado verde con el fallo dentro
    // varias veces en este fichero.
    const i = P.lastIndexOf('paso === 2 &&')
    expect(i, 'ya no existe el paso 2: revisa esta regla').toBeGreaterThan(-1)
    const cond = P.slice(i, i + 140)

    // Esta regla exigia antes que el camino de salida dependiera de
    // `claveYaElegida`, y ahora exige lo contrario — porque la version anterior
    // era mas debil de lo que parecia. Esa marca vive en localStorage: una
    // pestana privada, otro navegador o un movil distinto la pierden. Sin ella el
    // boton principal decia CAMBIAR y salia APAGADO, y la unica salida era un
    // SALTAR gris y pequeno. Un paso marcado OPCIONAL cuyo boton grande te exige
    // algo no es opcional: es obligatorio con mala conciencia.
    expect(/!actual && !nueva/.test(cond),
      'el boton ya no mira si hay algo escrito: puede volver a exigir la contrasena a quien no necesita cambiarla')
      .toBe(true)
    expect(/claveYaElegida/.test(cond),
      'el boton principal vuelve a depender de una marca de localStorage: quien la pierda se queda con un boton apagado')
      .toBe(false)
  })

  it('al terminar se olvida, para que la proxima vez decida de nuevo', () => {
    const P = leerCodigo('src/components/PuestaEnMarcha.tsx')
    const i = P.indexOf('const terminar')
    expect(/removeItem\('nx_clave_elegida'\)/.test(P.slice(i, i + 900)),
      'la marca sobrevive a la puesta en marcha: si se resetea y se entra con una temporal nueva, el paso se saltaria sin motivo')
      .toBe(true)
  })
})

describe('abrir una pieza rearma TODOS sus campos, no casi todos', () => {
  const C = leerCodigo('src/components/sections/ContenidoSection.tsx')

  // Regla GENERAL, no un caso: la que faltaba era `carpeta`, y la que falte
  // mañana sera otra. El patron del repo es un `useState` para el valor y un
  // `useRef` «xTocada» que dice si el usuario lo toco —porque un campo que no se
  // ha tocado NO debe viajar en el PATCH—. Ese ref es global al componente, asi
  // que si `openItem` no lo baja, la pieza que abres hereda el «lo toque» de la
  // anterior y le escribe encima su valor.
  const refs = [...C.matchAll(/const (\w+)Tocada = useRef/g)].map(m => m[1])

  it('hay refs de «tocado» que vigilar', () => {
    expect(refs.length, 'ya no existe el patron xTocada: revisa esta regla en vez de borrarla').toBeGreaterThan(0)
  })

  const abrir = (() => {
    const i = C.indexOf('const openItem =')
    return i === -1 ? '' : C.slice(i, i + 2000)
  })()

  it.each(refs)('openItem baja %sTocada', (campo) => {
    expect(abrir.includes(`${campo}Tocada.current = false`),
      `openItem no rearma ${campo}Tocada: al abrir otra pieza hereda el «lo toque» de la anterior y le pisa el valor al guardar`)
      .toBe(true)
  })

  it.each(refs)('openItem siembra el valor de %s desde la fila', (campo) => {
    const set = 'setEdit' + campo[0].toUpperCase() + campo.slice(1)
    // `\\w*` porque el ref y el setter no siempre se llaman igual: el ref es
    // `coverTocada` y el setter `setEditCoverUrl`. Lo que se comprueba es que el
    // valor salga de la FILA, no como se llame la variable.
    expect(new RegExp(set + '\\w*\\(item\\.').test(abrir),
      `openItem no siembra ${campo}: el campo se pinta vacio aunque la pieza tenga valor, y guardar lo borra`)
      .toBe(true)
  })
})

describe('el enlace de revision es util de verdad', () => {
  const R = leerCodigo('src/app/api/review/[token]/route.ts')
  const P = leerCodigo('src/app/review/[token]/page.tsx')

  it('si la pagina pinta el equipo, el GET lo devuelve', () => {
    // La mitad servidor estaba hecha (el POST valida el autor contra profiles) y la
    // mitad lectura no, asi que el selector «¿Quien eres?» no se pintaba NUNCA y
    // todo se firmaba como «Cliente». La pagina tipa `item` como any, o sea que
    // TypeScript no podia avisar: esto es lo unico que lo ve.
    if (!P.includes('item.equipo')) return
    const get = R.slice(R.indexOf('export async function GET'), R.indexOf('export async function POST'))
    expect(/equipo/.test(get),
      'la pagina pinta item.equipo pero el GET no lo devuelve: el selector no aparece nunca')
      .toBe(true)
  })
})

describe('todo enlace de invitacion pasa por el mismo sitio', () => {
  const T = leerCodigo('src/app/api/admin/team/route.ts')

  it('nadie lee action_link fuera de generarEnlace', () => {
    // `action_link` pasa por la pagina de verificacion de Supabase, que CONSUME el
    // token antes de que la nuestra se ejecute. `generarEnlace()` monta el enlace
    // con el token en crudo y es el unico sitio autorizado a caer al de Supabase
    // —y cuando lo hace, lo dice—. La rama «regenerar enlace» se lo saltaba: la
    // via de rescate de un enlace quemado devolvia otro enlace quemado.
    const g = T.indexOf('async function generarEnlace')
    expect(g, 'ya no existe generarEnlace: revisa esta regla en vez de borrarla').toBeGreaterThan(-1)
    const fin = T.indexOf('export async function DELETE')
    const fuera = T.slice(0, g) + T.slice(fin === -1 ? T.length : fin)
    expect(fuera.includes('action_link'),
      'se lee action_link fuera de generarEnlace: ese enlace se gasta al abrirlo')
      .toBe(false)
  })
})

describe('quedarse sin tiempo aplaza correo, no lo pierde', () => {
  // La ventana de Gmail NO pagina: `messages.list` devuelve los N mas recientes y
  // ya esta. Un correo que se queda detras del corte por tiempo no es un correo
  // que se vera luego — es un correo que no se vera NUNCA, porque en la pasada
  // siguiente ya no estara entre los mas recientes. Y no falla nada: desaparece.
  //
  // Regla GENERAL sobre los tres sitios que cortan por tiempo, no sobre uno: el
  // rescate estaba escrito solo en /api/gmail/sync y faltaba en las DOS funciones
  // del cron, que son justo las que corren cada hora sin que nadie mire.
  // Un solo fichero desde que /api/gmail/sync delega en la libreria en vez de
  // tener su propia copia del bucle. Los DOS cortes por tiempo que quedan —el del
  // buzon compartido y el personal— viven aqui dentro, y la regla los cuenta
  // igual: un rescate por cada corte.
  const SINCRONIZADORES = [
    'src/lib/colabsSync.ts',
  ]

  it.each(SINCRONIZADORES)('%s aplaza lo que deja detras', (ruta) => {
    const C = leerCodigo(ruta)
    const cortes = [...C.matchAll(/truncado = true/g)]
    expect(cortes.length, `${ruta} ya no corta por tiempo: revisa esta regla en vez de borrarla`).toBeGreaterThan(0)
    // Una llamada a aplazarResto por cada corte. Con menos, algun bucle tira su
    // resto — que es exactamente como estaba colabsSync: dos cortes, cero rescates.
    const rescates = [...C.matchAll(/aplazarResto\(/g)].length
    expect(rescates,
      `${ruta} tiene ${cortes.length} cortes por tiempo y ${rescates} rescates: el correo que cae detras de un corte sin rescate se pierde para siempre`)
      .toBeGreaterThanOrEqual(cortes.length)
  })

  it('el rescate vive en UN solo sitio', () => {
    // Estaba escrito a mano en la ruta y ausente en el cron: el gemelo clasico.
    // Si alguien vuelve a escribirlo a mano, el insert con `ai_estado: 'pendiente'`
    // aparecera fuera de aplazarCorreos.ts y esto se pone rojo.
    for (const ruta of SINCRONIZADORES) {
      const C = leerCodigo(ruta)
      expect(/ai_estado:\s*'pendiente'/.test(C),
        `${ruta} escribe el aplazamiento a mano en vez de usar aplazarResto: son dos implementaciones que se separaran`)
        .toBe(false)
    }
  })

  it('lo aplazado se guarda como pendiente, que es lo que lo hace recuperable', () => {
    const H = leerCodigo('src/lib/aplazarCorreos.ts')
    expect(H).toContain("ai_estado: 'pendiente'")
    // Sin mirar el error, un fallo del insert es indistinguible de un exito y el
    // correo se pierde igual, pero ademas creyendo que se guardo.
    expect(/if \(error\)/.test(H), 'el insert del aplazamiento no mira su error').toBe(true)
  })
})

describe('ningun fichero de ruta es una copia exacta de otro', () => {
  it('dos rutas distintas no pueden tener el MISMO contenido', () => {
    // Esto no es teorico: paso en esta misma sesion. Un script de verificacion
    // guardaba copias de seguridad usando solo el NOMBRE del fichero, y en este
    // repo hay 59 rutas que se llaman todas `route.ts`. Dos se pisaron, y
    // `src/app/api/review/[token]/route.ts` acabo siendo una copia byte a byte de
    // `src/app/api/admin/team/route.ts`.
    //
    // Lo grave es lo que NO lo detecto: `tsc --noEmit` paso, `npm run build`
    // compilo, y el commit se subio. Los dos ficheros son rutas validas, asi que
    // para el compilador no hay nada que objetar — simplemente el enlace de
    // revision habia dejado de existir y en su lugar respondia la API de equipo.
    // Lo cazo un test que buscaba otra cosa.
    const rutas: string[] = []
    const recorrer = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name)
        if (e.isDirectory()) recorrer(p)
        else if (e.name === 'route.ts') rutas.push(p)
      }
    }
    recorrer('src/app/api')
    expect(rutas.length, 'no se encuentran rutas: revisa esta regla en vez de borrarla').toBeGreaterThan(10)

    const porContenido = new Map<string, string[]>()
    for (const r of rutas) {
      const c = readFileSync(r, 'utf8')
      if (!porContenido.has(c)) porContenido.set(c, [])
      porContenido.get(c)!.push(r)
    }
    const duplicadas = [...porContenido.values()].filter(g => g.length > 1)
    expect(duplicadas.map(g => g.join('  ==  ')),
      'hay rutas con contenido identico: una se ha pisado con la otra y ni tsc ni el build lo ven')
      .toEqual([])
  })
})
describe('un progreso que dice 100% ha terminado', () => {
  const P = leerCodigo('src/components/sections/ProyectosSection.tsx')

  it('llegar al 100% de la subida cambia de fase, no se queda ahi', () => {
    // El fallo: la barra medía SOLO la subida a Storage, y después venían extraer
    // la portada y leer el PDF con Claude — varios segundos con el indicador al
    // 100% y el rótulo diciendo «SUBIENDO PDF…». Decir «hecho» mientras sigues
    // esperando es peor que no decir nada: parece que la app se ha colgado.
    const i = P.indexOf('setPdfUploadPct(100)')
    expect(i, 'ya no se llega al 100%: revisa esta regla en vez de borrarla').toBeGreaterThan(-1)
    // Ventana corta a propósito: la fase tiene que cambiar AHÍ, no en cualquier
    // punto posterior del manejador.
    expect(/setPdfFase\('leyendo'\)/.test(P.slice(i, i + 220)),
      'la subida llega al 100% y nadie cambia de fase: el indicador se queda diciendo «hecho» mientras aun se lee el PDF')
      .toBe(true)
  })

  it('la fase que no se puede medir NO enseña porcentaje', () => {
    // Poner un número a lo que no se sabe cuánto tarda es volver a mentir, con más
    // decimales. La segunda fase va con una animación sin fin.
    const i = P.indexOf("pdfFase !== 'leyendo' &&")
    expect(i, 'el porcentaje se pinta tambien mientras se lee el PDF: es un numero inventado').toBeGreaterThan(-1)
    expect(P.slice(i, i + 120)).toContain('{pdfUploadPct}%')
  })
})

describe('las carpetas archivan, no esconden', () => {
  const P = leerCodigo('src/components/sections/ProyectosSection.tsx')

  it('solo se agrupa lo terminado', () => {
    // Agrupar una columna en la que se trabaja escondería trabajo vivo detrás de
    // un clic. Se archiva lo que ya no se toca y se consulta.
    const i = P.indexOf('const agrupa =')
    expect(i).toBeGreaterThan(-1)
    expect(P.slice(i, i + 160)).toContain("col.status === 'completado'")
  })

  it('buscando no se agrupa: quien busca quiere resultados, no carpetas', () => {
    const i = P.indexOf('const agrupa =')
    expect(/!projSearch\.trim\(\)/.test(P.slice(i, i + 160)),
      'con una busqueda activa los resultados quedan dentro de carpetas cerradas: no se ven')
      .toBe(true)
  })
})

describe('un numero se calcula UNA vez', () => {
  it('la insignia de Tareas del menu no recuenta por su cuenta', () => {
    // La campana usaba `urgentCount`, que filtra por `esTareaDe`, y el menu volvia
    // a contar ahi mismo SIN el filtro: dos numeros distintos para la misma
    // pregunta, y el del menu enseñaba las urgentes de todo el equipo. El fichero
    // ya tiene un comentario avisando de este mismo gemelo diez lineas mas abajo.
    const D = leerCodigo('src/components/NexusDashboard.tsx')
    const menu = D.slice(D.indexOf("navItem('tareas'"), D.indexOf("navItem('tareas'") + 200)
    expect(menu.includes('urgentCount'),
      'la insignia de Tareas vuelve a contar en vez de usar urgentCount: el menu y la campana discreparan')
      .toBe(true)
    expect(/level\s*===?\s*'urgent'/.test(menu),
      'la insignia recuenta las urgentes a mano: si ese conteo no filtra por persona, enseña las de todo el equipo')
      .toBe(false)
  })
})

describe('el enlace publico no puede hacer sonar siete moviles', () => {
  it('el push de una opinion pasa por canSendPush', () => {
    // Es el UNICO push que dispara alguien SIN cuenta: el enlace se pasa al grupo
    // de WhatsApp. Sin freno, tres opiniones seguidas —o cinco clics en enviar—
    // son cinco avisos a los siete. El freno va por PIEZA, no global, para que dos
    // clientes opinando de dos piezas distintas si avisen los dos.
    const R = leerCodigo('src/app/api/review/[token]/route.ts')
    const i = R.indexOf('sendPushToUser(admin, creador')
    expect(i, 'ya no se manda push desde aqui: revisa esta regla en vez de borrarla').toBeGreaterThan(-1)
    expect(/canSendPush\(admin, `review-/.test(R.slice(Math.max(0, i - 900), i)),
      'la opinion dispara push sin freno, y este endpoint es publico')
      .toBe(true)
  })
})

describe('la vista previa del enlace enseña algo o no enseña nada', () => {
  it('la portada de la tarjetita va FIRMADA', () => {
    // El bucket es privado, asi que la direccion que guarda la base responde 400 a
    // cualquiera. La condicion anterior excluia las firmadas y dejaba pasar
    // justo esa: la unica imagen que llegaba a publicarse era la que nunca carga.
    const L = leerCodigo('src/app/review/[token]/layout.tsx')
    expect(/images:\s*\[portadaFirmada\]/.test(L),
      'la tarjetita publica la direccion cruda de un bucket privado: la imagen siempre saldra rota')
      .toBe(true)
    expect(/images:\s*\[data\.cover_url\]/.test(L)).toBe(false)
  })
})

describe('las preferencias de avisos no se duplican', () => {
  it('la lectura previa mira su error antes de decidir insertar', () => {
    // supabase-js no lanza: sin mirar el error, un fallo de consulta es igual que
    // «no hay fila» y se cae por la rama del insert. `reglas` no tiene `name`
    // unico, asi que quedan DOS filas de preferencias y gana la que salga primero:
    // silencias un aviso y vuelve solo al dia siguiente.
    const P = leerCodigo('src/app/api/push/prefs/route.ts')
    const i = P.indexOf("select('id').eq('name', PREFS_ROW)")
    expect(i, 'ya no se busca la fila: revisa esta regla en vez de borrarla').toBeGreaterThan(-1)
    const ventana = P.slice(Math.max(0, i - 200), i + 400)
    expect(/error:\s*errLectura/.test(ventana), 'la lectura no captura su error').toBe(true)
    expect(/if \(errLectura\)/.test(ventana), 'captura el error y no lo mira, que es lo mismo que no capturarlo').toBe(true)
  })
})

describe('el paso de la contrasena es opcional de verdad, no solo en el texto', () => {
  const P = leerCodigo('src/components/PuestaEnMarcha.tsx')

  it('va marcado OPCIONAL en las DOS versiones', () => {
    // El camino normal es el enlace de invitacion, y ahi la contrasena se pone en
    // esa misma pantalla: cuando llegas aqui ya esta hecho. Sin el distintivo
    // parece un tramite obligatorio y la gente escribe una nueva sin necesitarlo.
    const paso = P.slice(P.indexOf('{paso === 2 &&'), P.indexOf('{paso === 3 &&'))
    const cabeceras = [...paso.matchAll(/<Cabecera[\s\S]*?\/>/g)]
    expect(cabeceras.length, 'ya no hay dos versiones del paso: revisa esta regla en vez de borrarla').toBe(2)
    for (const c of cabeceras) {
      expect(/\bopcional\b/.test(c[0]), 'una de las dos versiones no lleva el distintivo OPCIONAL').toBe(true)
    }
  })

})

describe('nadie se topa con la pantalla de Google sin avisar', () => {
  // `gmail.readonly` es un permiso RESTRINGIDO: Google enseña «esta aplicación no
  // está verificada» y hay que entrar en «Configuración avanzada» para seguir.
  // Quitar esa pantalla pide una auditoría de seguridad que para siete personas no
  // tiene sentido, asi que se queda — y una alarma de seguridad sin previo aviso
  // hace lo que Google quiere: que la persona se eche atras. Lo que la desactiva
  // es haberla anunciado antes.
  //
  // Regla a nivel de FICHERO, no de linea, y a proposito: el aviso es de pantalla,
  // no tiene que estar pegado a cada boton. Lo que se vigila es que ninguna
  // pantalla con boton de conectar se quede sin el.
  const pantallas = (() => {
    const encontradas: string[] = []
    const recorrer = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name)
        if (e.isDirectory()) recorrer(p)
        else if (/\.tsx$/.test(e.name) && leerCodigo(p).includes('/api/gmail/connect')) encontradas.push(p)
      }
    }
    recorrer('src/components')
    return encontradas
  })()

  it('hay pantallas que conectan Gmail', () => {
    expect(pantallas.length, 'nadie enlaza ya a gmail/connect: revisa esta regla en vez de borrarla').toBeGreaterThan(0)
  })

  it.each(pantallas)('%s enseña el aviso', (ruta) => {
    expect(leerCodigo(ruta).includes('<AvisoGoogle'),
      'esta pantalla manda a Google sin avisar de que dira que la app no esta verificada')
      .toBe(true)
  })

  it('el aviso lleva los pasos LITERALES que hay que pulsar', () => {
    // El texto exacto de esos botones es lo unico que uno busca con la vista
    // cuando esta nervioso. Un «sigue las instrucciones» generico no sirve.
    const A = leerCodigo('src/components/shared/AvisoGoogle.tsx')
    expect(A).toContain('Configuración avanzada')
    expect(A).toContain('no está verificada')
    // Y el dominio no se escribe a mano: sale de APP_HOST, como todo lo demas.
    expect(/APP_HOST/.test(A), 'el dominio esta cableado: al cambiarlo, el aviso mandaria al sitio viejo').toBe(true)
  })
})

describe('la preferencia de uno no apaga el buzon de los siete', () => {
  // El buzon `colaboraciones@` es correo de trabajo del estudio entero y su
  // analisis es la razon de ser de la Bandeja. Que la preferencia personal de
  // alguien pudiera apagarlo para los siete no seria una opcion: seria un fallo, y
  // ademas de los silenciosos — nadie relaciona «apague algo en mi pantalla» con
  // «el equipo lleva dos semanas sin resumenes».
  it('la sincronizacion del buzon COMPARTIDO no consulta ninguna preferencia', () => {
    const C = leerCodigo('src/lib/colabsSync.ts')
    // La primera llamada a triar() del fichero es la del buzon compartido; la
    // segunda es la del personal. Acotado al SITIO y no al fichero: buscar
    // `analizar_correo` en todo colabsSync.ts daria verde con el fallo dentro,
    // porque el sync personal SI lo usa y vive aqui al lado.
    const compartido = C.indexOf('triar(email')
    expect(compartido, 'ya no se tria en el buzon compartido: revisa esta regla').toBeGreaterThan(-1)
    const llamada = C.slice(compartido, C.indexOf(')', compartido) + 1)
    expect(/analizar_correo|permitido/.test(llamada),
      'el buzon compartido consulta una preferencia personal: uno solo puede dejar al equipo sin analisis')
      .toBe(false)
  })

  it('el buzon compartido no consulta la preferencia personal, venga de donde venga', () => {
    // Antes esto vigilaba `/api/gmail/sync`, que tenia su propia copia del bucle y
    // podia sincronizar el buzon compartido si era la cuenta conectada. Esa copia
    // ya no existe: la ruta delega, y del buzon compartido se encarga
    // `syncColabsInbox`, que nunca mira preferencias personales.
    //
    // La regla se reapunta al sitio donde el invariante sigue vivo, en vez de
    // borrarse: si alguien vuelve a meter la preferencia personal en el camino del
    // buzon compartido, uno solo dejaria al equipo sin analisis.
    const R = leerCodigo('src/app/api/gmail/sync/route.ts')
    expect(/syncPersonalInbox\(/.test(R),
      'la ruta manual ha dejado de delegar: si vuelve a tener su propio bucle, tendra que volver a distinguir el buzon compartido a mano')
      .toBe(true)
    expect(/analizar_correo\s*!==\s*false/.test(R),
      'la ruta vuelve a decidir la preferencia por su cuenta en vez de pasarle el perfil a la libreria')
      .toBe(false)
  })

  it('apagar el analisis NO deja de guardar el correo', () => {
    // La distincion que sostiene todo el triaje: se guarda SIEMPRE, se analiza a
    // veces. Si apagar el interruptor dejara de insertar, la persona perderia su
    // correo creyendo que solo ha quitado un resumen. La regla mira que el insert
    // no dependa de `analizar` en ninguno de los tres sincronizadores.
    for (const ruta of ['src/lib/colabsSync.ts', 'src/app/api/gmail/sync/route.ts']) {
      const C = leerCodigo(ruta)
      expect(/if \(!analizar\)[\s\S]{0,80}continue/.test(C),
        `${ruta} se salta el correo cuando no se analiza: eso lo pierde, no lo omite`)
        .toBe(false)
    }
  })
})

describe('con un correo abierto, el correo cabe', () => {
  const I = leerCodigo('src/components/sections/InboxSection.tsx')
  const D = leerCodigo('src/components/NexusDashboard.tsx')

  // El fallo: 248 (menu) + 214 (cuentas) + 360 (lista) = 822 px de columnas FIJAS
  // antes de que el panel de lectura recibiera un solo pixel. Las tres llevan
  // `flex-shrink-0`, asi que en una ventana de ~800 px no encogian: el correo se
  // salia por la derecha y el contenedor padre, con `overflow-hidden`, lo cortaba.
  // Javi lo vio con «CONTENIDO DEL EMAIL» y «VER EN GMAIL» pegados al borde.

  it('la columna de cuentas se retira cuando hay un correo abierto y no cabe', () => {
    const i = I.indexOf("width:'214px'")
    expect(i, 'ya no existe esa columna: revisa esta regla en vez de borrarla').toBeGreaterThan(-1)
    // Hacia atras hasta el className del mismo div, que es donde vive la condicion.
    const div = I.slice(Math.max(0, i - 320), i)
    expect(/selected \?[^`]*hidden/.test(div),
      'la columna de cuentas se queda fija con un correo abierto: en una ventana pequena empuja el correo fuera')
      .toBe(true)
  })

  it('la lista CEDE ancho en vez de imponer 360 px', () => {
    const i = I.indexOf('selected ? {width:')
    expect(i, 'ya no hay columna de lista: revisa esta regla').toBeGreaterThan(-1)
    const w = I.slice(i, i + 120)
    expect(/clamp\(/.test(w), 'la lista vuelve a un ancho fijo: no cede sitio al correo').toBe(true)
    expect(/width:'360px'/.test(w)).toBe(false)
  })

  it('lo que queda fijo deja sitio de sobra en una ventana pequena', () => {
    // La regla de verdad, en numeros y no en forma: si alguien sube el minimo de la
    // lista o el ancho del menu, esto se pone rojo aunque el `clamp` siga ahi.
    const menu = Number((D.match(/width:sidebarOpen\?'(\d+)px'/) || [])[1])
    const minLista = Number((I.match(/clamp\((\d+)px/) || [])[1])
    expect(menu, 'no se encuentra el ancho del menu: revisa esta regla').toBeGreaterThan(0)
    expect(minLista, 'no se encuentra el minimo de la lista: revisa esta regla').toBeGreaterThan(0)
    // 790 px es la ventana en la que Javi lo vio cortado. 250 px es lo que necesita
    // el panel para que quepan las tarjetas de acciones sin desbordar.
    expect(790 - menu - minLista,
      `con el menu abierto solo quedan ${790 - menu - minLista}px para el correo en una ventana de 790: se vuelve a cortar`)
      .toBeGreaterThanOrEqual(250)
  })
})

describe('ocultar el buzon del equipo lo oculta ENTERO', () => {
  // Javi: «Julio y Pablo no tienen que ver el Gmail de colaboraciones, se
  // solventará cuando borre sus cuentas». No se solventa: la marca `shared` esta en
  // el CORREO, no en la persona, asi que la cuenta nueva lo veria igual. Y borrar
  // se llevaria por delante su Bandeja, su Fichar y sus conversaciones con Harvey.
  //
  // Lo que si lo resuelve es esta preferencia — y tiene que valer en LOS DOS sitios
  // donde ese correo aparece. Ocultarlo en la pantalla y seguir metiendoselo a su
  // Harvey no es medio arreglo: es ninguno, porque Harvey se lo cuenta al
  // preguntarle «¿que tengo hoy?».
  const SITIOS = ['src/app/api/inbox/route.ts', 'src/app/api/chat/route.ts']

  it.each(SITIOS)('%s consulta ver_colabs antes de traer el correo compartido', (ruta) => {
    const C = leerCodigo(ruta)
    expect(/ver_colabs/.test(C), 'no lee la preferencia en ningun sitio').toBe(true)

    // Y que MANDE sobre la consulta, no que solo aparezca en el fichero. La primera
    // version de esta regla buscaba `veColabs` en todo el fichero y daba verde con
    // la consulta cableada a `.or(shared.eq.true)`: la palabra seguia ahi, en la
    // linea que la define. Comprobar que un nombre existe no comprueba que decida.
    const i = C.indexOf("from('inbox_messages')")
    expect(i, 'ya no se leen correos aqui: revisa esta regla en vez de borrarla').toBeGreaterThan(-1)
    const antes = C.slice(Math.max(0, i - 220), i)
    expect(/veColabs\s*$|veColabs\s*\?/.test(antes.trim()) || /veColabs\s*\?/.test(antes),
      'la consulta de correos no esta gobernada por la preferencia: se lee y se ignora')
      .toBe(true)
  })

  it('ninguna consulta de correos se queda SIN filtro de usuario', () => {
    // Al montar esto se rompio de verdad: quitar el `.or(...)` del chat dejo la
    // consulta sin filtro ninguno — el correo personal de los siete entrando en el
    // Harvey de cualquiera. Lo cazo una lectura, no un test; ahora lo caza un test.
    for (const ruta of SITIOS) {
      const C = leerCodigo(ruta)
      // La ventana acaba en el PRIMER `.limit(` de cada consulta, y no en un salto
      // de linea o una llave. La primera version se comia la rama de al lado del
      // ternario: al quitarle el filtro a UNA de las dos, encontraba el `user_id`
      // de la OTRA y daba verde. Una ventana demasiado grande es una regla que
      // mira otro sitio.
      for (const m of C.matchAll(/from\('inbox_messages'\)([\s\S]*?\.limit\()/g)) {
        const consulta = m[1]
        if (!/\.select\(/.test(consulta)) continue          // solo lecturas
        if (/\.in\('id'/.test(consulta)) continue           // el bulk va por ids ya filtrados
        expect(/user_id/.test(consulta),
          `${ruta}: hay una lectura de inbox_messages sin filtro de usuario:\n${consulta.slice(0, 200)}`)
          .toBe(true)
      }
    }
  })

  it('ante un fallo al leer la preferencia, se ENSEÑA', () => {
    // Que aparezca correo que ya veias ayer es un incordio; que desaparezca sin
    // motivo parece que se ha perdido. `!== false` y no `=== true`.
    for (const ruta of SITIOS) {
      const C = leerCodigo(ruta)
      expect(/ver_colabs !== false/.test(C),
        `${ruta}: un fallo al leer la preferencia oculta el buzon del equipo`)
        .toBe(true)
    }
  })
})

describe('lo que flota no se posa encima del contenido', () => {
  const D = leerCodigo('src/components/NexusDashboard.tsx')
  const CSS = readFileSync('src/app/globals.css', 'utf8')

  it('el contenedor de las secciones reserva el hueco de los flotantes', () => {
    // Los controles «?» y «⌘K» van `fixed`, o sea FUERA del flujo: no empujan nada
    // y se posan encima de lo que haya debajo. En Inbox caian justo sobre el boton
    // ABRIR BRUTAL.IA, que va `mt-auto` pegado al fondo de su columna.
    //
    // El hueco se reserva UNA vez, en el contenedor que envuelve a las doce
    // secciones — no seccion por seccion, porque la trece nacería rota.
    const i = D.indexOf("flex-1 overflow-y-auto overflow-x-hidden")
    expect(i, 'ya no existe ese contenedor: revisa esta regla en vez de borrarla').toBeGreaterThan(-1)
    expect(/nx-hueco-flotantes/.test(D.slice(i, i + 90)),
      'el contenedor de las secciones no reserva sitio: lo que flota volvera a taparle el fondo a alguna')
      .toBe(true)
    expect(/\.nx-hueco-flotantes\s*\{[^}]*padding-bottom/.test(CSS),
      'la clase existe en el JSX pero no reserva nada en el CSS')
      .toBe(true)
  })

  it('el hueco solo existe donde existen los flotantes', () => {
    // En movil no se pintan (`!isMobile`), asi que reservar sitio para algo que no
    // esta seria un margen fantasma al final de cada pantalla.
    const i = CSS.indexOf('.nx-hueco-flotantes')
    const contexto = CSS.slice(Math.max(0, i - 160), i)
    expect(/@media\s*\(min-width:\s*768px\)/.test(contexto),
      'el hueco se reserva tambien en movil, donde no hay flotantes: margen fantasma')
      .toBe(true)
  })
})

describe('lo que va a una columna con CHECK se valida antes', () => {
  it('el animo del diario se comprueba contra su lista', () => {
    // La trampa que ya vivio meses con `tasks.level`: un valor fuera de la lista no
    // deja un dato raro — hace REBOTAR el upsert entero, asi que se pierde el
    // cierre del dia completo por haber pulsado un boton. Y `animo` entra por
    // `pick()`, o sea que puede llegar cualquier cosa.
    const R = leerCodigo('src/app/api/diario/route.ts')
    const i = R.indexOf("pick(body,")
    expect(i, 'ya no se usa pick() aqui: revisa esta regla en vez de borrarla').toBeGreaterThan(-1)
    if (!/'animo'/.test(R.slice(i, i + 120))) return   // si se quita el campo, no hay nada que validar

    const ventana = R.slice(i, i + 700)
    expect(/productivo[\s\S]{0,40}normal[\s\S]{0,40}bloqueado/.test(ventana),
      'no se comprueba el animo contra su lista antes de escribirlo')
      .toBe(true)
    expect(/status: 400/.test(ventana),
      'se detecta el valor invalido pero no se rechaza: acabaria igual en el upsert')
      .toBe(true)
  })

  it('y la columna tiene el CHECK que lo respalda', () => {
    // La validacion de la ruta es la que da un error util; el CHECK es el que
    // impide que entre basura por cualquier otra via. Hacen falta las dos.
    const sql = readdirSync('migrations').filter(f => f.endsWith('.sql'))
      .map(f => readFileSync(join('migrations', f), 'utf8')).join('\n')
    expect(/animo[\s\S]{0,120}check[\s\S]{0,120}bloqueado/i.test(sql),
      'la columna animo no lleva CHECK: la ruta seria la unica barrera')
      .toBe(true)
  })
})

describe('varias cuentas de Gmail por persona', () => {
  it('el token NUNCA sale al cliente', () => {
    // `refresh_token` da acceso al correo entero de esa persona, para siempre y sin
    // contrasena. La ruta devuelve direcciones y la marca de compartida, nada mas.
    const R = leerCodigo('src/app/api/gmail/cuentas/route.ts')
    const i = R.indexOf('NextResponse.json({')
    expect(i, 'la ruta ya no responde asi: revisa esta regla en vez de borrarla').toBeGreaterThan(-1)
    expect(/refresh_token/.test(R.slice(i, i + 300)),
      'la respuesta lleva el refresh_token: eso es la llave del correo de alguien')
      .toBe(false)
  })

  it('solo se tocan las cuentas de quien pide, nunca las de otro', () => {
    // El id sale de la SESION. Si viniera del cuerpo, mandar la direccion de un
    // companero desconectaria su correo.
    const R = leerCodigo('src/app/api/gmail/cuentas/route.ts')
    expect(/quitarCuenta\(admin, user\.id,/.test(R),
      'se desconecta por una identidad que no sale de la sesion')
      .toBe(true)
    // Las DOS funciones que reciben un `profileId` tienen que acotarse por él. La
    // primera version de esta regla solo miraba `quitarCuenta`, y al verificarla
    // por mutacion la modificacion cayo —por accidente— en `cuentasDe`: la regla
    // siguio verde con una funcion devolviendo las cuentas de TODO el mundo. El
    // accidente enseño el hueco.
    const L = leerCodigo('src/lib/gmailCuentas.ts')
    for (const fn of ['cuentasDe', 'quitarCuenta']) {
      const i = L.indexOf(`export async function ${fn}`)
      expect(i, `ya no existe ${fn}: revisa esta regla en vez de borrarla`).toBeGreaterThan(-1)
      const fin = L.indexOf('export async function', i + 10)
      const cuerpo = L.slice(i, fin === -1 ? L.length : fin)
      expect(/\.eq\('profile_id', profileId\)/.test(cuerpo),
        `${fn} no se acota a la persona: leeria o borraria las cuentas de otro`)
        .toBe(true)
    }
  })

  it('el buzon COMPARTIDO no se sincroniza dos veces', () => {
    // Cada persona que lo tenga conectado lo traeria entero por su cuenta, pagando
    // el analisis otra vez. De el se encarga `syncColabsInbox`, una sola vez.
    const C = leerCodigo('src/lib/colabsSync.ts')
    const i = C.indexOf('cuentasDe(admin, profile.id)')
    expect(i, 'el sync personal ya no lee las cuentas: revisa esta regla').toBeGreaterThan(-1)
    expect(/filter\(c => !c\.compartida\)/.test(C.slice(i, i + 120)),
      'el sync personal no excluye la cuenta compartida: se analizaria una vez por persona')
      .toBe(true)
  })

  it('desplegar sin haber corrido la migracion NO deja a nadie sin correo', () => {
    // Las columnas viejas siguen ahi y siguen siendo el respaldo. Es lo que hace
    // que este cambio sea reversible revirtiendo codigo, sin tocar la base.
    const C = leerCodigo('src/lib/colabsSync.ts')
    expect(/gmail_colabs_refresh_token/.test(C),
      'el buzon compartido ya no tiene respaldo por las columnas viejas')
      .toBe(true)
    const i = C.indexOf('if (!cuentas.length)')
    expect(i, 'el sync personal no contempla la tabla vacia: sin migracion, nadie sincroniza').toBeGreaterThan(-1)
    expect(/gmail_refresh_token/.test(C.slice(i, i + 200)),
      'con la tabla vacia no se cae a la columna vieja')
      .toBe(true)
  })

  it('la migracion RELLENA la tabla desde lo que ya habia', () => {
    // Sin el relleno, desplegar esto desconecta a todo el equipo a la vez.
    const sql = readFileSync('migrations/20260820_gmail_cuentas.sql', 'utf8')
    expect(/insert into public\.gmail_cuentas[\s\S]*from public\.profiles/.test(sql),
      'la migracion crea la tabla vacia: al desplegar, nadie tendria cuentas')
      .toBe(true)
    expect(/drop column/i.test(sql),
      'la migracion borra las columnas viejas: volver atras dejaria de ser posible sin tocar la base')
      .toBe(false)
  })
})

describe('desconectar Gmail desconecta de verdad', () => {
  // Encontrado por revision adversarial antes de fusionar el cambio a varias
  // cuentas: desconectar limpiaba `profiles` pero dejaba viva la fila en
  // `gmail_cuentas`, que es lo que los sincronizadores consultan de verdad. El
  // correo seguia entrando —y pagandose su analisis— despues de haber dicho que no.

  it('/api/gmail/disconnect limpia gmail_cuentas en las DOS ramas', () => {
    const R = leerCodigo('src/app/api/gmail/disconnect/route.ts')
    const n = [...R.matchAll(/quitarCuentaTodas\(/g)].length
    expect(n, 'no limpia gmail_cuentas: la fila sigue viva y el correo sigue entrando').toBe(2)
  })

  it('quitarCuenta cuenta las filas que borra de verdad', () => {
    // `delete` sin filas no es un error en Postgres: sin `.select()` para contar,
    // un email mal escrito respondia "desconectada" sin haber desconectado nada.
    const L = leerCodigo('src/lib/gmailCuentas.ts')
    const i = L.indexOf('export async function quitarCuenta(')
    const cuerpo = L.slice(i, L.indexOf('export async function quitarCuentaTodas'))
    expect(/\.select\('id'\)/.test(cuerpo), 'no cuenta las filas borradas').toBe(true)
    expect(/quitadas:\s*0/.test(cuerpo) === false || /data\?\.length/.test(cuerpo),
      'no calcula cuantas filas borro de verdad').toBe(true)
  })

  it('la ruta responde 404 si no habia nada que desconectar', () => {
    const R = leerCodigo('src/app/api/gmail/cuentas/route.ts')
    expect(/quitadas === 0/.test(R), 'no distingue "borrada" de "no habia nada que borrar"').toBe(true)
  })
})

describe('el buzon compartido se recupera reconectandolo', () => {
  // El fallo exacto que encontro la auditoria: con `ascending: true`, reconectar
  // colabs despues de que caducara creaba una fila NUEVA que siempre perdia contra
  // la vieja y muerta. Reconectar no arreglaba nada, para siempre.
  it('cuentaCompartida elige la MAS RECIENTE, no la mas antigua', () => {
    const L = leerCodigo('src/lib/gmailCuentas.ts')
    const i = L.indexOf('export async function cuentaCompartida')
    const cuerpo = L.slice(i, L.indexOf('export async function guardarCuenta'))
    expect(/ascending:\s*false/.test(cuerpo),
      'ordena por la mas antigua: reconectar el buzon compartido despues de que caduque no lo arreglaria nunca')
      .toBe(true)
  })
})

describe('una cuenta secundaria caducada no borra el token de la buena', () => {
  // Con varias cuentas por persona, la rama de token caducado vaciaba
  // `profiles.gmail_refresh_token` sin mirar CUAL de las cuentas habia caducado.
  // Si era la secundaria, se borraba el token de la que seguia viva.
  it('el sync personal borra por CUENTA cuando hay direccion, no el perfil entero', () => {
    const C = leerCodigo('src/lib/colabsSync.ts')
    const i = C.lastIndexOf('if (isTokenExpired) {')
    expect(i, 'ya no existe esa rama: revisa esta regla en vez de borrarla').toBeGreaterThan(-1)
    const cuerpo = C.slice(i, i + 700)
    expect(/if \(correoCuenta\)/.test(cuerpo),
      'la rama de token caducado no distingue si hay varias cuentas: puede borrar la que seguia viva')
      .toBe(true)
    expect(/quitarCuenta\(admin, profile\.id, correoCuenta\)/.test(cuerpo),
      'no borra la cuenta caducada de gmail_cuentas: se reintentaria para siempre')
      .toBe(true)
  })
})

describe('el boton de sincronizar es UNO', () => {
  const S = leerCodigo('src/components/sections/SincronizacionSection.tsx')

  it('nadie escribe su propio boton de sincronizar a mano', () => {
    // Habia CINCO repartidos por esta pantalla y ninguno se parecia a otro: dos
    // decian «Sync» en gris, uno «SYNC AHORA» en azul solido, y los de reconectar
    // decian «Reauth». Tres estilos y dos idiomas para la misma accion.
    //
    // Se vigila que no vuelva a aparecer uno escrito a mano: un `<button>` cuyo
    // contenido lleve el icono `refresh-cw` es exactamente eso.
    for (const m of S.matchAll(/<button[\s\S]{0,700}?<\/button>/g)) {
      expect(/refresh-cw/.test(m[0]),
        `hay un boton de sincronizar escrito a mano en vez de <BotonSincronizar>:\n${m[0].slice(0, 180)}`)
        .toBe(false)
    }
  })

  it('la pantalla usa el componente compartido', () => {
    expect(/<BotonSincronizar/.test(S), 'ya no se usa el componente: revisa esta regla').toBe(true)
  })

  it('esta en español: ni «Sync» ni «Reauth»', () => {
    // «Sync» no lo entiende quien no programa, y «Reauth» es jerga de OAuth.
    const B = leerCodigo('src/components/shared/BotonSincronizar.tsx')
    expect(/'Sync'|>Sync<|Reauth/.test(S + B),
      'vuelve a haber texto en jerga inglesa en los botones')
      .toBe(false)
  })

  it('no se puede pulsar dos veces mientras trabaja', () => {
    // Cada sincronizacion analiza correos con Claude: pulsarlo tres veces seguidas
    // es pagar tres veces por lo mismo.
    const B = leerCodigo('src/components/shared/BotonSincronizar.tsx')
    expect(/disabled=\{disabled \|\| sincronizando\}/.test(B),
      'el boton sigue pulsable mientras sincroniza: cada clic de mas cuesta dinero')
      .toBe(true)
  })
})

describe('sincronizar un buzon personal esta escrito UNA vez', () => {
  // Estuvo escrito dos: la ruta que dispara el navegador y `syncPersonalInbox`,
  // que dispara el cron. El propio fichero lo decia en un comentario y lo dejaba
  // para «otro dia». Mientras las dos copias hicieron lo mismo, la duplicacion
  // solo costaba mantenimiento. Dejaron de hacerlo dos veces:
  //
  //   · el cron aprendio a recorrer varias cuentas y la ruta se quedo leyendo una
  //     sola columna — el boton sincronizaba UNA de las dos, sin decirlo;
  //   · y desde antes, la ruta creaba tareas de reunion y el cron no. Un enlace de
  //     Meet en tu Gmail personal creaba tarea solo si pulsabas a mano.
  //
  // Un gemelo que diverge es peor que uno que no: el primero da resultados
  // distintos segun por donde entres, y nadie sabe cual es el bueno.
  const R = leerCodigo('src/app/api/gmail/sync/route.ts')

  it('la ruta manual delega, no reimplementa', () => {
    expect(/syncPersonalInbox\(/.test(R), 'la ruta no delega en la libreria').toBe(true)
    // Las señales de tener un bucle propio: si aparecen aqui, la copia ha vuelto.
    for (const señal of ['analyzeEmail(', 'getEmailsWithRefreshToken(', 'aplazarResto(', 'MEETING_RE']) {
      expect(R.includes(señal),
        `la ruta manual vuelve a tener su propia copia del bucle (${señal}): divergira otra vez del cron`)
        .toBe(false)
    }
  })

  it('las tareas de reunion se crean por LOS DOS caminos', () => {
    // Lo que hacia distinto al gemelo. Ahora vive en la libreria, asi que lo hacen
    // el cron y el boton por igual — por construccion, no por acordarse.
    const C = leerCodigo('src/lib/colabsSync.ts')
    const personal = C.slice(C.indexOf('async function syncPersonalInboxSinCerrojo'))
    expect(/MEETING_RE\.test\(/.test(personal),
      'el sync personal no crea tareas de reunion: un enlace de Meet solo la crearia pulsando el boton a mano')
      .toBe(true)
  })
})
