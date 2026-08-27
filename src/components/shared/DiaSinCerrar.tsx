'use client'
import { useState, useEffect, useCallback } from 'react'
import { BLU, GRN, AMBAR, SURFACE, SURF2, BORDER } from './design-tokens'
import LucideIcon from './LucideIcon'
import { todayKey } from './helpers'

// ─────────────────────────────────────────────────────────────────────────────
// EL DÍA QUE TE DEJASTE ABIERTO.
//
// Javi: «¿qué pasa si no cierras el día? Al día siguiente, cuando abras la app,
// que te salga un aviso de día anterior no cerrado».
//
// Lo que había: un push a las 20:00 y una regla que se lo cuenta al jefe. O sea
// que el aviso llegaba a todo el mundo MENOS a quien tiene que cerrarlo, dentro
// de la app, que es el único sitio donde se cierra.
//
// Tres decisiones:
//
// 1. NO BLOQUEA. Es el principio de toda la puesta en marcha y aquí vale igual:
//    «AHORA NO» lo quita hasta mañana. Un aviso que no se puede quitar se
//    aprende a ignorar, y este tiene que seguir funcionando dentro de un mes.
// 2. SE CIERRA AQUÍ MISMO. Mandarte a Fichar y que busques el día es pedirte
//    tres pasos para arreglar algo que ya te está molestando. Los objetivos se
//    tachan desde aquí y el día se cierra desde aquí.
// 3. LA HORA SE PIDE, NO SE INVENTA. Viene rellena con la última señal real de
//    ese día —la última tarea que completaste—, pero es un campo que puedes
//    corregir. Esa cifra acaba en el resumen del equipo.
// ─────────────────────────────────────────────────────────────────────────────

type Objetivo = { texto: string; hecha: boolean; taskId: string | null }
type DiaAbierto = { dia: string; entro: string; objetivos: Objetivo[]; horaSugerida: string | null }

const CLAVE_APLAZADO = 'nx_dia_sin_cerrar_aplazado'

/** «ayer», «el martes», o la fecha si ya queda lejos. */
function comoSeLlama(dia: string, hoy: string): string {
  const ayer = new Date(`${hoy}T12:00:00Z`)
  ayer.setUTCDate(ayer.getUTCDate() - 1)
  if (dia === ayer.toISOString().slice(0, 10)) return 'ayer'
  const d = new Date(`${dia}T12:00:00Z`)
  const diff = Math.round((new Date(`${hoy}T12:00:00Z`).getTime() - d.getTime()) / 86400000)
  const nombre = new Intl.DateTimeFormat('es-ES', { weekday: 'long', timeZone: 'UTC' }).format(d)
  if (diff <= 6) return `el ${nombre}`
  return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(d)
}

