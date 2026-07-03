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
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#040409' }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          {[0, 1, 2].map(i => (
            <div
              key={i}
              style={{
                width: '8px', height: '8px', borderRadius: '50%', background: '#1B5FFA',
                animation: `pulse 1.2s ${i * 0.2}s infinite ease-in-out`,
              }}
            />
          ))}
        </div>
        <style>{`@keyframes pulse{0%,80%,100%{opacity:.2;transform:scale(.8)}40%{opacity:1;transform:scale(1)}}`}</style>
      </div>
    )
  }

  if (!profile) return null
  return <NexusDashboard profile={profile} />
}
