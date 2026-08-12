'use client'
import { useState } from 'react'
import NexusBootScreen from '@/components/NexusBootScreen'

export default function Cliente() {
  const [elegido, setElegido] = useState<string|null>(null)
  if (elegido) return <div style={{padding:40,color:'#fff',fontFamily:'system-ui'}}>Elegido: {elegido}</div>
  return <NexusBootScreen pedirEleccion estado="Preparando tu espacio…" onElegir={t=>setElegido(t)} />
}
