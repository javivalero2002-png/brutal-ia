'use client'
import { useState, useEffect, useCallback } from 'react'
import { BLU, GRN, VIO, AMBAR, SURFACE, SURF2, BORDER, ACCENT_COLORS } from '@/components/shared/design-tokens'
import LucideIcon from '@/components/shared/LucideIcon'
import type { Profile } from '@/types'

// ─────────────────────────────────────────────────────────────────────────────
// PUESTA EN MARCHA — lo primero que ve cada persona del equipo.
//
// Hasta ahora todo han sido pruebas: la gente entraba con una contraseña que le
// dieron, sin Gmail conectado y sin avisos. Esto convierte esos cabos sueltos en
// un recorrido de una vez.
//
// Tres decisiones que la hacen usable, y las tres son por lo mismo — que nadie se
// quede fuera de la app por culpa de la pantalla que debía darle la bienvenida:
//
// 1. NADA BLOQUEA. Todos los pasos se pueden saltar. Un proceso que no deja pasar
//    hasta conectar Gmail deja tirado a quien tenga el móvil sin sesión de Google,
//    y encima el primer día.
// 2. SE PUEDE VOLVER. Conectar Gmail sale de la app (OAuth), así que el paso se
//    guarda para retomarlo al volver.
// 3. LO IMPORTANTE VA MARCADO. La contraseña se destaca porque la actual se la dio
//    otra persona; el resto es preferencia.
// ─────────────────────────────────────────────────────────────────────────────

const CLAVE_PASO = 'nx_onboarding_paso'

interface Props {
  profile: Profile
  onTerminar: () => void
  /** Cambia el tema y lo persiste. Lo pasa el dashboard, que ya lo tenía. */
  onTema: (claro: boolean) => void
  showToast: (m: string) => void
}

