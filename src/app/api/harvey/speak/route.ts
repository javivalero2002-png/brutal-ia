import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// La síntesis de una respuesta larga puede superar los 10s por defecto de Vercel
export const maxDuration = 60

// Voz de Harvey: "Vega" — mujer española, elegante y cálida.
// Primario: OpenAI coral con instructions. Fallback ElevenLabs: Rachel (femenina).
const VOICE_ID = '21m00Tcm4TlvDq8ikWAM'

const VOICE_INSTRUCTIONS = 'Mujer de Madrid, unos 30 años, hablando en una conversación real e informal. ACENTO CASTELLANO DE ESPAÑA ESTRICTO: la "z" y la "c" ante e/i SIEMPRE con zeta interdental /θ/ ("gracias" = "grazias" con zeta, "hacer", "cielo", "cinco"); la "s" es suave y relajada, NUNCA silbante ni marcada — prohibido el seseo y la "s" fuerte latinoamericana. Entonación madrileña coloquial, con la musicalidad plana del centro de España. RITMO RÁPIDO Y ÁGIL, como una madrileña hablando con un amigo — sin pausas artificiales ni cadencia de locutora. Timbre cálido, ligeramente grave, sensual sin exagerar. Encadena las frases con fluidez natural, relaja las terminaciones, suena espontánea e improvisada — jamás leída, jamás robótica, jamás de anuncio.'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const apiKey = process.env.ELEVENLABS_API_KEY
  const openaiKey = process.env.OPENAI_API_KEY
  if (!apiKey && !openaiKey) return NextResponse.json({ error: 'TTS not configured' }, { status: 503 })

  const { text } = await request.json()
  if (!text?.trim()) return NextResponse.json({ error: 'No text' }, { status: 400 })

  // 1) OpenAI gpt-4o-mini-tts — ~30x más barato que ElevenLabs con voz natural
  if (openaiKey) {
    try {
      const oRes = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini-tts',
          voice: 'shimmer',
          input: text,
          instructions: VOICE_INSTRUCTIONS,
          response_format: 'mp3',
          speed: 1.25,
        }),
      })
      if (oRes.ok) {
        const buffer = await oRes.arrayBuffer()
        return new NextResponse(buffer, {
          headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' },
        })
      }
      console.error('OpenAI TTS error:', oRes.status, (await oRes.text()).slice(0, 200))
    } catch (e: any) {
      console.error('OpenAI TTS fetch error:', e?.message)
    }
  }

  // 2) Fallback: ElevenLabs (Daniel)
  if (!apiKey) return NextResponse.json({ error: 'TTS failed' }, { status: 502 })
  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.42,
          similarity_boost: 0.80,
          style: 0.28,
          use_speaker_boost: true,
          speed: 1.12,
        },
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      console.error('ElevenLabs speak error:', res.status, err.slice(0, 200))
      return NextResponse.json({ error: 'TTS failed' }, { status: res.status })
    }

    const buffer = await res.arrayBuffer()
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
      },
    })
  } catch {
    return NextResponse.json({ error: 'TTS failed' }, { status: 502 })
  }
}
