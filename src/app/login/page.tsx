'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const supabase = createClient()
    const { error: err } = await supabase.auth.signInWithPassword({ email, password })

    if (err) {
      setError(err.message === 'Invalid login credentials'
        ? 'Email o contraseña incorrectos'
        : err.message)
      setLoading(false)
      return
    }

    // Client-side navigation — same JS context, session stays in memory
    router.push('/dashboard')
  }

  const s = {
    page: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'radial-gradient(ellipse 900px 600px at 60% 20%, rgba(27,95,250,0.12), transparent 65%), #040409' } as React.CSSProperties,
    card: { background: 'linear-gradient(180deg,#0C0C1C 0%,#07070F 100%)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '20px', padding: '32px', width: '320px' } as React.CSSProperties,
    label: { display: 'block', fontFamily: 'Syne,sans-serif', fontSize: '9px', fontWeight: 700, letterSpacing: '3px', color: 'rgba(240,240,248,0.3)', textTransform: 'uppercase', marginBottom: '8px' } as React.CSSProperties,
    input: { width: '100%', padding: '12px 16px', borderRadius: '12px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(27,95,250,0.2)', color: 'white', fontSize: '14px', outline: 'none', boxSizing: 'border-box', marginBottom: '16px' } as React.CSSProperties,
    btn: { width: '100%', padding: '14px', borderRadius: '12px', background: '#1B5FFA', border: 'none', color: 'white', fontFamily: 'Syne,sans-serif', fontSize: '11px', fontWeight: 800, letterSpacing: '2px', cursor: 'pointer', marginTop: '4px' } as React.CSSProperties,
  }

  return (
    <div style={s.page}>
      <div>
        <div style={{ textAlign: 'center', marginBottom: '36px' }}>
          <img src="https://brutal.thehook-produccion.es/wp-content/themes/brutal-studios/assets/img/brutal-logo-white.svg" alt="Brutal Studios" style={{ height: '28px', margin: '0 auto 10px', display: 'block' }} />
          <div style={{ fontFamily: 'Syne,sans-serif', fontSize: '13px', fontWeight: 900, color: 'white', letterSpacing: '4px' }}>BRUTAL<span style={{color:'#1B5FFA'}}>.IA</span></div>
          <div style={{ fontFamily: 'Syne,sans-serif', fontSize: '9px', letterSpacing: '4px', color: 'rgba(255,255,255,0.2)', marginTop: '4px' }}>INTELIGENCIA ARTIFICIAL</div>
        </div>

        <div style={s.card}>
          <div style={{ fontFamily: 'Syne,sans-serif', fontSize: '17px', fontWeight: 800, color: 'white', marginBottom: '24px' }}>Acceder</div>

          {error && (
            <div style={{ padding: '10px 14px', borderRadius: '10px', background: 'rgba(229,29,42,0.1)', border: '1px solid rgba(229,29,42,0.25)', color: '#ff7070', fontSize: '13px', marginBottom: '16px' }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <label style={s.label}>Email</label>
            <input
              style={s.input}
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="pablo@brutalstudios.es"
              required
              autoComplete="email"
            />

            <label style={s.label}>Contraseña</label>
            <input
              style={{ ...s.input, marginBottom: '20px' }}
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="current-password"
            />

            <button
              type="submit"
              style={{ ...s.btn, opacity: loading ? 0.6 : 1, cursor: loading ? 'not-allowed' : 'pointer' }}
              disabled={loading}
            >
              {loading ? 'ENTRANDO…' : 'ENTRAR →'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
