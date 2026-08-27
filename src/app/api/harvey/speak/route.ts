import { createClient, createAdminClient } from '@/lib/supabase/server'
import { checkAiRateLimit } from '@/lib/rate-limit'
import { NextRequest, NextResponse } from 'next/server'
import { textoParaVoz } from '@/lib/textoHarvey'

export const maxDuration = 60

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const fishKey = process.env.FISH_AUDIO_API_KEY
  const fishVoice = process.env.FISH_AUDIO_VOICE_ID
  if (!fishKey || !fishVoice) return NextResponse.json({ error: 'TTS no configurado' }, { status: 503 })

  const { text } = await request.json()
  if (!text?.trim()) return NextResponse.json({ error: 'Sin texto' }, { status: 400 })

  // LO QUE SE DICE NO ES LO QUE SE ESCRIBE. Javi: «cuando reprodujo en audio dos
  // horas y diez minutos, dijo 2H10M». Se mandaba el texto tal cual, y la app
  // escribe las duraciones en corto porque en pantalla es lo que se lee de un
  // vistazo. Aqui y no en cada boton que hable: asi vale para cualquiera que
  // llame a esta ruta, hoy y mañana.
  const paraDecir = textoParaVoz(text)
  if (!paraDecir) return NextResponse.json({ error: 'Sin texto' }, { status: 400 })

  // Fish Audio se factura por carácter. Sin tope, un cliente manipulado (o un
  // bucle accidental) podía quemar el saldo con una sola petición: esta ruta era
  // de las pocas que gastan dinero y no tenían ni límite de longitud ni de tasa.
  const MAX_CHARS = 4000
  if (text.length > MAX_CHARS) {
    return NextResponse.json({ error: `Texto demasiado largo (máx. ${MAX_CHARS} caracteres)` }, { status: 413 })
  }
  const admin = await createAdminClient()
  if (await checkAiRateLimit(admin, user.id, 'tts')) {
    return NextResponse.json({ error: 'Demasiadas solicitudes. Espera un momento.' }, { status: 429 })
  }

  try {
    // Sin `signal` rigen los defaults de undici (300 s), cinco veces el
    // maxDuration de 60 s de esta ruta: un cuelgue —no una caida, que cae sola en
    // segundos— agota la funcion y Vercel la mata sin respuesta, asi que el camino
    // de error de mas abajo no llega a ejecutarse.
    const res = await fetch('https://api.fish.audio/v1/tts', {
      signal: AbortSignal.timeout(45_000),
      method: 'POST',
      headers: {
        Authorization: `Bearer ${fishKey}`,
        'Content-Type': 'application/json',
        model: 's2.1-pro',
      },
      body: JSON.stringify({
        text: paraDecir,
        reference_id: fishVoice,
        format: 'mp3',
        mp3_bitrate: 128,
        latency: 'balanced',
        temperature: 0.7,
        top_p: 0.7,
        normalize: true,
        prosody: { speed: 1.15, volume: 0, normalize_loudness: true },
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      console.error('Fish Audio TTS error:', res.status, err.slice(0, 200))
      return NextResponse.json({ error: 'TTS failed' }, { status: res.status })
    }

    const buffer = await res.arrayBuffer()
    if (!buffer.byteLength) return NextResponse.json({ error: 'Audio vacío' }, { status: 502 })

    return new NextResponse(buffer, {
      headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' },
    })
  } catch (e: any) {
    console.error('Fish Audio TTS error:', e?.message)
    return NextResponse.json({ error: 'TTS failed' }, { status: 502 })
  }
}
