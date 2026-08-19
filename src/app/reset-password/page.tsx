'use client'
import { useState, useEffect } from 'react'
import { rutaApp } from '@/lib/appUrl'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { mensajeDeContrasena } from '@/lib/mensajesAuth'

// ─────────────────────────────────────────────────────────────────────────────
// Fijar contraseña. Es donde aterrizan DOS caminos:
//
//   · el enlace de invitación que genera el owner al dar de alta a alguien
//   · el "¿olvidaste tu contraseña?" del login
//
// Antes el enlace de invitación llevaba directo a /dashboard, así que la persona
// entraba sin llegar a poner contraseña nunca: la suya era la aleatoria que se
// genera al crear la cuenta, que no conoce nadie. Cambiarla en Ajustes exige la
// actual, y el login no ofrecía recuperarla. En cuanto cerraba sesión —o abría la
// app en el móvil, que es lo que pasa el primer día— se quedaba fuera y había que
// generarle otro enlace a mano.
//
// El enlace de Supabase deja una sesión de recuperación abierta, y con ella
// updateUser({password}) funciona sin pedir la anterior. Por eso esta página no
// pregunta por la contraseña actual: no la hay.
// ─────────────────────────────────────────────────────────────────────────────
export default function ResetPasswordPage() {
  const router = useRouter()
  const [pwd, setPwd] = useState('')
  const [pwd2, setPwd2] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState(false)
  const [sesion, setSesion] = useState<'comprobando' | 'si' | 'no'>('comprobando')

  useEffect(() => {
    // El enlace trae los tokens en el hash y supabase-js los canjea AL CARGAR,
    // pero ese canje es asíncrono. Preguntar una sola vez nada más montar llegaba
    // antes de tiempo y la página declaraba el enlace caducado con el enlace
    // perfectamente vivo — y encima mandaba a pedirle otro a Javi.
    //
    // Se hacen las tres cosas: preguntar, ESCUCHAR el cambio de estado (que es lo
    // que dispara el canje cuando termina), y solo declarar que no hay sesión tras
    // un plazo de gracia. Quien tenga un enlace bueno entra; quien lo tenga
    // gastado espera dos segundos y ve el aviso, que es el orden correcto de los
    // dos errores posibles.
    const supabase = createClient()
    let vivo = true
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (vivo && session) setSesion('si')
    })
    supabase.auth.getSession().then(({ data }) => { if (vivo && data.session) setSesion('si') })
    const plazo = setTimeout(() => { if (vivo) setSesion(a => (a === 'si' ? 'si' : 'no')) }, 2500)
    return () => { vivo = false; clearTimeout(plazo); sub.subscription.unsubscribe() }
  }, [])

  /**
   * Pedirse un enlace nuevo uno mismo.
   *
   * El aviso mandaba a «pedírselo a Javi», que es una dependencia absurda para
   * algo que la propia app sabe hacer: el enlace es de un SOLO USO y se gasta con
   * facilidad —basta con que quien lo reenvía por WhatsApp o Slack genere una
   * vista previa, porque el robot que la genera lo abre—. Con esto la persona se
   * desatasca sola.
   */
  const [emailNuevo, setEmailNuevo] = useState('')
  const [pidiendo, setPidiendo] = useState<'no' | 'si' | 'hecho'>('no')
  async function pedirOtro(e: React.FormEvent) {
    e.preventDefault()
    if (!emailNuevo.trim()) return
    setPidiendo('si')
    const supabase = createClient()
    const { error: errEnvio } = await supabase.auth.resetPasswordForEmail(emailNuevo.trim(), {
      // El dominio canónico, no el del navegador: esto viaja por CORREO y la app
      // sirve en dos hosts. Es lo que fija la regla de `enlaces compartibles`.
      redirectTo: rutaApp('/reset-password'),
    })
    // Un fallo REAL de envío (red caída, límite de peticiones) se dice, y el
    // formulario vuelve para poder reintentar: antes se decía «Hecho» pasara lo
    // que pasara y el formulario desaparecía, así que quien no recibiera nada se
    // quedaba esperando un correo que nunca salió y sin forma de volver a pedirlo.
    //
    // Que la cuenta NO EXISTA no es un fallo y se sigue diciendo lo mismo: Supabase
    // no lo distingue a propósito, y responder distinto convertiría esta pantalla
    // en un comprobador de qué correos están dados de alta.
    if (errEnvio) {
      setError('No se pudo enviar. Comprueba la conexión y vuelve a intentarlo.')
      setPidiendo('no')
      return
    }
    setError('')
    setPidiendo('hecho')
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    if (pwd.length < 8) { setError('Mínimo 8 caracteres'); return }
    if (pwd !== pwd2) { setError('Las dos contraseñas no coinciden'); return }
    setLoading(true); setError('')
    const supabase = createClient()
    const { error: err } = await supabase.auth.updateUser({ password: pwd })
    if (err) { console.error('[reset]', err.message); setError(mensajeDeContrasena(err.message)); setLoading(false); return }
    setOk(true)
    setTimeout(() => router.push('/dashboard'), 1200)
  }

  const s: Record<string, React.CSSProperties> = {
    // Scroll propio y centrado con `margin:auto` en el hijo, igual que en /login y
    // por lo mismo: el <body> es `height:100%; overflow:hidden` (globals.css:38),
    // así que lo que sobresalga se RECORTA sin barra que lo alcance, y
    // `align-items:center` desborda también por ARRIBA, adonde el scroll no llega.
    // Aquí el recorte es peor: esta página ya arranca más alta (dos campos, dos
    // etiquetas y el párrafo de explicación) y encima suma avisos —el de enlace
    // caducado, el de error, el de "guardada"—, así que se pasa de largo con
    // facilidad. Y es de un solo uso: si no se llega al botón GUARDAR Y ENTRAR hay
    // que pedir otro correo, porque el enlace de recuperación ya se ha consumido.
    page: { height: '100dvh', overflowY: 'auto', display: 'flex', background: '#05050C', padding: '20px 20px max(20px, env(safe-area-inset-bottom))' },
    card: { background: 'linear-gradient(180deg,#0C0C1C 0%,#07070F 100%)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '20px', padding: '32px', width: '100%', maxWidth: '380px' },
    label: { display: 'block', fontFamily: 'Syne,sans-serif', fontSize: '9px', fontWeight: 700, letterSpacing: '3px', color: 'rgba(240,240,248,0.3)', textTransform: 'uppercase', marginBottom: '8px' },
    input: { width: '100%', padding: '12px 16px', borderRadius: '12px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(27,95,250,0.2)', color: 'white', fontSize: '14px', marginBottom: '16px', outline: 'none' },
    btn: { width: '100%', padding: '14px', borderRadius: '12px', background: '#1B5FFA', border: 'none', color: 'white', fontFamily: 'Syne,sans-serif', fontSize: '11px', fontWeight: 800, letterSpacing: '2px', cursor: 'pointer' },
    aviso: { padding: '10px 14px', borderRadius: '10px', fontSize: '13px', marginBottom: '16px' },
  }

  return (
    <div style={s.page}>
      <div style={{ margin: 'auto', width: '100%', maxWidth: '380px' }}>
        <div style={{ textAlign: 'center', marginBottom: '36px' }}>
          <img src="/brutal-logo.svg" alt="Brutal Studios" style={{ height: '28px', margin: '0 auto 10px', display: 'block' }} />
          <div style={{ fontFamily: 'Syne,sans-serif', fontSize: '13px', fontWeight: 900, color: 'white', letterSpacing: '4px' }}>BRUTAL<span style={{ color: '#1B5FFA' }}>.IA</span></div>
        </div>

        <div style={s.card}>
          <div style={{ fontFamily: 'Syne,sans-serif', fontSize: '17px', fontWeight: 800, color: 'white', marginBottom: '8px' }}>Elige tu contraseña</div>
          <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.35)', marginBottom: '24px', lineHeight: 1.5 }}>
            Es la que usarás para entrar desde ahora, también en el móvil.
          </div>

          {sesion === 'comprobando' && (
            <div style={{ ...s.aviso, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.45)' }}>
              Comprobando el enlace…
            </div>
          )}
          {sesion === 'no' && (
            <div style={{ ...s.aviso, background: 'rgba(255,176,32,0.1)', border: '1px solid rgba(255,176,32,0.25)', color: '#FFB020' }}>
              {pidiendo === 'hecho'
                ? 'Hecho. Si ese correo está dado de alta, te llega un enlace nuevo en un minuto. Míralo también en spam.'
                : (
                  <>
                    Este enlace ya no vale: <strong>caducan en una hora y solo sirven una vez</strong>, y mandarlos
                    por WhatsApp o Slack los suele quemar porque la vista previa los abre sola.
                    <br /><br />
                    <strong>Si te dieron una contraseña temporal, entra con ella directamente</strong> — esa no
                    caduca. O pide un enlace nuevo aquí:
                  </>
                )}
            </div>
          )}
          {sesion === 'no' && pidiendo !== 'hecho' && (
            <form onSubmit={pedirOtro} style={{ marginBottom: '20px' }}>
              <input
                style={{ ...s.input, marginBottom: '10px' }}
                type="email" value={emailNuevo} onChange={e => setEmailNuevo(e.target.value)}
                placeholder="tu@brutalstudios.es" autoComplete="email"
                onFocus={e => { e.currentTarget.style.borderColor = 'rgba(27,95,250,0.55)' }}
                onBlur={e => { e.currentTarget.style.borderColor = 'rgba(27,95,250,0.2)' }}
              />
              <button type="submit" disabled={pidiendo === 'si' || !emailNuevo.trim()}
                style={{ ...s.btn, background: 'rgba(255,255,255,0.06)', opacity: pidiendo === 'si' || !emailNuevo.trim() ? 0.4 : 1 }}>
                {pidiendo === 'si' ? 'ENVIANDO…' : 'MÁNDAME UN ENLACE NUEVO'}
              </button>
            </form>
          )}
          {error && (
            <div style={{ ...s.aviso, background: 'rgba(229,29,42,0.1)', border: '1px solid rgba(229,29,42,0.25)', color: '#ff7070' }}>{error}</div>
          )}
          {ok && (
            <div style={{ ...s.aviso, background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)', color: '#22c55e' }}>
              Guardada. Entrando…
            </div>
          )}

          <form onSubmit={guardar}>
            <label style={s.label}>Nueva contraseña</label>
            <input style={s.input} type="password" value={pwd} onChange={e => setPwd(e.target.value)}
                   placeholder="Mínimo 8 caracteres" required autoComplete="new-password" disabled={sesion === 'no' || ok} 
              onFocus={e=>{e.currentTarget.style.borderColor='rgba(27,95,250,0.55)'}}
              onBlur={e=>{e.currentTarget.style.borderColor='rgba(27,95,250,0.2)'}}
              />
            <label style={s.label}>Repítela</label>
            <input style={s.input} type="password" value={pwd2} onChange={e => setPwd2(e.target.value)}
                   required autoComplete="new-password" disabled={sesion === 'no' || ok} 
              onFocus={e=>{e.currentTarget.style.borderColor='rgba(27,95,250,0.55)'}}
              onBlur={e=>{e.currentTarget.style.borderColor='rgba(27,95,250,0.2)'}}
              />
            <button style={{ ...s.btn, opacity: (loading || sesion !== 'si' || ok) ? 0.5 : 1 }}
                    type="submit" disabled={loading || sesion !== 'si' || ok}>
              {loading ? 'GUARDANDO…' : 'GUARDAR Y ENTRAR'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