export default function PuestaEnMarcha({ profile, onTerminar, onTema, showToast }: Props) {
  const [paso, setPaso] = useState(0)
  const [guardando, setGuardando] = useState(false)

  // Perfil
  const [nombre, setNombre] = useState(profile?.name || '')
  const [iniciales, setIniciales] = useState(profile?.initials || '')
  const [color, setColor] = useState(profile?.avatar_color || BLU)

  // Contraseña
  const [actual, setActual] = useState('')
  const [nueva, setNueva] = useState('')
  const [repetida, setRepetida] = useState('')
  const [claveCambiada, setClaveCambiada] = useState(false)

  const [claro, setClaro] = useState(false)
  const [avisos, setAvisos] = useState(false)

  // Al volver de Google se retoma donde estaba. Sin esto, conectar Gmail te
  // devolvía al principio y había que pasar otra vez por todo.
  useEffect(() => {
    try {
      const guardado = Number(localStorage.getItem(CLAVE_PASO))
      if (Number.isFinite(guardado) && guardado > 0) setPaso(guardado)
      setClaro(document.documentElement.classList.contains('theme-light'))
    } catch { /* sin localStorage se empieza por el principio, que tampoco es grave */ }
  }, [])

  const irA = useCallback((n: number) => {
    setPaso(n)
    try { localStorage.setItem(CLAVE_PASO, String(n)) } catch {}
  }, [])

  const terminar = useCallback(async () => {
    setGuardando(true)
    try {
      const res = await fetch('/api/onboarding', { method: 'POST' })
      if (!res.ok) showToast('No se pudo guardar — te la volveremos a enseñar')
      try { localStorage.removeItem(CLAVE_PASO) } catch {}
      onTerminar()
    } catch {
      showToast('No se pudo guardar — te la volveremos a enseñar')
      onTerminar()
    } finally { setGuardando(false) }
  }, [onTerminar, showToast])

  const guardarPerfil = async () => {
    setGuardando(true)
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nombre.trim(), initials: iniciales.trim().slice(0, 2).toUpperCase(), avatar_color: color }),
      })
      if (!res.ok) { showToast('No se pudo guardar tu ficha'); return }
      irA(2)
    } catch { showToast('No se pudo guardar tu ficha') }
    finally { setGuardando(false) }
  }

  const cambiarClave = async () => {
    if (nueva.length < 8) { showToast('La nueva contraseña necesita al menos 8 caracteres'); return }
    if (nueva !== repetida) { showToast('Las dos contraseñas no coinciden'); return }
    setGuardando(true)
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: actual, newPassword: nueva }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { showToast(j?.error || 'No se pudo cambiar la contraseña'); return }
      setClaveCambiada(true)
      showToast('Contraseña cambiada')
      irA(3)
    } catch { showToast('No se pudo cambiar la contraseña') }
    finally { setGuardando(false) }
  }

  const activarAvisos = async () => {
    try {
      if (!('Notification' in window)) { showToast('Este navegador no admite avisos'); return }
      const permiso = await Notification.requestPermission()
      if (permiso !== 'granted') { showToast('Los avisos quedan desactivados — puedes activarlos en Operativa'); return }
      setAvisos(true)
      showToast('Avisos activados')
    } catch { showToast('No se pudieron activar los avisos') }
  }

  const PASOS = ['Bienvenida', 'Tu ficha', 'Contraseña', 'Aspecto', 'Gmail', 'Avisos', 'Listo']
  const ultimo = PASOS.length - 1

  const Cabecera = ({ icono, eyebrow, titulo, bajada }: { icono: string; eyebrow: string; titulo: string; bajada: string }) => (
    <div className="flex items-start gap-3 mb-5">
      <div className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0"
        style={{ background: `${VIO}1E`, border: `1px solid ${VIO}3A` }}>
        <LucideIcon name={icono} size={17} color={VIO} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-syne text-[8px] font-black tracking-[0.2em] mb-1" style={{ color: 'rgba(255,255,255,0.3)' }}>{eyebrow}</div>
        <h2 className="font-figtree text-[19px] font-black text-white leading-tight" style={{ letterSpacing: '-0.02em' }}>{titulo}</h2>
        <p className="font-figtree text-[12.5px] mt-1.5 leading-snug" style={{ color: 'rgba(255,255,255,0.42)' }}>{bajada}</p>
      </div>
    </div>
  )

  const Boton = ({ children, onClick, primario, disabled }: { children: React.ReactNode; onClick: () => void; primario?: boolean; disabled?: boolean }) => (
    <button onClick={onClick} disabled={disabled || guardando}
      className="px-5 py-2.5 rounded-2xl font-syne text-[9px] font-black tracking-widest transition-all active:scale-95 disabled:opacity-40"
      style={primario
        ? { background: `linear-gradient(140deg, ${VIO}38, ${BLU}26)`, border: `1px solid ${VIO}55`, color: '#E6DEFF' }
        : { border: `1px solid ${BORDER}`, color: 'rgba(255,255,255,0.4)' }}>
      {children}
    </button>
  )

  const campo = 'w-full px-3.5 py-3 rounded-2xl text-[13px] text-white placeholder-white/20 outline-none'
  const estiloCampo = { background: 'rgba(255,255,255,0.04)', border: `1px solid ${BORDER}`, caretColor: VIO }

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center p-4" style={{ background: 'rgba(2,2,10,0.88)', backdropFilter: 'blur(10px)' }}>
      <div className="w-full rounded-3xl overflow-hidden flex flex-col" style={{ maxWidth: '30rem', maxHeight: '92vh', background: SURFACE, border: `1px solid ${VIO}30` }}>

        {/* Progreso. Enseña cuántos pasos quedan: sin eso, un proceso de siete
            pantallas parece que no se acaba nunca. */}
        <div className="flex gap-1 px-5 pt-5">
          {PASOS.map((_, i) => (
            <div key={i} className="flex-1 rounded-full" style={{ height: '3px', background: i <= paso ? VIO : 'rgba(255,255,255,0.08)' }} />
          ))}
        </div>
        <div className="px-5 pt-2.5 font-syne text-[7.5px] font-black tracking-widest" style={{ color: 'rgba(255,255,255,0.25)' }}>
          PASO {paso + 1} DE {PASOS.length} · {PASOS[paso].toUpperCase()}
        </div>

        <div className="px-5 py-5 overflow-y-auto flex-1">

          {paso === 0 && (
            <>
              <Cabecera icono="sparkles" eyebrow="BRUTAL STUDIOS" titulo={`Bienvenido, ${(profile?.name || '').split(' ')[0] || 'compañero'}`}
                bajada="Vamos a dejar tu cuenta lista en un minuto. Puedes saltarte cualquier paso y hacerlo luego desde Operativa." />
              <div className="flex flex-col gap-2">
                {[
                  { i: 'user', t: 'Tu ficha', d: 'Nombre, iniciales y color con los que te verá el equipo' },
                  { i: 'key', t: 'Tu contraseña', d: 'La actual te la dio otra persona' },
                  { i: 'sun', t: 'Aspecto', d: 'Claro u oscuro' },
                  { i: 'mail', t: 'Gmail', d: 'Para que tu correo entre en la app' },
                  { i: 'bell', t: 'Avisos', d: 'Notificaciones de lo urgente' },
                ].map(x => (
                  <div key={x.t} className="flex items-center gap-3 px-3.5 py-2.5 rounded-2xl" style={{ background: SURF2, border: `1px solid ${BORDER}` }}>
                    <LucideIcon name={x.i} size={14} color="rgba(255,255,255,0.35)" />
                    <div className="flex-1 min-w-0">
                      <div className="font-figtree text-[12.5px] font-semibold text-white">{x.t}</div>
                      <div className="font-figtree text-[11px]" style={{ color: 'rgba(255,255,255,0.32)' }}>{x.d}</div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {paso === 1 && (
            <>
              <Cabecera icono="user" eyebrow="TU FICHA" titulo="Cómo te ve el equipo"
                bajada="Tus iniciales y tu color salen en cada tarea, en el diario y en el calendario." />
              <div className="flex items-center gap-3 mb-4">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 font-syne text-[15px] font-black"
                  style={{ background: `${color}26`, color, border: `1px solid ${color}45` }}>
                  {(iniciales || nombre.slice(0, 2) || '??').toUpperCase()}
                </div>
                <div className="flex-1 min-w-0 flex flex-col gap-2">
                  <input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Tu nombre" className={campo} style={estiloCampo} />
                  <input value={iniciales} onChange={e => setIniciales(e.target.value.slice(0, 2))} placeholder="Iniciales" maxLength={2}
                    className={campo} style={{ ...estiloCampo, textTransform: 'uppercase' }} />
                </div>
              </div>
              <div className="font-syne text-[7.5px] font-black tracking-widest mb-2" style={{ color: 'rgba(255,255,255,0.28)' }}>TU COLOR</div>
              <div className="flex flex-wrap gap-2">
                {ACCENT_COLORS.map(c => (
                  <button key={c} onClick={() => setColor(c)} aria-label={`Color ${c}`}
                    className="w-8 h-8 rounded-xl transition-all active:scale-90"
                    style={{ background: `${c}30`, border: `2px solid ${color === c ? c : 'transparent'}` }}>
                    <span className="block w-3 h-3 rounded-full mx-auto" style={{ background: c }} />
                  </button>
                ))}
              </div>
            </>
          )}

          {paso === 2 && (
            <>
              <Cabecera icono="key" eyebrow="SEGURIDAD" titulo="Pon tu propia contraseña"
                bajada="La que usas ahora te la dio otra persona, así que la conoce alguien más." />
              <div className="flex flex-col gap-2">
                <input type="password" value={actual} onChange={e => setActual(e.target.value)} placeholder="Contraseña actual" className={campo} style={estiloCampo} />
                <input type="password" value={nueva} onChange={e => setNueva(e.target.value)} placeholder="Nueva (mínimo 8 caracteres)" className={campo} style={estiloCampo} />
                <input type="password" value={repetida} onChange={e => setRepetida(e.target.value)} placeholder="Repite la nueva" className={campo} style={estiloCampo} />
              </div>
              {claveCambiada && (
                <div className="flex items-center gap-2 mt-3 font-figtree text-[12px]" style={{ color: GRN }}>
                  <LucideIcon name="check" size={13} color={GRN} /> Contraseña cambiada
                </div>
              )}
            </>
          )}

          {paso === 3 && (
            <>
              <Cabecera icono="sun" eyebrow="ASPECTO" titulo="Claro u oscuro"
                bajada="Se guarda en este aparato. Puedes cambiarlo cuando quieras desde la barra lateral." />
              <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
                {[
                  { c: false, t: 'Oscuro', d: 'El de siempre', bg: '#0A0A14', fg: '#F2F3F9' },
                  { c: true, t: 'Claro', d: 'Para mucha luz', bg: '#F2F3F5', fg: '#12131A' },
                ].map(o => (
                  <button key={o.t} onClick={() => { setClaro(o.c); onTema(o.c) }}
                    className="rounded-2xl p-3 text-left transition-all active:scale-95"
                    style={{ background: o.bg, border: `2px solid ${claro === o.c ? VIO : BORDER}` }}>
                    <div className="rounded-lg mb-2" style={{ height: '2.2rem', background: claro === o.c ? `${VIO}30` : 'rgba(128,128,150,0.18)' }} />
                    <div className="font-figtree text-[12.5px] font-bold" style={{ color: o.fg }}>{o.t}</div>
                    <div className="font-figtree text-[10.5px]" style={{ color: o.fg, opacity: 0.5 }}>{o.d}</div>
                  </button>
                ))}
              </div>
            </>
          )}

          {paso === 4 && (
            <>
              <Cabecera icono="mail" eyebrow="CORREO" titulo="Conecta tu Gmail"
                bajada="Tus correos entran en Inbox y la IA te marca los urgentes. Nexus no manda correo en tu nombre." />
              {profile?.gmail_connected ? (
                <div className="flex items-center gap-2 px-3.5 py-3 rounded-2xl font-figtree text-[12.5px]"
                  style={{ background: `${GRN}10`, border: `1px solid ${GRN}30`, color: GRN }}>
                  <LucideIcon name="check" size={14} color={GRN} />
                  Ya está conectado{profile.gmail_account ? ` · ${profile.gmail_account}` : ''}
                </div>
              ) : (
                <>
                  {/* Se avisa de que sale de la app: si no, el salto a Google parece
                      que ha pasado algo raro justo el primer día. */}
                  <p className="font-figtree text-[11.5px] mb-3" style={{ color: 'rgba(255,255,255,0.32)' }}>
                    Se abrirá Google para que des permiso. Al volver seguimos donde lo dejaste.
                  </p>
                  <a href="/api/gmail/connect?account=personal"
                    onClick={() => { try { localStorage.setItem(CLAVE_PASO, '4') } catch {} }}
                    className="flex items-center justify-center gap-2 w-full py-3 rounded-2xl font-syne text-[9px] font-black tracking-widest"
                    style={{ background: `${BLU}18`, border: `1px solid ${BLU}38`, color: BLU }}>
                    <LucideIcon name="mail" size={13} color={BLU} />
                    CONECTAR GMAIL
                  </a>
                </>
              )}
            </>
          )}

          {paso === 5 && (
            <>
              <Cabecera icono="bell" eyebrow="AVISOS" titulo="Que te avise de lo urgente"
                bajada="Solo para lo que no puede esperar: un correo urgente de cliente o una tarea que vence hoy." />
              {avisos ? (
                <div className="flex items-center gap-2 px-3.5 py-3 rounded-2xl font-figtree text-[12.5px]"
                  style={{ background: `${GRN}10`, border: `1px solid ${GRN}30`, color: GRN }}>
                  <LucideIcon name="check" size={14} color={GRN} /> Avisos activados
                </div>
              ) : (
                <button onClick={activarAvisos}
                  className="flex items-center justify-center gap-2 w-full py-3 rounded-2xl font-syne text-[9px] font-black tracking-widest"
                  style={{ background: `${AMBAR}18`, border: `1px solid ${AMBAR}38`, color: AMBAR }}>
                  <LucideIcon name="bell" size={13} color={AMBAR} />
                  ACTIVAR AVISOS
                </button>
              )}
            </>
          )}

          {paso === ultimo && (
            <>
              <Cabecera icono="check-circle" eyebrow="LISTO" titulo="Ya está"
                bajada="Todo lo que has elegido se puede cambiar en Operativa. Si te has saltado algo, está ahí." />
              <div className="rounded-2xl px-4 py-3.5" style={{ background: SURF2, border: `1px solid ${BORDER}` }}>
                <div className="font-syne text-[7.5px] font-black tracking-widest mb-2" style={{ color: 'rgba(255,255,255,0.3)' }}>POR DÓNDE EMPEZAR</div>
                <div className="flex flex-col gap-1.5 font-figtree text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                  <span>· <strong className="text-white">Hoy</strong> — tu resumen del día y Harvey</span>
                  <span>· <strong className="text-white">Diario</strong> — escribe qué te propones; se convierte en tareas</span>
                  <span>· <strong className="text-white">Inbox</strong> — tu correo, con lo urgente marcado</span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Nada bloquea: siempre se puede saltar. Un proceso que retiene a alguien
            fuera de la app el primer día es peor que uno incompleto. */}
        <div className="flex items-center gap-2 px-5 py-4" style={{ borderTop: `1px solid ${BORDER}` }}>
          {paso > 0 && paso < ultimo && (
            <Boton onClick={() => irA(paso - 1)}>ATRÁS</Boton>
          )}
          <div className="flex-1" />
          {paso < ultimo && (
            <button onClick={() => irA(paso + 1)}
              className="px-3 py-2.5 font-syne text-[9px] font-black tracking-widest"
              style={{ color: 'rgba(255,255,255,0.3)' }}>
              SALTAR
            </button>
          )}
          {paso === 0 && <Boton primario onClick={() => irA(1)}>EMPEZAR</Boton>}
          {paso === 1 && <Boton primario onClick={guardarPerfil}>GUARDAR</Boton>}
          {paso === 2 && <Boton primario onClick={cambiarClave} disabled={!actual || !nueva || !repetida}>CAMBIAR</Boton>}
          {(paso === 3 || paso === 4 || paso === 5) && <Boton primario onClick={() => irA(paso + 1)}>SIGUIENTE</Boton>}
          {paso === ultimo && <Boton primario onClick={terminar}>ENTRAR EN NEXUS</Boton>}
        </div>
      </div>
    </div>
  )
}
