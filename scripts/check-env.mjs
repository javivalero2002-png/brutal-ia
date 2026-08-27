#!/usr/bin/env node
// Comprueba las variables de entorno ANTES de compilar.
//
// Sustituye a src/lib/env.ts, que decía "build fails fast if something is
// missing" y no lo importaba absolutamente nadie (`grep '@/lib/env' src/` → 0).
// Cablearlo en las rutas tampoco servía: `required()` se evalúa a nivel de
// módulo, así que habría lanzado en RUNTIME dentro de la función serverless,
// devolviendo un 500 en producción — justo lo contrario de fallar pronto.
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// En Vercel las vars ya están en process.env. En local, `node` NO lee .env.local
// (eso lo hace Next), así que hay que parsearlo a mano o `npm run build` local
// fallaría siempre.
if (!process.env.VERCEL && existsSync(resolve(process.cwd(), '.env.local'))) {
  for (const line of readFileSync(resolve(process.cwd(), '.env.local'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
}

const has = (k) => typeof process.env[k] === 'string' && process.env[k].trim() !== ''
const isVercelProd = process.env.VERCEL_ENV === 'production'

// Sin estas la app no arranca o pierde una función entera en silencio.
const REQUIRED = [
  ['NEXT_PUBLIC_SUPABASE_URL', 'base de datos y auth'],
  ['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'cliente del navegador'],
  ['SUPABASE_SERVICE_ROLE_KEY', 'todas las rutas API'],
  ['ANTHROPIC_API_KEY', 'chat, Harvey y análisis de emails'],
  ['GOOGLE_CLIENT_ID', 'OAuth de Gmail y Calendar'],
  ['GOOGLE_CLIENT_SECRET', 'OAuth de Gmail y Calendar'],
  ['NEXT_PUBLIC_APP_URL', 'redirects de OAuth'],
  ['NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'notificaciones push'],
  ['VAPID_PRIVATE_KEY', 'notificaciones push'],
]

// Solo obligatorias en el build de producción de Vercel: en local no existen y
// no deben impedir compilar.
const REQUIRED_PROD = [
  ['CRON_SECRET', 'el cron horario devuelve 500 sin ella'],
]

// Su ausencia degrada una función concreta, no rompe la app.
const OPTIONAL = [
  ['TAVILY_API_KEY', 'búsqueda web en el chat'],
  ['OPENAI_API_KEY', 'transcripción de Harvey'],
  ['GROQ_API_KEY', 'transcripción rápida'],
  ['FISH_AUDIO_API_KEY', 'voz de Harvey'],
  ['WHATSAPP_APP_SECRET', 'el webhook responde 503 sin ella (integración futura)'],
  // Las de la REVENTA. Todas tienen valor por defecto y ninguna falla si falta:
  // la instancia funciona y lleva el nombre de Brutal Studios dentro. Por eso van
  // aquí — para que se vean al montar una instancia nueva.
  ['COMPANY_EMAIL', 'de aquí sale qué correos son «del equipo»; por defecto, el de Brutal Studios'],
  ['DOMINIO_EQUIPO', 'la lista de Equipo filtra por este dominio; con el de otro negocio, saldría VACÍA'],
  ['VAPID_SUBJECT', 'va firmado en cada notificación; por defecto, un correo de Brutal Studios'],
  ['FISH_AUDIO_VOICE_ID', 'sin ella Harvey no habla, y el fallo es el mismo 503 que si faltara la clave'],
  ['WHATSAPP_TOKEN', 'sin ella no sale ni un mensaje de WhatsApp, y no da error'],
  ['WHATSAPP_PHONE_NUMBER_ID', 'lo mismo que el token: las dos se comprueban juntas'],
  ['WHATSAPP_VERIFY_TOKEN', 'el apretón de manos del webhook con Meta; te la inventas tú'],
]

const required = isVercelProd ? [...REQUIRED, ...REQUIRED_PROD] : REQUIRED
const missing = required.filter(([k]) => !has(k))
const missingOptional = OPTIONAL.filter(([k]) => !has(k))

if (missingOptional.length) {
  console.warn('\n⚠  Variables opcionales ausentes (funciones degradadas):')
  for (const [k, why] of missingOptional) console.warn(`   · ${k} — ${why}`)
}

if (missing.length) {
  console.error('\n✖ Faltan variables de entorno obligatorias:\n')
  for (const [k, why] of missing) console.error(`   · ${k} — ${why}`)
  console.error('\n  Local:   añádelas a .env.local')
  console.error('  Vercel:  npx vercel@latest env add <NOMBRE> production\n')
  process.exit(1)
}

console.log(`✓ Variables de entorno OK (${required.length} obligatorias${isVercelProd ? ', build de producción' : ''})`)