export default function DiaSinCerrar({ showToast, onCerrado }: {
  showToast: (m: string) => void
  onCerrado?: () => void
}) {
  const [dia, setDia] = useState<DiaAbierto | null>(null)
  const [otros, setOtros] = useState(0)
  const [hechos, setHechos] = useState<Set<string>>(new Set())
  const [hora, setHora] = useState('')
  const [balance, setBalance] = useState('')
  const [guardando, setGuardando] = useState(false)

  const buscar = useCallback(async () => {
    try {
      const r = await fetch('/api/diario/pendientes')
      if (!r.ok) return
      const j = await r.json()
      const lista: DiaAbierto[] = Array.isArray(j?.dias) ? j.dias : []
      // El aplazado es POR DÍA: si te dejaste dos abiertos, decir «ahora no» al de
      // ayer no debería esconder también el del martes.
      let aplazados: Record<string, string> = {}
      try { aplazados = JSON.parse(localStorage.getItem(CLAVE_APLAZADO) || '{}') } catch {}
      const hoy = todayKey()
      const vivos = lista.filter(d => aplazados[d.dia] !== hoy)
      // El MÁS ANTIGUO primero: es el que más cerca está de perderse del todo.
      setDia(vivos[0] || null)
      setOtros(Math.max(0, vivos.length - 1))
      if (vivos[0]) {
        setHechos(new Set(vivos[0].objetivos.filter(o => o.hecha).map(o => o.texto)))
        setHora(vivos[0].horaSugerida || '')
      }
    } catch { /* si no se puede comprobar, no se afirma que esté todo cerrado */ }
  }, [])
  useEffect(() => { buscar() }, [buscar])

  if (!dia) return null

  const aplazar = () => {
    try {
      const prev = JSON.parse(localStorage.getItem(CLAVE_APLAZADO) || '{}')
      localStorage.setItem(CLAVE_APLAZADO, JSON.stringify({ ...prev, [dia.dia]: todayKey() }))
    } catch {}
    setDia(null)
  }

  const cerrar = async () => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) { showToast('Pon la hora en que terminaste (por ejemplo 18:30)'); return }
    setGuardando(true)
    try {
      // Primero las tareas: si el cierre falla, al menos lo tachado queda tachado.
      // Al revés, un día cerrado con los objetivos sin tachar dice que no hiciste
      // nada, que es peor que no haberlo cerrado.
      for (const o of dia.objetivos) {
        const marcada = hechos.has(o.texto)
        if (!o.taskId || marcada === o.hecha) continue
        const r = await fetch(`/api/tasks/${o.taskId}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ done: marcada }),
        })
        if (!r.ok) { showToast('No se pudo actualizar un objetivo'); setGuardando(false); return }
      }
      const r = await fetch('/api/diario', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dia: dia.dia, cerrar: true, cierre_hora: hora,
          ...(balance.trim() ? { cierre: balance.trim() } : {}),
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { showToast(j?.error || 'No se pudo cerrar el día'); return }
      showToast(`Día ${dia.dia} cerrado`)
      onCerrado?.()
      await buscar()
      setBalance('')
    } catch { showToast('No se pudo cerrar el día') }
    finally { setGuardando(false) }
  }

  const hoy = todayKey()
  const campo = 'px-3 py-2 rounded-xl text-[13px] text-white placeholder-white/20 outline-none'
  const estiloCampo = { background: 'rgba(255,255,255,0.04)', border: `1px solid ${BORDER}`, caretColor: BLU }

  return (
    <div className="relative rounded-2xl overflow-hidden animate-fadeUp mb-3"
      style={{ background: SURFACE, border: `1px solid ${AMBAR}38` }}>
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: `radial-gradient(120% 130% at 0% 0%, ${AMBAR}12, transparent 60%)` }} />

      <div className="relative px-4 pt-3.5 pb-3">
        <div className="flex items-center gap-2 mb-2">
          <LucideIcon name="alert-triangle" size={12} color={AMBAR} />
          <span className="font-syne text-[7.5px] font-black tracking-[0.2em]" style={{ color: AMBAR }}>
            TE DEJASTE {comoSeLlama(dia.dia, hoy).toUpperCase()} SIN CERRAR
          </span>
          <div className="flex-1" />
          {otros > 0 && (
            <span className="font-syne text-[7px] font-black tracking-wide" style={{ color: 'rgba(255,255,255,0.25)' }}>
              Y {otros} MÁS
            </span>
          )}
        </div>

        <p className="font-figtree text-[12.5px] leading-snug mb-2.5" style={{ color: 'rgba(255,255,255,0.55)' }}>
          Fichaste a las {dia.entro} y no llegaste a cerrarlo. Ciérralo aquí y ya está.
        </p>

        {dia.objetivos.length > 0 && (
          <div className="flex flex-col gap-1 mb-2.5">
            {dia.objetivos.map(o => {
              const marcada = hechos.has(o.texto)
              return (
                <button key={o.texto} onClick={() => setHechos(s => {
                  const n = new Set(s); if (n.has(o.texto)) n.delete(o.texto); else n.add(o.texto); return n
                })}
                  className="flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left transition-all active:scale-[0.99]"
                  style={{ background: SURF2, border: `1px solid ${marcada ? `${GRN}38` : BORDER}` }}>
                  <div className="w-3.5 h-3.5 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ background: marcada ? `${GRN}2E` : 'transparent', border: `1px solid ${marcada ? GRN : 'rgba(255,255,255,0.18)'}` }}>
                    {marcada && <LucideIcon name="check" size={8} color={GRN} />}
                  </div>
                  <span className="font-figtree text-[12px] flex-1"
                    style={{ color: marcada ? 'rgba(255,255,255,0.32)' : 'rgba(255,255,255,0.75)', textDecoration: marcada ? 'line-through' : 'none' }}>
                    {o.texto}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        <div className="flex items-center gap-2 mb-2">
          <span className="font-syne text-[7px] font-black tracking-[0.18em] flex-shrink-0" style={{ color: 'rgba(255,255,255,0.3)' }}>
            TERMINASTE A LAS
          </span>
          <input type="time" value={hora} onChange={e => setHora(e.target.value)}
            className={campo} style={{ ...estiloCampo, width: '104px', colorScheme: 'dark' }} />
          {!dia.horaSugerida && (
            <span className="font-figtree text-[10.5px]" style={{ color: 'rgba(255,255,255,0.25)' }}>
              no sé a qué hora fue
            </span>
          )}
        </div>

        <input value={balance} onChange={e => setBalance(e.target.value)}
          placeholder="¿Cómo fue? (opcional)"
          className={`${campo} w-full font-figtree`} style={estiloCampo} />

        <div className="flex items-center gap-2 mt-3">
          <button onClick={aplazar} disabled={guardando}
            className="px-3 py-2 font-syne text-[8.5px] font-black tracking-widest disabled:opacity-40"
            style={{ color: 'rgba(255,255,255,0.3)' }}>
            AHORA NO
          </button>
          <div className="flex-1" />
          <button onClick={cerrar} disabled={guardando}
            className="px-4 py-2 rounded-xl font-syne text-[8.5px] font-black tracking-widest transition-all active:scale-95 disabled:opacity-40"
            style={{ background: `${AMBAR}1F`, border: `1px solid ${AMBAR}4D`, color: AMBAR }}>
            {guardando ? 'CERRANDO…' : 'CERRAR EL DÍA'}
          </button>
        </div>
      </div>
    </div>
  )
}
