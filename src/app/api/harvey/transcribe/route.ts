import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// Transcribir audio largo puede superar los 10s por defecto de Vercel
export const maxDuration = 60

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const apiKey = process.env.ELEVENLABS_API_KEY
  const groqKey = process.env.GROQ_API_KEY
  const openaiKey = process.env.OPENAI_API_KEY
  if (!apiKey && !groqKey && !openaiKey) return NextResponse.json({ error: 'STT not configured' }, { status: 503 })

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const audio = formData.get('audio') as Blob | null
  if (!audio || audio.size === 0) return NextResponse.json({ error: 'No audio' }, { status: 400 })

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

  // 2) OpenAI Whisper — barato ($0.006/min), útil si no hay clave de Groq
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

  // 3) Fallback: ElevenLabs Scribe
  if (!apiKey) return NextResponse.json({ error: 'STT failed' }, { status: 502 })
  const elForm = new FormData()
  elForm.append('file', audio, ext)
  elForm.append('model_id', 'scribe_v1')
  elForm.append('language_code', 'es')

  try {
    const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
      body: elForm,
    })

    if (!res.ok) {
      const err = await res.text()
      // Cuota de ElevenLabs agotada — que el cliente pueda avisar con claridad
      if (err.includes('quota_exceeded')) return NextResponse.json({ error: 'quota' }, { status: 402 })
      return NextResponse.json({ error: err }, { status: res.status })
    }

    const data = await res.json()
    return NextResponse.json({ text: (data.text || '').trim() })
  } catch {
    return NextResponse.json({ error: 'Transcription failed' }, { status: 500 })
  }
}
