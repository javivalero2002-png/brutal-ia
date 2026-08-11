import { createClient, createAdminClient } from '@/lib/supabase/server'
import { checkAiRateLimit } from '@/lib/rate-limit'
import { NextRequest, NextResponse } from 'next/server'

// Transcribir audio largo puede superar los 10s por defecto de Vercel
export const maxDuration = 60

// Mismo razonamiento que /api/harvey/speak: esta ruta gasta dinero (cae a OpenAI
// Whisper, $0.006/min, cuando Groq falla o no está) y no tenía ni tope de tamaño
// ni límite de tasa. Un micrófono colgado en bucle facturaba sin techo. 25 MB es
// el máximo que aceptan ambos proveedores; por encima, la llamada iba a fallar
// igualmente después de haber subido el fichero entero.
const MAX_AUDIO_BYTES = 25 * 1024 * 1024

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const groqKey = process.env.GROQ_API_KEY
  const openaiKey = process.env.OPENAI_API_KEY
  if (!groqKey && !openaiKey) return NextResponse.json({ error: 'STT not configured' }, { status: 503 })

  const admin = await createAdminClient()
  if (await checkAiRateLimit(admin, user.id, 'stt')) {
    return NextResponse.json({ error: 'Demasiadas solicitudes. Espera un momento.' }, { status: 429 })
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const audio = formData.get('audio') as Blob | null
  if (!audio || audio.size === 0) return NextResponse.json({ error: 'No audio' }, { status: 400 })
  if (audio.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: 'Audio demasiado largo (máx. 25 MB)' }, { status: 413 })
  }

  const ext = audio.type.includes('mp4') ? 'recording.mp4' : 'recording.webm'

  const prompt = 'Brutal Studios, Harvey, clientes, proyectos, tareas, calendario, Gmail, contenido, Instagram, TikTok, YouTube, LinkedIn, equipo, colaboraciones'

  // 1) Groq Whisper — gratis (2.000 audios/día) y calidad top en español
  if (groqKey) {
    try {
      const gForm = new FormData()
      gForm.append('file', audio, ext)
      gForm.append('model', 'whisper-large-v3')
      gForm.append('language', 'es')
      gForm.append('temperature', '0')
      gForm.append('prompt', prompt)
      const gRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${groqKey}` },
        body: gForm,
      })
      if (gRes.ok) {
        const data = await gRes.json()
        return NextResponse.json({ text: (data.text || '').trim(), provider: 'groq' })
      }
      console.error('Groq STT error:', gRes.status, (await gRes.text()).slice(0, 200))
    } catch (e: any) {
      console.error('Groq STT fetch error:', e?.message)
    }
  }

  // 2) OpenAI Whisper — fallback barato ($0.006/min) si Groq falla o no está
  if (openaiKey) {
    try {
      const oForm = new FormData()
      oForm.append('file', audio, ext)
      oForm.append('model', 'whisper-1')
      oForm.append('language', 'es')
      oForm.append('temperature', '0')
      oForm.append('prompt', prompt)
      const oRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${openaiKey}` },
        body: oForm,
      })
      if (oRes.ok) {
        const data = await oRes.json()
        return NextResponse.json({ text: (data.text || '').trim(), provider: 'openai' })
      }
      console.error('OpenAI STT error:', oRes.status, (await oRes.text()).slice(0, 200))
    } catch (e: any) {
      console.error('OpenAI STT fetch error:', e?.message)
    }
  }

  return NextResponse.json({ error: 'Transcription failed' }, { status: 502 })
}
