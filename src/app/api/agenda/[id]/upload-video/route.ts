import { NextRequest, NextResponse } from 'next/server'

// Vídeos desactivados para ahorrar almacenamiento.
// Usar YouTube, Vimeo, Instagram o Google Drive y pegar el enlace en la app.
export async function POST(_request: NextRequest, _ctx: { params: Promise<{ id: string }> }) {
  return NextResponse.json(
    { error: 'La subida de vídeos está desactivada. Sube el vídeo a YouTube, Vimeo o Drive y pega el enlace.' },
    { status: 400 }
  )
}
