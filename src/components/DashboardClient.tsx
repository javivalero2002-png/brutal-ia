'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import NexusDashboard from '@/components/NexusDashboard'
import NexusBootScreen from '@/components/NexusBootScreen'
import type { Profile } from '@/types'

export default function DashboardClient({ initialSection }: { initialSection?: string }) {
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
    return <NexusBootScreen />
  }

  if (!profile) return null
  return <NexusDashboard profile={profile} initialSection={initialSection} />
}
