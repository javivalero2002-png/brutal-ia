'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import NexusDashboard from '@/components/NexusDashboard'
import NexusBootScreen from '@/components/NexusBootScreen'
import type { Profile } from '@/types'

/** Persiste el tema. Igual que el conmutador del menú: cookie para que el
 *  servidor la lea en el HTML inicial (si no, hay destello) y localStorage por si
 *  queda alguna pestaña vieja abierta. */
function guardarTema(claro: boolean) {
  const valor = claro ? 'light' : 'dark'
  try { localStorage.setItem('nx_theme', valor) } catch {}
  try { document.cookie = `nx_theme=${valor}; path=/; max-age=31536000; samesite=lax` } catch {}
  document.documentElement.classList.toggle('theme-light', claro)
}

export default function DashboardClient({ initialSection }: { initialSection?: string }) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [perfilListo, setPerfilListo] = useState(false)
  // `null` mientras no se sabe; se resuelve en el efecto para no leer cookies
  // durante el render del servidor.
  const [debePreguntar, setDebePreguntar] = useState<boolean | null>(null)
  const [temaElegido, setTemaElegido] = useState(false)
  const [estado, setEstado] = useState('Comprobando tu sesión…')

  useEffect(() => {
    // Solo se pregunta la PRIMERA vez. Si ya hay tema guardado, el arranque es
    // una animación corta con la insignia: preguntar en cada carga convertiría un
    // detalle bonito en un peaje diario.
    const yaTiene = typeof document !== 'undefined' && /(?:^|;\s*)nx_theme=/.test(document.cookie)
    setDebePreguntar(!yaTiene)
    setTemaElegido(yaTiene)
  }, [])

  useEffect(() => {
    const supabase = createClient()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!session) {
        if (event === 'INITIAL_SESSION' || event === 'SIGNED_OUT') {
          window.location.href = '/login'
        }
        return
      }

      setEstado('Cargando tu perfil…')
      // Use /api/me which uses the admin client (bypasses RLS recursion bug)
      try {
        const resp = await fetch('/api/me', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        const prof: Profile = await resp.json()
        setProfile(prof)
        setEstado('Preparando tu espacio…')
        setPerfilListo(true)
      } catch (err) {
        console.error('Profile load failed:', err)
        window.location.href = '/login'
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  // La pantalla se mantiene hasta que se cumplen LAS DOS cosas: hay perfil y hay
  // tema. Antes solo esperaba al perfil, así que en la primera carga se veía la
  // carcasa vacía mientras el dashboard pedía sus diez endpoints — de ahí los
  // saltos y la sensación de que se quedaba pillado.
  const listo = perfilListo && temaElegido && debePreguntar !== null
  if (!listo) {
    return (
      <NexusBootScreen
        pedirEleccion={debePreguntar === true && !temaElegido}
        estado={estado}
        onElegir={tema => { guardarTema(tema === 'light'); setTemaElegido(true) }}
      />
    )
  }

  if (!profile) return null
  return <NexusDashboard profile={profile} initialSection={initialSection} />
}
