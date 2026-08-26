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
/**
 * El rescate de aplazados NO criba, y es correcto.
 *
 * La criba mira las etiquetas de Gmail y el remitente para decidir si un
 * correo merece una llamada al modelo. Estos YA pasaron por ella:
 * `ai_estado: 'pendiente'` significa literalmente «la criba dijo que si,
 * pero la pasada se quedo sin tiempo». Volver a cribarlos seria preguntar
 * dos veces lo mismo — y encima no se podria, porque de Gmail solo se
 * guardo el cuerpo, no las etiquetas.
 *
 * Si algun dia este fichero pasa a analizar correo NUEVO, hay que sacarlo
 * de aqui: entonces si estaria saltandose la criba de verdad.
 */
const APLAZADOS = 'src/lib/aplazarCorreos.ts'
const buclesDeSync = (todos: string[]) =>
  todos.filter(f => f !== REANALISIS && f !== APLAZADOS && /await analyzeEmail\(/.test(leerCodigo(f)))

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
    //
    // SE PROHÍBE EL DERIVADO, NO UNA FORMA DE ESCRIBIRLO. La versión anterior solo
    // buscaba `.slice(0,10)`, así que `.split('T')[0]` y `.substring(0,10)` pasaban
    // las dos reglas — y `.split('T')[0]` no es una forma rebuscada: ya es un idioma
    // de este repo, está escrito en cuatro sitios, así que es lo que sale solo al
    // escribir la línea siguiente.
    //
    // Lo que se busca es un `toISOString()` de la fecha de AHORA seguido de
    // cualquier forma de quedarse con los diez primeros caracteres.
    const CORTES = String.raw`(?:\.slice\(\s*0\s*,\s*10\s*\)|\.substring\(\s*0\s*,\s*10\s*\)|\.substr\(\s*0\s*,\s*10\s*\)|\.split\('T'\)\[0\]|\.split\("T"\)\[0\])`
    const patron = new RegExp(String.raw`new Date\(\)\.toISOString\(\)\s*` + CORTES)
    const malas = TS.flatMap(f => leer(f).split('\n').map((l, i) => ({ f, i: i + 1, l })))
      .filter(({ l }) => patron.test(l) && !/^\s*(\/\/|\*)/.test(l))
    expect(malas.map(u => `${u.f}:${u.i}`),
      'Día en UTC: a partir de las ~22:00 de Madrid da el día de MAÑANA. Usa todayKey() de shared/helpers')
      .toEqual([])
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
    // El contexto vive ahora en UN solo sitio: estaba escrito dos veces con once
    // diferencias. La regla se muda con el código, no se borra.
    const C = leerCodigo('src/lib/contextoHarvey.ts')
    expect(/const sinLeer = inbox\.filter\(m => !m\.is_read\)\.length/.test(C),
      'vuelve a etiquetar la lista recortada como «sin leer»: la lista lleva tope y mete urgentes ya leidos, asi que su longitud NO es «sin leer»')
      .toBe(true)
    // Y el total tampoco se inventa. `data.inbox` esta topado a 100 por /api/inbox:
    // decir «(N total)» con 865 correos en la base era un numero falso presentado
    // como el conjunto entero.
    expect(/de \$\{inbox\.length\} cargados/.test(C),
      'el contexto vuelve a llamar «total» a lo que solo esta cargado: Harvey afirmara 100 con 865 correos')
      .toBe(true)
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
    // SE INVIERTE LA REGLA. La version anterior miraba solo `api/(diario|harvey)` y
    // buscaba el literal exacto `assigned_to === p.id`, asi que se saltaba dos
    // cosas: `resumenEquipo.ts` —el fichero al que se MUDO este codigo, y que es lo
    // que leen las dos IAs para contestar «¿como va Pablo?»— y cualquier variable
    // que no se llame `p`.
    //
    // Si ese fichero volviera a contar solo `assigned_to`, las tareas donde alguien
    // es CO-responsable desaparecerian de la respuesta de la IA mientras Reportes
    // —que si usa `esTareaDe`— las sigue contando: la IA le dice al jefe que Pablo
    // cerro 2 y la seccion dice 4, la misma tarde.
    //
    // Ahora se listan los ficheros que hablan de tareas por persona y se prohibe la
    // comparacion a pelo en TODOS, con cualquier nombre de variable.
    const infractores: string[] = []
    for (const ruta of TS) {
      if (ruta.startsWith('src/lib/__tests__/')) continue
      const c = leerCodigo(ruta)
      // Solo los ficheros que ya conocen el ayudante: son los que cuentan tareas
      // por persona. Prohibirlo en todo el repo daria falsos positivos en las
      // rutas que legitimamente filtran por `assigned_to` en una consulta.
      if (!/\besTareaDe\b/.test(c)) continue
      for (const m of c.matchAll(/\.assigned_to\s*===\s*(\w+(?:\.\w+)*)/g)) {
        // Dentro de la propia definicion de esTareaDe, la comparacion es correcta.
        if (ruta.endsWith('shared/helpers.ts')) continue
        infractores.push(`${ruta}: .assigned_to === ${m[1]}`)
      }
    }
    expect(infractores,
      `compara assigned_to a pelo en vez de esTareaDe(): las tareas con co-responsable se cuentan distinto segun quien pregunte, y la IA y Reportes daran numeros distintos el mismo dia:\n  ${infractores.join('\n  ')}`)
      .toEqual([])
  })

  // El calendario del Diario deja PLANIFICAR dias futuros a proposito. Sin tope
  // por arriba, Harvey leia esos planes y los contaba como trabajo hecho.
  it('harvey no lee dias del diario que aun no han pasado', () => {
    // El bloque se mudó a `resumenEquipo.ts` cuando Brutal.IA necesitó lo mismo.
    // La regla lo detectó sola —se puso roja— y por eso se reapunta en vez de
    // borrarse: la que se borra al mudar el código es la que deja de proteger.
    const C = leerCodigo('src/lib/resumenEquipo.ts')
    // La consulta DEL RESUMEN, no la primera del fichero: `miJornadaHoy` añadió otra
    // más arriba (la jornada de quien pregunta, que es de HOY y no necesita tope).
    const i = C.indexOf("from('diario').select('dia,user_id")
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
    // Las instrucciones viven pegadas al dato en `resumenEquipo.ts`
    // (`COMO_LEER_EL_DIARIO`): separarlas es como se acaba mandando el diario sin
    // decirle al modelo que lo de «se propuso» es un plan y no un hecho.
    const H = leerCodigo('src/lib/resumenEquipo.ts')
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

  it('el repo crea TODAS las columnas vivas, y en SU tabla', () => {
    // La regla de abajo es deliberadamente floja —lo dice ella misma: comprueba que
    // el NOMBRE exista en algun sitio del DDL, no en su tabla— y solo mira los
    // `.select('literal')`. Por esos dos huecos colaban dos columnas reales:
    //
    //   · `projects.cover_url`, que se escribe por `pick()` y no por select, y cuyo
    //     nombre existe en `content_agenda`: los CINCO proyectos de produccion
    //     tienen portada y en una instancia nueva subirla revienta con 42703.
    //   · `tasks.notes`, igual, con el nombre existiendo en `clients`.
    //
    // Esta compara contra el esquema VIVO de produccion, POR TABLA. La instantanea
    // se regenera con `probes/esquema.probe.ts` (necesita red y credenciales); el
    // test compara contra el fichero, asi que corre en CI sin nada.
    const vivo = JSON.parse(readFileSync('supabase/esquema-vivo.json', 'utf8')) as {
      tablas: Record<string, { columnas: string[] }>
    }
    expect(Object.keys(vivo.tablas).length, 'la instantanea del esquema esta vacia: regenerala').toBeGreaterThan(15)

    // Columnas por tabla que el repo SI sabe crear: del cuerpo del CREATE TABLE y
    // de los ALTER TABLE ADD COLUMN (incluido el multicolumna separado por comas,
    // que es como esta escrito `migration_gmail_colabs.sql`).
    const porTabla: Record<string, Set<string>> = {}
    const anade = (t: string, c: string) => { (porTabla[t] ??= new Set()).add(c.toLowerCase()) }
    for (const m of ddl.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)\s*\(([\s\S]*?)\n\s*\)\s*;/gi)) {
      for (const linea of m[2].split('\n')) {
        const l = linea.trim().replace(/,$/, '')
        if (!l || /^(primary|foreign|unique|constraint|check|exclude)\b/i.test(l)) continue
        const c = l.match(/^"?([a-z_][a-z0-9_]*)"?\s/i)
        if (c) anade(m[1].toLowerCase(), c[1])
      }
    }
    for (const m of ddl.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)\s+([\s\S]*?);/gi)) {
      for (const a of m[2].matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?"?([a-z_][a-z0-9_]*)/gi)) {
        anade(m[1].toLowerCase(), a[1])
      }
    }

    const faltan: string[] = []
    for (const [tabla, info] of Object.entries(vivo.tablas)) {
      for (const col of info.columnas) {
        if (!porTabla[tabla]?.has(col.toLowerCase())) faltan.push(`${tabla}.${col}`)
      }
    }
    expect(faltan,
      `produccion tiene columnas que este repo NO sabe crear en su tabla. Una instancia nueva arranca, compila, y revienta con 42703 al usarlas:\n  ${faltan.join('\n  ')}`)
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

