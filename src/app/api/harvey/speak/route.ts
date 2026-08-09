import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

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

  try {
    const res = await fetch('https://api.fish.audio/v1/tts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${fishKey}`,
        'Content-Type': 'application/json',
        model: 's2.1-pro',
      },
      body: JSON.stringify({
        text,
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
