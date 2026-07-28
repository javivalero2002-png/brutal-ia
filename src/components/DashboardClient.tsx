'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import NexusDashboard from '@/components/NexusDashboard'
import type { Profile } from '@/types'

export default function DashboardClient() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!session) {
        if (event === 'INITIAL_SESSION' || event === 'SIGNED_OUT') {
          window.location.href = '/login'
        }
        return
      }

      // Use /api/me which uses the admin client (bypasses RLS recursion bug)
      try {
        const resp = await fetch('/api/me', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        const prof: Profile = await resp.json()
        setProfile(prof)
        setLoading(false)
      } catch (err) {
        console.error('Profile load failed:', err)
        window.location.href = '/login'
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  if (loading) {
    // Misma pantalla EXACTA que la de carga de datos de NexusDashboard,
    // para que el paso de una a otra sea imperceptible (sin parpadeo al abrir).
    return (
      <div style={{ height: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#030308' }}>
        <div style={{ textAlign: 'center' }}>
          <div className="font-syne" style={{ fontSize: '10px', fontWeight: 900, letterSpacing: '0.3em', marginBottom: '24px', color: 'rgba(27,95,250,0.5)' }}>BRUTAL.IA</div>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
            <div className="w-1.5 h-1.5 rounded-full animate-dot1" style={{ background: '#1B5FFA' }} />
            <div className="w-1.5 h-1.5 rounded-full animate-dot2" style={{ background: '#1B5FFA' }} />
            <div className="w-1.5 h-1.5 rounded-full animate-dot3" style={{ background: '#1B5FFA' }} />
          </div>
        </div>
      </div>
    )
  }

  if (!profile) return null
  return <NexusDashboard profile={profile} />
}
