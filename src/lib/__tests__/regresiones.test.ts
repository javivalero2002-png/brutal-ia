import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

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

describe('uniones con CHECK en la base · nadie las silencia con `as any`', () => {
  it('ni el nivel de una tarea ni el estado de un proyecto se castean', () => {
    const malos = TS.flatMap(f => leer(f).split('\n').map((l, i) => ({ f, i: i + 1, l })))
      .filter(({ l }) => /\b(level|status)\s*:\s*[^,;]*\bas any\b/.test(l))
    expect(malos.map(u => `${u.f}:${u.i}`),
      'Castea a any un campo con CHECK: normalízalo (ver nivelTarea) en vez de silenciarlo').toEqual([])
  })
})
