import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { estadoDeadline, dlLabel } from '@/components/shared/helpers'

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
  const ANALIZAN = TS.filter(f => /\banalyzeEmail\s*\(/.test(leer(f)) && !f.endsWith('src/lib/ai.ts'))

  it('hay ficheros que revisar', () => {
    expect(ANALIZAN.length).toBeGreaterThan(1)
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
  it('las dos copias del sync personal comparten clave de cerrojo', () => {
    const clave = /sync-personal-\$\{[a-zA-Z.]+\}/
    const RUTA = leer('src/app/api/gmail/sync/route.ts')
    const LIB = leer('src/lib/colabsSync.ts')
    expect(clave.test(RUTA), 'la ruta no usa la clave sync-personal-<id>').toBe(true)
    expect(clave.test(LIB), 'colabsSync no usa la clave sync-personal-<id>').toBe(true)
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
