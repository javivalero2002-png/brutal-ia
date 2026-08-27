#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// ¿ESTÁ ESTA INSTANCIA COMO TIENE QUE ESTAR?
//
// `check-env.mjs` comprueba que las variables EXISTAN. Esto comprueba que
// FUNCIONEN, que no es lo mismo: una clave caducada, un bucket que se renombró o
// un par de claves VAPID que no casan pasan la primera comprobación y rompen la
// app en producción, cada uno a su manera y ninguno con un error claro.
//
// Existe porque Nexus va a montarse una vez por cliente. El primero se monta bien
// porque estás concentrado; en el tercero te dejas una variable y te enteras
// cuando el cliente llama. Esto es lo que convierte «lo monté de memoria» en algo
// repetible.
//
//   node scripts/revisar-instancia.mjs
//   node scripts/revisar-instancia.mjs --env .env.cliente-x
//
// Sale con código 1 si algo obligatorio falla, para poder usarlo en un despliegue.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs'
import { createPrivateKey } from 'node:crypto'

const arg = process.argv.indexOf('--env')
const RUTA = arg !== -1 ? process.argv[arg + 1] : '.env.local'

// Se lee el fichero Y el entorno: en Vercel las variables vienen del entorno y no
// hay fichero, y ahí también tiene que poder correr.
const env = { ...process.env }
if (existsSync(RUTA)) {
  for (const linea of readFileSync(RUTA, 'utf8').split('\n')) {
    const i = linea.indexOf('=')
    if (i < 1 || linea.trimStart().startsWith('#')) continue
    const k = linea.slice(0, i).trim()
    if (!env[k]) env[k] = linea.slice(i + 1).trim().replace(/^["']|["']$/g, '')
  }
}

const V = '\x1b[32m✓\x1b[0m', X = '\x1b[31m✗\x1b[0m', A = '\x1b[33m!\x1b[0m'
let fallos = 0, avisos = 0
const ok = (m, d = '') => console.log(`  ${V} ${m}${d ? `  \x1b[2m${d}\x1b[0m` : ''}`)
const mal = (m, d) => { fallos++; console.log(`  ${X} ${m}\n      \x1b[31m${d}\x1b[0m`) }
const ojo = (m, d) => { avisos++; console.log(`  ${A} ${m}\n      \x1b[33m${d}\x1b[0m`) }
const titulo = t => console.log(`\n\x1b[1m${t}\x1b[0m`)

/** Un fetch que NO se puede quedar colgado. Sin `signal` rigen los 300 s de undici. */
const pedir = (url, opts = {}) =>
  fetch(url, { ...opts, signal: AbortSignal.timeout(opts.ms || 10_000) })

// ── 1. LAS VARIABLES ────────────────────────────────────────────────────────
// Las listas salen de `check-env.mjs` para que no haya dos: si allí se añade una
// variable y aquí no, esto diría que está todo y faltaría algo.
//
// Y salen las TRES por separado, que es donde me equivoqué la primera vez: leí el
// fichero a lo bruto y di por obligatorias `CRON_SECRET` —que solo lo es en
// producción— y `WHATSAPP_APP_SECRET`, que es opcional. Dos falsas alarmas en la
// primera ejecución. Un revisor que avisa de lo que no pasa se aprende a ignorar,
// y entonces no sirve para lo que sí pasa.
titulo('1 · Variables')
const lista = (nombre) => {
  const src = readFileSync('scripts/check-env.mjs', 'utf8')
  const i = src.indexOf(`const ${nombre} = [`)
  if (i === -1) return []
  const j = src.indexOf('\n]', i)
  return [...src.slice(i, j).matchAll(/\['([A-Z][A-Z0-9_]+)'/g)].map(m => m[1])
}
const REQ = lista('REQUIRED'), REQ_PROD = lista('REQUIRED_PROD'), OPC = lista('OPTIONAL')
if (!REQ.length) mal('no se pudo leer check-env.mjs', 'esta comprobación no vale nada así')

// Producción se decide por la URL: en local apunta a localhost y ahí `CRON_SECRET`
// no hace falta —lo dice el propio check-env—, así que exigirla sería mentir.
const esProd = !!env.NEXT_PUBLIC_APP_URL && !/localhost|127\.0\.0\.1/.test(env.NEXT_PUBLIC_APP_URL)
const exigidas = esProd ? [...REQ, ...REQ_PROD] : REQ
const faltan = exigidas.filter(k => !env[k])
if (faltan.length) mal(`faltan ${faltan.length} de ${exigidas.length} obligatorias`, faltan.join(', '))
else ok(`las ${exigidas.length} obligatorias están`, esProd ? 'mirando como producción' : 'mirando como local')

if (!esProd) {
  const sinProd = REQ_PROD.filter(k => !env[k])
  if (sinProd.length) console.log(`  \x1b[2m· solo hacen falta en producción, y aquí no están: ${sinProd.join(', ')}\x1b[0m`)
}
const sinOpc = OPC.filter(k => !env[k])
if (sinOpc.length) ojo(`${sinOpc.length} opcionales sin poner`, `${sinOpc.join(', ')} — cada una apaga una función, no rompe la app`)
else ok(`las ${OPC.length} opcionales también están`)

// ── 2. SUPABASE ─────────────────────────────────────────────────────────────
titulo('2 · Supabase')
const URL_SB = env.NEXT_PUBLIC_SUPABASE_URL
const SEC = env.SUPABASE_SERVICE_ROLE_KEY
const PUB = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const hSec = { apikey: SEC, Authorization: `Bearer ${SEC}` }

// LAS 23 TABLAS que la app usa de verdad, sacadas de `supabase/esquema-vivo.json`
// —el esquema real de producción— y no de schema.sql, que va por detrás.
const TABLAS = JSON.parse(readFileSync('supabase/esquema-vivo.json', 'utf8')).tablas
const NOMBRES = Array.isArray(TABLAS) ? TABLAS : Object.keys(TABLAS)

if (!URL_SB || !SEC || !PUB) mal('faltan las credenciales de Supabase', 'sin esto no se puede comprobar nada más')
else {
  // Las DOS claves. El 27 de agosto la pública funcionaba y la secreta no: mirar
  // solo una habría dicho que todo iba bien.
  for (const [nombre, cab] of [['clave secreta', hSec], ['clave pública', { apikey: PUB }]]) {
    try {
      const r = await pedir(`${URL_SB}/rest/v1/profiles?select=id&limit=1`, { headers: cab })
      if (r.ok) ok(`base de datos, ${nombre}`)
      else mal(`base de datos, ${nombre}`, `HTTP ${r.status} ${(await r.text()).slice(0, 120)}`)
    } catch (e) { mal(`base de datos, ${nombre}`, e.message) }
  }

  // Las tablas. Una que falte es una migración sin aplicar, y el síntoma es un
  // 42P01 en una ruta suelta semanas después.
  const sinTabla = []
  for (const t of NOMBRES) {
    try {
      const r = await pedir(`${URL_SB}/rest/v1/${t}?select=*&limit=0`, { headers: hSec })
      if (!r.ok) sinTabla.push(`${t} (HTTP ${r.status})`)
    } catch { sinTabla.push(`${t} (sin respuesta)`) }
  }
  if (sinTabla.length) mal(`faltan ${sinTabla.length} de ${NOMBRES.length} tablas`, sinTabla.join(', '))
  else ok(`las ${NOMBRES.length} tablas existen`)

  // El bucket, por su NOMBRE EXACTO: va escrito dentro de cada dirección guardada,
  // así que renombrarlo rompe todos los ficheros que ya hay. Y privado: público
  // significa que cualquiera con el enlace se descarga contratos y presupuestos.
  try {
    const r = await pedir(`${URL_SB}/storage/v1/bucket`, { headers: hSec })
    const b = r.ok ? await r.json() : []
    const cv = Array.isArray(b) ? b.find(x => x.name === 'content-videos') : null
    if (!cv) mal('el bucket `content-videos` no existe', 'los ficheros no se podrán subir ni leer')
    else if (cv.public) mal('el bucket `content-videos` es PÚBLICO', 'cualquiera con la dirección se descarga los documentos')
    else ok('bucket `content-videos`, privado')
  } catch (e) { mal('storage', e.message) }

  try {
    const r = await pedir(`${URL_SB}/auth/v1/settings`, { headers: { apikey: PUB } })
    ok('auth responde', `HTTP ${r.status}`)
  } catch (e) { mal('auth', e.message) }

  // Alguien con rol `owner`. Sin owner, las pantallas de propietario —Reportes,
  // Copias, Equipo— no las ve nadie y la instancia parece a medio hacer.
  try {
    const r = await pedir(`${URL_SB}/rest/v1/profiles?select=id,role&role=eq.owner&limit=1`, { headers: hSec })
    const j = r.ok ? await r.json() : []
    if (j.length) ok('hay un propietario dado de alta')
    else ojo('no hay ningún perfil con rol `owner`', 'Reportes, Copias y Equipo no las verá nadie')
  } catch (e) { ojo('no se pudo comprobar el propietario', e.message) }
}

// ── 3. LAS CLAVES DE FUERA ──────────────────────────────────────────────────
titulo('3 · Servicios')
try {
  const r = await pedir('https://api.anthropic.com/v1/models?limit=1', {
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY || '', 'anthropic-version': '2023-06-01' },
  })
  if (r.ok) ok('Anthropic', 'las dos IAs, el análisis de correo y los PDF')
  else mal('Anthropic', `HTTP ${r.status} — sin esto no funciona ninguna IA`)
} catch (e) { mal('Anthropic', e.message) }

try {
  const r = await pedir('https://api.tavily.com/search', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ api_key: env.TAVILY_API_KEY, query: 'ping', max_results: 1 }),
  })
  if (r.ok) ok('Tavily', 'la búsqueda en internet de las IAs')
  else ojo('Tavily', `HTTP ${r.status} — las IAs dejan de buscar en internet, el resto sigue`)
} catch (e) { ojo('Tavily', e.message) }

// VAPID: que la pública y la privada sean DEL MISMO PAR. Dos claves válidas que
// no casan es el fallo más silencioso de todos — las notificaciones se «envían»
// y no llega ninguna, sin un solo error.
try {
  const priv = Buffer.from(env.VAPID_PRIVATE_KEY || '', 'base64url')
  const pub = Buffer.from(env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '', 'base64url')
  if (priv.length !== 32 || pub.length !== 65 || pub[0] !== 4) {
    mal('claves VAPID', `formato raro (privada ${priv.length}B, pública ${pub.length}B)`)
  } else {
    // Node valida el par al construir la clave: si no casan, lanza.
    createPrivateKey({ format: 'jwk', key: {
      kty: 'EC', crv: 'P-256',
      d: priv.toString('base64url'),
      x: pub.subarray(1, 33).toString('base64url'),
      y: pub.subarray(33, 65).toString('base64url'),
    } })
    ok('claves VAPID', 'la pública y la privada son del mismo par')
  }
} catch {
  mal('claves VAPID', 'la pública y la privada NO son del mismo par: los avisos se enviarían y no llegaría ninguno')
}

if (!env.FISH_AUDIO_API_KEY) mal('Fish Audio', 'sin esto Harvey no habla')
else ojo('Fish Audio', 'no se comprueba: su API cobra por carácter y no tiene endpoint gratuito de cuenta')

// ── 4. LA APP Y GOOGLE ──────────────────────────────────────────────────────
titulo('4 · La app y Google')
const APP = env.NEXT_PUBLIC_APP_URL
if (!APP) mal('falta NEXT_PUBLIC_APP_URL', 'de aquí sale la URI de redirección de Google')
else {
  try {
    const r = await pedir(`${APP}/api/salud`, { ms: 15000 })
    const j = await r.json().catch(() => ({}))
    if (r.ok) ok('la app responde y se ve sana', APP)
    else mal('la app dice que NO está sana', `HTTP ${r.status} · falla: ${(j.fallo || []).join(', ')}`)
  } catch (e) { mal('la app no responde', `${APP} — ${e.message}`) }

  // No se puede comprobar desde fuera si Google tiene esta URI dada de alta: se
  // IMPRIME para poder pegarla, que es donde se falla al montar una instancia.
  console.log(`\n  \x1b[2mPega esta URI en Google Cloud → Credenciales → tu cliente OAuth:\x1b[0m`)
  console.log(`  \x1b[1m${APP}/api/gmail/callback\x1b[0m`)
  console.log(`  \x1b[2mSi no coincide EXACTAMENTE, conectar Gmail falla con redirect_uri_mismatch.\x1b[0m`)
}

console.log(`\n${fallos ? `\x1b[31m${fallos} fallo(s)\x1b[0m` : '\x1b[32mSin fallos\x1b[0m'}${avisos ? ` · \x1b[33m${avisos} aviso(s)\x1b[0m` : ''}\n`)
process.exit(fallos ? 1 : 0)
