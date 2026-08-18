import { createClient, createAdminClient } from '@/lib/supabase/server'
import { extraerTareasDelDiario } from '@/lib/ai'
import { NextRequest, NextResponse } from 'next/server'

// Una llamada a Claude, corta. 30s sobra y deja margen para que el fallo lo dé la
// ruta con un mensaje, y no la plataforma cortando la función a secas.
export const maxDuration = 30

/**
 * Lee un texto de diario y devuelve las tareas que contiene. NO crea nada.
 *
 * Quien confirma es el usuario, desde la sección. Es el mismo trato que la tarjeta
 * de Harvey: el modelo propone y una persona decide. Crear a ciegas desde texto
 * libre, en una app que avisa por push a siete personas, es cómo se consigue que
 * el equipo aprenda a ignorar los avisos.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { texto } = await request.json().catch(() => ({ texto: '' }))
  if (typeof texto !== 'string' || !texto.trim()) {
    return NextResponse.json({ tareas: [] })
  }

  // El nombre sale de la sesión, no del cuerpo: solo sirve para dar contexto al
  // modelo, pero un nombre que llega del cliente es un nombre que se puede falsear.
  const admin = await createAdminClient()
  const { data: perfil } = await admin
    .from('profiles').select('name').eq('id', user.id).maybeSingle()

  const tareas = await extraerTareasDelDiario(texto, perfil?.name || '', 20_000)
  return NextResponse.json({ tareas })
}