describe('el recordatorio de fichar suena a las 10 de MADRID', () => {
  const R = leerCodigo('src/app/api/cron/recordatorio-fichar/route.ts')

  it('comprueba la hora de Madrid, no la del servidor', () => {
    // Los crons de Vercel se programan en UTC. `0 10 * * *` seria las 10:00 de
    // Madrid solo en invierno: en verano avisaria a las 12:00, dos horas tarde y
    // todos los dias durante siete meses. La hora se comprueba aqui dentro.
    expect(/madridHour\(\)/.test(R), 'usa la hora del servidor: en verano avisaria dos horas tarde').toBe(true)
    expect(/new Date\(\)\.getHours\(\)/.test(R), 'usa getHours() del servidor, que en Vercel es UTC').toBe(false)
  })

  it('estan programadas LAS DOS horas UTC que pueden ser las 10 en Madrid', () => {
    // 08:00 UTC en verano y 09:00 UTC en invierno. Con una sola, media año falla.
    const v = JSON.parse(readFileSync('vercel.json', 'utf8')) as { crons: { path: string; schedule: string }[] }
    const suyos = v.crons.filter(c => c.path === '/api/cron/recordatorio-fichar').map(c => c.schedule)
    expect(suyos.length,
      'falta una de las dos horas: con una sola, medio año el aviso llega a destiempo')
      .toBe(2)
    expect(suyos.some(s => s.startsWith('0 8 ')), 'falta la de verano (08:00 UTC)').toBe(true)
    expect(suyos.some(s => s.startsWith('0 9 ')), 'falta la de invierno (09:00 UTC)').toBe(true)
  })

  it('no avisa a quien ya ha fichado', () => {
    // Avisar a quien ya lo hizo es lo que enseña a ignorar los avisos.
    expect(/conObjetivos\.has\(/.test(R), 'avisa a todo el mundo, hayan fichado o no').toBe(true)
  })
})

describe('Harvey sugiere UNA tarea', () => {
  const T = leerCodigo('src/components/sections/TareasSection.tsx')

  it('se pinta una sola sugerencia', () => {
    // Javi: «no quiero que sugiera tantas tareas, quiero que sugiera una».
    expect(/HARVEY_SUGGESTIONS\.map\(/.test(T),
      'vuelve a pintar la lista entera de sugerencias')
      .toBe(false)
    expect(/sugerencia\.map\(/.test(T), 'ya no se pinta la sugerencia elegida: revisa esta regla').toBe(true)
  })

  it('y no sugiere algo que ya tienes', () => {
    expect(/yaEstan\.has\(/.test(T),
      'sugiere sin mirar tus tareas: puede proponerte una que acabas de crear')
      .toBe(true)
  })
})

describe('las carpetas de Proyectos se ven tambien en movil', () => {
  const P = leerCodigo('src/components/sections/ProyectosSection.tsx')

  it('la vista de LISTA agrupa por carpeta', () => {
    // En movil se fuerza la vista de lista —el kanban no cabe en 375px— asi que
    // las carpetas, que solo existian en el tablero, no existian en el telefono.
    expect(/isMobile\) setProjView\('list'\)/.test(P),
      'ya no se fuerza la lista en movil: revisa esta regla en vez de borrarla')
      .toBe(true)
    const i = P.indexOf('const listProjectsSorted')
    const cuerpo = P.slice(i, i + 1800)
    expect(/conCarpeta/.test(cuerpo), 'la lista no agrupa por carpeta: en movil no se veran').toBe(true)
    expect(/abreCarpeta/.test(P), 'la lista no pinta cabecera al cambiar de carpeta').toBe(true)
  })
})

describe('el cronometro de Fichar se ve, y en las dos pantallas', () => {
  const D = leerCodigo('src/components/sections/DiarioSection.tsx')

  it('no esta escondido detras de !isMobile', () => {
    // Javi: «sigo sin ver un boton de marcar entrada». Estaba casi todo hecho y no
    // se veia por dos motivos: el bloque iba detras de `!isMobile` —o sea que en el
    // movil no existia— y el boton de fichar estaba enterrado al final del panel de
    // objetivos, visible solo si ya habias escrito alguno.
    const i = D.indexOf('EN LA OFICINA')
    expect(i, 'ya no existe el cronometro: revisa esta regla en vez de borrarla').toBeGreaterThan(-1)
    const antes = D.slice(Math.max(0, i - 1400), i)
    expect(/!isMobile && miEntrada/.test(antes),
      'el cronometro vuelve a estar oculto en movil, que es donde Javi no lo veia')
      .toBe(false)
  })

  it('hay una accion clara en cada estado', () => {
    // Sin fichar → arrancar. En marcha → terminar. Un cronometro sin boton de
    // arranque visible no es un cronometro, es un numero.
    for (const t of ['MARCAR ENTRADA', 'TERMINAR', 'PONER OBJETIVOS']) {
      expect(D.includes(t), `falta la accion «${t}» del cronometro`).toBe(true)
    }
  })

  it('sin objetivos lleva a escribirlos, no da un error', () => {
    // `fichar('entrada')` exige objetivos —es lo que hace que fichar valga para
    // algo—. Pulsar y comerse un toast de error es peor que llevar al sitio.
    const i = D.indexOf('PONER OBJETIVOS')
    expect(/refObjetivos\.current\?\.scrollIntoView/.test(D.slice(Math.max(0, i - 700), i)),
      'sin objetivos el boton no lleva a escribirlos')
      .toBe(true)
  })
})

describe('las carpetas de la lista empiezan plegadas', () => {
  const P = leerCodigo('src/components/sections/ProyectosSection.tsx')

  it('una carpeta cerrada NO pinta sus proyectos', () => {
    // Javi: salian las tres piezas de cada carpeta en fila y «manchaban toda la
    // pantalla». Una carpeta que enseña su contenido sin pedirselo no ordena nada:
    // solo ha puesto un titulo encima del mismo muro.
    expect(/const plegada = !!carpeta && !carpetasAbiertas\.has\(carpeta\)/.test(P),
      'ya no se calcula si la carpeta esta plegada').toBe(true)
    expect(/\{!plegada &&/.test(P),
      'las filas se pintan aunque la carpeta este cerrada: la carpeta no esconde nada')
      .toBe(true)
  })

  it('lo que NO tiene carpeta nunca se pliega', () => {
    // No es una carpeta: es lo que aun no has colocado. Esconderlo lo haria
    // desaparecer del todo, y entonces no hay forma de llegar a ello.
    expect(/const plegada = !!carpeta &&/.test(P),
      'lo suelto tambien se puede plegar: desapareceria sin forma de recuperarlo')
      .toBe(true)
  })
})

describe('nada mas ancho que la pantalla en el movil de Contenido', () => {
  const C = leerCodigo('src/components/sections/ContenidoSection.tsx')

  it('el panel no puede desbordar en horizontal', () => {
    // Un `<input>` o un `<select>` con `flex-1` NO encoge por debajo de su ancho
    // intrinseco —unos 20 caracteres— salvo `min-width: 0`. Sin eso una fila se
    // hace mas ancha que la pantalla y arrastra el panel ENTERO: se ve todo
    // cortado por la izquierda, no solo la fila culpable.
    // Anclado al contenedor del MODAL MOVIL, que es el que se identifica por su
    // `scrollPaddingBottom`. Buscar el primer `flex-1 overflow-y-auto` del fichero
    // encontraba otro contenedor distinto y daba rojo sin fallo — el tropiezo de
    // anclar al primer `indexOf` que ya ha pasado varias veces en esta suite.
    const i = C.indexOf('scrollPaddingBottom')
    expect(i, 'ya no existe el modal movil: revisa esta regla en vez de borrarla').toBeGreaterThan(-1)
    const div = C.slice(Math.max(0, i - 260), i)
    expect(/overflow-x-hidden/.test(div),
      'el cuerpo del modal movil puede volver a desbordar en horizontal')
      .toBe(true)
  })

  it('los campos que comparten fila pueden encoger', () => {
    // La causa, no solo el sintoma: `overflow-x-hidden` corta lo que sobra, pero
    // `min-w-0` hace que no sobre.
    // POR LINEAS, no con un regex sobre la etiqueta.
    //
    // La primera version usaba `/<(?:input|select)[^>]*flex-1[^>]*>/`, y `[^>]*`
    // cortaba en el `>` de las flechas `e=>` de los `onChange`: no casaba con
    // NINGUN campo, el bucle se recorria vacio y el test pasaba sin mirar nada.
    // Lo enseño la verificacion por mutacion —quitar un `minWidth: 0` no ponia
    // nada rojo—. Un `expect` dentro de un bucle vacio es un test que siempre pasa.
    const campos = C.split('\n').filter(l => /<(input|select)\b/.test(l) && /flex-1/.test(l))
    expect(campos.length, 'no se encuentra ningun campo con flex-1: revisa esta regla').toBeGreaterThan(0)
    for (const linea of campos) {
      expect(/minWidth:\s*0/.test(linea),
        `hay un campo con flex-1 y sin minWidth: 0, que no encogera y arrastrara la pantalla:\n${linea.trim().slice(0, 150)}`)
        .toBe(true)
    }
  })
})

describe('las dos IAs saben lo mismo', () => {
  // Javi, describiendo para que sirve Memoria: «un apartado donde se guardan todos
  // los documentos de la empresa… para que la IA sepa que se va haciendo y por
  // donde se puede tirar en el futuro».
  //
  // Habia DOS superficies de IA y solo una la veia: Harvey montaba su contexto en
  // el cliente e incluia Memoria; `/api/chat` (Brutal.IA) la ignoraba por completo.
  // Si el brief de un cliente o las tarifas estaban ahi, una lo sabia y la otra no
  // — y desde fuera parecen la misma IA, asi que no se lee como «dos herramientas»
  // sino como que la IA a veces finge no saber.
  const SUPERFICIES = [
    'src/app/api/chat/route.ts',
    'src/components/sections/HarveySection.tsx',
  ]

  it.each(SUPERFICIES)('%s consulta la Memoria', (ruta) => {
    expect(/memoriaRelevante/.test(leerCodigo(ruta)),
      'esta IA no mira la Memoria: sabra menos que la otra sobre lo mismo')
      .toBe(true)
  })

  it('y las dos eligen las notas con la MISMA funcion', () => {
    // No dos criterios parecidos: el mismo. Dos formas de elegir «lo relevante»
    // divergen igual que divergen dos copias de un bucle — y aqui la divergencia
    // no se ve, porque las dos responden algo plausible.
    for (const ruta of SUPERFICIES) {
      expect(/from '@\/lib\/memoriaRelevante'/.test(leerCodigo(ruta)),
        `${ruta} elige las notas por su cuenta en vez de usar la funcion compartida`)
        .toBe(true)
    }
  })

  it('la Memoria llega al prompt, no solo a la consulta', () => {
    // Traerla de la base y no metersela al modelo es el fallo silencioso: la
    // consulta existe, el codigo parece cableado, y el modelo sigue sin verla.
    const A = leerCodigo('src/lib/ai.ts')
    expect(/MEMORIA DEL ESTUDIO/.test(A),
      'el prompt no incluye la Memoria: se consulta y se tira')
      .toBe(true)
    expect(/context\.memoria/.test(A), 'el bloque existe pero no usa el dato').toBe(true)
  })
})

describe('la voz de Harvey no se corta al tocar la pantalla', () => {
  const A = leerCodigo('src/components/shared/audio.ts')

  it('unlockAudio no pisa lo que esta sonando', () => {
    // Javi: «mientras esta hablando y deslizo, se para».
    //
    // `unlockAudio` va enganchado a CADA `touchend` y `click` de la app, y ponia
    // `src = SILENT_WAV` en el UNICO elemento de audio que existe. La guarda era
    // `__unlocked`, que solo se pone a true si ese primer `play()` sale bien — y en
    // iOS falla a menudo. Con la guarda en falso, cada toque metia un wav silencioso
    // encima de la voz. Y `touchend` dispara tambien al terminar un scroll, asi que
    // bastaba con deslizar para leer lo que Harvey iba diciendo.
    const i = A.indexOf('export const unlockAudio')
    expect(i, 'ya no existe unlockAudio: revisa esta regla en vez de borrarla').toBeGreaterThan(-1)
    const cuerpo = A.slice(i, A.indexOf('export const isSRBroken'))
    const guarda = cuerpo.indexOf('a.src = SILENT_WAV')
    expect(/!a\.paused/.test(cuerpo.slice(0, guarda)),
      'unlockAudio asigna el src sin comprobar antes si hay algo sonando')
      .toBe(true)
  })

  it('cualquier reproduccion que suene deja el audio desbloqueado', () => {
    // Sin esto `__unlocked` solo se ponia si el wav silencioso conseguia sonar, y
    // si fallaba se reintentaba en CADA toque durante el resto de la sesion.
    expect(/addEventListener\('playing'/.test(A),
      'nada marca el audio como desbloqueado al sonar de verdad: se reintentara para siempre')
      .toBe(true)
  })
})

describe('Harvey no espera en serie lo que puede pedir a la vez', () => {
  const R = leerCodigo('src/app/api/harvey/chat/route.ts')

  it('la busqueda web no bloquea el montaje del contexto', () => {
    // Javi: «tarda mucho en responder». Habia una cadena EN SERIE antes de llamar
    // al modelo: busqueda web (externa, segundos) → consulta de perfil → consulta
    // de plantilla → Anthropic. Cada eslabon esperaba al anterior sin necesitarlo.
    // El comentario decia «run in parallel» y el codigo hacia `await` justo debajo.
    expect(/const searchResults = needsSearch \? await webSearch/.test(R),
      'la busqueda web vuelve a bloquear: nada corre mientras tanto')
      .toBe(false)
    expect(/Promise\.all\(\[[\s\S]{0,200}busqueda/.test(R),
      'la busqueda no se espera junto a las consultas de la base')
      .toBe(true)
  })

  it('el equipo se pide en UNA consulta, no en dos', () => {
    // Eran dos viajes seguidos a la misma tabla: quien pregunta y la plantilla.
    // Con `id, name, role` de todos salen las dos cosas y el que pregunta se busca
    // en memoria, que cuesta cero.
    expect(/from\('profiles'\)\.select\('id, name, role'\)/.test(R),
      'no se pide el equipo entero de una vez').toBe(true)
    expect(/from\('profiles'\)\.select\('id,name'\)/.test(R),
      'vuelve a haber una segunda consulta a profiles: un viaje de mas en cada mensaje')
      .toBe(false)
  })
})

describe('cambiar de seccion no parece roto', () => {
  const D = leerCodigo('src/components/NexusDashboard.tsx')

  it('lo que se ve mientras carga no llama la atencion', () => {
    // ESTA REGLA DEFENDIA MI PROPIO ERROR y duro un dia.
    //
    // Diagnostiqué el parpadeo como «la descarga del trozo de la seccion» y puse un
    // esqueleto con `animate-pulse`. Javi: «sigue pasando y encima ahora esta la
    // animacion; fue peor el remedio que la enfermedad». Tenia razon dos veces: la
    // causa era otra —`useIsMobile` arrancaba diciendo «no es movil»— y un bloque
    // que late es MAS visible que un texto pequeño, asi que convertí un parpadeo en
    // una animacion.
    //
    // La pista estaba en el propio sintoma, «SIEMPRE»: descargar un trozo pasa una
    // vez por sesion; aquello pasaba en cada apertura.
    //
    // Lo que la regla protege ahora: que el hueco de carga sea DISCRETO. Ni texto
    // centrado sobre el vacio, ni nada que se mueva.
    const i = D.indexOf('const sectionLoader')
    expect(i, 'ya no existe el cargador: revisa esta regla en vez de borrarla').toBeGreaterThan(-1)
    const cuerpo = D.slice(i, i + 400)
    expect(/CARGANDO/.test(cuerpo), 'vuelve el texto centrado sobre el vacio').toBe(false)
    expect(/animate-(pulse|spin|bounce|ping)/.test(cuerpo),
      'el hueco de carga vuelve a moverse: una animacion ahi es mas visible que la espera que tapa')
      .toBe(false)
  })

  it('las secciones se precargan al apuntar, no al pulsar', () => {
    expect(/onPointerEnter=\{\(\)=>precargar\(id\)\}/.test(D),
      'no se precarga al pasar el raton: la primera vez sigue esperando')
      .toBe(true)
    expect(/onTouchStart=\{\(\)=>precargar\(id\)\}/.test(D),
      'en movil no se precarga: entre tocar y levantar hay ~100ms que se estan tirando')
      .toBe(true)
  })

  it('hay UNA lista de secciones, no dos', () => {
    // Al añadir la precarga por raton lo primero que escribi fue un segundo mapa —
    // dos listas de las mismas trece secciones. Asi nacen los gemelos aqui: se
    // añade la catorce a una y no a la otra, y nadie se entera hasta que esa tarda.
    const listas = [...D.matchAll(/const CARGADORES/g)].length
    expect(listas, 'hay mas de una lista de cargadores de seccion: divergiran').toBe(1)
  })
})

describe('lo que se despliega se puede plegar', () => {
  it('el calendario de Fichar tiene boton de plegar', () => {
    // Se abria desde la tira de la semana y solo se cerraba ELIGIENDO un dia — o
    // sea que para plegarlo tenias que cambiar de dia, un efecto que quiza no
    // querias. Un panel que se despliega se repliega con el mismo gesto.
    const D = leerCodigo('src/components/sections/DiarioSection.tsx')
    const i = D.indexOf('{verCalendario && (')
    expect(i, 'ya no existe el calendario desplegable: revisa esta regla').toBeGreaterThan(-1)
    const bloque = D.slice(i, i + 1400)

    // Anclado a un BOTON dedicado, no a que aparezca `setVerCalendario(false)`.
    // La primera version buscaba esa llamada y daba verde con el boton borrado,
    // porque la MISMA llamada esta dentro de `onElegirDia` —que cierra el
    // calendario al elegir dia—. La regla casaba con otra cosa que ya estaba ahi.
    expect(/onClick=\{\(\) => setVerCalendario\(false\)\}/.test(bloque),
      'no hay un boton para plegar el calendario: solo se cierra cambiando de dia, que es un efecto que quiza no quieres')
      .toBe(true)
  })
})

describe('el enlace de revision se puede sacar desde el movil', () => {
  const C = leerCodigo('src/components/sections/ContenidoSection.tsx')

  it('el boton esta definido UNA vez y usado en los DOS paneles', () => {
    // Estaba escrito solo en el panel de escritorio: desde el telefono no habia
    // forma de generarlo. Y pedir una revision se hace mas fuera de la oficina que
    // delante del ordenador.
    expect([...C.matchAll(/const BotonEnlaceRevision/g)].length,
      'el boton del enlace no esta definido una sola vez').toBe(1)
    expect([...C.matchAll(/<BotonEnlaceRevision/g)].length,
      'el boton del enlace no esta en los dos paneles (movil y escritorio)').toBe(2)
  })

  it('el enlace sale de rutaApp, no del dominio por el que entraste', () => {
    // El equipo tiene la PWA instalada desde el dominio viejo: con
    // `window.location.origin` el mismo boton daba una URL u otra segun quien lo
    // pulsara, y ese enlace se le manda a otra persona.
    const i = C.indexOf('const BotonEnlaceRevision')
    const cuerpo = C.slice(i, i + 900)
    expect(/rutaApp\(`\/review\//.test(cuerpo), 'el enlace no se construye con rutaApp').toBe(true)
    expect(/window\.location\.origin/.test(cuerpo), 'usa el origen del navegador: dara dominios distintos').toBe(false)
  })
})

describe('el diseño acierta en el PRIMER render, no en el segundo', () => {
  // LA CAUSA REAL del «frame bugueado» que Javi veia al abrir cualquier seccion.
  //
  // `useIsMobile` arrancaba en `useState(false)` —«no es movil»— y se corregia en
  // un `useEffect`, que corre DESPUES de pintar. En un telefono eso significa que
  // cada seccion se pintaba una vez entera con el diseño de ESCRITORIO —columnas de
  // kanban, paneles de 360px, tres columnas— y al frame siguiente saltaba al de
  // movil.
  //
  // Pasaba SIEMPRE, en todas las secciones, y esa palabra era la pista: descargar
  // el trozo de una seccion pasa UNA vez por sesion; esto pasaba en cada apertura.
  // Yo lo achaque primero a la descarga y puse un esqueleto animado — empeoro.

  it('useIsMobile no arranca mintiendo', () => {
    const H = leerCodigo('src/components/shared/hooks.ts')
    const i = H.indexOf('export function useIsMobile')
    expect(i, 'ya no existe useIsMobile: revisa esta regla en vez de borrarla').toBeGreaterThan(-1)
    const cuerpo = H.slice(i, i + 700)
    expect(/useState\(false\)/.test(cuerpo),
      'useIsMobile vuelve a arrancar en false: cada seccion se pintara un frame con el diseño de escritorio')
      .toBe(false)
    expect(/matchMedia/.test(cuerpo.slice(0, cuerpo.indexOf('useEffect'))),
      'el valor inicial no consulta el ancho real: se corregira despues de pintar')
      .toBe(true)
  })

  it('la vista de Proyectos nace en la que toca', () => {
    // El efecto que la corregia vive en ProyectosSection y corre despues de pintar:
    // en movil, un frame de columnas de kanban antes de saltar a la lista.
    const D = leerCodigo('src/components/NexusDashboard.tsx')
    const i = D.indexOf("const [projView, setProjView]")
    expect(i, 'ya no existe projView: revisa esta regla').toBeGreaterThan(-1)
    const decl = D.slice(i, i + 260)
    expect(/matchMedia/.test(decl),
      'projView vuelve a nacer en board y a corregirse luego: un frame de kanban en movil')
      .toBe(true)
  })
})

describe('la tarjeta de Harvey no vuelve a tener su propio mapa', () => {
  // Estaba escrita CUATRO veces y con dos mapas distintos entre si: `nota` salia
  // con el icono de «cliente» en dos de ellas, y el boton decia CREANDO al marcar
  // una tarea como hecha. Ahora sale de `etiquetaAccion()`, que es exhaustiva por
  // tipo — o sea que un tipo nuevo sin etiqueta ya no compila.
  it('las secciones no llevan su propia tabla de iconos ni de titulos', () => {
    const infractores = TS.filter(r => /sections\/(Hoy|Harvey)Section/.test(r) &&
      /(iconMap|labelMap)\s*:\s*Record<string,\s*string>/.test(leerCodigo(r)))
    expect(infractores, `vuelve a haber un mapa de etiquetas a mano:\n  ${infractores.join('\n  ')}`).toEqual([])
  })

  it('el boton de confirmar no dice «CREANDO» a pelo', () => {
    const infractores = TS.filter(r => /sections\/(Hoy|Harvey)Section/.test(r) &&
      /confirmingAction\s*\?\s*'CREANDO/.test(leerCodigo(r)))
    expect(infractores, `el boton vuelve a decir CREANDO para todo, incluido marcar una tarea como hecha:\n  ${infractores.join('\n  ')}`).toEqual([])
  })
})

describe('el ejecutor no lee campos que el parser nunca rellena', () => {
  // El caso `pieza` leia el cliente y la fecha de la accion, y el parser no los
  // pone: eran `undefined` SIEMPRE. No fallaba nada —y por eso vivio— pero quien
  // leyera el ejecutor daba por hecho que una pieza dictada se enlaza con su
  // cliente. Codigo muerto que parece una funcion es peor que codigo muerto.
  //
  // El contrato de `pieza` son tres campos A PROPOSITO: se dicta en voz alta y un
  // interrogatorio de cuatro preguntas para apuntar un reel no lo usa nadie. O
  // sea que la solucion no era rellenarlos, era dejar de leerlos.
  it('cada campo que se lee en un case, el parser lo pone en ese mismo case', () => {
    const EJ = leerCodigo('src/lib/harveyEjecutar.ts')
    const PA = leerCodigo('src/lib/harveyAccion.ts')

    // Lo que el parser SI rellena, por tipo.
    const rellena: Record<string, Set<string>> = {}
    for (const m of PA.matchAll(/case '(\w+)':[\s\S]{0,600}?type: '\1'([\s\S]{0,400}?)\}\s*\}/g)) {
      rellena[m[1]] = new Set([...m[2].matchAll(/(\w+):/g)].map(x => x[1]))
    }
    expect(Object.keys(rellena).length, 'no se reconocio ningun case del parser: revisa esta regla en vez de borrarla')
      .toBeGreaterThan(3)

    // Lo que el ejecutor LEE, por tipo. Cada case va de `case 'x': {` al siguiente.
    const casos = [...EJ.matchAll(/case '(\w+)': \{/g)]
    const huerfanos: string[] = []
    casos.forEach((c, i) => {
      const tipo = c[1]
      if (!rellena[tipo]) return   // un case que el parser no conoce ya lo cubre otra regla
      const cuerpo = EJ.slice(c.index!, casos[i + 1]?.index ?? EJ.length)
      for (const l of cuerpo.matchAll(/accion\.(\w+)/g)) {
        // `type` y `text` los pone el parser en todos.
        if (l[1] === 'type' || l[1] === 'text') continue
        if (!rellena[tipo].has(l[1])) huerfanos.push(`${tipo}.${l[1]}`)
      }
    })
    expect([...new Set(huerfanos)],
      `el ejecutor lee campos que el parser NUNCA rellena para ese tipo: son undefined siempre, no fallan, y parecen una funcion que no existe:\n  ${[...new Set(huerfanos)].join('\n  ')}`)
      .toEqual([])
  })
})

describe('una respuesta cortada no se sirve como entera', () => {
  // Las dos IAs tienen tope de tokens y las dos se lo tragaban. Harvey lo avisaba
  // con un `console.warn` —o sea a NADIE— y ahi es peor que en Brutal.IA: el
  // `[ACCION:...]` va al FINAL, asi que es lo primero que se pierde al truncar.
  // Harvey decia en voz alta «te creo la tarea», la etiqueta se quedaba cortada,
  // no se creaba nada, y el usuario se enteraba tres dias despues.
  it('las dos miran stop_reason y se lo dicen a quien esta mirando', () => {
    // OJO A LA FORMA. La primera version buscaba el texto de aviso «por ahi cerca»
    // de la bandera, y PASO EN VERDE con las dos mutaciones puestas: desactivar la
    // rama (`if (false)`, `false ? ...`) no borra el literal, que sigue en el
    // fichero sin que nadie lo emita nunca. Hay que exigir que la bandera y el
    // mensaje esten UNIDOS en la misma expresion.
    for (const [ruta, ata] of [
      // Harvey: stream de texto plano que se lee en voz alta. Se encola al cerrar.
      ['src/app/api/harvey/chat/route.ts', /if \(truncada\)\s*\{[\s\S]{0,400}?cortado la respuesta/],
      // Brutal.IA: no hay stream, se pega al final de la respuesta que devuelve.
      ['src/lib/ai.ts', /truncada\s*\?[\s\S]{0,200}?cortado aqui|truncada\s*\?[\s\S]{0,200}?cortado aquí/],
    ] as const) {
      const c = leerCodigo(ruta)
      expect(/stop_reason === 'max_tokens'/.test(c),
        `${ruta} ya no mira si el modelo corto la respuesta`).toBe(true)
      expect(ata.test(c),
        `${ruta} detecta el truncamiento y no se lo dice a quien esta mirando. Que lo MIRE no basta: antes lo miraba y lo escribia en la consola del servidor, que es donde no lo lee nadie.`)
        .toBe(true)
    }
  })
})

describe('las dos IAs saben lo mismo del equipo', () => {
  // Harvey contestaba «¿que hizo Pablo ayer?» y Brutal.IA no: la misma pregunta,
  // en la misma app, con dos respuestas segun a cual de las dos le hablaras. Desde
  // fuera no son dos herramientas —son «la IA»—, y eso no se lee como una
  // limitacion: se lee como que la IA a veces se inventa que no sabe.
  it('las dos rutas de chat tiran del mismo modulo', () => {
    for (const ruta of ['src/app/api/harvey/chat/route.ts', 'src/app/api/chat/route.ts']) {
      expect(/resumenDelEquipo\(/.test(leerCodigo(ruta)),
        `${ruta} ya no usa resumenDelEquipo(): o se quedo sin diario de equipo, o tiene su propia copia — que es el gemelo de siempre`)
        .toBe(true)
    }
  })

  it('nadie se ha vuelto a escribir el bloque por su cuenta', () => {
    // Se mira la PROSA, no la consulta. Un `from('diario')` no es una copia: el
    // motor de automatizaciones lee el diario de 14 dias para disparar avisos, y
    // `/api/equipo/resumen` lo lee para la valoracion que solo ve un propietario.
    // Lo que no puede haber dos veces son las frases del bloque — «se propuso»,
    // «hizo (cierre del dia)» —, porque son el CONTRATO con el modelo: el prompt
    // le explica como leerlas, y una segunda copia con otras palabras es una copia
    // que el prompt no sabe interpretar.
    // Y la PAREJA de frases, no cualquiera de las dos: `comoVaLaPersona` (la
    // valoracion que redacta la IA para el panel de equipo, solo propietario)
    // tambien escribe «se propuso», y comparte ese vocabulario a proposito — pero
    // cierra con «conto al cerrar» y alimenta otro prompt. No es una copia.
    const sobran = TS.filter(r => r !== 'src/lib/resumenEquipo.ts' && (c =>
      /se propuso:/.test(c) && /hizo \(cierre del d/.test(c))(leerCodigo(r)))
    expect(sobran, `vuelve a haber una copia del bloque de diario fuera del modulo:\n  ${sobran.join('\n  ')}`).toEqual([])
  })
})

describe('Harvey sabe lo que pasa en Fichar', () => {
  const R = leerCodigo('src/lib/resumenEquipo.ts')

  it('trae las horas y el animo, no solo el texto', () => {
    // Javi: «lo que hace cada uno en fichar se va a poder preguntar en Harvey — un
    // jefe pregunta que ha hecho hoy X persona».
    //
    // El resumen del equipo ya traia lo que cada uno ESCRIBIO, pero no cuanto
    // estuvo ni como le fue — y eso es media respuesta: «se propuso tres cosas y
    // cerro con una» significa algo muy distinto si estuvo dos horas o nueve.
    // Igual: la consulta del RESUMEN, que es la que alimenta el bloque de las IAs.
    const i = R.indexOf("from('diario').select('dia,user_id")
    expect(i, 'ya no se lee el diario aqui: revisa esta regla en vez de borrarla').toBeGreaterThan(-1)
    const select = R.slice(i, i + 120)
    expect(/entrada_at/.test(select), 'no trae la hora de entrada: no puede decir cuanto estuvo').toBe(true)
    expect(/animo/.test(select), 'no trae el animo: un «bloqueado» pasaria desapercibido').toBe(true)
  })

  it('un dia sin cerrar dice «lleva», no «estuvo»', () => {
    // El dia no ha terminado: dar un total cerrado sobre algo en curso es afirmar
    // de mas, y ese numero se lo lee un jefe como si fuera definitivo.
    // La frase cambió al añadir las horas de entrada y salida, pero el invariante es
    // el mismo: un día en curso dice «lleva», no «estuvo».
    expect(/lleva \$\{dur\} sin cerrar/.test(R),
      'un dia en curso se reporta como si estuviera cerrado')
      .toBe(true)
    expect(/ABIERTA, sin cerrar/.test(R),
      'la jornada en curso de quien pregunta se reporta como cerrada').toBe(true)
  })
})

describe('abrir la app desde el icono no da escalones de color', () => {
  // Javi: «hay otro parpadeo justo cuando abres la app desde inicio».
  //
  // Al lanzarla se pintaban TRES negros distintos, uno detrás de otro:
  //   · el splash del sistema, del `background_color` del manifest
  //   · el HTML al llegar, del `background` de html/body
  //   · la pantalla de arranque al montar React, del `.nx-boot`
  // Tres repintados en cascada. En una pantalla OLED esa diferencia se ve como un
  // escalón — no es un parpadeo de carga, es de COLOR.
  const CSS = readFileSync('src/app/globals.css', 'utf8')
  const MANIFEST = JSON.parse(readFileSync('public/manifest.json', 'utf8')) as { background_color?: string; theme_color?: string }
  const LAYOUT = readFileSync('src/app/layout.tsx', 'utf8')

  const arranque = (CSS.match(/--nx-arranque:\s*(#[0-9a-fA-F]{6})/) || [])[1]

  it('hay un color de arranque declarado en un solo sitio', () => {
    expect(arranque, 'no existe --nx-arranque: revisa esta regla en vez de borrarla').toBeTruthy()
  })

  it('html/body y la pantalla de arranque usan ESE color, no uno suyo', () => {
    expect(/html, body \{[^}]*background: var\(--nx-arranque\)/.test(CSS),
      'el fondo del documento vuelve a estar escrito a mano: se separara del splash')
      .toBe(true)
    const i = CSS.indexOf('.nx-boot {')
    expect(/background: var\(--nx-arranque\)/.test(CSS.slice(i, i + 300)),
      'la pantalla de arranque tiene su propio negro: habra un escalon al montar React')
      .toBe(true)
  })

  it('el manifest y el themeColor dicen lo MISMO', () => {
    // El manifest es lo que pinta el sistema ANTES de que exista la pagina. Si no
    // coincide, el escalon ocurre antes de que nuestro codigo pueda hacer nada.
    expect(MANIFEST.background_color?.toLowerCase(),
      'el splash del sistema no coincide con el fondo de la app').toBe(arranque?.toLowerCase())
    expect(new RegExp(`themeColor: '${arranque}'`, 'i').test(LAYOUT),
      'el themeColor no coincide: la barra del navegador dara el escalon').toBe(true)
  })

  it('la pantalla de arranque no se funde entera', () => {
    // Fundir el contenedor desde opacidad 0 deja ver el fondo de debajo mientras
    // sube — y como el CONTENIDO ya tiene su animacion, la opacidad se multiplica y
    // la insignia tarda el doble en verse.
    const i = CSS.indexOf('.nx-boot {')
    expect(/animation: nxBootEntra/.test(CSS.slice(i, i + 400)),
      'vuelve el fundido del contenedor: se vera el escalon de fondo otra vez')
      .toBe(false)
  })
})

describe('la app no nombra ninguna tipografia que no cargue', () => {
  // ESTUVO ROTO TRECE DIAS Y NO LO VIO NADIE. Eso es lo que lo hace peligroso.
  //
  // El 2026-08-09 se anadio la CSP de next.config.ts, con dos directivas:
  //
  //     style-src 'self' 'unsafe-inline'   ← bloquea el CSS de fonts.googleapis.com
  //     font-src  'self' data:             ← bloquea los .woff2 de fonts.gstatic.com
  //
  // …y globals.css seguia pidiendo Syne y Figtree a Google con un @import. Una
  // fuente bloqueada NO DA ERROR: cae al siguiente nombre de la pila. Asi que la app
  // se pinto entera con la del sistema durante casi dos semanas, en silencio.
  //
  // El 2026-08-22 se migro a next/font —mismo dominio, o sea 'self'— y Syne aparecio
  // POR PRIMERA VEZ en meses. Se noto muchisimo: medido en el navegador, «ANALIZAR
  // CON IA BRUTAL» paso de 527 px a 870 px, un 65% mas ancha. A Javi no le gusto y
  // se volvio a lo que habia.
  //
  // ESTA REGLA NO DEFIENDE ESA DECISION, que es de gusto y puede cambiar manana.
  // Defiende que lo DECLARADO y lo CARGADO coincidan. Si se recupera Syne con
  // next/font, la regla sigue valiendo sin tocar una linea.
  const CSS = leerCodigo('src/app/globals.css')
  const TW = leerCodigo('tailwind.config.ts')
  const LAYOUT = leerCodigo('src/app/layout.tsx')

  // Lo que la app CARGA de verdad hoy: lo que importe de next/font.
  const cargadas = new Set<string>()
  for (const m of LAYOUT.matchAll(/import \{([^}]+)\} from 'next\/font\/google'/g)) {
    for (const n of m[1].split(',')) if (n.trim()) cargadas.add(n.trim().toLowerCase())
  }

  // Nombres que el sistema ya tiene, o palabras clave de CSS: no hace falta cargarlos.
  const DEL_SISTEMA = new Set([
    'sans-serif', 'serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
    'ui-sans-serif', 'ui-serif', 'ui-monospace', 'ui-rounded',
    'inherit', 'initial', 'unset', 'revert', 'none',
    '-apple-system', 'blinkmacsystemfont', 'segoe ui', 'roboto',
    'helvetica', 'helvetica neue', 'arial', 'courier new', 'georgia', 'menlo', 'monaco',
  ])

  // Todo sitio del repo donde se fija una familia, con su texto tal cual.
  const declaraciones: { donde: string; valor: string }[] = []
  for (const m of CSS.matchAll(/font-family:\s*([^;}]+)/g)) declaraciones.push({ donde: 'globals.css', valor: m[1] })
  const iTW = TW.indexOf('fontFamily')
  if (iTW > -1) {
    for (const m of TW.slice(iTW, iTW + 500).matchAll(/(\w+):\s*\[([^\]]+)\]/g)) {
      declaraciones.push({ donde: `tailwind.config.ts → ${m[1]}`, valor: m[2].replace(/'/g, '') })
    }
  }
  for (const f of TS) {
    for (const m of leerCodigo(f).matchAll(/fontFamily[:=]\s*['"{]?\s*['"]([^'"]+)['"]/g)) {
      declaraciones.push({ donde: f, valor: m[1] })
    }
  }

  it('nadie vuelve a pedir las fuentes a Google: la CSP lo bloquea EN SILENCIO', () => {
    expect(/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(CSS + LAYOUT),
      'vuelve el @import de Google, y la CSP lo tira sin decir nada: la app se pinta con la del sistema y parece que va bien')
      .toBe(false)
  })

  it('ninguna declaracion nombra una familia que la app no carga', () => {
    expect(declaraciones.length, 'no se encontro ni una declaracion de fuente: la regla no esta mirando nada')
      .toBeGreaterThan(5)
    const huerfanas: string[] = []
    for (const d of declaraciones) {
      for (const bruto of d.valor.split(',')) {
        const t = bruto.trim().replace(/^["']|["']$/g, '').toLowerCase()
        if (!t) continue
        if (t.startsWith('var(')) {
          // Una variable solo existe si next/font la crea.
          const fam = t.replace(/^var\(--fuente-/, '').replace(/\).*$/, '')
          if (!cargadas.has(fam)) huerfanas.push(`${d.donde}: var de «${fam}» sin next/font que la defina`)
          continue
        }
        if (DEL_SISTEMA.has(t)) continue
        if (cargadas.has(t)) continue
        huerfanas.push(`${d.donde}: «${bruto.trim()}» no la carga nadie`)
      }
    }
    expect(huerfanas, `se nombran fuentes que no se cargan — se veran con la del sistema y NADIE se entera:\n  ${huerfanas.join('\n  ')}`)
      .toEqual([])
  })
})

describe('la insignia del arranque no aparece de golpe', () => {
  it('se precarga, y solo la del tema que toca', () => {
    // La pantalla de arranque pinta DOS <img> —logo oscuro y claro— y el CSS oculta
    // uno. Pero el navegador descarga los dos, y como son peticiones que solo
    // arrancan despues del CSS, el circulo se queda vacio hasta que llegan: el logo
    // aparece de golpe medio segundo despues de pintarse la pantalla.
    //
    // El `preload` lo pide a la vez que el HTML. Y solo el que se va a ver: el
    // servidor ya sabe el tema por la cookie, asi que no hay que adivinar ni bajar
    // 30 KB del que esta oculto.
    const L = readFileSync('src/app/layout.tsx', 'utf8')
    const i = L.indexOf("rel=\"preload\"")
    expect(i, 'no se precarga la insignia: volvera a aparecer de golpe').toBeGreaterThan(-1)
    const bloque = L.slice(i, i + 200)
    expect(/as="image"/.test(bloque), 'el preload no declara que es una imagen').toBe(true)
    expect(/claro \? '\/logo-claro\.svg' : '\/logo-oscuro\.svg'/.test(bloque),
      'precarga una insignia fija en vez de la del tema: en modo claro precargaria la que no se ve')
      .toBe(true)
  })
})

describe('en Brutal.IA, un titulo es mas grande que su texto', () => {
  const C = leerCodigo('src/components/sections/ChatSection.tsx')

  const tam = (marca: string) => {
    const i = C.indexOf(`startsWith('${marca} ')`)
    if (i === -1) return null
    const m = C.slice(i, i + 700).match(/fontSize:'([\d.]+)px'/)
    return m ? Number(m[1]) : null
  }
  const cuerpo = (() => {
    const i = C.indexOf('result.push(<p key={i}')
    const m = C.slice(i, i + 300).match(/fontSize:'([\d.]+)px'/)
    return m ? Number(m[1]) : null
  })()

  it('la escala baja de # a ### y todos por encima del cuerpo', () => {
    // El `###` se pintaba a 9px en versalitas, MAS PEQUEÑO que el parrafo que
    // encabeza (13px). Claude estructura con `###` constantemente, asi que cada vez
    // que lo hacia la respuesta PERDIA jerarquia en vez de ganarla: un bloque gris
    // uniforme donde no se puede escanear nada.
    //
    // Y al arreglarlo lo dejé invertido otra vez —### a 15 por encima de ## a 14—
    // hasta que lo vi renderizado. Por eso esto se comprueba con numeros y no de
    // memoria: la escala invertida no duele al leer el codigo, solo al mirarlo.
    const [h1, h2, h3] = [tam('#'), tam('##'), tam('###')]
    expect(h1, 'no se encuentra el tamaño de #').toBeTruthy()
    expect(cuerpo, 'no se encuentra el tamaño del parrafo').toBeTruthy()
    expect(h1! > h2!, `# (${h1}) deberia ser mayor que ## (${h2})`).toBe(true)
    expect(h2! > h3!, `## (${h2}) deberia ser mayor que ### (${h3})`).toBe(true)
    expect(h3! > cuerpo!, `### (${h3}) deberia ser mayor que el cuerpo (${cuerpo})`).toBe(true)
  })

  it('el contenido no es el texto mas apagado de la pantalla', () => {
    // Lo que la gente viene a leer iba a opacidad 0,78 mientras los adornos del
    // estado vacio iban a 20px. En HoySection el contenido va a 0,82-0,9.
    const i = C.indexOf('result.push(<p key={i}')
    const m = C.slice(i, i + 300).match(/rgba\(240,240,248,([\d.]+)\)/)
    expect(m, 'no se encuentra el color del parrafo').toBeTruthy()
    expect(Number(m![1]),
      'el texto de la respuesta vuelve a estar mas apagado que el contenido del resto de la app')
      .toBeGreaterThanOrEqual(0.85)
  })

  it('la burbuja del usuario no lleva degradado', () => {
    // El degradado azul de esquina a esquina databa la pantalla, y ademas se rompia
    // en modo claro: el contrafiltro solo cancela declaraciones `color:`, no fondos,
    // asi que el body lo invertia y la burbuja salia naranja con texto negro.
    // Acotado a la BURBUJA, no a todo el fichero: el boton de enviar lleva un
    // degradado y ahi esta bien —es un boton, no un bloque de texto que el modo
    // claro va a invertir—. La primera version prohibia el degradado en todo el
    // fichero y se ponia roja por el boton, que no tenia nada que ver.
    const i = C.indexOf("background:m.role==='user'")
    expect(i, 'ya no existe la burbuja: revisa esta regla en vez de borrarla').toBeGreaterThan(-1)
    expect(/linear-gradient/.test(C.slice(i, i + 160)),
      'vuelve el degradado en la burbuja: se rompe en modo claro y data la pantalla')
      .toBe(false)
  })

  it('el hilo tiene ancho de lectura', () => {
    // En un monitor ancho el 76% son ~1000px de linea, muy por encima de las 65-75
    // letras que se siguen sin perder el renglon.
    expect(/maxWidth:'min\(76%, \d+px\)'/.test(C),
      'el hilo vuelve a un ancho porcentual: en pantalla ancha la linea se hace ilegible')
      .toBe(true)
  })
})

describe('Harvey · la primera impresion y los estados', () => {
  const H = leerCodigo('src/components/sections/HarveySection.tsx')

  it('el saludo NO se inyecta como mensaje: el heroe tiene que poder verse', () => {
    // El saludo se metia en `conversation` nada mas entrar, una vez al dia — y la
    // condicion del heroe es `conversation.length === 0`, asi que el estado vacio
    // bonito (orbe grande + saludo) era casi inalcanzable. Justo la primera
    // impresion de la seccion estrella.
    const i = H.indexOf('historialCargado.current = true')
    const carga = H.slice(i, i + 1600)
    expect(/setConversation\(\[\{role:'harvey',text:g/.test(carga),
      'el saludo vuelve a inyectarse como mensaje: el heroe no se vera nunca')
      .toBe(false)
    // Y el saludo vive en el heroe, personalizado.
    expect(/Buenos días/.test(H) && /Buenas tardes/.test(H),
      'el heroe ya no lleva el saludo personalizado')
      .toBe(true)
  })

  it('pensar y hablar SE MUEVEN, y distinto', () => {
    // `thinking` no tenia NINGUN movimiento —justo cuando hace falta ver que Harvey
    // trabaja— y `speaking` compartia color y quietud con `idle`.
    expect(/mode==='thinking' && \(\s*<div[^>]*animation:'pls/.test(H),
      'thinking vuelve a estar quieto: no se ve que Harvey esta trabajando')
      .toBe(true)
    expect(/mode==='speaking' && \[/.test(H),
      'speaking pierde sus ondas: no se distingue de idle con el rabillo del ojo')
      .toBe(true)
  })

  it('la linea de estado se lee, y la espera es la pieza compartida', () => {
    expect(/text-\[7\.5px\][^>]*rgba\(255,255,255,0\.12\)/.test(H),
      'la linea de estado vuelve a contraste ~1,3:1: invisible donde se explica como usar la seccion')
      .toBe(false)
    expect(/mode==='thinking' \? \(\s*<Esperando/.test(H),
      'la espera de Harvey ya no es la pieza compartida: las tres IAs volveran a esperar distinto')
      .toBe(true)
  })

  it('la waveform vive dentro del orbe, no empuja el campo', () => {
    // Se insertaba en la fila flex al empezar a grabar y el campo de texto se
    // encogia ~200px de golpe — en el momento exacto en que estas hablando.
    // La ventana se cierra BUSCANDO DESDE el inicio, no desde 0: el anillo de
    // `thinking` esta antes en el fichero, y `slice(start, end)` con end < start
    // devuelve vacio — la regla nacia mirando la nada. Lo enseño su primera pasada.
    const ini = H.indexOf("mode==='recording' && (")
    expect(ini, 'ya no existe el bloque de grabacion: revisa esta regla').toBeGreaterThan(-1)
    const orbe = H.slice(ini, ini + 600)
    expect(/animate-wave1/.test(orbe), 'la waveform ya no esta dentro del orbe').toBe(true)
  })
})

describe('el briefing dice donde mirar', () => {
  const D = leerCodigo('src/components/sections/DiarioSection.tsx')
  const R = leerCodigo('src/app/api/diario/briefing/route.ts')

  it('la ruta devuelve el animo y los bloqueos', () => {
    // `animo` venia en la consulta (`select('*')`) y el mapeo lo tiraba. Un
    // «bloqueado» enterrado en una columna que no se pinta no avisa a nadie.
    expect(/animo: e\.animo \?\? null/.test(R), 'el mapeo vuelve a tirar el animo').toBe(true)
    expect(/bloqueos:/.test(R), 'no se cuentan los bloqueos por persona').toBe(true)
  })

  it('el total no cuenta dos veces la tarea compartida', () => {
    // `esTareaDe` casa por asignado O co-asignado: una tarea de dos personas
    // aparecia en las dos fichas (correcto) y el total la sumaba dos veces
    // (incorrecto). Respondia «cuantas atribuciones» a la pregunta «cuanto se hizo».
    expect(/new Set\(activos\.flatMap\(p => p\.tareas\.map\(t => t\.id\)\)\)\.size/.test(R),
      'el total vuelve a sumar por persona: la tarea compartida cuenta doble')
      .toBe(true)
  })

  it('el texto del diario SE PINTA, y el rango esta escrito', () => {
    // Las `entradas[]` viajaban en la respuesta y no se pintaban NUNCA: la parte
    // con mas informacion del briefing estaba muerta en el JSON.
    expect(/se propuso · /.test(D) && /hizo · /.test(D),
      'el texto del diario vuelve a no pintarse: la mitad del briefing muere en el JSON')
      .toBe(true)
    expect(/briefing\.desde === briefing\.hasta/.test(D),
      'el rango ya no se escribe: «SEMANA» sin fechas obliga a adivinar cual')
      .toBe(true)
  })

  it('se ordena por señal, con los bloqueos primero', () => {
    expect(/sort\(\(a: any, b: any\) =>\s*\(b\.bloqueos - a\.bloqueos\)/.test(D),
      'el equipo vuelve al orden de la tabla profiles: la fila que importa queda enterrada')
      .toBe(true)
  })
})

describe('decir que lo has hecho sin haberlo hecho tiene aviso', () => {
  // La emision de la accion NO es determinista. Probando las ocho frases contra el
  // modelo real, una de ocho salio sin `[ACCION:...]`: Harvey dijo «he añadido el
  // reel al pipeline» y no se propuso nada. El truncamiento por longitud ya se
  // avisa aparte —el `[ACCION:...]` va al final y es lo primero que se pierde—;
  // esto cubre el resto, que no da ninguna señal.
  it('las dos secciones lo comprueban', () => {
    for (const ruta of ['src/components/sections/HoySection.tsx', 'src/components/sections/HarveySection.tsx']) {
      const c = leerCodigo(ruta)
      expect(/afirmaHaberloHecho\(/.test(c),
        `${ruta} vuelve a dar por buena una respuesta que dice «he creado la tarea» sin accion detras`).toBe(true)
      // Y atado al caso: solo cuando NO hubo accion.
      const i = c.indexOf('afirmaHaberloHecho(')
      expect(/else if/.test(c.slice(Math.max(0, i - 120), i)),
        `${ruta}: el aviso no cuelga del caso «no hubo accion», asi que saltaria tambien cuando si la hubo`).toBe(true)
    }
  })
})

describe('las dos IAs eligen los mismos correos', () => {
  // El contexto lleva tope —diez para Harvey, quince para Brutal.IA— y se gastaba
  // por ORDEN DE LLEGADA entre los no leidos. Con 704 sin leer, casi todos
  // boletines, se gastaba entero antes de llegar a nada que importara: los diez
  // correos del contexto real eran DHGate, Polymarket, Temu, adidas, idealista.
  it('las dos usan correosParaIA para gastar el tope', () => {
    for (const ruta of ['src/lib/contextoHarvey.ts', 'src/lib/ai.ts']) {
      expect(/correosParaIA\(/.test(leerCodigo(ruta)),
        `${ruta} vuelve a llenar el tope por orden de llegada: los boletines se comen el contexto`).toBe(true)
    }
  })

  it('nadie se cree el ai_client sin comparar con los clientes reales', () => {
    // `ai_client` guarda desde siempre la marca de quien envia. Priorizar por ese
    // campo a pelo pondria a Temu por delante de un cliente de verdad.
    const c = leerCodigo('src/lib/contextoHarvey.ts')
    expect(/nombresCliente|data\.clients/.test(c),
      'contextoHarvey prioriza por ai_client sin contrastar con la lista de clientes').toBe(true)
  })
})

describe('la IA no se declara incapaz de lo que la app sabe hacer', () => {
  // El caso REAL, hablando con ella: sin eventos cargados, «¿que reuniones tengo
  // esta semana?» se contestaba con «no tengo acceso a tu calendario, miralo en
  // Google Calendar». Y SI lo tiene — leer el calendario es una de las cosas que la
  // app hace, y encima acababa de arreglarse la ventana para que trajera 15 meses.
  //
  // Una IA que se declara incapaz de algo que sabe hacer no se vuelve a usar para
  // eso, y eso no se ve en ningun log: el usuario simplemente deja de preguntar.
  it('distingue «no hay nada» de «no lo he podido leer»', () => {
    const A = leerCodigo('src/lib/ai.ts')
    expect(/no se ha podido cargar la agenda/.test(A),
      'vuelve a haber un solo estado: sin eventos, el modelo concluye que no tiene calendario').toBe(true)
    expect(/NO digas que no tienes acceso/.test(A),
      'no se le dice explicitamente que no niegue tener acceso').toBe(true)
    // Y el servidor tiene que CONSERVAR la diferencia: si convierte «no mandado» en
    // «lista vacia», el prompt ya no puede distinguirlos por mucho que lo intente.
    const C = leerCodigo('src/app/api/chat/route.ts')
    expect(/Array\.isArray\(body\?\.eventos\) \? undefined/.test(C),
      'el servidor vuelve a convertir «no mandado» en lista vacia: la distincion se pierde antes de llegar al prompt').toBe(true)
  })
})

describe('lo que se dice de las cuentas de Gmail sale de la tabla nueva', () => {
  // `profiles.gmail_account` es la columna VIEJA: UNA ranura que el callback pisa
  // en cada conexion. Con tres cuentas conectadas, Sincronizacion decia «Conectado
  // a lauravalero754@gmail.com» —la ultima que entro— mientras justo debajo pintaba
  // la lista de verdad con las dos personales. Dos verdades en la misma pantalla, y
  // la de arriba en letra mas grande.
  //
  // Javi: «aqui me pone que estoy conectado a este correo, pero en verdad estoy
  // conectado a dos».
  it('la seccion no pinta la ranura vieja como si fuera la cuenta', () => {
    const c = leerCodigo('src/components/sections/SincronizacionSection.tsx')
    const crudos = [...c.matchAll(/Conectado a \$\{gmailStatus[^}]*\}/g)].map(m => m[0])
    expect(crudos, `vuelve a anunciarse la ranura vieja como «la cuenta conectada»:\n  ${crudos.join('\n  ')}`).toEqual([])
    expect(/rotuloCuentas/.test(c),
      'ya no se calcula el rotulo desde la lista de cuentas: volvera a decir una sola cuando hay varias').toBe(true)
  })
})

describe('todos los buscadores de la app buscan igual', () => {
  // `buscaEnTexto` existe porque `includes()` no sirve escribiendo en español: no
  // encuentra «diseño» si escribes «diseno», ni casa dos palabras sueltas. Se
  // arreglo en las SEIS secciones y la lupa de ⌘K —la mas a mano— se quedo con la
  // comparacion de siempre. El arreglo estaba hecho y escrito; el sitio mas visible
  // no lo tenia.
  it('nadie compara a mano lo que el usuario escribe', () => {
    const infractores: string[] = []
    for (const ruta of TS) {
      if (!/src\/(components\/sections|components\/NexusDashboard|lib\/busquedaGlobal)/.test(ruta)) continue
      const c = leerCodigo(ruta)
      // `algo.toLowerCase().includes(<la consulta>)` — se buscan los nombres que
      // este repo usa de verdad para la caja de busqueda.
      for (const m of c.matchAll(/\.toLowerCase\(\)\.includes\(\s*(q|query|search|searchQuery|busqueda)\b/g)) {
        infractores.push(`${ruta}: ${m[0]}`)
      }
    }
    expect(infractores, `vuelve a compararse la busqueda con includes(): no encontrara con tildes ni con dos palabras, y solo en algunos sitios de la app:\n  ${infractores.join('\n  ')}`)
      .toEqual([])
  })
})

describe('la documentacion no se vuelve mentira sola', () => {
  // El valor de esta app fuera de la cabeza de Javi esta en `README.md` y
  // `docs/OPERACION.md`: son lo que permite que otra persona la levante y la
  // mantenga. Pero una documentacion que se queda vieja es PEOR que ninguna,
  // porque se sigue con confianza.
  //
  // Y se queda vieja igual que el codigo. Hoy mismo se encontro el panel de
  // procesos diciendo «TODO LO AUTOMÁTICO, AL DÍA» mientras vigilaba 2 de los 4
  // crons; el runbook listaba esos mismos 2, y al README le faltaba una variable
  // OBLIGATORIA (`VAPID_SUBJECT`) — o sea que seguir el README al pie de la letra
  // para levantar una instancia daba un build fallido.
  //
  // Estas dos reglas comparan la prosa contra la fuente de verdad.
  it('el README documenta todas las variables que el arranque exige', () => {
    const exigidas = [...new Set(
      [...readFileSync('scripts/check-env.mjs', 'utf8').matchAll(/'([A-Z][A-Z0-9_]+)'/g)].map(m => m[1]))]
    expect(exigidas.length, 'check-env ya no exige nada: revisa esta regla en vez de borrarla').toBeGreaterThan(8)
    const readme = readFileSync('README.md', 'utf8')
    const faltan = exigidas.filter(v => !readme.includes(v))
    expect(faltan,
      `hay variables que \`prebuild\` exige y el README no menciona. Quien siga el README para levantar una instancia se encuentra un build fallido y un mensaje sobre una variable de la que nadie le habia hablado:\n  ${faltan.join('\n  ')}`)
      .toEqual([])
  })

  it('el runbook lista todos los procesos automaticos que hay', () => {
    const crons = [...new Set((JSON.parse(readFileSync('vercel.json', 'utf8')) as { crons?: { path: string }[] })
      .crons?.map(c => c.path) || [])]
    expect(crons.length, 'no hay crons en vercel.json: revisa esta regla').toBeGreaterThan(1)
    const doc = readFileSync('docs/OPERACION.md', 'utf8')
    const faltan = crons.filter(c => !doc.includes(c))
    expect(faltan,
      `hay procesos automaticos que el runbook no menciona. Quien lo lea creera que corren dos cosas cuando corren cuatro, y no sabra que mirar cuando una deje de funcionar — que es justo lo que paso con el aviso de las 20:00:\n  ${faltan.join('\n  ')}`)
      .toEqual([])
  })
})

describe('el SQL del repo se puede aplicar de principio a fin', () => {
  // «Tener el DDL» y «poder levantar una instancia» no son lo mismo. La regla
  // hermana comprueba que TODA tabla y columna viva tenga su SQL; esta comprueba
  // que ese SQL se pueda EJECUTAR en orden — que es lo que decide si una instancia
  // nueva arranca o se queda a medias.
  //
  // Sin base de datos delante no se puede ejecutar de verdad, pero si se pueden
  // comprobar las tres formas en que esto se rompe al concatenar ficheros:
  // una clave ajena que apunta a una tabla que aun no existe, un `alter table`
  // sobre algo que nadie crea, y una funcion de extension usada antes de
  // habilitarla (`uuid_generate_v4()` sin `create extension "uuid-ossp"`).
  const ORDEN = ['supabase/schema.sql',
    ...readdirSync('supabase').filter(f => f.endsWith('.sql') && f !== 'schema.sql').sort().map(f => join('supabase', f)),
    ...readdirSync('migrations').filter(f => f.endsWith('.sql')).sort().map(f => join('migrations', f))]

  // Las crea Supabase, no nosotros.
  const DE_SUPABASE = new Set(['auth.users', 'storage.objects', 'storage.buckets'])

  it('cada clave ajena apunta a una tabla ya creada', () => {
    const creadas: string[] = []
    const problemas: string[] = []
    for (const f of ORDEN) {
      const sql = readFileSync(f, 'utf8').replace(/--.*$/gm, '')
      for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)\s*\(([\s\S]*?)\n\s*\)\s*;/gi)) {
        const tabla = m[1].toLowerCase()
        for (const r of m[2].matchAll(/references\s+((?:[a-z_]+\.)?[a-z_][a-z0-9_]*)/gi)) {
          const destino = r[1].toLowerCase()
          if (DE_SUPABASE.has(destino)) continue
          const limpio = destino.replace(/^public\./, '')
          if (!creadas.includes(limpio)) {
            problemas.push(`${f}: \`${tabla}\` referencia a \`${limpio}\`, que todavia no existe en este punto`)
          }
        }
        creadas.push(tabla)
      }
    }
    expect(creadas.length, 'no se reconoce ninguna tabla: revisa esta regla').toBeGreaterThan(15)
    expect(problemas, `aplicando el SQL en orden, una clave ajena apunta a una tabla que aun no se ha creado. En una instancia nueva eso es un error y la migracion se para a medias:\n  ${problemas.join('\n  ')}`)
      .toEqual([])
  })

  it('ningun ALTER TABLE toca una tabla que nadie crea', () => {
    const todo = ORDEN.map(f => readFileSync(f, 'utf8').replace(/--.*$/gm, '')).join('\n')
    const creadas = new Set([...todo.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/gi)].map(m => m[1].toLowerCase()))
    const huerfanos = [...new Set([...todo.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/gi)]
      .map(m => m[1].toLowerCase())
      .filter(t => !creadas.has(t) && !DE_SUPABASE.has(t) && t !== 'objects' && t !== 'buckets'))]
    expect(huerfanos, `hay ALTER TABLE sobre tablas que este repo no crea:\n  ${huerfanos.join('\n  ')}`).toEqual([])
  })

  it('las funciones de extension se usan DESPUES de habilitarla', () => {
    // `uuid_generate_v4()` viene de `uuid-ossp` y NO esta en Postgres por defecto.
    // Si algun fichero la usa antes de que `schema.sql` habilite la extension, la
    // creacion de esa tabla falla en una instancia nueva. (`gen_random_uuid()` si
    // es nativa desde Postgres 13 y no necesita nada.)
    let habilitada = false
    const problemas: string[] = []
    for (const f of ORDEN) {
      const sql = readFileSync(f, 'utf8').replace(/--.*$/gm, '')
      const iExt = sql.search(/create\s+extension\s+(?:if\s+not\s+exists\s+)?"?uuid-ossp/i)
      const iUso = sql.search(/uuid_generate_v4\s*\(/i)
      if (iUso !== -1 && !habilitada && (iExt === -1 || iExt > iUso)) {
        problemas.push(`${f}: usa uuid_generate_v4() y la extension uuid-ossp no se ha habilitado todavia`)
      }
      if (iExt !== -1) habilitada = true
    }
    expect(problemas, `una funcion de extension se usa antes de habilitarla: en una instancia nueva esa tabla no se crea:\n  ${problemas.join('\n  ')}`)
      .toEqual([])
  })
})

describe('las IAs saben si has cerrado tu jornada', () => {
  // Javi cerro su dia a las 13:22 y pregunto. Las DOS contestaron «no, todavia no».
  // Harvey ademas se contradijo en la misma frase: «no tengo registrado un cierre...
  // el ultimo que veo es del 26, donde estuviste 46 minutos».
  //
  // Tres causas, encontradas una detras de otra interceptando el prompt de verdad:
  //
  //  1. El bloque del diario solo se trae si la pregunta casa con una lista de
  //     palabras, y «cerrado» no estaba. Llegaba VACIO y el modelo respondia de
  //     memoria — negando con seguridad algo que no habia mirado.
  //  2. El bloque no decia cual de las fechas era HOY, ni a que hora se ficho: solo
  //     la duracion. A «¿a que hora he fichado?» Harvey llego a decir que «el diario
  //     no esta sincronizado con los datos de fichar», que es falso.
  //  3. Y el contrato de acciones llamaba a una accion «Cerrar el dia en el diario»
  //     cuando solo escribia el balance: Harvey se invento DOS cierres distintos y
  //     contestaba «cerraste la sesion a las 13:22, pero el cierre del dia en el
  //     diario no esta registrado». La etiqueta creaba el concepto.
  const R = leerCodigo('src/lib/resumenEquipo.ts')

  it('la jornada de quien pregunta va SIEMPRE, sin depender de palabras clave', () => {
    // Ampliar la lista de palabras solo tapa el caso conocido; siempre tendra
    // huecos. El estado de la jornada cabe en una linea y es lo que mas se pregunta.
    expect(/export async function miJornadaHoy/.test(R),
      'ya no existe miJornadaHoy(): la respuesta volvera a depender de que la pregunta case con una lista de palabras').toBe(true)
    // Y que llegue AL PROMPT, no solo que se llame. La primera version comprobaba
    // `miJornadaHoy(` en el fichero y paso en verde con `${miJornada}` borrado del
    // texto del prompt: la funcion se seguia llamando y el resultado se tiraba.
    const H = leerCodigo('src/app/api/harvey/chat/route.ts')
    expect(/miJornadaHoy\(/.test(H), 'harvey ya no lee el estado de la jornada').toBe(true)
    expect(/\$\{miJornada\}/.test(H), 'harvey lee el estado de la jornada y NO lo mete en el prompt').toBe(true)
    const C = leerCodigo('src/app/api/chat/route.ts')
    expect(/miJornadaHoy\(/.test(C), 'brutal.ia ya no lee el estado de la jornada').toBe(true)
    // Aqui viaja dentro de `diarioEquipo`, que si entra en el prompt.
    expect(/\(await miJornadaHoy\([^)]*\)\)\s*\n?\s*\+/.test(C),
      'brutal.ia lee el estado de la jornada y no lo concatena al contexto').toBe(true)
  })

  it('el estado va como ETIQUETA, no como prosa', () => {
    // Con «hizo (cierre del dia): ... · cerro a las 13:22» delante, Harvey seguia
    // diciendo «tu dia sigue abierto»: era un dato mas en una lista de cuatro
    // separados por puntos. Tres palabras en mayusculas no se leen de dos maneras.
    expect(/CERRADA\./.test(R), 'el estado de la jornada vuelve a ir en prosa').toBe(true)
    expect(/\[DÍA CERRADO\]/.test(R), 'las lineas del diario ya no marcan el estado del dia').toBe(true)
    expect(/\(HOY\)/.test(R), 'las lineas del diario ya no dicen cual es hoy: el modelo lee la fecha como pasada').toBe(true)
  })

  it('la linea del diario lleva las HORAS, no solo la duracion', () => {
    // LAS DOS RAMAS. La primera version solo pedia `fichó a las ${entro}` y paso en
    // verde con el bug puesto, porque la rama del dia SIN cerrar tambien lo lleva:
    // se puede romper la del dia cerrado y la regla no se entera.
    expect(/fichó a las \$\{entro\} y cerró a las/.test(R),
      'el dia CERRADO vuelve a dar solo la duracion: a «¿a que hora he salido?» la IA dira que no lo sabe').toBe(true)
    expect(/fichó a las \$\{entro\} y lleva/.test(R),
      'el dia ABIERTO vuelve a dar solo la duracion: a «¿a que hora he fichado?» la IA dira que no lo sabe').toBe(true)
  })

  it('el disparador reconoce las palabras del cierre', () => {
    const m = R.match(/const porTrabajo = \/[^/]*\//)
    expect(m, 'ya no existe el disparador: revisa esta regla').toBeTruthy()
    for (const palabra of ['cerr', 'jornada', 'horas']) {
      expect(m![0].includes(palabra), `el disparador no reconoce «${palabra}»`).toBe(true)
    }
  })

  it('no se anuncian dos cierres distintos', () => {
    // La accion se llamaba «Cerrar el dia en el diario» y solo escribia el balance.
    const H = leerCodigo('src/app/api/harvey/chat/route.ts')
    expect(/Cerrar el día en el diario/.test(H),
      'vuelve a anunciarse un «cierre en el diario» aparte del de fichar: la IA se inventara que hay dos').toBe(false)
    const E = leerCodigo('src/lib/harveyEjecutar.ts')
    expect(/cerrar: true/.test(E), 'la accion de cerrar el dia ya no cierra la jornada').toBe(true)
  })
})

describe('«objetivos completados» cuenta objetivos, no dias', () => {
  // El panel «Resumen semanal» pintaba `cerrados` bajo la etiqueta «Objetivos
  // completados». Y `cerrados` son DIAS QUE ALGUIEN CERRO: dos cosas distintas. El
  // porcentaje salia de dividir dias entre objetivos, que no significa nada.
  //
  // Lo mas llamativo: el comentario que hay justo encima YA decia «el porcentaje es
  // de OBJETIVOS, no de dias, porque cerrar un dia con la mitad sin hacer no es
  // cumplir» — mientras el codigo hacia exactamente lo contrario, tres lineas mas
  // abajo. Una prosa que se contradice con su codigo es peor que no tener prosa.
  it('la semana suma objetivosHechos, no dias cerrados', () => {
    const D = leerCodigo('src/components/sections/DiarioSection.tsx')
    const i = D.indexOf('const semana = ')
    expect(i, 'ya no existe el resumen semanal: revisa esta regla en vez de borrarla').toBeGreaterThan(-1)
    const cuerpo = D.slice(i, i + 1400)
    expect(/hechos \+= r\?\.objetivosHechos/.test(cuerpo),
      '«Objetivos completados» vuelve a contar dias cerrados: el numero dira una cosa y el rotulo otra').toBe(true)
    expect(/hechos \+= r\?\.cerrados/.test(cuerpo), 'vuelve a sumarse `cerrados` como si fueran objetivos').toBe(false)
  })

  it('la ruta del mes calcula los completados mirando las tareas', () => {
    // `diario` por si solo NO puede saber que objetivo se cumplio: eso vive en la
    // tarea. Sin este join, el numero solo puede ser una aproximacion o una mentira.
    const R = leerCodigo('src/app/api/diario/mes/route.ts')
    expect(/objetivosHechos/.test(R), 'la ruta ya no devuelve los objetivos completados').toBe(true)
    expect(/from\('tasks'\)/.test(R), 'la ruta vuelve a contar sin mirar las tareas').toBe(true)
    // Y `cerrados` se queda como estaba: el calendario lo usa para «todos cerraron»,
    // y ahi si significa dias.
    expect(/cerrados\+\+/.test(R), 'se ha perdido el recuento de dias cerrados, que el calendario si usa').toBe(true)
  })

  it('el resumen se vuelve a pedir cuando cambia lo que cuenta', () => {
    // Las dependencias eran `[dia, demo]`: se cargaba una vez y se quedaba asi.
    // Javi escribio tres objetivos y el panel seguia diciendo «1».
    const D = leerCodigo('src/components/sections/DiarioSection.tsx')
    const i = D.indexOf('setMesFichado(junto)')
    expect(i, 'ya no se carga el mes: revisa esta regla').toBeGreaterThan(-1)
    const deps = D.slice(i, i + 700).match(/\}, \[([^\]]*)\]\)/)
    expect(deps, 'no se reconocen las dependencias del efecto').toBeTruthy()
    expect(/firmaTareas/.test(deps![1]),
      `el resumen semanal vuelve a quedarse caducado: se carga una vez y no se entera de que creas, borras o completas tareas. Dependencias ahora: [${deps![1]}]`)
      .toBe(true)
  })
})

describe('quitar un objetivo se lleva su tarea', () => {
  // Javi: «acabo de borrar un objetivo que habia puesto en el apartado de fichar y
  // no se ha borrado en el apartado de tareas. Eso no puede pasar».
  //
  // La X hacia solo dos cosas —sacar la fila de la lista y guardar el texto— y no
  // tocaba la tarea NUNCA. Al fichar, cada linea se convierte en una tarea; al
  // quitarla, esa tarea se quedaba viva y sin dueño: aparecia en Tareas como algo
  // pendiente que ya no existe en ningun sitio, y seguia contando en el pipeline y
  // en los resumenes que leen las dos IAs.
  //
  // Medido con sus datos: ficho a las 10:36, se crearon 3 tareas, borro el tercer
  // objetivo y la tarea «acabé video, está para subir a tiktok» siguio ahi.
  const D = leerCodigo('src/components/sections/DiarioSection.tsx')

  it('el unico camino para quitar una fila borra tambien la tarea', () => {
    const i = D.indexOf('const quitarObjetivo')
    expect(i, 'ya no existe quitarObjetivo(): revisa esta regla en vez de borrarla').toBeGreaterThan(-1)
    const cuerpo = D.slice(i, i + 1400)
    expect(/deleteTask\(/.test(cuerpo),
      'quitar un objetivo vuelve a dejar su tarea viva y sin dueño en Tareas').toBe(true)
    // Y no puede borrar la de otra persona: si el objetivo se delego, esa tarea ya
    // es suya y no puede desaparecer de su lista porque yo limpie mi diario.
    expect(/assigned_to !== profile\.id/.test(cuerpo),
      'se borraria la tarea de otra persona al quitar un objetivo delegado').toBe(true)
  })

  it('ningun sitio quita una fila sin pasar por ahi', () => {
    // Habia DOS caminos —la X y el Backspace sobre una fila vacia— y cada uno es un
    // sitio donde olvidarse de la tarea. Ahora los dos llaman a la misma funcion.
    // CON EL INDICE DE CADA COINCIDENCIA, no con `indexOf`. La primera version
    // buscaba cada texto con `D.indexOf(x)`, que devuelve SIEMPRE la primera
    // aparicion — la de dentro de la propia `quitarObjetivo` — asi que todas las
    // coincidencias caian en la excepcion y la regla paso en verde con el bug
    // reintroducido: la X volvia a quitar la fila por su cuenta y nadie chistaba.
    const iFuncion = D.indexOf('const quitarObjetivo')
    const finFuncion = D.indexOf('\n  const ', iFuncion + 10)
    // Solo el PREFIJO de la llamada. Con `[^)]*` la expresion se paraba en el
    // parentesis de `(_, k)` y no casaba NUNCA — ni el codigo bueno ni el malo—,
    // asi que la regla pasaba en verde con la X quitando la fila por su cuenta.
    const sueltos = [...D.matchAll(/cambiarFilas\(filas\.filter\(/g)]
      .filter(m => m.index! < iFuncion || m.index! > finFuncion)
      .map(m => `linea ${D.slice(0, m.index!).split('\n').length}`)
    expect(sueltos, `hay un camino que quita una fila sin borrar su tarea:\n  ${sueltos.join('\n  ')}`).toEqual([])
  })
})

describe('el extractor no reescribe lo que tu ya has escrito', () => {
  // Javi: «cuando tu añades los objetivos, te aparece un boton de sugerir tareas.
  // Pues eso, en verdad, hace que quites».
  //
  // Medido con sus datos reales: escribio 3 objetivos y acabo con 5 tareas. Al
  // fichar, cada linea YA se convierte en una tarea —el propio codigo lo dice: «una
  // linea es una tarea y punto»—, asi que pasarle ademas los objetivos al modelo
  // solo puede producir una SEGUNDA version reescrita de algo que ya existe.
  //
  // Y reescrita de verdad: «generacion video higgfield 1-2h» volvio como
  // «Generación video higgfield» —perdiendo el «1-2h» que el habia puesto a
  // proposito— y normalizando distinto, asi que el filtro de duplicados no podia
  // cazarlo NUNCA. El balance es otra cosa: ahi cuentas en prosa lo que hiciste, y
  // sacar tareas de ahi si aporta.
  it('solo mira el balance, nunca los objetivos', () => {
    const D = leerCodigo('src/components/sections/DiarioSection.tsx')
    const i = D.indexOf("'/api/diario/extraer'")
    expect(i, 'ya no se llama al extractor: revisa esta regla en vez de borrarla').toBeGreaterThan(-1)
    // El texto que se le manda se compone justo antes, en el mismo efecto.
    const antes = D.slice(Math.max(0, i - 2600), i)
    const m = antes.match(/const texto = ([^\n]*)/)
    expect(m, 'ya no se compone el texto del extractor donde esta regla lo busca').toBeTruthy()
    expect(/objetivos/.test(m![1]),
      `el extractor vuelve a leer los objetivos: te devolvera reescrito lo que acabas de escribir, y como no normaliza igual el filtro de duplicados no podra cazarlo. Lo que se le manda ahora es: ${m![1]}`)
      .toBe(false)
  })
})

describe('el cronometro de la jornada late de verdad', () => {
  // Javi lo pidio asi: «un contador de cuanto tiempo llevo trabajando: un minuto,
  // dos minutos, tres minutos, que se vaya actualizando». Lo que habia:
  //
  //  · un `setInterval` de 30 SEGUNDOS con formato HH:MM, o sea que el primer
  //    cambio visible («00:01») llegaba entre 60 y 90 s despues de fichar y entre
  //    tick y tick no se movia nada;
  //  · y peor: el «ahora» se sembraba al MONTAR la seccion. Como los objetivos se
  //    escriben durante minutos antes de pulsar, ese instante era ANTERIOR a
  //    `entrada_at`, la resta salia negativa, el codigo devolvia null y el numero
  //    grande ponia «—». El reloj no arrancaba en 00:00: arrancaba en una raya,
  //    justo en el segundo en que acabas de fichar.
  const R = leerCodigo('src/components/shared/RelojJornada.tsx')

  it('late cada segundo y se pone en hora ANTES del primer intervalo', () => {
    expect(R.length, 'ya no existe RelojJornada.tsx: revisa esta regla en vez de borrarla').toBeGreaterThan(200)
    expect(/setInterval\(\s*tick\s*,\s*1000\s*\)/.test(R), 'el reloj ya no late cada segundo').toBe(true)
    // `tick()` TIENE que ir antes del setInterval: es la linea que mata la raya.
    const iTick = R.indexOf('tick()')
    const iInt = R.indexOf('setInterval(')
    expect(iTick, 'ya no se llama a tick(): el reloj volvera a arrancar con la hora del montaje').toBeGreaterThan(-1)
    expect(iTick).toBeLessThan(iInt)
  })

  it('no tiene estado roto: un negativo es un cero, no una raya', () => {
    expect(/Math\.max\(0,/.test(R), 'vuelve a poder salir un tiempo negativo').toBe(true)
    expect(/return null/.test(R), 'el reloj vuelve a poder no pintar nada').toBe(false)
    expect(/\|\| '—'/.test(R), 'vuelve la raya').toBe(false)
  })

  it('se pone en hora al volver de segundo plano', () => {
    // Los navegadores estrangulan setInterval a ~1/min con la pestaña oculta y la
    // PWA de iOS lo congela: sin esto, al volver ves un numero caducado justo en el
    // instante en que lo miras.
    expect(/visibilitychange/.test(R), 'no se refresca al volver a la pestaña').toBe(true)
  })

  it('vive fuera de la seccion, que es lo que permite el segundero', () => {
    // Cada tick repintaba las 2.000 lineas de DiarioSection —incluido el bucle de
    // 400 iteraciones de la racha—. A 30 s se toleraba; a 1 s, no.
    const D = leerCodigo('src/components/sections/DiarioSection.tsx')
    expect(/<RelojJornada/.test(D), 'la seccion ya no usa el reloj aislado').toBe(true)
    const inline = [...D.matchAll(/setInterval\([^)]*Date\.now\(\)/g)].map(m => m[0])
    expect(inline, `vuelve a haber un cronometro dentro de la seccion: cada tick repinta las 2.000 lineas\n  ${inline.join('\n  ')}`).toEqual([])
  })
})

describe('parar guarda la jornada, y no se cierra lo que no se abrio', () => {
  // Javi: «cuando le de a parar, que guarde la jornada». Antes cerrar exigia haber
  // escrito el balance: pulsabas TERMINAR, salia un aviso de tres segundos y el
  // contador SEGUIA CORRIENDO. Y el campo que habia que rellenar esta en otro panel
  // mas abajo — en movil, fuera de pantalla.
  it('cerrar no depende de haber escrito el balance', () => {
    const D = leerCodigo('src/components/sections/DiarioSection.tsx')
    const i = D.indexOf('const fichar = async')
    expect(i, 'ya no existe fichar(): revisa esta regla').toBeGreaterThan(-1)
    const cuerpo = D.slice(i, i + 1800)
    expect(/campo === 'entrada' && !valor\.trim\(\)/.test(cuerpo),
      'vuelve a exigirse el balance para cerrar: el boton de parar no parara y no se vera por que').toBe(true)
  })

  it('el servidor rechaza cerrar un dia que no se ha abierto', () => {
    // Escribir el balance sin haber fichado dejaba `cierre_at` con `entrada_at` a
    // null. Al fichar despues, `entrada_at > cierre_at`, la resta sale negativa y el
    // reloj queda roto PARA SIEMPRE: no hay ninguna ruta que ponga `cierre_at` a null.
    const R = leerCodigo('src/app/api/diario/route.ts')
    const iGuarda = R.search(/!previo\?\.entrada_at[\s\S]{0,200}status: 400/)
    const iSella = R.indexOf('fila.cierre_at = ahora')
    expect(iGuarda, 'no hay guarda: se puede cerrar un dia sin abrirlo y dejar el reloj en negativo').toBeGreaterThan(-1)
    expect(iGuarda, 'la guarda esta DESPUES de sellar la hora: no sirve de nada').toBeLessThan(iSella)
  })
})

describe('dos contadores que subian solos', () => {
  it('«completadas esta semana» se cuenta por completed_at', () => {
    // Se contaba por `updated_at`: retocar el texto de una tarea vieja ya terminada
    // le cambia el `updated_at` y la hacia contar como completada ESTA semana. El
    // contador del panel de equipo subia sin que nadie hubiera terminado nada.
    const infractores: string[] = []
    for (const ruta of TS) {
      if (!ruta.startsWith('src/components/')) continue
      const c = leerCodigo(ruta)
      for (const m of c.matchAll(/t\.done\s*&&[^\n]*new Date\(t\.updated_at/g)) {
        infractores.push(`${ruta}: ${m[0].slice(0, 70)}`)
      }
    }
    expect(infractores, `vuelve a contarse una tarea como terminada esta semana por su ultima EDICION:\n  ${infractores.join('\n  ')}`)
      .toEqual([])
  })

  it('la ficha se rehace tambien al EDITAR y al BORRAR una nota', () => {
    // `fichaDesfasada` pedia `updated_at` y luego usaba solo `created_at`, asi que
    // editar una nota no rehacia la ficha NUNCA: cambiar una tarifa o corregir un
    // brief no llegaba a las IAs, que siguen leyendo la ficha vieja como la verdad
    // permanente del estudio. Y borrar bajaba el recuento, la resta salia negativa
    // y la ficha se quedaba citando algo que ya no existe.
    const F = leerCodigo('src/lib/fichaEstudio.ts')
    const i = F.indexOf('export async function fichaDesfasada')
    expect(i, 'ya no existe fichaDesfasada: revisa esta regla').toBeGreaterThan(-1)
    const cuerpo = F.slice(i, F.indexOf('\nexport ', i + 10))
    expect(/reciente\?\.updated_at/.test(cuerpo),
      'vuelve a mirarse solo `created_at`: editar una nota no rehara la ficha').toBe(true)
    expect(/notas < Number\(ficha\.notas/.test(cuerpo),
      'borrar una nota vuelve a no rehacer la ficha: se queda citando lo que ya no existe').toBe(true)
  })
})

describe('«supabase-js NO lanza» por fin tiene regla', () => {
  // CLAUDE.md lo pone como una de las trampas que ya han mordido —«en un
  // Promise.all que desestructura solo `data`, un fallo es indistinguible de "no
  // hay filas" — un bug asi vivio semanas»— y NO habia ninguna regla que lo
  // vigilara. Habia dos sitios vivos:
  //
  //   · `fichaEstudio.ts`: si falla la lectura de `clients`, la ficha se escribia
  //     con «CLIENTES DADOS DE ALTA AHORA MISMO (0): ninguno» y el prompt dice
  //     justo debajo que eso MANDA sobre los documentos. Y la ficha se PERSISTE:
  //     a partir de ahi las dos IAs contestan «no tenemos ningun cliente» con
  //     autoridad. Por eso ahi no basta con registrar — se aborta la regeneracion.
  //   · `harvey-draft`: un fallo al leer la memoria salia como «no hay nada
  //     relevante» y el borrador se escribia sobre menos contexto del que hay.
  it('ningun Promise.all de consultas tira los errores', () => {
    const infractores: string[] = []
    for (const ruta of TS) {
      if (ruta.startsWith('src/lib/__tests__/')) continue
      const c = leerCodigo(ruta)
      for (const m of c.matchAll(/(?:const|let)\s+(\[[^\]]*\]|\w+)\s*=\s*await Promise\.all\(\[/g)) {
        const abre = c.indexOf('[', m.index! + m[0].length - 1)
        // El array de promesas: de `Promise.all([` a su `])`.
        let n = 0, fin = abre
        for (let i = abre; i < c.length; i++) {
          if (c[i] === '[') n++
          else if (c[i] === ']') { n--; if (n === 0) { fin = i; break } }
        }
        const promesas = c.slice(abre, fin)
        if (!/\b(admin|supabase)\.from\(/.test(promesas)) continue

        const destino = m[1]
        // Vale cualquiera de las dos: nombrar `error` al desestructurar, o pasar el
        // resultado entero por `logQueryErrors`.
        const nombraError = /\berror\b/.test(destino)
        const despues = c.slice(fin, fin + 400)
        const registra = /logQueryErrors\(/.test(despues) || /\.some\(r => r\.error\)/.test(despues)
        if (!nombraError && !registra) {
          infractores.push(`${ruta}: ${destino.replace(/\s+/g, ' ').slice(0, 80)}`)
        }
      }
    }
    expect(infractores,
      `un Promise.all de consultas desestructura solo \`data\`. supabase-js NO lanza, asi que un fallo de lectura se vuelve indistinguible de «no hay filas» — y en la ficha eso se PERSISTE y las dos IAs lo repiten con autoridad. Nombra \`error\` o pasa el resultado por logQueryErrors():\n  ${infractores.join('\n  ')}`)
      .toEqual([])
  })
})

describe('tres afirmaciones mas que no se sostenian', () => {
  it('ninguna PANTALLA saca la hora de un evento cortando el ISO', () => {
    // La regla hermana cubre los constructores de contexto de las dos IAs. Estas
    // dos pantallas seguian cortando: Google devuelve cada evento en el desfase del
    // calendario donde vive (+01:00 el personal, +02:00 el compartido), asi que la
    // misma reunion salia a las 10:30 en un panel y a las 11:30 en Calendario.
    const infractores: string[] = []
    for (const ruta of TS) {
      if (!ruta.startsWith('src/components/')) continue
      for (const m of leerCodigo(ruta).matchAll(/\w*[Ss]tart\w*\.slice\(\s*11\s*,\s*16\s*\)/g)) {
        infractores.push(`${ruta}: ${m[0]}`)
      }
    }
    expect(infractores, `una pantalla vuelve a sacar la hora cortando el ISO: dira una hora distinta de la que enseña Calendario, y solo para algunos calendarios:\n  ${infractores.join('\n  ')}`)
      .toEqual([])
  })

  it('el panel de procesos vigila TODOS los crons que hay', () => {
    // El panel dice «TODO LO AUTOMÁTICO, AL DÍA» y `CADENCIA` solo listaba dos de
    // los cuatro: los dos recordatorios podian llevar dias sin correr y aqui salia
    // todo verde. Un panel que afirma mas de lo que mira es peor que no tenerlo,
    // porque se deja de comprobar a mano.
    const crons = new Set(
      (JSON.parse(readFileSync('vercel.json', 'utf8')) as { crons?: { path: string }[] }).crons
        ?.map(c => c.path.split('/').pop()!) || [])
    expect(crons.size, 'no hay crons en vercel.json: revisa esta regla').toBeGreaterThan(1)
    const L = leerCodigo('src/app/api/admin/latido/route.ts')
    const m = L.match(/const CADENCIA: Record<string, number> = \{([\s\S]*?)\n\}/)
    expect(m, 'ya no existe CADENCIA: revisa esta regla en vez de borrarla').toBeTruthy()
    // `backup` late como `copia`: el cron y el nombre del latido no coinciden.
    const ALIAS: Record<string, string> = { backup: 'copia' }
    const sinVigilar = [...crons].map(c => ALIAS[c] || c).filter(c => !new RegExp(`['"]?${c}['"]?\\s*:`).test(m![1]))
    expect(sinVigilar, `hay crons que el panel de procesos no vigila, y aun asi dice «todo al dia»:\n  ${sinVigilar.join('\n  ')}`)
      .toEqual([])
  })

  it('«fichó y no cerró» se decide por el fichaje, no por el texto', () => {
    // Con el texto, quien abre Fichar, escribe dos palabras y se va —sin llegar a
    // fichar— salia acusado de «ficho y no cerro». Es una afirmacion falsa sobre el
    // trabajo de alguien, y le llega a un jefe.
    const A = leerCodigo('src/lib/automations.ts')
    const i = A.indexOf("sincerrar:")
    expect(i, 'ya no existe el disparador sin_fichar: revisa esta regla').toBeGreaterThan(-1)
    const bloque = A.slice(Math.max(0, i - 400), i)
    expect(/haFichado\(/.test(bloque),
      'vuelve a decidirse por el texto: acusara de no cerrar a quien nunca ficho').toBe(true)
    expect(/!\(d\.entrada \|\| ''\)\.trim\(\)/.test(bloque),
      'vuelve el criterio del texto').toBe(false)
  })
})

describe('la CSP deja incrustar lo que la app sabe incrustar', () => {
  // `videoEmbed()` genera iframes de YouTube, Vimeo, Drive e Instagram; `frame-src`
  // solo listaba los dos primeros. Drive e Instagram los bloqueaba la CSP: caja
  // negra vacia, sin error visible en la pantalla — que es exactamente el sintoma
  // que los dos commits que añadieron ese soporte dicen haber arreglado («pegabas
  // el enlace y no se veia nada»).
  //
  // La lista se saca de la FUNCION, no se escribe aqui: añadir un quinto proveedor
  // sin tocar la CSP tiene que ponerse rojo solo.
  it('todo dominio que videoEmbed produce esta en frame-src', () => {
    const H = leerCodigo('src/components/shared/helpers.ts')
    const i = H.indexOf('export const videoEmbed')
    expect(i, 'ya no existe videoEmbed: revisa esta regla en vez de borrarla').toBeGreaterThan(-1)
    const fin = H.indexOf('\nexport ', i + 10)
    const cuerpo = H.slice(i, fin > i ? fin : i + 1500)
    const dominios = [...new Set([...cuerpo.matchAll(/https:\/\/([a-z0-9.-]+)\//g)].map(m => m[1]))]
    expect(dominios.length, 'no se reconoce ningun dominio de embed').toBeGreaterThan(2)

    const csp = leerCodigo('next.config.ts')
    const m = csp.match(/"frame-src ([^"]*)"/)
    expect(m, 'ya no hay frame-src: sin el, `default-src self` bloquea TODOS los iframes').toBeTruthy()
    const faltan = dominios.filter(d => !m![1].includes(d))
    expect(faltan, `videoEmbed genera iframes de dominios que la CSP bloquea. El usuario ve una caja negra vacia y ni un error:\n  ${faltan.join('\n  ')}`)
      .toEqual([])
  })
})

describe('«no lo he podido leer» no se pinta como «no tienes nada»', () => {
  // Las preferencias de avisos se leian con un `.catch(() => {})` que dejaba `prefs`
  // en `{}`. Como el pintado es `prefs[cat] !== false`, los OCHO interruptores
  // salian encendidos: la pantalla afirmaba que no tienes nada silenciado sin
  // haberlo comprobado.
  //
  // Y lo grave venia despues: al pulsar cualquiera se manda el objeto ENTERO
  // (`{...prefs, [cat]: valor}`), asi que el primer toque escribia `{}` mas esa
  // clave encima del servidor. Un fallo de red al abrir la pestaña te borraba todo
  // lo que llevabas silenciado, en silencio.
  it('las preferencias distinguen cargando, listo y error', () => {
    const N = leerCodigo('src/components/sections/NotificacionesTab.tsx')
    expect(/estadoPrefs/.test(N),
      'vuelve a haber un solo estado: un fallo de lectura se pintara como «nada silenciado»').toBe(true)
    expect(/'cargando' \| 'listo' \| 'error'/.test(N), 'los tres estados ya no estan').toBe(true)
    // Y la escritura tiene que estar cerrada mientras no se hayan leido.
    const i = N.indexOf('const cambiarPref')
    expect(i, 'ya no existe cambiarPref: revisa esta regla').toBeGreaterThan(-1)
    expect(/estadoPrefs !== 'listo'/.test(N.slice(i, i + 500)),
      'se puede escribir sin haber leido: el PUT manda el objeto entero y borra lo que no se llego a leer')
      .toBe(true)
  })
})

describe('el trabajo de alguien no desaparece por no haber fichado', () => {
  // `/api/equipo/resumen` mapeaba sobre `diario` y colgaba las tareas DENTRO de
  // cada dia, asi que un dia trabajado sin fichar no existia — y con el, todas las
  // tareas cerradas ese dia.
  //
  // MEDIDO contra produccion con una tarea completada el 23 de agosto (un dia sin
  // fila de diario), preguntando «¿que tal va Javi?»:
  //   antes → «No hay nada escrito de Javi en este tramo: ni objetivos, ni
  //            cierres, NI TAREAS COMPLETADAS.»
  //   ahora → «Javi ha completado el montaje del teaser el veintitres de agosto,
  //            pero no cerro ese dia de trabajo.»
  // Lo primero es una afirmacion, y es falsa, y la lee un jefe sobre el trabajo de
  // alguien. El primer caso de prueba que escribi uso «ayer» y NO aislaba el bug,
  // porque ese dia si tenia fila de diario: el caso tiene que ejercitar la decision.
  it('los dias salen del diario Y de las tareas, no solo del diario', () => {
    const R = leerCodigo('src/app/api/equipo/resumen/route.ts')
    expect(/new Set\(\[\.\.\.conDiario\.keys\(\), \.\.\.conTareas\]\)/.test(R),
      'la lista de dias vuelve a salir solo de `diario`: el trabajo de quien cerro tareas sin fichar desaparece, y el texto que lee el jefe dice «ni tareas completadas»')
      .toBe(true)
    // Y que no se vuelva a mapear directamente sobre el diario.
    expect(/const dias: DiaDeTrabajo\[\] = \(diario \|\| \[\]\)\.map/.test(R),
      'se vuelve a construir la lista de dias mapeando sobre `diario`').toBe(false)
  })
})

describe('una funcion memorizada no lee estado congelado del primer render', () => {
  // `sendChatMessage` era un `useCallback` con deps `[]` que leia `calendarEvents`
  // de la clausura. Con deps vacias la funcion es SIEMPRE la del primer render, y
  // en ese render el estado vale su valor inicial: `[]`. Resultado — el cuerpo que
  // salia hacia `/api/chat` llevaba `eventos: []` en todos los mensajes, toda la
  // sesion, para siempre. Brutal.IA no vio la agenda ni una vez.
  //
  // Y era la peor version del fallo: el servidor distingue a proposito «lista
  // vacia» de «no mandado» para que el modelo no diga que no tiene calendario.
  // Recibiendo `[]` contestaba «no tienes nada esta semana» — una afirmacion, y
  // falsa. Un bug de React convertido en una mentira de la IA.
  //
  // Se mira `useNexusData.ts` porque es el sitio donde vive el estado de la app: 18
  // `useState` y las funciones que los consumen. La solucion cuando hace falta el
  // valor de ahora sin cambiar la identidad de la funcion es un ref, que este mismo
  // fichero ya usaba para `onNewInboxMessage`.
  it('ningun useCallback con deps vacias lee un useState de este hook', () => {
    const H = leerCodigo('src/hooks/useNexusData.ts')

    // Los nombres de estado declarados con useState (no los setters).
    const estados = [...H.matchAll(/const \[(\w+), set\w+\] = useState/g)].map(m => m[1])
    expect(estados.length, 'no se reconoce ningun useState: revisa esta regla en vez de borrarla').toBeGreaterThan(8)

    // EL FINAL DE CADA useCallback SE ENCUENTRA CONTANDO PARENTESIS.
    //
    // La primera version buscaba el siguiente `}, [])` con un `indexOf` y saltaba
    // el callback si por el camino aparecia otro `useCallback(`. Como el `}, [])`
    // mas cercano casi siempre pertenece a OTRO callback varias funciones mas
    // abajo, la condicion se cumplia SIEMPRE: se saltaban los 34 y la regla no
    // comprobaba absolutamente nada. Paso en verde con el bug reintroducido.
    const cuerpoDe = (desde: number): { cuerpo: string; deps: string } | null => {
      const abre = H.indexOf('(', desde)
      if (abre === -1) return null
      let n = 0
      for (let i = abre; i < H.length; i++) {
        if (H[i] === '(') n++
        else if (H[i] === ')') {
          n--
          if (n === 0) {
            const dentro = H.slice(abre + 1, i)
            const coma = dentro.lastIndexOf(',')
            if (coma === -1) return null
            return { cuerpo: dentro.slice(0, coma), deps: dentro.slice(coma + 1).trim() }
          }
        }
      }
      return null
    }

    const revisados: string[] = []
    const infractores: string[] = []
    for (const m of H.matchAll(/const (\w+) = useCallback/g)) {
      const t = cuerpoDe(m.index! + m[0].length)
      if (!t) continue
      revisados.push(m[1])
      if (t.deps !== '[]') continue                 // solo las de dependencias vacias
      // Fuera las cadenas literales antes de comparar: `apiFetch('/api/tasks')`
      // contiene la palabra `tasks` y no es leer el estado `tasks`. Los `${...}`
      // de las plantillas se conservan, que ahi si puede haber una lectura real.
      const cuerpo = t.cuerpo
        .replace(/'[^']*'/g, "''")
        .replace(/"[^"]*"/g, '""')
        // De las plantillas se conserva SOLO lo interpolado: `/api/tasks/${id}`
        // contiene la palabra `tasks` y no es leer el estado `tasks`, pero
        // `${calendarEvents.length}` si lo seria.
        .replace(/`(?:[^`\\]|\\.)*`/g, lit =>
          [...lit.matchAll(/\$\{([^{}]*)\}/g)].map(x => x[1]).join(' '))
      for (const e of estados) {
        // El nombre del estado, pero NO cuando es `xRef.current` ni el setter.
        if (new RegExp(`(?<![\\w.])${e}(?!\\w)`).test(cuerpo)) {
          infractores.push(`${m[1]}() tiene deps [] y lee el estado ${e}`)
        }
      }
    }
    expect(revisados.length, 'no se reconoce ningun useCallback: la regla no esta mirando nada').toBeGreaterThan(20)
    expect(infractores,
      `una funcion memorizada con deps vacias lee estado del componente: se queda con el valor del PRIMER render para siempre, y nadie lo ve porque no falla — simplemente manda el valor inicial. Usa un ref (como onNewInboxRef) o pon la dependencia:\n  ${infractores.join('\n  ')}`)
      .toEqual([])
  })
})

describe('un select trae las columnas que el codigo va a leer', () => {
  // EL FALLO MAS CARO DE LA AUDITORIA, y no daba error de ninguna clase.
  //
  // `recordatorio-cerrar` —el aviso de las 20:00 que Javi llama vital— pedia
  // `select('user_id, entrada, cierre_at')` y luego filtraba con `haFichado()`, que
  // lee `entrada_at`. PostgREST devuelve SOLO las columnas que le pides, asi que
  // `entrada_at` no venia ni como clave: `undefined`, `haFichado` false siempre,
  // lista de avisados SIEMPRE vacia. El aviso no se envio nunca a nadie.
  //
  // Y el cron contestaba `{ok:true, avisados:0}`, que es indistinguible de «hoy
  // todo el mundo habia cerrado su dia». Ni un error, ni un log, ni un latido rojo.
  //
  // El gemelo de al lado, `recordatorio-fichar`, SI pedia la columna.
  //
  // Las columnas se sacan del CUERPO del ayudante, no de una lista escrita aqui:
  // si mañana `diarioTieneAlgo` empieza a mirar otra columna, esta regla lo exige
  // sola sin que nadie se acuerde de actualizarla.
  const H = leerCodigo('src/components/shared/helpers.ts')
  const columnasQueLee = (nombre: string): string[] => {
    const i = H.indexOf(`export const ${nombre} =`)
    expect(i, `ya no existe ${nombre}: revisa esta regla en vez de borrarla`).toBeGreaterThan(-1)
    const fin = H.indexOf('\nexport ', i + 10)
    const cuerpo = H.slice(i, fin > i ? fin : i + 900)
    return [...new Set([...cuerpo.matchAll(/\bd\??\.(\w+)/g)].map(m => m[1]))]
  }

  // ACOTADA AL SITIO, no al fichero — que es el error que CLAUDE.md avisa y que
  // esta regla cometio en su primera version. `POST /api/diario` lee
  // `select('entrada_at, cierre_at')` para NO pisar la hora de fichaje al editar
  // por segunda vez, y ese resultado no pasa por ningun ayudante. Es un select
  // legitimo en un fichero que ademas usa `diarioTieneAlgo` en otra consulta.
  const EXCEPCIONES: Record<string, string> = {
    "src/app/api/diario/route.ts::entrada_at, cierre_at":
      'POST lee la fila previa solo para conservar entrada_at/cierre_at al reescribir; no lo filtra con nada',
    "src/lib/resumenEquipo.ts::entrada_at, cierre_at":
      'miJornadaHoy lee SOLO las dos horas de la jornada de quien pregunta, para una linea del prompt; no pasa por ningun ayudante',
  }

  it('quien filtra con haFichado o diarioTieneAlgo pide esas columnas', () => {
    const AYUDANTES = ['haFichado', 'diarioTieneAlgo'] as const
    const usadas = new Set<string>()
    const infractores: string[] = []
    for (const ruta of TS) {
      if (ruta.startsWith('src/lib/__tests__/') || ruta.endsWith('shared/helpers.ts')) continue
      const c = leerCodigo(ruta)
      for (const ayudante of AYUDANTES) {
        if (!new RegExp(`\\b${ayudante}\\(`).test(c)) continue
        const necesita = columnasQueLee(ayudante)
        // Todos los `select` sobre `diario` de ese fichero.
        for (const m of c.matchAll(/from\('diario'\)\s*(?:\.\w+\([^)]*\)\s*)*?\.select\(\s*'([^']*)'/g)) {
          const pedidas = m[1]
          if (pedidas.includes('*')) continue     // `select('*')` lo trae todo
          const faltan = necesita.filter(col => !new RegExp(`\\b${col}\\b`).test(pedidas))
          const clave = `${ruta}::${pedidas}`
          if (EXCEPCIONES[clave]) { usadas.add(clave); continue }
          if (faltan.length) {
            infractores.push(`${ruta}: filtra con ${ayudante}() y su select('${pedidas}') no trae ${faltan.join(', ')}`)
          }
        }
      }
    }
    expect(infractores,
      `un select no trae una columna que el codigo va a leer despues. PostgREST devuelve SOLO lo pedido, asi que el valor sera undefined, el filtro dara false para todo el mundo y la lista saldra vacia — SIN error, SIN log, y sin forma de distinguirlo de «no habia nadie»:\n  ${infractores.join('\n  ')}`)
      .toEqual([])

    // Una excepcion que ya no existe se nota sola, como todas las de este fichero.
    const sobran = Object.keys(EXCEPCIONES).filter(k => !usadas.has(k))
    expect(sobran, `hay excepciones que ya no hacen falta: quitalas\n  ${sobran.join('\n  ')}`).toEqual([])
  })
})

describe('los tres sitios que cuentan dias del diario usan el mismo criterio', () => {
  // Habia CUATRO filas de diario en la base que no eran nada —`entrada: ''` y todo
  // lo demas a null— y las tres cuentas de dias las contaban. El briefing decia «1
  // dia», el resumen del equipo escribia una linea por cada una, y las dos IAs lo
  // leian y lo repetian: «ha habido actividad los dias 21, 22, 24 y 25». No la hubo.
  //
  // Tres sitios con el mismo criterio son tres oportunidades de arreglar uno.
  const SITIOS = [
    ['src/app/api/diario/route.ts', 'el panel de Fichar'],
    ['src/app/api/diario/briefing/route.ts', 'el briefing del equipo'],
    ['src/lib/resumenEquipo.ts', 'lo que leen las dos IAs'],
  ] as const

  it('ninguno cuenta una fila por el hecho de existir', () => {
    for (const [ruta, que] of SITIOS) {
      expect(/diarioTieneAlgo\(/.test(leerCodigo(ruta)),
        `${ruta} (${que}) vuelve a contar filas vacias como dias de trabajo`).toBe(true)
    }
  })
})

describe('el cliente de un correo no lo inventa el modelo', () => {
  // Medido sobre los 871 correos reales: 123 nombres distintos en `ai_client` y
  // ninguno era cliente. El unitario prueba el normalizador; esto prueba que se
  // USA — que es donde se pierden estos arreglos: la funcion existe, esta bien
  // hecha, y el sitio que importa sigue metiendo el valor crudo.
  it('analyzeEmail pasa el cliente por clienteConocido antes de devolverlo', () => {
    const A = leerCodigo('src/lib/ai.ts')
    const i = A.indexOf('export async function analyzeEmail(')
    expect(i, 'ya no existe analyzeEmail: revisa esta regla').toBeGreaterThan(-1)
    const j = A.indexOf('export async function analyzeWhatsAppMessage', i)
    const cuerpo = A.slice(i, j > i ? j : A.length)
    expect(/client: clienteConocido\(/.test(cuerpo),
      'el cliente vuelve a salir crudo del modelo: la columna se llenara otra vez con la marca de quien envia (Temu, Google, Revolut)')
      .toBe(true)
  })

  it('la pantalla pinta lo mismo que filtra', () => {
    // El filtro ya emparejaba contra los clientes reales; el panel escribia
    // `ai_client` TAL CUAL, asi que la ficha del correo decia «Cliente: Temu»
    // mientras el contador no lo contaba. Dos verdades para el mismo correo.
    const I = leerCodigo('src/components/sections/InboxSection.tsx')
    const crudos = [...I.matchAll(/\{[^{}]*\bai_client\s*!==\s*'Desconocido'[^{}]*\}/g)].map(m => m[0])
    expect(crudos, `vuelve a pintarse ai_client sin emparejar con un cliente real:\n  ${crudos.join('\n  ')}`).toEqual([])
  })

  it('el prompt dice que el remitente no es un cliente', () => {
    const A = leerCodigo('src/lib/ai.ts')
    expect(/no es un cliente por enviarlo|EXACTAMENTE uno de los clientes/.test(A),
      'el prompt vuelve a pedir «el cliente si se identifica» sin atarlo a la lista').toBe(true)
  })
})

describe('una hora de evento no se saca cortando el texto', () => {
  // Google devuelve cada evento en el desfase del calendario DONDE VIVE, no en el
  // del usuario: el calendario personal de Javi va en +01:00 y el compartido en
  // +02:00. Cortar el ISO (`start.slice(11,16)`) da la hora de ese desfase.
  //
  // Medido sobre los eventos reales: «reunion brutal» del 4 de agosto salia como
  // las 10:30 para Harvey y como las 11:30 en la pantalla. La misma reunion. Y era
  // la peor version del fallo, porque la seccion SI lo hacia bien: la app y la IA
  // decian cosas distintas del mismo dato.
  it('los constructores de contexto usan el ayudante de Madrid', () => {
    const infractores: string[] = []
    for (const ruta of ['src/lib/contextoHarvey.ts', 'src/lib/ai.ts']) {
      const c = leerCodigo(ruta)
      // Cualquier `slice` que saque hora y minuto de algo que se llama `start`.
      for (const m of c.matchAll(/(\w*[Ss]tart\w*)[^\n]{0,40}\.slice\(\s*11\s*,\s*16\s*\)/g)) {
        infractores.push(`${ruta}: ${m[0].slice(0, 60)}`)
      }
      // O que corte los 16 primeros caracteres, que es la otra forma de lo mismo.
      for (const m of c.matchAll(/(\w*[Ss]tart\w*)\.slice\(\s*0\s*,\s*16\s*\)/g)) {
        infractores.push(`${ruta}: ${m[0].slice(0, 60)}`)
      }
    }
    expect(infractores, `vuelve a leerse la hora cortando el ISO: dira una hora distinta de la que enseña la pantalla, y solo para algunos calendarios:\n  ${infractores.join('\n  ')}`)
      .toEqual([])
    for (const ruta of ['src/lib/contextoHarvey.ts', 'src/lib/ai.ts']) {
      expect(/cuandoEnMadrid\(/.test(leerCodigo(ruta)), `${ruta} ya no usa cuandoEnMadrid()`).toBe(true)
    }
  })

  it('la ventana del calendario se decide en UN sitio', () => {
    // La seccion deja navegar a cualquier mes y de Google solo se trae un tramo.
    // Si el rango se escribe dos veces, el aviso de «mes no cargado» acaba mintiendo
    // en la direccion contraria: diciendo que hay datos donde no los hay.
    const g = leerCodigo('src/lib/gmail.ts')
    expect(/ventanaCalendario\(\)/.test(g), 'gmail.ts vuelve a calcular la ventana por su cuenta').toBe(true)
    expect(/new Date\(now\.getFullYear\(\), now\.getMonth\(\)/.test(g),
      'gmail.ts vuelve a construir el rango a mano').toBe(false)
    expect(/mesCargado\(/.test(leerCodigo('src/components/sections/CalendarioSection.tsx')),
      'el calendario ya no avisa de los meses que no ha traido: los pinta vacios, que se lee como «no tienes nada»').toBe(true)
  })
})

describe('el cliente no llama a metodos que la ruta no tiene', () => {
  // ESTE ES EL BUG QUE ME COMI. La accion de cerrar el dia llamaba a
  // `/api/diario` con PATCH y esa ruta exporta GET y POST: en produccion
  // contestaba 405 y no se escribia nada. La prueba unitaria pasaba en verde
  // porque su `fetch` de mentira aceptaba el metodo que le dieras — o sea que
  // estaba de acuerdo con MI SUPOSICION, no con la ruta.
  //
  // Un doble solo comprueba lo que ya creias. Esto compara contra el fichero.
  it('cada fetch a /api/... usa un metodo que ese route.ts exporta', () => {
    const infractores: string[] = []
    for (const ruta of TS) {
      if (ruta.startsWith('src/app/api/')) continue      // el servidor no se llama a si mismo
      const codigo = leerCodigo(ruta)
      // `fetch('/api/loquesea', { ... method: 'X' ... })` — se mira la llamada
      // entera, no el fichero: en un fichero grande hay muchos metodos sueltos.
      for (const m of codigo.matchAll(/fetch\(\s*[`'"](\/api\/[^`'"?\s]*)[^)]*?\bmethod:\s*'(\w+)'/g)) {
        const [, url, metodo] = m
        // Se resuelve el fichero de esa ruta: primero literal, luego con el
        // ultimo tramo como [id], que es como estan escritas las dinamicas.
        const partes = url.replace(/^\//, '').split('/')
        const candidatos = [
          `src/app/${url.replace(/^\//, '')}/route.ts`,
          `src/app/${[...partes.slice(0, -1), '[id]'].join('/')}/route.ts`,
        ]
        const fichero = candidatos.find(c => TS.includes(c))
        // Una URL con interpolacion (`/api/tasks/${id}`) no se resuelve aqui:
        // se salta en vez de dar un falso positivo.
        if (!fichero) continue
        if (!new RegExp(`export async function ${metodo}\\b`).test(leerCodigo(fichero))) {
          infractores.push(`${ruta}: ${metodo} ${url} — ${fichero} no exporta ${metodo}`)
        }
      }
    }
    expect(infractores, `el cliente llama con un metodo que la ruta no tiene: en produccion es un 405 y no se escribe nada, sin que nadie lo vea:\n  ${infractores.join('\n  ')}`)
      .toEqual([])
  })
})

describe('lo que emite Harvey se normaliza antes de guardarse', () => {
  // CLAUDE.md ya lo avisa —«lo que escribe el modelo no entra crudo en la base»— y
  // el aviso seguia vigente: de las CINCO acciones que Harvey podia emitir, SOLO la
  // tarea pasaba por un normalizador (`nivelTarea`). Las otras cuatro metian
  // `campo(n).trim()` a pelo.
  //
  // No rebotaba nada porque esas columnas NO tienen CHECK, al reves que `level` o
  // `animo`. Asi que el fallo no era un error: era un dato falso que se guarda.
  // Una pieza con plataforma «Facebook» no casa ningun color y sale en gris, y un
  // proyecto con deadline «proximo viernes» NO VENCE NUNCA, porque `estadoDeadline`
  // devuelve null para lo que no sea AAAA-MM-DD — o sea que no sale en ninguna
  // alerta de retraso y nadie se entera.
  const EJ = leerCodigo('src/lib/harveyEjecutar.ts')
  const PARSER = leerCodigo('src/lib/harveyAccion.ts')
  const PROMPT = leerCodigo('src/app/api/harvey/chat/route.ts')

  it('nada que venga del modelo llega crudo a una columna sin CHECK', () => {
    const crudos: string[] = []
    // Los tres que iban a pelo. `|| 'valor'` no es normalizar: es poner un valor
    // por defecto cuando falta, y no hacer nada cuando viene mal.
    for (const [campo, patronMalo] of [
      ['deadline', /deadline: accion\.date \|\| 'TBD'/],
      ['platform', /platform: accion\.platform \|\| /],
      ['content_type', /content_type: accion\.contentType \|\| /],
    ] as const) {
      if (patronMalo.test(EJ)) crudos.push(campo)
    }
    expect(crudos, `vuelven a guardarse crudos, y ninguna de esas columnas tiene CHECK que lo rebote:\n  ${crudos.join(', ')}`)
      .toEqual([])
    for (const n of ['fechaOTBD(', 'plataformaContenido(', 'tipoContenido(']) {
      expect(EJ.includes(n), `el ejecutor ya no usa ${n}`).toBe(true)
    }
  })

  it('el contrato del prompt y los tipos que el parser entiende dicen lo mismo', () => {
    // El propio fichero lo pide: «El contrato lo fija el prompt. Si cambias uno,
    // cambia el otro». Nada lo comprobaba. Harvey OFRECIA crear notas —su prompt lo
    // dice— y el parser no conocia ese tipo: decia que la creaba y no pasaba nada.
    // Ofrecer algo que no se puede hacer es peor que no ofrecerlo.
    const m = PARSER.match(/TIPOS_ACCION = \[([^\]]*)\]/)
    expect(m, 'ya no existe TIPOS_ACCION: revisa esta regla en vez de borrarla').toBeTruthy()
    const tipos = m![1].split(',').map(t => t.trim().replace(/'/g, '')).filter(Boolean)
    expect(tipos.length, 'TIPOS_ACCION esta vacio').toBeGreaterThan(4)
    const sinContrato = tipos.filter(t => !PROMPT.includes(`[ACCION:${t}|`))
    expect(sinContrato, `el parser entiende tipos que el prompt no le ofrece al modelo — nunca se emitiran:\n  ${sinContrato.join(', ')}`)
      .toEqual([])
    const sinParser = [...PROMPT.matchAll(/\[ACCION:(\w+)\|/g)].map(x => x[1]).filter(t => !tipos.includes(t))
    expect(sinParser, `el prompt ofrece acciones que el parser NO entiende — Harvey dira que las hace y no pasara nada:\n  ${sinParser.join(', ')}`)
      .toEqual([])
  })

  it('cada tipo que el parser entiende tiene quien lo ejecute', () => {
    const tipos = (PARSER.match(/TIPOS_ACCION = \[([^\]]*)\]/)?.[1] || '')
      .split(',').map(t => t.trim().replace(/'/g, '')).filter(Boolean)
    const sinEjecutor = tipos.filter(t => !new RegExp(`case '${t}'`).test(EJ))
    expect(sinEjecutor, `tipos sin ejecutor: se propondran en la tarjeta y al confirmar no haran nada:\n  ${sinEjecutor.join(', ')}`)
      .toEqual([])
  })

  it('el motivo real de un evento fallido llega al usuario', () => {
    // El servidor dice «No se entendio la fecha "martes" — tiene que ser
    // AAAA-MM-DD» y se tiraba a la basura: el usuario veia un error generico que
    // culpaba a Google, sin saber que bastaba con repetir la fecha.
    const i = EJ.indexOf("'Error al crear el evento en Google Calendar'")
    expect(i, 'ya no se maneja el fallo del evento: revisa esta regla').toBeGreaterThan(-1)
    // Ojo a la FORMA: mirar si `json.error` aparece «por ahi cerca» no comprueba
    // nada — en 500 caracteres cabe cualquier cosa, y la primera version de esta
    // regla paso en verde con el bug reintroducido porque casaba con otra linea.
    // Lo que hay que exigir es que el mensaje del servidor sea LA ALTERNATIVA a
    // este texto generico, o sea la rama de al lado del ternario.
    const antes = EJ.slice(Math.max(0, i - 200), i)
    expect(/\?\s*json\??\.error\s*:\s*$/.test(antes),
      `el texto generico ya no es el ultimo recurso de un ternario que prefiere el mensaje del servidor — el usuario vera «error al crear el evento» sin enterarse de que la fecha no se entendio. Justo antes hay:\n  ...${antes.slice(-90)}`)
      .toBe(true)
  })
})

describe('el contexto de Harvey se escribe UNA vez', () => {
  // Estaba escrito DOS veces —`buildCtx` en HoySection y `buildContext` en
  // HarveySection— con ONCE diferencias. Y no eran variantes a proposito: eran
  // arreglos que se le hicieron a una copia y no a la otra.
  //
  // Lo demuestran los propios comentarios: cada fichero llevaba escrito el arreglo
  // que recibio EL, diciendo «el gemelo de X ya lo hacia bien» — y el gemelo, a su
  // vez, decia lo mismo de otro arreglo distinto. Cada uno se creia el corregido.
  //
  // Lo que divergia: uno veia que vence hoy y el otro no; uno ponia el responsable
  // de las urgentes y el otro no; uno listaba los proyectos atrasados por nombre
  // —cosa que el SERVIDOR parsea en su respuesta de emergencia, asi que desde el
  // otro ese numero era siempre 0— y el otro solo los marcaba; 8 correos frente a
  // 10; 6 proyectos frente a 8; y una tercera copia a mano del formateador de
  // memoria que ya existia compartido.
  const HOY = leerCodigo('src/components/sections/HoySection.tsx')
  const HAR = leerCodigo('src/components/sections/HarveySection.tsx')

  it('ninguna pantalla se escribe su propio contexto', () => {
    // La firma delata al gemelo: si una pantalla vuelve a componer el texto, tendra
    // que armar el bloque de INBOX o el de PROYECTOS por su cuenta.
    const malos: string[] = []
    for (const [nombre, src] of [['HoySection', HOY], ['HarveySection', HAR]] as const) {
      if (/BRUTAL STUDIOS — \$\{madridDateLabel\(\)\}/.test(src)) malos.push(`${nombre}: vuelve a componer la cabecera del contexto`)
      if (/PROYECTOS ACTIVOS \(/.test(src)) malos.push(`${nombre}: vuelve a componer el bloque de proyectos`)
      if (/INBOX — /.test(src)) malos.push(`${nombre}: vuelve a componer el bloque de inbox`)
    }
    expect(malos, `el contexto vuelve a escribirse por duplicado — es como nacieron las once diferencias:\n  ${malos.join('\n  ')}`)
      .toEqual([])
  })

  it('las dos piden el contexto al mismo sitio', () => {
    for (const [nombre, src] of [['HoySection', HOY], ['HarveySection', HAR]] as const) {
      expect(/from '@\/lib\/contextoHarvey'/.test(src),
        `${nombre} ya no usa el constructor compartido`)
        .toBe(true)
    }
  })

  it('las dos mandan el hilo de la conversacion', () => {
    // El orbe de Hoy mandaba solo `{message, context}`: cada pregunta empezaba de
    // cero. Si Harvey preguntaba «¿para que fecha?» y respondias «el jueves», esa
    // frase le llegaba suelta. HarveySection lo tiene medido: sin historial crea la
    // tarea 1 de cada 3 veces; con historial, 3 de 3.
    for (const [nombre, src] of [['HoySection', HOY], ['HarveySection', HAR]] as const) {
      const i = src.indexOf("'/api/harvey/chat'")
      expect(i, `${nombre} ya no habla con Harvey: revisa esta regla`).toBeGreaterThan(-1)
      const bloque = src.slice(i, i + 500)
      expect(/history:/.test(bloque),
        `${nombre} habla con Harvey sin mandarle el hilo: olvidara lo que acaba de preguntar`)
        .toBe(true)
    }
  })
})

describe('lo que se le oculta a alguien no se le cuela por detras', () => {
  // `ver_colabs` es el interruptor de «quiero ver el buzon del equipo». Se
  // respetaba en `/api/inbox` y en `/api/chat`, y el comentario de chat/route.ts lo
  // dice con todas las letras: «ocultarle a alguien el correo del equipo en la
  // pantalla y seguir metiendoselo a su Harvey no es medio arreglo, es ninguno».
  //
  // Pues faltaba la otra mitad. La suscripcion en VIVO escuchaba `shared=eq.true` a
  // secas, sin mirar el interruptor: a quien lo tuviera apagado, la pantalla le
  // ocultaba el buzon compartido y cada correo que entrara con la app abierta se le
  // colaba igual en el estado local — y de ahi al contexto de Harvey. Se corregia
  // solo al recargar, asi que era intermitente y no se notaba.
  const H = leerCodigo('src/hooks/useNexusData.ts')

  it('la suscripcion al buzon compartido comprueba ver_colabs', () => {
    const i = H.indexOf("filter: `shared=eq.true`")
    expect(i, 'ya no hay suscripcion al buzon compartido: revisa esta regla en vez de borrarla').toBeGreaterThan(-1)
    // La guarda va ANTES de suscribirse, no dentro del manejador: suscribirse y
    // luego tirar el mensaje deja el canal abierto y el dato viajando.
    const antes = H.slice(Math.max(0, i - 900), i)
    expect(/ver_colabs === false\) return/.test(antes),
      'la suscripcion en vivo vuelve a traer el buzon compartido a todo el mundo: a quien lo tenga apagado se le colara en el contexto de Harvey')
      .toBe(true)
  })

  it('apagar el interruptor surte efecto sin recargar', () => {
    // Sin `ver_colabs` en las dependencias, el canal sigue vivo hasta que la
    // persona recarga — que es justo lo que no va a hacer despues de apagarlo.
    const i = H.indexOf("filter: `shared=eq.true`")
    const despues = H.slice(i, i + 900)
    expect(/\}, \[profile\?\.id, profile\?\.ver_colabs\]\)/.test(despues),
      'el efecto no depende de ver_colabs: apagarlo no cierra el canal hasta recargar')
      .toBe(true)
  })

  it('nadie decide si un proyecto esta vencido restando instantes', () => {
    // El bug de las 02:00 que documenta CLAUDE.md: `dlDate(p.deadline) < new Date()`
    // marca como ATRASADO algo que vence HOY desde las 00:00, y entonces Harvey
    // contesta sobre un retraso que no existe mientras la pantalla dice «vence hoy».
    // Estaba arreglado en HoySection y vivo en HarveySection: el gemelo exacto.
    const malos: string[] = []
    for (const f of CLIENTE) {
      const src = leerCodigo(f)
      for (const m of src.matchAll(/dlDate\([^)]*\)\s*<\s*new Date\(\)|new Date\(\)\s*>\s*dlDate\(/g)) {
        malos.push(`${f}:${src.slice(0, m.index!).split('\n').length}`)
      }
    }
    expect(malos, `se vuelve a decidir «vencido» restando instantes en vez de con estadoDeadline — un proyecto que vence HOY saldra como atrasado desde las 00:00:\n  ${malos.join('\n  ')}`)
      .toEqual([])
  })
})

describe('las superficies de IA se DERIVAN, no se enumeran', () => {
  // Javi: «cuando le das a redactar, Harvey y la IA tienen constancia de toda la
  // empresa y todo el contexto». Lo daba por hecho. NO ERA ASI.
  //
  // `/api/inbox/harvey-draft` era la TERCERA superficie de IA de la app y la unica
  // sin nada: 61 lineas, CERO consultas de negocio. Ni ficha, ni memoria, ni
  // clientes, ni un solo correo anterior de ese remitente. Ni el cuerpo del email
  // —solo `ai_summary`, que es un resumen de un resumen—. Y `senderLanguage:
  // 'español'` escrito A MANO en el cliente, asi que a un correo en ingles se le
  // decia que el remitente escribia en español.
  //
  // POR QUE NO LO CAZO NINGUNA REGLA: las que exigen contexto ENUMERABAN a mano
  // las superficies, y eran una lista de dos ficheros. Una tercera se escapaba
  // sola, y una cuarta se escapara igual.
  //
  // Esta regla no enumera: BUSCA quien llama al modelo y exige que cada uno tenga
  // contexto o este en la lista de excepciones CON SU MOTIVO.
  const RUTAS = ficheros('src/app/api', ['.ts'])
    .filter(f => /anthropic\.messages\.create/.test(leerCodigo(f)))

  /**
   * Superficies que llaman al modelo y NO necesitan la ficha del estudio, cada
   * una con su motivo. Si una deja de cumplirlo, hay que sacarla de aqui.
   */
  const SIN_FICHA: Record<string, string> = {
    'src/app/api/documents/route.ts':
      'ingesta de un PDF: extrae texto para METERLO en memoria. Darle la ficha seria contarle lo que ya sabemos para que resuma lo que aun no sabemos.',
    'src/app/api/projects/analyze-pdf/route.ts':
      'analiza el PDF de UN proyecto concreto, y el propio documento es todo el contexto que necesita. Ademas es el unico sitio con prompt caching y meterle un bloque que cambia cada hora lo invalidaria.',
    'src/app/api/clients/[id]/ai-advice/route.ts':
      'consejo sobre UN cliente, con la ficha de ese cliente delante. Pendiente de revisar si le vendria bien, pero hoy no es un fallo mudo.',
  }

  it('toda superficie de IA tiene contexto, o una excepcion escrita', () => {
    expect(RUTAS.length, 'ya no hay rutas que llamen al modelo: revisa esta regla en vez de borrarla')
      .toBeGreaterThan(2)
    const sinNada: string[] = []
    for (const f of RUTAS) {
      if (SIN_FICHA[f]) continue
      const src = leerCodigo(f)
      if (!/leerFicha\(/.test(src)) sinNada.push(f)
    }
    expect(sinNada, `superficies de IA sin la ficha del estudio y sin excepcion escrita — hablaran del estudio sin saber quien es:\n  ${sinNada.join('\n  ')}`)
      .toEqual([])
  })

  it('las excepciones que se apuntan siguen existiendo', () => {
    // Una excepcion que sobra es una mentira que se lee como una decision.
    const fantasmas = Object.keys(SIN_FICHA).filter(f => !RUTAS.includes(f))
    expect(fantasmas, `hay excepciones apuntadas para ficheros que ya no llaman al modelo:\n  ${fantasmas.join('\n  ')}`)
      .toEqual([])
  })

  it('el borrador compone su contexto en el SERVIDOR, no se fia del navegador', () => {
    const D = leerCodigo('src/app/api/inbox/harvey-draft/route.ts')
    // El cliente manda un id; el servidor lee la fila y comprueba que puede verla.
    // Con seis campos sueltos, el navegador elegia que contarle al modelo y el
    // servidor no podia comprobar ni que ese correo fuera tuyo.
    expect(/from\('inbox_messages'\)/.test(D),
      'el borrador vuelve a fiarse de lo que le mande el navegador: no puede comprobar de quien es el correo')
      .toBe(true)
    expect(/ver_colabs/.test(D),
      'el borrador no comprueba ver_colabs: se podria redactar —y leer— un correo del buzon compartido sin permiso')
      .toBe(true)
    expect(/senderLanguage/.test(D + leerCodigo('src/components/sections/InboxSection.tsx')),
      'vuelve el idioma escrito a mano: a un correo en ingles se le respondera en español')
      .toBe(false)
  })
})

describe('fichar significa una sola cosa en toda la app', () => {
  // Javi: «aqui me pone 3 seguidos y en verdad no complete ningun dia de fichar».
  //
  // Tenia razon, y la racha estaba BIEN calculada: salta fines de semana, asi que
  // con filas el 25, el 24 y el 21 daba 3. El fallo era que esas filas estaban
  // COMPLETAMENTE VACIAS —ni hora de entrada, ni cierre, ni una palabra—: fantasmas
  // que deja el guardado automatico del borrador con solo abrir la seccion. Y
  // `/api/diario/mes` contaba cualquier fila como «ficho ese dia».
  //
  // Debajo habia algo peor: TRES criterios distintos para la misma pregunta. El
  // calendario contaba filas, los recordatorios miraban el TEXTO de `entrada`, y el
  // panel de equipo miraba `entrada_at`. Tres respuestas para «¿ficho?».
  //
  // La marca es `entrada_at` porque es lo unico que significa exactamente eso: el
  // servidor la sella solo al guardar de verdad —no un borrador— y en un dia que no
  // es futuro. Escribir en un borrador es estar escribiendo; planificar el jueves
  // que viene es planificar.
  const CONSUMIDORES = [
    'src/app/api/diario/mes/route.ts',
    'src/app/api/cron/recordatorio-fichar/route.ts',
    'src/app/api/cron/recordatorio-cerrar/route.ts',
    'src/lib/automations.ts',
  ]

  it('existe UNA definicion y es la que se usa', () => {
    expect(/export const haFichado/.test(leerCodigo('src/components/shared/helpers.ts')),
      'ya no existe haFichado: cada sitio volvera a decidir por su cuenta que es fichar')
      .toBe(true)
    const sinUsar = CONSUMIDORES.filter(f => !/haFichado\(/.test(leerCodigo(f)))
    expect(sinUsar, `deciden por su cuenta si alguien ficho, en vez de usar haFichado:\n  ${sinUsar.join('\n  ')}`)
      .toEqual([])
  })

  it('nadie vuelve a contar una fila vacia como un fichaje', () => {
    // El bug exacto: contar la existencia de la fila. Con el borrador
    // autoguardandose, eso es contar «abrio la seccion».
    const MES = leerCodigo('src/app/api/diario/mes/route.ts')
    const i = MES.indexOf('personas.push')
    expect(i, 'ya no se agrupan personas por dia: revisa esta regla').toBeGreaterThan(-1)
    const linea = MES.slice(MES.lastIndexOf('\n', i) + 1, MES.indexOf('\n', i))
    expect(/haFichado\(/.test(linea),
      `el calendario vuelve a contar cualquier fila como un fichaje: la racha mentira otra vez — «${linea.trim().slice(0, 80)}»`)
      .toBe(true)
    // Y la columna tiene que viajar, o `haFichado` mira undefined siempre.
    expect(/entrada_at/.test(MES.match(/\.select\('[^']*'\)/)?.[0] || ''),
      'el select de /api/diario/mes no trae entrada_at: haFichado mirara undefined y NADIE contara como fichado')
      .toBe(true)
  })
})

describe('el orden de tareas cambia lo que se ve', () => {
  // Javi: «con estos 2 botones en tareas no pasa nada». Y era verdad, aunque el
  // codigo del orden estaba BIEN: `filtered` se ordenaba por prioridad o por fecha
  // segun el boton, correctamente.
  //
  // Lo que pasaba es que en la pestana «Todas» la lista no se pinta en plano: se
  // reparte en ATRASADAS / HOY / PROXIMAS / SIN FECHA. Esos cuatro cajones SON una
  // ordenacion por fecha, asi que se comian cualquier otra — una tarea urgente para
  // el mes que viene seguia cayendo en PROXIMAS, debajo de todo.
  //
  // Es un modo de fallo que no da error y que ademas ENGANA al que lee el codigo:
  // el orden se calcula, el estado se guarda, el boton se ilumina. Todo funciona
  // menos lo unico que importa.
  const UI = leerCodigo('src/components/sections/TareasSection.tsx')

  it('el agrupado por fecha se apaga al ordenar por prioridad', () => {
    const i = UI.indexOf('const grouped = useMemo(')
    expect(i, 'ya no se agrupan las tareas: revisa esta regla en vez de borrarla').toBeGreaterThan(-1)
    const cuerpo = UI.slice(i, i + 1200)
    expect(/if \(taskSort==='prioridad'\) return null/.test(cuerpo),
      'el agrupado por fecha vuelve a mandar siempre: el boton de prioridad se ilumina y no cambia nada de lo que se ve')
      .toBe(true)
  })

  it('el memo del agrupado depende del orden elegido', () => {
    // Sin `taskSort` en las dependencias, React devuelve el agrupado anterior y el
    // boton vuelve a no hacer nada — con el codigo de arriba correcto.
    const i = UI.indexOf('const grouped = useMemo(')
    const cierre = UI.indexOf('}, [', i)
    const deps = UI.slice(cierre, UI.indexOf(']', cierre) + 1)
    expect(/taskSort/.test(deps),
      `el memo del agrupado no depende de taskSort: se quedara cacheado y el boton no hara nada — deps: ${deps.trim()}`)
      .toBe(true)
  })

  it('los dos botones existen y llevan estados distintos', () => {
    const i = UI.indexOf("id:'prioridad'")
    expect(i, 'ya no existe el selector de orden').toBeGreaterThan(-1)
    const bloque = UI.slice(i, i + 400)
    expect(/id:'fecha'/.test(bloque), 'falta la opcion de fecha').toBe(true)
    expect(/setTaskSort\(s\.id\)/.test(UI), 'los botones ya no cambian el orden').toBe(true)
  })
})

describe('el calendario escribe en la cuenta de la que salio el evento', () => {
  // La mitad que faltaba del arreglo de hoy: la LECTURA paso a unir todas las
  // cuentas personales, y la ESCRITURA se quedo usando una sola. Un evento de la
  // segunda cuenta se borraba con el token de la primera — Google contesta que ese
  // evento no existe y el usuario ve «Error eliminando evento» sin ninguna pista.
  //
  // Hoy no muerde y por eso hacia falta comprobarlo de verdad, no leerlo: en la
  // segunda cuenta de Javi solo hay calendarios de festivos, que son de SOLO
  // LECTURA y la UI ya les esconde editar y borrar. Muerde el dia que alguien
  // tenga eventos propios en dos cuentas — o sea, en cuanto el equipo conecte.
  const GET = leerCodigo('src/app/api/calendar/events/route.ts')
  const ESCRIBE = leerCodigo('src/app/api/calendar/events/[id]/route.ts')
  const UI = leerCodigo('src/components/sections/CalendarioSection.tsx')

  it('cada evento se lleva la cuenta de la que vino', () => {
    expect(/cuenta: personales\[i\]\.email/.test(GET),
      'los eventos vuelven a salir sin decir de que cuenta son: la escritura no podra saber que token usar')
      .toBe(true)
  })

  it('borrar y editar resuelven el token POR esa cuenta', () => {
    // La firma obliga: `tokenDeAgenda(userId)` a secas no compila. Es lo que evita
    // que alguien anada un tercer sitio y se olvide.
    expect(/async function tokenDeAgenda\(userId: string, cuenta: string \| null\)/.test(ESCRIBE),
      'tokenDeAgenda vuelve a no pedir la cuenta: se podra escribir en la agenda equivocada sin que TypeScript avise')
      .toBe(true)
    const usos = [...ESCRIBE.matchAll(/tokenDeAgenda\(([^)]*)\)/g)].map(m => m[1])
    const sinCuenta = usos.filter(u => !u.includes(','))
    expect(sinCuenta, `hay llamadas a tokenDeAgenda sin cuenta:\n  ${sinCuenta.join('\n  ')}`).toEqual([])
  })

  it('el PATCH lee el cuerpo ANTES de resolver el token', () => {
    // La cuenta viaja en el cuerpo. Resolver el token antes de leerlo es
    // exactamente el orden que devolvia a la agenda equivocada, y compila igual.
    const iCuerpo = ESCRIBE.indexOf('await request.json()')
    const iToken = ESCRIBE.indexOf('tokenDeAgenda(user.id, typeof cuenta')
    expect(iCuerpo, 'el PATCH ya no lee el cuerpo: revisa esta regla').toBeGreaterThan(-1)
    expect(iToken, 'el PATCH ya no resuelve el token por cuenta').toBeGreaterThan(-1)
    expect(iCuerpo < iToken,
      'el PATCH resuelve el token antes de leer la cuenta del cuerpo: volvera a escribir en la agenda equivocada')
      .toBe(true)
  })

  it('la pantalla manda la cuenta en las dos operaciones', () => {
    expect(/cuenta=\$\{encodeURIComponent\(cuenta \|\| ''\)\}/.test(UI),
      'al borrar ya no se manda la cuenta: el servidor no sabra que token usar')
      .toBe(true)
    expect(/cuenta: editEvent\.cuenta/.test(UI),
      'al editar ya no se manda la cuenta')
      .toBe(true)
  })
})

describe('lo que se rompe queda anotado', () => {
  // Javi: «estaria bien que se anotasen en algun lado para notificartelos... que yo
  // te dijese "hay algun error detectado" y sacases los errores detectados».
  //
  // Sale del hallazgo de fondo de la auditoria de Gmail: lo que falla en esta app
  // NO DA ERROR A NADIE. Un buzon cuyo token revoca Google deja de traer correo, el
  // cron responde 200, el latido se pinta verde, y la unica traza es un
  // `console.error` que dura lo que dure la retencion de logs de Vercel. Si nadie
  // mira ese dia, el fallo no existio. Paso de verdad el 2026-08-13.
  const ERR = leerCodigo('src/lib/errores.ts')
  const SYNC = leerCodigo('src/lib/colabsSync.ts')

  it('los fallos mudos del sync se anotan, no solo se imprimen', () => {
    // Los tres que encontro la auditoria. Cada uno deja de traer correo sin que
    // nadie lo note, y los tres se veian igual desde fuera: verde.
    for (const clave of ['gmail:auth_rota', 'gmail:sync_caido', 'gmail:cuentas_ilegibles']) {
      expect(SYNC.includes(clave),
        `el sync ya no anota «${clave}»: ese fallo vuelve a ser invisible — el correo deja de entrar y el latido sigue verde`)
        .toBe(true)
    }
    // Y el console.error se CONSERVA: no se cambia un camino que funciona por otro
    // sin haberlo probado.
    expect(/console\.error/.test(ERR),
      'anotarError dejo de imprimir: si la tabla falla, el fallo no queda en ningun sitio')
      .toBe(true)
  })

  it('anotar un error no puede romper lo que estaba pasando', () => {
    // Es lo que separa un registro util de una bomba: si escribir el error lanza,
    // se lleva por delante el sync entero — y por un fallo tendriamos dos.
    const i = ERR.indexOf('export async function anotarError')
    expect(i, 'ya no existe anotarError: revisa esta regla en vez de borrarla').toBeGreaterThan(-1)
    const cuerpo = ERR.slice(i)
    expect(/try \{/.test(cuerpo) && /catch \(err\)/.test(cuerpo),
      'anotarError puede lanzar: un fallo al anotar tumbaria el proceso que lo estaba reportando')
      .toBe(true)
    expect(/Promise<void>/.test(cuerpo),
      'anotarError devuelve algo: quien lo llame se vera tentado de ramificar sobre si se pudo anotar, que no es asunto suyo')
      .toBe(true)
  })

  it('el registro no guarda secretos', () => {
    // Un sitio donde queda escrito lo que falla es lo ultimo que deberia acabar
    // siendo un sitio donde mirar tokens.
    expect(/token\|secret\|password/.test(ERR) || /SECRETO/.test(ERR),
      'el contexto de los errores ya no se filtra: un refresh_token puede acabar guardado en claro')
      .toBe(true)
    const i = ERR.indexOf('function limpiar')
    expect(i, 'ya no existe el filtro del contexto').toBeGreaterThan(-1)
    expect(/\[omitido\]/.test(ERR.slice(i, i + 500)),
      'el filtro ya no sustituye los valores sensibles')
      .toBe(true)
  })

  it('un error que vuelve se REABRE', () => {
    // Es la senal mas valiosa del registro: significa que el arreglo no era. Con
    // una marca de resuelto pegajosa se perderia justo eso.
    const i = ERR.indexOf('.update({')
    expect(i, 'anotarError ya no actualiza: revisa esta regla').toBeGreaterThan(-1)
    expect(/resuelto_at: null/.test(ERR.slice(i, i + 700)),
      'un error que vuelve a pasar se queda marcado como resuelto: se pierde la senal de que el arreglo no funciono')
      .toBe(true)
  })

  it('los abiertos no caducan; solo se purgan los resueltos', () => {
    const CRON = leerCodigo('src/app/api/cron/sync-colabs/route.ts')
    const i = CRON.indexOf("from('errores')")
    expect(i, 'ya no se purgan los errores: la tabla crecera para siempre').toBeGreaterThan(-1)
    const bloque = CRON.slice(i, i + 300)
    expect(/not\('resuelto_at', 'is', null\)/.test(bloque),
      'la purga borra tambien los errores ABIERTOS: uno que lleva tres meses pasando es justo el que hay que ver')
      .toBe(true)
  })
})

describe('cada cosa usa el token de SU buzon, no el de la ultima conexion', () => {
  // `profiles.gmail_refresh_token` y `gmail_account` son UNA RANURA que el callback
  // pisa en cada conexion personal. Mientras hubo una sola cuenta por persona eso
  // era «tu Gmail»; desde que `gmail_cuentas` permite varias, significa «la ultima
  // que tocaste», que no es nada. Y nada dio error:
  //
  //   · el CALENDARIO de Javi era el de su segunda cuenta. Sin hueco y sin aviso:
  //     una agenda entera que era la de otro buzon.
  //   · los ADJUNTOS de sus 749 correos se pedian con el token del otro buzon.
  //     Gmail no encuentra ese identificador ahi y contesta un error generico, asi
  //     que parecia un problema de red.
  //   · «ABRIR EN GMAIL», lo mismo.
  //   · y al quitar una cuenta se vaciaban las columnas viejas aunque quedara otra,
  //     con lo que la app decia «sin Gmail» mientras el sync seguia trayendo correo.
  //
  // La regla no prohibe la columna vieja —sigue siendo el respaldo mientras exista—
  // sino usarla COMO SI FUERA la cuenta de algo concreto.
  const RUTAS = [
    'src/app/api/inbox/attachment/route.ts',
    'src/app/api/inbox/gmail-open/route.ts',
    'src/app/api/calendar/events/route.ts',
    'src/app/api/calendar/events/[id]/route.ts',
  ]

  it('ninguna ruta pasa la ranura vieja como token a una llamada de Google', () => {
    const malos: string[] = []
    for (const f of RUTAS) {
      const src = leerCodigo(f)
      for (const m of src.matchAll(/\b(getCalendarEvents|createCalendarEvent|updateCalendarEvent|deleteCalendarEvent|getAttachment|getEmailsWithRefreshToken)\(([^,)]*)/g)) {
        if (/gmail_refresh_token/.test(m[2])) malos.push(`${f}: ${m[0].slice(0, 70)}`)
      }
      // Y el token del correo se resuelve por su buzon, no por el perfil.
      if (/inbox\//.test(f)) {
        expect(/tokenParaCorreo\(/.test(src),
          `${f} no resuelve el token por el buzon del correo: los adjuntos de una de las cuentas seguiran rotos`)
          .toBe(true)
        expect(/\.select\('shared, cuenta'\)/.test(src),
          `${f} no pide la columna «cuenta»: no puede saber de que buzon vino el correo`)
          .toBe(true)
      }
    }
    expect(malos, `se vuelve a llamar a Google con «la ultima cuenta conectada» en vez de con la del buzon:\n  ${malos.join('\n  ')}`)
      .toEqual([])
  })

  it('el calendario mira TODAS las cuentas personales, no una', () => {
    const src = leerCodigo('src/app/api/calendar/events/route.ts')
    expect(/personalesDe\(admin, user\.id\)/.test(src),
      'el calendario vuelve a mirar una sola cuenta: la agenda de la otra desaparece sin decir nada')
      .toBe(true)
    // En paralelo, no en serie: es una de las rutas mas lentas del arranque.
    expect(/Promise\.allSettled\(/.test(src),
      'las cuentas del calendario se piden en serie: con dos, la ruta tarda el doble — y una que falle se lleva a las demas')
      .toBe(true)
  })

  it('quitar una cuenta no deja «sin Gmail» a quien conserva otra', () => {
    const src = leerCodigo('src/lib/gmailCuentas.ts')
    const i = src.indexOf("perfil?.gmail_account?.toLowerCase().trim() === correo")
    expect(i, 'ya no se limpian las columnas viejas al quitar una cuenta: revisa esta regla').toBeGreaterThan(-1)
    const bloque = src.slice(i, i + 900)
    expect(/const otra = \(await cuentasDe\(admin, profileId\)\)\.find\(c => !c\.compartida\)/.test(bloque),
      'al quitar una cuenta se vacian las columnas viejas sin mirar si queda otra: la app dira «sin Gmail» mientras sigue entrando correo')
      .toBe(true)
  })
})

describe('la puesta en marcha no puede dejar a nadie fuera', () => {
  // ESTA PANTALLA ES LA UNICA QUE SE INTERPONE ENTRE ALGUIEN Y SU HERRAMIENTA DE
  // TRABAJO. Si falla, no falla una seccion: falla el acceso. Y no vive dentro de
  // ningun SectionErrorBoundary, asi que un error de render sube a global-error.
  //
  // Las dos reglas de aqui nacen de DOS REGRESIONES REALES metidas el mismo dia,
  // las dos por escribir a mano un numero que ya no era el que era:
  //
  //   1. Al quitar el paso de contrasena, PASOS paso de 7 a 6. Quien hubiera
  //      llegado a «Listo» sin pulsar ENTRAR tenia un 6 guardado en localStorage,
  //      y `PASOS[6].toUpperCase()` lanza. Como el valor persiste, pasaba en CADA
  //      carga: app inaccesible sin abrir la consola del navegador.
  //   2. El boton CONECTAR GMAIL guardaba el literal '4' para volver a su paso.
  //      Era correcto cuando Gmail era el 4; tras renumerar es el 3, asi que
  //      volver de Google te dejaba en AVISOS sin ver nunca «Ya esta conectado».
  //      Y el gemelo de al lado —el boton nuevo— si estaba bien: mismo valor
  //      escrito dos veces, arreglado en una copia y vivo en la otra.
  const P = leerCodigo('src/components/PuestaEnMarcha.tsx')

  it('el paso que se restaura se acota al ultimo que existe', () => {
    const i = P.indexOf('localStorage.getItem(CLAVE_PASO)')
    expect(i, 'ya no se restaura el paso: revisa esta regla en vez de borrarla').toBeGreaterThan(-1)
    const bloque = P.slice(i, i + 700)
    expect(/Math\.min\(guardado, PASOS\.length - 1\)/.test(bloque),
      'el paso guardado se restaura sin tope: un numero que ya no existe revienta el render en cada carga y deja la app inaccesible')
      .toBe(true)
  })

  it('nadie escribe a mano el numero de un paso', () => {
    // La unica fuente del numero es `irA`, que hace setPaso y localStorage a la
    // vez. Un literal es un valor que hay que acordarse de cambiar al reordenar,
    // y ya se demostro que no nos acordamos.
    const literales = [...P.matchAll(/setItem\(CLAVE_PASO,\s*'(\d+)'\)/g)].map(m => m[0])
    expect(literales, `se vuelve a escribir a mano el numero del paso — al reordenar la lista quedara apuntando al sitio equivocado:\n  ${literales.join('\n  ')}`)
      .toEqual([])
  })

  it('PASOS vive fuera del componente, para poder acotarlo antes de pintar', () => {
    expect(/^const PASOS = \[/m.test(P),
      'PASOS vuelve dentro del componente: el efecto que restaura el paso no lo ve y no puede acotarlo')
      .toBe(true)
  })
})

describe('la contrasena no se pide en la bienvenida', () => {
  // Javi: «este paso, quitalo porque ya lo has hecho al principio, cuando paso el
  // enlace». Tiene razon: el camino normal es el enlace de invitacion, y ahi la
  // contrasena se pone en esa misma pantalla treinta segundos antes. Pedirla otra
  // vez en la primera pantalla de la app —y encima diciendo «por si te la dio otra
  // persona»— es explicar un motivo que no existe.
  //
  // Habia un apano: `nx_clave_elegida` en localStorage cambiaba el TEXTO segun si
  // la habias puesto. Pero el paso salia igual, y la marca solo existia si habias
  // pasado por /reset-password en ESE navegador — con otro movil o una pestana
  // privada volvia a decirte lo que no era.
  //
  // Las tres reglas que habia aqui defendian ese paso: que dijera la verdad segun
  // como hubieras entrado, que fuera opcional en las dos versiones, y que se
  // pudiera seguir sin escribir nada. Al quitarlo dejan de tener sentido, y esta
  // las sustituye — no se borran reglas sin poner lo que protege la decision nueva.
  const P = leerCodigo('src/components/PuestaEnMarcha.tsx')

  it('la puesta en marcha no vuelve a pedir la contrasena', () => {
    expect(/change-password/.test(P),
      'la bienvenida vuelve a pedir la contrasena: quien entra por el enlace ya la ha puesto')
      .toBe(false)
    const pasos = P.match(/const PASOS = \[[^\]]*\]/)?.[0] || ''
    expect(pasos, 'ya no existe la lista de PASOS: revisa esta regla en vez de borrarla').toBeTruthy()
    expect(/Contrase/i.test(pasos), 'vuelve a haber un paso de contrasena en la bienvenida')
      .toBe(false)
  })

  it('pero cambiarla sigue siendo posible, en Ajustes', () => {
    // Quitar el paso solo vale si el camino sigue existiendo donde se busca. Quien
    // entro con una clave temporal tiene que poder cambiarla.
    expect(/change-password/.test(leerCodigo('src/components/sections/AjustesSection.tsx')),
      'se quito el paso de la bienvenida Y tambien el de Ajustes: nadie puede cambiar su contrasena desde la app')
      .toBe(true)
  })

  it('el paso de Gmail ensena TODAS las cuentas, no la columna vieja', () => {
    // Javi: «me pone que estoy conectado a este correo, pero en verdad estoy
    // conectado a dos». Leia `profile.gmail_account`, la columna de UNA direccion
    // de antes de `gmail_cuentas`.
    const i = P.indexOf('gmail_connected')
    expect(i, 'ya no hay paso de Gmail: revisa esta regla').toBeGreaterThan(-1)
    expect(/fetch\('\/api\/gmail\/cuentas'\)/.test(P),
      'la bienvenida vuelve a sacar la cuenta del perfil: con dos conectadas ensenara solo una')
      .toBe(true)
    expect(/buzones\.map|buzones && buzones\.length/.test(P),
      'no se recorren los buzones: se seguira ensenando una sola direccion')
      .toBe(true)
  })
})

describe('la memoria llega entera a las dos IAs', () => {
  // Javi: «quiero asegurarme de que Memoria es la base de datos y el cerebro de
  // Brutal.IA, y de que la IA lo usa como contexto... si no existe ese contexto,
  // crear un contexto resumido».
  //
  // Estaba conectada a las dos, pero con tres agujeros, y ninguno daba error:
  //
  //   1. `/api/chat` traia la memoria con `.limit(120)` por fecha. Cada PDF subido
  //      entra como una nota, asi que al pasar de 120 filas las decisiones CURADAS
  //      caian fuera ANTES de que `memoriaRelevante` pudiera salvarlas — el mismo
  //      bug que esa funcion existe para evitar, reintroducido en SQL.
  //   2. El orbe de Hoy elegia memoria SIN la pregunta, asi que devolvia siempre
  //      las mismas notas preguntaras lo que preguntaras. Harvey ya lo hacia bien:
  //      era su gemelo.
  //   3. Nada garantizaba una base: `memoriaRelevante` solo trae lo que CASA con
  //      la pregunta. «¿Como trabajamos con los clientes?» no casa con nada.
  //
  // La ficha del estudio cierra el 3, y va desde el SERVIDOR en las dos rutas: el
  // contexto de Harvey lo arma el cliente, asi que si dejara de mandarlo Harvey se
  // quedaria sin memoria y solo se notaria en que contesta peor.
  const CHAT = leerCodigo('src/app/api/chat/route.ts')
  const HARVEY = leerCodigo('src/app/api/harvey/chat/route.ts')
  const HOY = leerCodigo('src/components/sections/HoySection.tsx')
  const FICHA = leerCodigo('src/lib/fichaEstudio.ts')

  it('nadie vuelve a recortar la memoria por fecha en una sola consulta', () => {
    const i = CHAT.indexOf("from('memoria')")
    expect(i, 'ya no se consulta memoria en /api/chat: revisa esta regla en vez de borrarla').toBeGreaterThan(-1)
    // Lo curado y los documentos van por separado. Con una sola consulta limitada,
    // los documentos desplazan a las decisiones y nadie se entera.
    const consultas = [...CHAT.matchAll(/from\('memoria'\)[^\n]*/g)].map(m => m[0])
    expect(consultas.length, 'la memoria vuelve a traerse en UNA sola consulta: los documentos desplazaran a lo curado')
      .toBeGreaterThanOrEqual(2)
    expect(consultas.some(c => /not\('category', 'ilike', 'documento'\)/.test(c)),
      'ninguna consulta protege lo curado de los documentos')
      .toBe(true)
  })

  it('las dos IAs reciben la ficha, y desde el servidor', () => {
    for (const [nombre, src] of [['api/chat', CHAT], ['api/harvey/chat', HARVEY]] as const) {
      expect(/leerFicha\(admin\)/.test(src),
        `${nombre} no lee la ficha del estudio en el servidor: la IA se queda sin base cuando la pregunta no casa con ninguna nota`)
        .toBe(true)
    }
    expect(/FICHA DEL ESTUDIO/.test(leerCodigo('src/lib/ai.ts')),
      'el prompt de Brutal.IA ya no incluye la ficha')
      .toBe(true)
    expect(/FICHA DEL ESTUDIO/.test(HARVEY),
      'el prompt de Harvey ya no incluye la ficha')
      .toBe(true)
  })

  it('la pregunta llega hasta quien elige la memoria', () => {
    // Antes esto exigia que CADA pantalla llamara a `memoriaRelevante` con la
    // pregunta. Ahora las dos delegan en `contextoHarvey`, asi que la cadena tiene
    // tres eslabones y el invariante es que la pregunta los cruce enteros: si se
    // pierde en cualquiera, `memoriaRelevante` no puede emparejar nada y devuelve
    // siempre las mismas notas, preguntes lo que preguntes.
    const C = leerCodigo('src/lib/contextoHarvey.ts')
    expect(/export function construirContexto\(data: DatosContexto, pregunta\?: string\)/.test(C),
      'el constructor de contexto ya no recibe la pregunta')
      .toBe(true)
    expect(/memoriaRelevante\(\(data\.memoria \|\| \[\]\) as never, pregunta\)/.test(C),
      'el constructor no le pasa la pregunta a memoriaRelevante: devolvera siempre las mismas notas')
      .toBe(true)

    for (const f of ['HoySection', 'HarveySection']) {
      const src = leerCodigo(`src/components/sections/${f}.tsx`)
      const usos = [...src.matchAll(/construirContexto\(([^)]*)\)/g)].map(m => m[1])
      expect(usos.length, `${f} ya no construye contexto: revisa esta regla en vez de borrarla`)
        .toBeGreaterThan(0)
      const sinPregunta = usos.filter(u => !u.includes(','))
      expect(sinPregunta, `${f} construye el contexto sin pasar la pregunta:\n  ${sinPregunta.join('\n  ')}`)
        .toEqual([])
    }
  })

  it('el envoltorio de Harvey reenvia la pregunta, no se la come', () => {
    // Sin esto, la regla de arriba pasa en verde mientras el envoltorio ignora su
    // parametro: las llamadas se verian bien y la seleccion seria la de siempre.
    const H = leerCodigo('src/components/sections/HarveySection.tsx')
    expect(/const memoriaRelevante = \(pregunta\?: string\) => elegirMemoria\([^)]*, pregunta\)/.test(H),
      'el envoltorio de HarveySection ya no le pasa la pregunta a elegirMemoria')
      .toBe(true)
  })

  it('si el modelo falla, la ficha vieja se queda: nunca se escribe una vacia', () => {
    // Una ficha vacia se lee como «el estudio no tiene nada guardado», que es
    // mentira y es peor que una desactualizada.
    const i = FICHA.indexOf('export async function regenerarFicha')
    expect(i, 'ya no existe regenerarFicha').toBeGreaterThan(-1)
    const cuerpo = FICHA.slice(i)
    // Todo camino de fallo sale con ok:false ANTES del upsert.
    const upsert = cuerpo.indexOf('.upsert(')
    expect(upsert, 'regenerarFicha ya no escribe').toBeGreaterThan(-1)
    const antes = cuerpo.slice(0, upsert)
    for (const salida of ['motivo: \'lectura\'', 'motivo: \'modelo\'', 'motivo: \'vacia\'']) {
      expect(antes.includes(salida),
        `regenerarFicha ya no sale por «${salida}» antes de escribir: podria guardar una ficha vacia encima de una buena`)
        .toBe(true)
    }
  })
})

describe('las plantillas de automatizacion no se esconden al usar una', () => {
  // Javi: «cuando seleccionas una y le das a usar, ya no te aparecen como ejemplo
  // para poder anadirlas. Quiero que sigan apareciendo».
  //
  // Estaban dentro de `{data.reglas.length===0 && …}`: al crear la PRIMERA regla
  // desaparecian las once. Y son el catalogo de lo que la app sabe vigilar —
  // esconderlas justo al usar la primera deja al equipo sin saber que mas se puede
  // hacer, en el momento en que acaba de descubrir que la seccion sirve.
  const UI = leerCodigo('src/components/sections/AutomatizacionesSection.tsx')

  it('el catalogo se pinta siempre, no solo cuando no hay reglas', () => {
    const i = UI.indexOf('PLANTILLAS.map(')
    expect(i, 'ya no se pintan las plantillas: revisa esta regla en vez de borrarla').toBeGreaterThan(-1)
    // Lo que hay POR ENCIMA del map, dentro del bloque que lo envuelve, no puede
    // condicionar su existencia al numero de reglas.
    const antes = UI.slice(Math.max(0, i - 600), i)
    expect(/reglas\.length===0\s*&&/.test(antes),
      'las plantillas vuelven a esconderse en cuanto hay una regla: el catalogo desaparece justo al empezar a usarlo')
      .toBe(false)
  })

  it('el catalogo vive fuera del componente, para poder contarlo', () => {
    // Estaba escrito a mano dentro del JSX. Fuera se puede leer, contar y —lo que
    // importa aqui— comprobar que no se ha quedado a medias.
    expect(/^const PLANTILLAS = \[/m.test(UI),
      'las plantillas vuelven a estar incrustadas en el JSX')
      .toBe(true)
    const ini = UI.indexOf('const PLANTILLAS = [')
    const bloque = UI.slice(ini, UI.indexOf('\n]', ini))
    const cuantas = [...bloque.matchAll(/\{name:'/g)].length
    expect(cuantas, `el catalogo se ha quedado en ${cuantas} plantillas: alguna edicion se comio la lista`)
      .toBeGreaterThanOrEqual(8)
  })

  it('la que ya se usa se ve, pero no se puede duplicar', () => {
    // Dos reglas iguales avisan dos veces, y a la tercera nadie lee los avisos.
    expect(/enUso\.has\(tpl\.name\)/.test(UI),
      'ya no se distingue la plantilla que esta en uso: se puede anadir dos veces y avisara doble')
      .toBe(true)
    expect(/const enUso = new Set\(data\.reglas\.map/.test(UI),
      'el conjunto de plantillas en uso ya no sale de las reglas reales')
      .toBe(true)
  })
})

describe('un cliente es uno de la tabla, no lo que escriba el modelo', () => {
  // Javi: «en el inbox los clientes los revisa mal, saca clientes de donde no
  // son». Tenia 57 de 100 correos marcados como cliente — Amazon, AliExpress,
  // Facebook, idealista, Hostinger. El prompt de `analyzeEmail` solo pide «nombre
  // del cliente si se identifica», y el modelo identifica EMPRESAS, que no es lo
  // mismo que un cliente de Brutal Studios.
  //
  // Por que se cuela: `ai_client` se guarda crudo porque su columna NO tiene
  // CHECK, al reves que su vecina `ai_urgency`, que si lo tiene — y por eso esa se
  // normaliza en la frontera con `nivelTarea`. Sin CHECK nada rebota: el dato
  // falso entra y la pantalla lo cuenta como bueno. Es la version silenciosa de la
  // trampa que CLAUDE.md ya documenta.
  //
  // La regla NO pide validar al guardar —lo que el modelo creyo ver es informacion
  // util para pintar el nombre— sino al CONTAR y al FILTRAR, que es donde una
  // cadena inventada se convierte en una cifra falsa.
  const UI = leerCodigo('src/components/sections/InboxSection.tsx')

  it('el filtro y el contador de Clientes se validan contra la tabla clients', () => {
    // Acotado a CONTAR y FILTRAR. La primera version prohibia la comparacion con
    // «Desconocido» en todo el fichero, y eso tumbaba dos sitios legitimos: los que
    // PINTAN el nombre que el modelo creyo ver, que es informacion util. Contar y
    // pintar no son lo mismo — una cadena inventada como rotulo se lee y se
    // descarta; como cifra, se cree.
    const contador = UI.match(/const fromClients = [^\n]*/)?.[0] || ''
    expect(contador, 'ya no existe fromClients: revisa esta regla en vez de borrarla').toBeTruthy()
    expect(/esDeCliente/.test(contador),
      `el contador de Clientes vuelve a contar lo que diga el modelo: ${contador.slice(0, 90)}`)
      .toBe(true)

    const filtro = UI.match(/if \(filter==='Clientes'\) return [^\n]*/)?.[0] || ''
    expect(filtro, 'ya no existe el filtro Clientes: revisa esta regla').toBeTruthy()
    expect(/esDeCliente/.test(filtro),
      `el filtro de Clientes vuelve a filtrar por lo que diga el modelo: ${filtro.slice(0, 90)}`)
      .toBe(true)
    expect(/const esDeCliente = [^\n]*matchClientByName\(data\.clients/.test(UI),
      'el predicado de cliente ya no empareja contra data.clients: cualquier cadena del modelo volvera a contar')
      .toBe(true)
  })

  it('el emparejador que ya existia se usa, en vez de escribir otro', () => {
    // Habia TRES implementaciones del mismo predicado en la app (dos en Clientes,
    // una aqui) y ninguna compartida. La cuarta no ayuda.
    const i = UI.indexOf('const esDeCliente')
    expect(i, 'ya no existe esDeCliente: revisa esta regla en vez de borrarla').toBeGreaterThan(-1)
    const cuerpo = UI.slice(i, UI.indexOf('\n', i))
    expect(/matchClientByName/.test(cuerpo),
      'esDeCliente dejo de usar matchClientByName y hace su propia comparacion')
      .toBe(true)
  })

  it('crear una tarea desde un correo con el teclado pide confirmacion', () => {
    // Javi vio una tarea que no recordaba haber escrito. La `t` la creaba de una
    // sola pulsacion, sin confirmar y sin deshacer — y esta pegada a `j`/`k`, que
    // son las de pasar correos.
    const i = UI.indexOf("e.key === 't'")
    expect(i, 'ya no existe el atajo de crear tarea: revisa esta regla').toBeGreaterThan(-1)
    const bloque = UI.slice(i, i + 900)
    expect(/confirmarTarea/.test(bloque),
      'la tecla `t` vuelve a crear la tarea de una sola pulsacion: apareceran tareas que nadie recuerda haber escrito')
      .toBe(true)
  })
})

describe('un boton que falla dice POR QUE', () => {
  // PASO DE VERDAD, y costo un diagnostico entero. Javi pulso IDENTIFICAR mientras
  // Vercel todavia desplegaba: la ruta no existia aun, devolvio 404, y el `catch`
  // de la pantalla lo convirtio en «no se pudieron identificar». Con ese mensaje,
  // un despliegue a medias es indistinguible de un fallo real — y Javi dio por
  // hecho que ya estaba hecho, que es lo peor de todo.
  //
  // La regla no exige un texto concreto: exige que la respuesta del servidor SE
  // MIRE. Tragarse el `status` es lo que convierte un problema de dos minutos en
  // media hora de diagnostico.
  const UI = leerCodigo('src/components/sections/SincronizacionSection.tsx')

  it('la llamada a identificar distingue los fallos por su codigo', () => {
    const i = UI.indexOf("fetch('/api/inbox/identificar'")
    expect(i, 'ya no se llama a identificar: revisa esta regla en vez de borrarla').toBeGreaterThan(-1)
    const bloque = UI.slice(i, i + 1400)
    expect(/r\.status === 404/.test(bloque),
      'un 404 vuelve a caer en el mensaje generico: un despliegue a medias parecera un fallo de verdad')
      .toBe(true)
    expect(/error \$\{r\.status\}|\$\{r\.status\}/.test(bloque),
      'el codigo de error no llega al usuario: no habra forma de saber que fallo')
      .toBe(true)
  })

  it('al identificar se refrescan los recuentos, no solo el aviso', () => {
    // Sin esto la pantalla dice «753 correos identificados» y sigue enseñando los
    // buzones a cero: el mensaje y lo que se ve se contradicen.
    const i = UI.indexOf("fetch('/api/inbox/identificar'")
    const bloque = UI.slice(i, i + 1400)
    expect(/cargarCuentas\(\)/.test(bloque),
      'no se vuelven a pedir las cuentas tras identificar: los recuentos se quedan como estaban')
      .toBe(true)
  })
})

describe('identificar correos viejos no adivina de que buzon vienen', () => {
  // La migracion 20260824 dejo 754 de 809 correos sin atribuir, y eso fue A
  // PROPOSITO: quien tiene dos cuentas personales no puede saber cual fue sin
  // preguntar. Una etiqueta equivocada es peor que un hueco — el hueco se ve.
  //
  // Esta ruta lo resuelve de la unica forma exacta: un `gmail_id` pertenece al
  // buzon que lo devuelve en su lista. Lo que la regla protege es que siga siendo
  // exacta y que no pueda tocar lo que ya estaba bien.
  const RUTA = 'src/app/api/inbox/identificar/route.ts'
  const src = leerCodigo(RUTA)

  it('solo toca lo que sigue SIN identificar, nunca lo ya atribuido', () => {
    // Sin `.is('cuenta', null)` en el UPDATE, una segunda pasada podria reescribir
    // un buzon correcto con otro — y no habria forma de notarlo.
    const i = src.indexOf('.update(')
    expect(i, 'ya no se actualiza nada: revisa esta regla en vez de borrarla').toBeGreaterThan(-1)
    const bloque = src.slice(i, i + 340)
    expect(/\.is\('cuenta', null\)/.test(bloque),
      'el UPDATE ya no se limita a los que estan sin identificar: puede pisar una atribucion correcta')
      .toBe(true)
    expect(/\.eq\('user_id', user\.id\)/.test(bloque),
      'el UPDATE no se limita al usuario de la sesion: podria tocar el correo de otro')
      .toBe(true)
  })

  it('las cuentas salen de la sesion, no de lo que pida el cliente', () => {
    expect(/cuentasDe\(admin, user\.id\)/.test(src),
      'las cuentas ya no salen de la sesion: se podria pedir que se recorra el buzon de otro')
      .toBe(true)
    expect(/auth\.getUser\(\)/.test(src), 'no se resuelve al usuario antes de usar el admin client')
      .toBe(true)
  })

  it('una cuenta que falla no tumba a las demas, y se dice cual', () => {
    // Con un token caducado de una de las dos, sin esto la mitad se quedaria sin
    // identificar y la respuesta diria que todo fue bien.
    // La LLAMADA, no el import. Anclar en el nombre a secas cogia la linea del
    // `import` y la ventana caia sobre codigo que no era: la regla pasaba en verde
    // mirando otra cosa. Es la trampa que CLAUDE.md llama «acota la regla al sitio».
    const i = src.indexOf('await listarIdsDeMensajes(')
    expect(i, 'ya no se llama a listarIdsDeMensajes: revisa esta regla').toBeGreaterThan(-1)
    const bloque = src.slice(i, i + 420)
    expect(/catch/.test(bloque) && /continue/.test(bloque),
      'un fallo listando una cuenta corta el proceso entero en vez de seguir con la siguiente')
      .toBe(true)
    expect(/console\.error[^\n]*c\.email/.test(bloque),
      'el fallo de una cuenta no dice CUAL fallo: quedaria invisible')
      .toBe(true)
  })

  it('el recorrido del buzon esta acotado', () => {
    // Un buzon de 40.000 correos son 80 paginas. Sin tope, la funcion se cuelga y
    // Vercel la mata sin respuesta — el modo de fallo que CLAUDE.md documenta para
    // los fetch sin `signal`.
    const gmail = leerCodigo('src/lib/gmail.ts')
    const i = gmail.indexOf('export async function listarIdsDeMensajes')
    expect(i, 'ya no existe listarIdsDeMensajes').toBeGreaterThan(-1)
    const cuerpo = gmail.slice(i, i + 1200)
    expect(/maxPaginas/.test(cuerpo), 'el recorrido del buzon ya no tiene tope de paginas')
      .toBe(true)
    expect(/encontrados\.size >= pendientes\.size/.test(cuerpo),
      'ya no se para al resolver todo: pasearia el buzon entero para atribuir cuatro correos')
      .toBe(true)
  })
})

describe('un fallo nunca se convierte en un juicio sobre alguien', () => {
  // El panel de equipo y el texto de la IA hablan del TRABAJO DE PERSONAS REALES, y
  // los lee su jefe. Eso cambia el coste de los modos de fallo mudos que el resto
  // del fichero persigue: aqui una consulta caida que se pinta como «no ha hecho
  // nada» no es un hueco, es una acusacion.
  //
  // Tres sitios donde eso podia pasar, y los tres se cierran a proposito.
  const RUTA = 'src/app/api/equipo/resumen/route.ts'
  const PANEL = 'src/components/sections/PanelEquipo.tsx'
  const AI = leerCodigo('src/lib/ai.ts')

  it('solo el propietario puede pedir el texto de una persona', () => {
    const src = leerCodigo(RUTA)
    expect(/role !== 'owner'/.test(src) && /403/.test(src),
      'cualquiera del equipo puede pedir una valoracion de un companero: eso cambia lo que es la herramienta')
      .toBe(true)
    // Y el rol sale del servidor, no de lo que diga el cliente.
    expect(/getAuthCtx\(\)/.test(src), 'el rol no se resuelve en el servidor con getAuthCtx')
      .toBe(true)
  })

  it('si la IA falla, la ruta lo DICE en vez de devolver un texto vacio con 200', () => {
    // Un 200 con texto vacio se pinta como «no hay nada que contar», que es una
    // respuesta legitima y distinta. La pantalla tiene que poder separarlas.
    const src = leerCodigo(RUTA)
    expect(/degraded/.test(src) && /503/.test(src),
      'un fallo de la IA se devuelve como respuesta buena: la pantalla dira que no hay nada que contar')
      .toBe(true)
  })

  it('comoVaLaPersona no inventa un texto cuando la llamada se cae', () => {
    const i = AI.indexOf('export async function comoVaLaPersona')
    expect(i, 'ya no existe comoVaLaPersona: revisa esta regla en vez de borrarla').toBeGreaterThan(-1)
    const cuerpo = AI.slice(i, i + 4200)
    const catchs = [...cuerpo.matchAll(/catch[^{]*\{([^}]*)\}/g)].map(m => m[1])
    expect(catchs.length, 'la llamada al modelo ya no tiene catch').toBeGreaterThan(0)
    for (const c of catchs) {
      expect(/degraded: true/.test(c),
        'el catch de comoVaLaPersona devuelve algo que NO es `degraded`: seria un juicio que nadie ha escrito')
        .toBe(true)
    }
  })

  it('el panel distingue «no se pudo leer» de «nadie ficho»', () => {
    // Sin esto, una consulta caida pinta seis filas vacias y parece que el equipo
    // no ha trabajado. Es el mismo fallo que `logQueryErrors` persigue en el
    // servidor, pero con consecuencias sobre personas.
    const src = leerCodigo(PANEL)
    expect(/setFallo\(true\)/.test(src) && /if \(fallo\)/.test(src),
      'el panel no tiene estado de fallo: una consulta caida se vera igual que un equipo que no ha fichado')
      .toBe(true)
    // Y el mensaje tiene que decirlo con todas las letras, no solo pintar distinto.
    const i = src.indexOf('if (fallo)')
    expect(/No es que nadie/.test(src.slice(i, i + 700)),
      'el aviso de fallo no aclara que NO es que nadie haya fichado')
      .toBe(true)
  })
})

describe('los recordatorios de fichar saltan cuando toca', () => {
  // Javi: «a las 8 de la tarde, si no has cerrado el dia y lo has empezado, te
  // tiene que mandar una notificacion... es vital».
  //
  // Un aviso que deja de saltar NO DA ERROR: nadie recibe nada y todo el mundo
  // supone que es que no habia a quien avisar. Es el mismo modo de fallo mudo que
  // el resto del fichero persigue, y aqui es peor porque el sintoma —silencio— es
  // identico al funcionamiento normal.
  const CERRAR = 'src/app/api/cron/recordatorio-cerrar/route.ts'
  const FICHAR = 'src/app/api/cron/recordatorio-fichar/route.ts'
  const VERCEL = JSON.parse(leer('vercel.json')) as { crons: { path: string; schedule: string }[] }

  it('cada recordatorio esta registrado DOS veces, por el cambio de hora', () => {
    // Los crons de Vercel van en UTC y Espana cambia de hora. Con una sola entrada,
    // medio ano el aviso cae a las 19:00 o a las 21:00 de Madrid — o no cae, porque
    // la ruta comprueba `madridHour()` y se descarta a si misma. Con dos, una de las
    // dos acierta siempre y la otra se descarta sola.
    for (const ruta of ['/api/cron/recordatorio-fichar', '/api/cron/recordatorio-cerrar']) {
      const horas = VERCEL.crons.filter(c => c.path === ruta).map(c => c.schedule)
      expect(horas.length, `${ruta} no esta registrado dos veces: media ano saltara a la hora equivocada`)
        .toBe(2)
      // Y tienen que ser dos horas CONSECUTIVAS, no la misma repetida.
      const h = horas.map(x => Number(x.split(' ')[1])).sort((a, b) => a - b)
      expect(h[1] - h[0], `${ruta}: las dos entradas no son horas consecutivas (${horas.join(' y ')})`)
        .toBe(1)
    }
  })

  it('la hora se comprueba en Madrid, no en la del servidor', () => {
    for (const f of [CERRAR, FICHAR]) {
      const src = leerCodigo(f)
      expect(/madridHour\(\)/.test(src), `${f} no usa madridHour(): el servidor va en UTC y el aviso caeria a otra hora`)
        .toBe(true)
      expect(/todayKey\(\)/.test(src), `${f} no usa todayKey(): miraria el dia de UTC, que a partir de las 22:00 de Madrid ya es otro`)
        .toBe(true)
    }
  })

  it('el de las 20:00 exige las DOS condiciones: empezado y sin cerrar', () => {
    // Saltarse una lo convierte en ruido. Sin «empezado», regana por la tarde a
    // quien ya recibio el aviso de las 10:00; sin «sin cerrar», avisa a quien ya
    // cerro. Un aviso que salta cuando no toca se deja de leer, y entonces tampoco
    // sirve cuando toca.
    const src = leerCodigo(CERRAR)
    const i = src.indexOf('pendientes')
    expect(i, 'ya no se calculan los pendientes: revisa esta regla en vez de borrarla').toBeGreaterThan(-1)
    const bloque = src.slice(i, i + 320)
    expect(/haFichado\(/.test(bloque),
      'el aviso de las 20:00 ya no exige haber EMPEZADO el dia: regana a quien no ficho, que ya fue avisado a las 10:00')
      .toBe(true)
    expect(/!d\.cierre_at/.test(bloque),
      'el aviso de las 20:00 ya no exige que el dia siga SIN CERRAR: avisaria a quien ya cerro')
      .toBe(true)
  })

  it('los dos avisos van en la categoria `fichaje`, que se puede silenciar', () => {
    // Iban como 'tarea', asi que quien silenciaba las tareas perdia tambien el
    // recordatorio de fichar sin haberlo pedido. Y `fichaje` es silenciable a
    // proposito: Javi pidio que no fuera obligatorio.
    for (const f of [CERRAR, FICHAR]) {
      expect(/categoria: 'fichaje'/.test(leerCodigo(f)),
        `${f} no manda el aviso en la categoria 'fichaje': se mezcla con otra cosa y se silencia sin querer`)
        .toBe(true)
    }
    const avisos = leerCodigo('src/lib/avisos.ts')
    const j = avisos.indexOf('fichaje: {')
    expect(j, 'ya no existe la categoria fichaje').toBeGreaterThan(-1)
    expect(/silenciable: true/.test(avisos.slice(j, avisos.indexOf('},', j))),
      'la categoria fichaje dejo de ser silenciable: Javi pidio que no fuera obligatorio')
      .toBe(true)
    expect(/'fichaje'/.test(avisos.slice(avisos.indexOf('ORDEN_AVISOS'), avisos.indexOf('ORDEN_AVISOS') + 200)),
      'fichaje no sale en ORDEN_AVISOS: existe pero no se puede tocar desde la pantalla')
      .toBe(true)
  })
})

describe('la pantalla no lee campos que la API no manda', () => {
  // EL BUG: el «Pulso del equipo» de Fichar ensenaba 0 y 0% a TODO EL MUNDO, todos
  // los dias, desde que se escribio.
  //
  // `/api/diario` trae las tareas del dia con `.eq('done', true)` —o sea que TODAS
  // estan hechas— pero su `select` NO incluye la columna `done`. Y la pantalla hacia
  // `p.tareas.filter(t => (t as {done?:boolean}).done).length`, que sobre unos
  // objetos sin ese campo da 0 siempre.
  //
  // Lo tapaba el `as`: sin el, TypeScript habria dicho que `done` no existe. Mismo
  // mecanismo que CLAUDE.md documenta con `as any` en HoySection — el cast no
  // arregla el tipo, apaga al unico que iba a avisar.
  //
  // Y lo delataba la propia pantalla: mas abajo, el acordeon calcula lo MISMO con
  // `p.tareas.length` y decia «3 HECHAS» mientras la barra decia 0 y 0%. Dos
  // gemelos, uno bien y otro mal, contradiciendose a la vista.
  const API = leerCodigo('src/app/api/diario/route.ts')
  const UI = leerCodigo('src/components/sections/DiarioSection.tsx')

  /** El cuerpo del parentesis que abre en `desde`, con los parentesis emparejados. */
  const cuerpo = (src: string, desde: number) => {
    let prof = 0
    for (let i = desde; i < src.length; i++) {
      if (src[i] === '(') prof++
      else if (src[i] === ')') { prof--; if (!prof) return src.slice(desde, i) }
    }
    return src.slice(desde)
  }

  it('los campos que la pantalla lee de una tarea del dia vienen en el select', () => {
    const m = API.match(/from\('tasks'\)[\s\S]{0,80}?\.select\('([^']+)'\)/)
    expect(m, 'ya no se consultan las tareas del dia en /api/diario: revisa esta regla en vez de borrarla')
      .toBeTruthy()
    const columnas = new Set(m![1].split(',').map(c => c.trim().split(':')[0]))

    const leidos = new Set<string>()
    let sitios = 0
    for (const uso of UI.matchAll(/\bp\.tareas\s*\.\s*(?:map|filter|find|some|every|flatMap)\s*\(/g)) {
      sitios++
      const b = cuerpo(UI, uso.index! + uso[0].length - 1)
      const par = b.match(/^\(\s*\(?\s*(\w+)/)
      if (!par) continue
      for (const c of b.matchAll(new RegExp('\\b' + par[1] + '\\s*\\??\\.(\\w+)', 'g'))) leidos.add(c[1])
    }
    expect(sitios, 'la pantalla ya no recorre p.tareas: revisa esta regla en vez de borrarla')
      .toBeGreaterThan(0)

    const fantasmas = [...leidos].filter(c => !columnas.has(c))
    expect(fantasmas, `la pantalla lee de una tarea campos que /api/diario NO manda — saldran undefined y la cifra saldra mal SIN dar error:\n  ${fantasmas.join(', ')}\n  (el select trae: ${[...columnas].join(', ')})`)
      .toEqual([])
  })

  it('nadie vuelve a filtrar por `done` unas tareas que ya vienen todas hechas', () => {
    expect(/\bp\.tareas[^\n]*\bdone\b/.test(UI),
      'se vuelve a filtrar p.tareas por `done`: esas tareas YA vienen todas hechas de la API')
      .toBe(false)
    expect(/\.eq\('done', true\)/.test(API),
      '/api/diario ya no acota a las hechas: entonces la pantalla SI tendria que filtrar, y esta regla sobra')
      .toBe(true)
  })
})

describe('todo correo que entra dice por que buzon entro', () => {
  // Javi: «no se si estan entrando los Gmail de ambos correos». Y no habia forma de
  // saberlo: `inbox_messages` guarda `user_id` y `shared`, pero no la DIRECCION del
  // buzon. Con dos cuentas personales conectadas —lo que permite `gmail_cuentas`
  // desde el 2026-08-20— las dos escriben `shared = false` y son la misma casilla.
  //
  // La columna `cuenta` (migracion 20260824_inbox_cuenta.sql) lo arregla, pero solo
  // sirve si la escriben TODOS los caminos de entrada. Y son tres, no uno: el sync
  // del buzon compartido, el personal, y la cola de aplazados de `aplazarCorreos`.
  // Olvidar uno no da error: esos correos salen «sin identificar» y el selector de
  // buzones deja de verlos. Justo el fallo mudo que persigue el resto del fichero.
  const RUTAS_DE_ENTRADA = ['src/lib/colabsSync.ts', 'src/lib/aplazarCorreos.ts']

  it('nadie inserta en inbox_messages por su cuenta: todos pasan por insertarEnInbox', () => {
    // La puerta unica es lo que hace que la comprobacion de abajo sea suficiente.
    // Tambien es donde vive el reintento sin la columna, que es lo que impide que
    // desplegar antes de correr la migracion deje al equipo sin correo.
    const sueltos: string[] = []
    for (const f of RUTAS_DE_ENTRADA) {
      if (/\.from\('inbox_messages'\)\s*\.insert\(/.test(leerCodigo(f))) sueltos.push(f)
    }
    expect(sueltos, `insertan en inbox_messages sin pasar por insertarEnInbox, asi que se saltan la columna «cuenta» y el reintento:\n  ${sueltos.join('\n  ')}`)
      .toEqual([])
  })

  it('cada fila de correo que se construye lleva su `cuenta`', () => {
    // La regla mira la FORMA DE LA FILA y no la llamada. La primera version miraba
    // el objeto pegado a `insertarEnInbox(`, y daba un falso positivo en
    // `aplazarCorreos`, que construye la cola arriba y pasa la variable. Un falso
    // positivo se ve y se corrige; el simetrico —dar por buena una fila sin cuenta
    // porque el objeto estaba en otra linea— habria sido el fallo grave.
    //
    // Firma de una fila de inbox: lleva `user_id` y `gmail_id`. No hay otra cosa en
    // estos ficheros con esas dos claves juntas.
    const sinCuenta: string[] = []
    for (const f of RUTAS_DE_ENTRADA) {
      const src = leerCodigo(f)
      let vistas = 0
      for (const m of src.matchAll(/\{[^{}]*\buser_id:[^{}]*\}/g)) {
        if (!/\bgmail_id:/.test(m[0])) continue
        vistas++
        if (!/\bcuenta:/.test(m[0])) {
          // La linea, sobre el fichero REAL: `src` viene sin comentarios de bloque
          // y eso corre el conteo. Ya paso una vez en este mismo fichero.
          const orig = leer(f)
          const j = orig.indexOf(m[0].slice(0, 40))
          sinCuenta.push(`${f}:${j < 0 ? '?' : orig.slice(0, j).split('\n').length}`)
        }
      }
      expect(vistas, `${f} ya no construye filas de inbox: revisa esta regla en vez de borrarla`)
        .toBeGreaterThan(0)
    }
    expect(sinCuenta, `correos que entran sin decir de que buzon vienen — saldran «sin identificar» y el selector no los vera:\n  ${sinCuenta.join('\n  ')}`)
      .toEqual([])
  })

  it('la cola de aplazados EXIGE la cuenta en el tipo, no la deja opcional', () => {
    // Sin esto la regla de arriba pasa en verde el dia que alguien anada un cuarto
    // camino: `cuenta` seria opcional y omitirla compilaria. Que sea obligatoria en
    // la firma es lo que hizo que tsc cazara los dos sitios al escribir esto.
    const src = leerCodigo('src/lib/aplazarCorreos.ts')
    expect(/destino: \{[^}]*cuenta: string \| null[^}]*\}/.test(src),
      'aplazarResto ya no exige `cuenta` en su destino: omitirla vuelve a compilar')
      .toBe(true)
  })
})

describe('el arranque no se apaga a mitad', () => {
  // EL PARPADEO AL ABRIR LA APP. Me costo CUATRO diagnosticos, y los tres primeros
  // fueron mios y equivocados: los tres negros distintos, la insignia que llegaba
  // tarde, y la tipografia (que ni siquiera podia ser, porque la CSP la bloqueaba y
  // no llegaba a cargarse nunca). Lo resolvio un video de Javi, mirado frame a
  // frame a 60 fps.
  //
  // La app monta DOS pantallas de arranque seguidas, y son objetos distintos:
  //
  //   0,00 s  DashboardClient pinta una — «Comprobando tu sesion…»
  //   0,60 s  /api/me responde → `listo` pasa a true → esa pantalla SE DESMONTA,
  //           y NexusDashboard monta OTRA porque sus datos aun no han llegado
  //   1,58 s  llegan los datos y aparece la app
  //
  // Al ser un nodo nuevo, `nxBootSube` (0,6 s, de opacity 0 a 1) vuelve a empezar.
  // Medido en el video: el brillo del emblema cae de 80,5 a 61,3 en 33 ms y tarda
  // otros 0,6 s en recuperarse. Y `nxBootLatido` salta a scale(1), por eso el logo
  // se ve mas pequeno en ese frame.
  //
  // La regla no exige que haya UNA sola pantalla —son dos porque son dos estados de
  // carga distintos, y unificarlos es otra reforma—: exige que la segunda RELEVE a
  // la primera en vez de entrar de cero.
  const SITIOS = TS.filter(f => /<NexusBootScreen/.test(leerCodigo(f)))
  // `preview-boot` es una pagina suelta para mirar la pantalla de eleccion. No
  // releva a nadie porque no hay nada antes: alli la entrada SI debe verse.
  const PREVIEW = 'src/app/preview-boot/Cliente.tsx'
  const RELEVOS = SITIOS.filter(f => f !== PREVIEW)

  it('si hay mas de una pantalla de arranque, todas menos la primera relevan', () => {
    expect(RELEVOS.length, 'ya no se pinta NexusBootScreen: revisa esta regla en vez de borrarla')
      .toBeGreaterThan(0)
    if (RELEVOS.length < 2) return
    const conContinua = RELEVOS.filter(f =>
      leerCodigo(f).split('<NexusBootScreen').slice(1)
        .some(t => /^[^>]*\bcontinua\b/.test(t)))
    expect(conContinua.length, `hay ${RELEVOS.length} pantallas de arranque y solo ${conContinua.length} relevan: la que entra de cero apaga la que ya se veia\n  ${RELEVOS.join('\n  ')}`)
      .toBeGreaterThanOrEqual(RELEVOS.length - 1)
  })

  it('la clase de relevo cancela la ENTRADA y respeta la SALIDA', () => {
    const CSS = leerCodigo('src/app/globals.css')
    const i = CSS.indexOf('.nx-boot-continua')
    expect(i, 'no existe la clase de relevo: `continua` no hace nada').toBeGreaterThan(-1)
    const regla = CSS.slice(i, CSS.indexOf('}', i) + 1)
    expect(/animation:\s*none/.test(regla), 'la clase de relevo ya no cancela la animacion de entrada')
      .toBe(true)
    // Sin el :not() esta regla gana por especificidad y se lleva por delante TAMBIEN
    // la animacion de salida. Se vio midiendo `animationName` en el navegador.
    expect(/:not\(\.nx-boot-saliendo\)/.test(regla),
      'la clase de relevo pisa la animacion de salida: al elegir tema desapareceria de golpe')
      .toBe(true)
  })
})

describe('lo que llega de fuera no puede ensanchar un panel', () => {
  // Javi, con una captura del movil: «esta pagina no es estatica». El detalle de un
  // correo se podia arrastrar de lado y se salia media pantalla — hasta el boton
  // VOLVER quedaba fuera. Las dos barras fijas seguian en su sitio, que es lo que
  // delataba que no era el documento (`html, body` llevan `overflow: hidden`) sino
  // el propio panel.
  //
  // LA CAUSA es una regla de CSS que sorprende: si UNO de los dos ejes deja de ser
  // `visible`, el otro no puede seguir siendolo y el navegador lo computa a `auto`.
  // O sea que `overflow-y-auto` activa TAMBIEN el eje horizontal sin que nadie lo
  // pida. Medido en el navegador: un div con solo `overflow-y:auto` da
  // `overflowX: "auto"` y 3231 px de contenido en 200 px de caja.
  //
  // Habia 44 contenedores asi en la app y solo 3 tapaban el eje X. Bastaba un texto
  // que no supiera partirse —un enlace de seguimiento de LinkedIn, 300 caracteres
  // sin un espacio— para poder arrastrar el panel entero.
  const CSS = leerCodigo('src/app/globals.css')

  it('la guarda de CSS existe y NO vive dentro de un @media', () => {
    const i = CSS.indexOf('.overflow-y-auto:not(')
    expect(i, 'se fue la guarda: cualquier texto largo vuelve a mover el panel de lado')
      .toBeGreaterThan(-1)
    // Estuvo a punto de colarse dentro del bloque movil, y el fallo pasa igual en
    // escritorio: la lista de correos mide 360 px y desborda con lo mismo.
    // Profundidad de llaves hasta la guarda. A nivel raiz es 0; dentro de un
    // @media es 1. `leerCodigo` ya quito los comentarios de bloque, asi que las
    // llaves que se cuentan son todas de CSS de verdad.
    const antes = CSS.slice(0, i)
    const profundidad = (antes.split('{').length - 1) - (antes.split('}').length - 1)
    expect(profundidad, 'la guarda quedo dentro de un @media: solo protege a esas pantallas')
      .toBe(0)
    expect(/overflow-x:\s*hidden/.test(CSS.slice(i, i + 200)),
      'la guarda ya no tapa el eje horizontal').toBe(true)
    // Y tiene que apartarse de quien pide los dos ejes a proposito.
    expect(/:not\(\.overflow-x-auto\)/.test(CSS.slice(i, i + 200)),
      'la guarda pisa a quien pide scroll horizontal aposta').toBe(true)
  })

  // Que sepa partir un token sin espacios: da igual si es clase de Tailwind o
  // estilo inline. `overflowWrap: 'anywhere'` hace exactamente el mismo trabajo.
  const PARTE = /break-words|break-all|truncate|line-clamp|overflowWrap|wordBreak/

  it('`whitespace-pre-wrap` siempre va con algo que sepa partir un token largo', () => {
    // `pre-wrap` respeta los saltos y parte por espacios, pero una URL de 300
    // caracteres NO tiene espacios: estira el contenedor y ya no hay vuelta atras.
    const malos: string[] = []
    for (const f of CLIENTE) {
      // Sobre el fichero ENTERO y no sobre leerCodigo(), para que el numero de linea
      // que se reporta sea el de verdad: quitar comentarios de bloque lo desplaza.
      // Aqui un comentario solo puede provocar un falso POSITIVO, que se ve y se
      // corrige; el peligroso es el simetrico, y ese no cabe en esta forma.
      leer(f).split('\n').forEach((l, i) => {
        if (!/whitespace-pre-wrap/.test(l)) return
        if (/^\s*(\/\/|\*|\{\/\*)/.test(l)) return
        if (PARTE.test(l)) return
        malos.push(`${f}:${i + 1}`)
      })
    }
    expect(malos, `texto preformateado sin forma de partirse — un enlace largo ensancha el panel:\n  ${malos.join('\n  ')}`)
      .toEqual([])
  })

  it('el texto que viene del correo se pinta con algo que sepa partirlo', () => {
    // Solo cuando es el CONTENIDO de un elemento. Pasarlo como prop no cuenta: ahi
    // decide el componente que lo recibe.
    const DE_FUERA = /\{[^{}]*\.(from_email|from_name|subject|ai_summary|body_preview)\b[^{}]*\}/g
    // Las iniciales del avatar: DOS caracteres en un circulo de 32 px. No pueden
    // desbordar nada, y ponerles break-words seria ruido.
    const INICIALES = /\.slice\(0, ?2\)/
    const malos: string[] = []
    for (const f of CLIENTE) {
      const src = leerCodigo(f)
      for (const m of src.matchAll(DE_FUERA)) {
        if (src[m.index! - 1] === '=') continue          // es una prop
        if (src[m.index! - 1] !== '>') continue          // no es el texto del elemento
        const abre = src.lastIndexOf('<', m.index!)
        if (abre < 0) continue
        const etiqueta = src.slice(abre, m.index!)
        if (!/^<[a-z]/.test(etiqueta)) continue          // <Componente/>, no un tag
        if (PARTE.test(etiqueta)) continue
        if (INICIALES.test(m[0])) continue
        // El numero de linea, sobre el fichero real: src viene sin comentarios de
        // bloque y eso corre el conteo.
        const orig = leer(f)
        const j = orig.indexOf(m[0])
        const linea = j < 0 ? 0 : orig.slice(0, j).split('\n').length
        malos.push(`${f}:${linea} → ${m[0].slice(0, 46)}`)
      }
    }
    expect(malos, `texto de fuera sin forma de partirse — una direccion o un asunto largo mueve el panel:\n  ${malos.join('\n  ')}`)
      .toEqual([])
  })
})

describe('el motor de automatizaciones recibe lo que mira', () => {
  it('las COLUMNAS que el tipo de ctx declara se piden en el select', () => {
    // La regla de abajo mira los campos de PRIMER NIVEL de `ctx` —que llegue
    // `diario`, que llegue `tasks`— y eso deja fuera las columnas de dentro: el
    // snapshot puede traer `diario` y no traer `entrada_at`, y el evaluador se
    // queda mirando `undefined` para siempre. Sin error.
    //
    // PASÓ HOY, y por eso existe esta segunda regla. Al unificar el criterio de
    // «fichó» en `haFichado(entrada_at)`, el select seguía pidiendo
    // `user_id,dia,entrada,cierre_at,animo`. Nadie habría contado como fichado
    // NUNCA, y «lleva 2 días sin fichar» habría saltado para todo el equipo, todos
    // los días. La regla de abajo pasó en verde: el campo se lee a través de un
    // ayudante, no como `d.entrada_at`, así que su regex no lo veía.
    //
    // Esta no mira cómo se lee, sino lo que el TIPO PROMETE. Eso no se puede
    // esquivar con un ayudante ni con un cast.
    const A = leerCodigo('src/lib/automations.ts')
    const m = A.match(/diario\?: \{ ([^}]*) \}\[\]/)
    expect(m, 'ya no se declara el tipo de ctx.diario: revisa esta regla en vez de borrarla').toBeTruthy()
    const declaradas = m![1].split(';').map(c => c.trim().split(/[?:]/)[0].trim()).filter(Boolean)
    expect(declaradas.length, 'el tipo de ctx.diario no declara columnas').toBeGreaterThan(2)

    const sel = A.match(/from\('diario'\)\.select\('([^']+)'\)/)
    expect(sel, 'el snapshot ya no consulta el diario').toBeTruthy()
    const pedidas = new Set(sel![1].split(',').map(c => c.trim()))

    const faltan = declaradas.filter(c => !pedidas.has(c))
    expect(faltan, `el tipo de ctx.diario promete columnas que el snapshot NO pide — el evaluador vera undefined para siempre y ninguna regla saltara:\n  faltan: ${faltan.join(', ')}\n  pide: ${[...pedidas].join(', ')}`)
      .toEqual([])
  })

  it('cada lista del snapshot trae las COLUMNAS que el evaluador le lee', () => {
    // La regla de al lado comprueba que la LISTA llegue (`ctx.projects` existe). No
    // comprueba que esa lista traiga las columnas que se leen de sus elementos, y
    // por ahi se colo «Nuevo proyecto añadido»: el evaluador hace `p.created_at` y
    // el select era `'id,name,status,deadline,client_id'`. Sin la columna,
    // `created_at` es undefined, el `continue` se ejecuta siempre y el disparador
    // NO PUEDE SALTAR NUNCA — sin error, sin log, cero coincidencias para siempre.
    // Es el mismo fallo mudo que este fichero ya documenta con `level`.
    const A = leerCodigo('src/lib/automations.ts')
    const ini = A.indexOf('export function evaluateTrigger')
    const fin = A.indexOf('export async function runAutomations')
    const evaluador = A.slice(ini, fin)

    const bucles = [...evaluador.matchAll(/for \(const (\w+) of \(?ctx\.(\w+)/g)]
    expect(bucles.length, 'no se reconoce ningun bucle sobre ctx: revisa esta regla').toBeGreaterThan(2)

    // Los select DEL SNAPSHOT, no los del fichero entero: hay mas consultas sueltas
    // (contadores, por ejemplo `select('user_id')`) y quedarse con la ultima daba
    // ocho falsos positivos de golpe.
    const iSnap = A.indexOf('const snapshot = await Promise.all([')
    expect(iSnap, 'ya no se construye el snapshot con Promise.all: revisa esta regla').toBeGreaterThan(-1)
    const bloqueSnap = A.slice(iSnap, A.indexOf('])', iSnap) + 2)
    // UNION de columnas por tabla: una misma tabla se consulta varias veces en el
    // snapshot (`inbox_messages` va completa para la lista y con `select('user_id')`
    // para un contador). Quedarse con la ultima daba ocho falsos positivos.
    const selects: Record<string, string> = {}
    for (const m of bloqueSnap.matchAll(/from\('(\w+)'\)\.select\('([^']*)'/g)) {
      selects[m[1]] = (selects[m[1]] ? selects[m[1]] + ',' : '') + m[2]
    }

    const TABLA: Record<string, string> = {
      projects: 'projects', tasks: 'tasks', clients: 'clients', agenda: 'content_agenda',
      inbox: 'inbox_messages', diario: 'diario', team: 'profiles',
    }
    const DE_ARRAY = ['length', 'map', 'filter', 'find', 'some', 'every', 'slice', 'push', 'join']

    const faltan: string[] = []
    for (const [, variable, lista] of bucles) {
      const sel = selects[TABLA[lista]]
      if (!sel || sel.includes('*')) continue
      // Las dos formas de leer una columna, porque este fichero usa las dos:
      // `p.created_at` y `(p as { created_at?: string }).created_at`. Mirando solo
      // la primera, la regla pasaba en verde con el bug reintroducido — el acceso
      // real de `proyecto_nuevo` lleva el cast por delante.
      const cols = new Set([
        ...[...evaluador.matchAll(new RegExp(`\\b${variable}\\.(\\w+)`, 'g'))].map(m => m[1]),
        ...[...evaluador.matchAll(new RegExp(`\\(\\s*${variable}\\s+as\\s+[^)]*\\)\\.(\\w+)`, 'g'))].map(m => m[1]),
      ])
      for (const c of cols) {
        if (DE_ARRAY.includes(c)) continue
        if (!new RegExp(`\\b${c}\\b`).test(sel)) {
          faltan.push(`ctx.${lista}: se lee ${variable}.${c} y select('${sel}') no lo trae`)
        }
      }
    }
    expect([...new Set(faltan)],
      `el evaluador lee columnas que el snapshot no pide. PostgREST devuelve SOLO lo pedido, asi que el valor es undefined y ese disparador no salta NUNCA — sin error y sin log:\n  ${[...new Set(faltan)].join('\n  ')}`)
      .toEqual([])
  })

  it('todo campo que lee evaluateTrigger viene cargado en el snapshot', () => {
    // EL FALLO MUDO que el propio fichero documenta: «un snapshot que no trae lo
    // que el evaluador mira es un fallo mudo — no hay error, solo cero
    // coincidencias para siempre». Ya pasó una vez con `level` y `assigned_to`, y
    // la regla «urgentes sin asignar» no saltó UNA VEZ desde que existía.
    //
    // Al añadir las automatizaciones de control volvió a estar a un descuido: si
    // `ctx` no llevara `diario`, `sin_fichar` no saltaría jamás y nadie lo notaría.
    // Verificado vaciándolo: ningún test se ponía rojo. Ahora sí.
    const A = leerCodigo('src/lib/automations.ts')

    const ini = A.indexOf('export function evaluateTrigger')
    const fin = A.indexOf('export async function runAutomations')
    expect(ini, 'ya no existe evaluateTrigger: revisa esta regla').toBeGreaterThan(-1)
    expect(fin, 'ya no existe runAutomations: revisa esta regla').toBeGreaterThan(ini)

    // Qué campos de `ctx` lee el evaluador…
    const leidos = new Set(
      [...A.slice(ini, fin).matchAll(/\bctx\.([a-zA-Z_][a-zA-Z0-9_]*)/g)].map(m => m[1]))
    expect(leidos.size, 'el evaluador no lee nada de ctx: revisa esta regla').toBeGreaterThan(3)

    // …y cuáles construye runAutomations.
    // Se mira en LOS DOS sitios donde se puede aportar un campo: el objeto `ctx`
    // y la propia llamada a `evaluateTrigger`, que hace `{ ...ctx, sinLeerMios }`.
    // Mirar solo el primero daba un falso positivo con ese campo — el dato SÍ
    // llegaba, solo que por la otra vía.
    const i = A.indexOf('const ctx = {', fin)
    expect(i, 'ya no se construye ctx en runAutomations: revisa esta regla').toBeGreaterThan(-1)
    const construido = A.slice(i, A.indexOf('\n  }', i) + 4)
    const j = A.indexOf('evaluateTrigger(cfg', fin)
    const enLlamada = j === -1 ? '' : A.slice(j, A.indexOf(')', j) + 1)

    const faltan = [...leidos].filter(k =>
      !new RegExp(`\\b${k}\\s*:`).test(construido) && !new RegExp(`\\b${k}\\b`).test(enLlamada))
    expect(faltan,
      'el evaluador lee campos que el snapshot no carga: esos disparadores no saltaran NUNCA y no habra ningun error')
      .toEqual([])
  })
})
