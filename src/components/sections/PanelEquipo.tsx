'use client'
import { useEffect, useMemo, useState } from 'react'
import LucideIcon from '@/components/shared/LucideIcon'
import { BLU, GRN, RED, AMBAR, VIO } from '@/components/shared/design-tokens'
import { localDayKey, todayKey } from '@/components/shared/helpers'

// ─────────────────────────────────────────────────────────────────────────────
// EL PANEL DE TRABAJO DEL EQUIPO
//
// Javi: «quiero algo visual que ayude a ver qué han hecho todos a la vez: una
// dashboard de trabajo general».
//
// Lo que había estaba repartido en tres sitios —el pulso y el briefing al final
// de Fichar, la carga por persona en Reportes, los anillos de tareas en Equipo—
// y ninguno contestaba «qué está pasando ahora mismo».
//
// TRES DECISIONES, que son las que lo hacen legible:
//
//   1. El eje que faltaba es EL TIEMPO. La franja horaria de cada jornada dice de
//      un vistazo quién está dentro, desde cuándo y quién cerró, sin abrir nada.
//   2. Todo el equipo cabe en una pantalla. Nada de acordeones para lo principal:
//      quien entra treinta segundos tiene que ver que Fer lleva dos días sin
//      fichar sin buscarlo.
//   3. No se inventa nada. Solo hora de entrada y cierre, objetivos, tareas
//      completadas y ánimo — que es lo que la base guarda de verdad. No hay
//      presencia ni horas por tarea, así que no se fingen.
// ─────────────────────────────────────────────────────────────────────────────

type Persona = { id: string; name: string; initials?: string | null; avatar_color?: string | null }
type Entrada = { dia: string; entrada: string | null; cierre: string | null; entrada_at: string | null; cierre_at: string | null; animo: string | null }
type Tarea = { id: string; text: string; level?: string | null; completed_at?: string | null }
type Fila = { persona: Persona; entradas: Entrada[]; tareas: Tarea[] }
type Brief = { dias: string[]; equipo: Fila[]; sinActividad: string[] }

/** La jornada que dibuja la franja. Fuera de esto no se pinta nada. */
const H_INI = 8
const H_FIN = 20

const pct = (iso: string) => {
  const d = new Date(iso)
  const h = d.getHours() + d.getMinutes() / 60
  return Math.max(0, Math.min(100, ((h - H_INI) / (H_FIN - H_INI)) * 100))
}
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })

const ESTADOS = {
  cerrado:   { l: 'DÍA CERRADO', c: GRN },
  bloqueado: { l: 'BLOQUEADO', c: RED },
  curso:     { l: 'EN CURSO', c: BLU },
  tarde:     { l: 'ENTRÓ TARDE', c: AMBAR },
  sinFichar: { l: 'SIN FICHAR', c: 'rgba(255,255,255,0.3)' },
} as const

function estadoDe(e: Entrada | undefined) {
  if (!e || !e.entrada_at) return 'sinFichar' as const
  if (e.cierre_at) return 'cerrado' as const
  if (e.animo === 'bloqueado') return 'bloqueado' as const
  return new Date(e.entrada_at).getHours() >= 11 ? ('tarde' as const) : ('curso' as const)
}

export default function PanelEquipo({ profile }: { profile: { id?: string } | null }) {
  const [brief, setBrief] = useState<Brief | null>(null)
  const [fallo, setFallo] = useState(false)
  const [dia, setDia] = useState(() => todayKey())
  const [abierta, setAbierta] = useState<string | null>(null)
  const [resumen, setResumen] = useState<Record<string, { texto?: string; error?: string; cargando?: boolean }>>({})

  useEffect(() => {
    let vivo = true
    fetch('/api/diario/briefing?rango=semana')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(j => { if (vivo) setBrief(j) })
      // El fallo se PINTA. Sin esto, una consulta caída se ve igual que un equipo
      // que no ha fichado — y eso es una afirmación falsa sobre gente real.
      .catch(() => { if (vivo) setFallo(true) })
    return () => { vivo = false }
  }, [])

  const dias = useMemo(() => (brief?.dias ? [...brief.dias].sort() : []), [brief])
  useEffect(() => { if (dias.length && !dias.includes(dia)) setDia(dias[dias.length - 1]) }, [dias, dia])

  const pedirResumen = async (p: Persona) => {
    setResumen(r => ({ ...r, [p.id]: { cargando: true } }))
    try {
      const desde = dias[0] || dia
      const hasta = dias[dias.length - 1] || dia
      const res = await fetch(`/api/equipo/resumen?user=${encodeURIComponent(p.id)}&desde=${desde}&hasta=${hasta}`)
      if (!res.ok) throw new Error(String(res.status))
      const j = await res.json()
      setResumen(r => ({ ...r, [p.id]: { texto: j.texto } }))
    } catch {
      setResumen(r => ({ ...r, [p.id]: { error: 'No se pudo redactar ahora mismo. Inténtalo otra vez.' } }))
    }
  }

  if (fallo) return (
    <div className="rounded-2xl px-5 py-4 font-figtree text-[12.5px] break-words"
      style={{ background: `${AMBAR}10`, border: `1px solid ${AMBAR}33`, color: 'rgba(255,255,255,0.6)' }}>
      No se pudo leer el parte del equipo. No es que nadie haya fichado — es que la consulta falló.
    </div>
  )
  if (!brief) return (
    <div className="font-figtree text-[12px] py-6 text-center" style={{ color: 'rgba(255,255,255,0.28)' }}>
      Reuniendo el parte del equipo…
    </div>
  )

  const delDia = brief.equipo.map(f => ({ ...f, hoy: f.entradas.find(e => e.dia === dia) }))
  const fichados = delDia.filter(f => f.hoy?.entrada_at).length
  const bloqueados = delDia.filter(f => f.hoy?.animo === 'bloqueado').length
  const objetivos = delDia.reduce((n, f) => n + (f.hoy?.entrada || '').split('\n').filter(l => l.trim()).length, 0)
  const completadas = delDia.reduce((n, f) => n + f.tareas.filter(t => t.completed_at && localDayKey(t.completed_at) === dia).length, 0)
  const esHoy = dia === todayKey()

  return (
    <div>
      {/* ── LAS CIFRAS DEL DÍA ────────────────────────────────────────── */}
      <div className="grid grid-cols-4 rounded-2xl overflow-hidden mb-4" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
        {[
          { v: `${fichados}/${delDia.length}`, l: 'HAN FICHADO', c: fichados === delDia.length ? GRN : AMBAR },
          { v: String(bloqueados), l: 'BLOQUEADOS', c: bloqueados ? RED : 'rgba(255,255,255,0.25)' },
          { v: String(objetivos), l: 'OBJETIVOS', c: '#FFFFFF' },
          { v: String(completadas), l: 'COMPLETADAS', c: completadas ? BLU : 'rgba(255,255,255,0.25)' },
        ].map((k, i, arr) => (
          <div key={k.l} className="py-2.5 text-center" style={{ borderRight: i < arr.length - 1 ? '1px solid rgba(255,255,255,0.08)' : undefined }}>
            <div className="font-figtree text-[17px] font-black leading-none" style={{ color: k.c }}>{k.v}</div>
            <div className="font-syne text-[6.5px] font-black tracking-[0.16em] mt-1" style={{ color: 'rgba(255,255,255,0.26)' }}>{k.l}</div>
          </div>
        ))}
      </div>

      {/* ── LA JORNADA DE CADA UNO ───────────────────────────────────── */}
      <div className="flex justify-between font-syne text-[7.5px] font-black tracking-wide mb-1" style={{ color: 'rgba(255,255,255,0.2)', paddingLeft: 132 }}>
        {[8, 11, 14, 17, 20].map(h => <span key={h}>{h}:00</span>)}
      </div>

      {delDia.map(f => {
        const est = ESTADOS[estadoDe(f.hoy)]
        const e = f.hoy
        const hechas = f.tareas.filter(t => t.completed_at && localDayKey(t.completed_at) === dia)
        const objs = (e?.entrada || '').split('\n').filter(l => l.trim())
        const yo = f.persona.id === profile?.id
        const col = f.persona.avatar_color || VIO
        const ini = e?.entrada_at ? pct(e.entrada_at) : null
        const fin = e?.cierre_at ? pct(e.cierre_at) : (esHoy ? pct(new Date().toISOString()) : null)
        const abierto = abierta === f.persona.id
        const r = resumen[f.persona.id]
        return (
          <div key={f.persona.id} className="rounded-2xl mb-1" style={{ background: yo ? 'rgba(255,255,255,0.028)' : 'transparent' }}>
            <button onClick={() => setAbierta(abierto ? null : f.persona.id)}
              className="w-full flex items-center gap-2.5 px-2 py-2 text-left">
              <div className="flex items-center gap-2 flex-shrink-0" style={{ width: 130 }}>
                <span className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 font-syne text-[8.5px] font-black"
                  style={{ background: col + '22', color: col }}>
                  {f.persona.initials || (f.persona.name || '?').slice(0, 2).toUpperCase()}
                </span>
                <span className="font-figtree text-[12px] font-bold truncate" style={{ color: 'rgba(255,255,255,0.82)' }}>{f.persona.name}</span>
              </div>
              <div className="flex-1 min-w-0 relative rounded-lg" style={{ height: 19, background: 'rgba(255,255,255,0.035)' }}>
                {ini !== null && fin !== null ? (
                  <div className="absolute top-0 bottom-0 rounded-lg flex items-center px-2 font-syne text-[8.5px] font-black whitespace-nowrap overflow-hidden"
                    style={{ left: `${ini}%`, width: `${Math.max(6, fin - ini)}%`, background: `${est.c}33`, color: est.c }}>
                    {hhmm(e!.entrada_at!)}{e?.cierre_at ? ` — ${hhmm(e.cierre_at)}` : ' — en curso'}
                  </div>
                ) : (
                  <div className="absolute inset-0 flex items-center pl-2 font-syne text-[8.5px] font-black" style={{ color: 'rgba(255,255,255,0.28)' }}>
                    sin fichar
                  </div>
                )}
              </div>
              <span className="font-figtree text-[11px] font-bold flex-shrink-0 text-right" style={{ width: 44, color: 'rgba(255,255,255,0.55)' }}>
                {objs.length ? <><b style={{ color: '#fff' }}>{hechas.length}</b>/{objs.length}</> : '—'}
              </span>
              <span className="font-syne text-[8px] font-black tracking-[0.1em] flex-shrink-0 text-right" style={{ width: 78, color: est.c }}>{est.l}</span>
            </button>

            {/* ── QUÉ HA HECHO Y QUÉ HA PUESTO ────────────────────────── */}
            {abierto && (
              <div className="px-3 pb-3 pt-1">
                {!e && !hechas.length ? (
                  <div className="font-figtree text-[12px] py-2" style={{ color: 'rgba(255,255,255,0.3)' }}>
                    No escribió nada este día.
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {objs.length > 0 && (
                      <div>
                        <div className="font-syne text-[7px] font-black tracking-[0.2em] mb-1.5" style={{ color: 'rgba(255,255,255,0.24)' }}>SE PROPUSO</div>
                        {objs.map((o, i) => (
                          <div key={i} className="font-figtree text-[12.5px] leading-relaxed break-words" style={{ color: 'rgba(255,255,255,0.62)' }}>· {o}</div>
                        ))}
                      </div>
                    )}
                    {hechas.length > 0 && (
                      <div>
                        <div className="font-syne text-[7px] font-black tracking-[0.2em] mb-1.5" style={{ color: 'rgba(255,255,255,0.24)' }}>TAREAS COMPLETADAS</div>
                        <div className="flex flex-wrap gap-1.5">
                          {hechas.map(t => (
                            <span key={t.id} className="font-figtree text-[11.5px] px-2.5 py-1 rounded-lg break-words"
                              style={{ background: `${GRN}14`, color: 'rgba(210,255,230,0.8)' }}>{t.text}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {e?.cierre && (
                      <div>
                        <div className="font-syne text-[7px] font-black tracking-[0.2em] mb-1.5" style={{ color: 'rgba(255,255,255,0.24)' }}>BALANCE DEL DÍA</div>
                        <div className="font-figtree text-[12.5px] leading-relaxed whitespace-pre-wrap break-words" style={{ color: 'rgba(255,255,255,0.72)' }}>{e.cierre}</div>
                      </div>
                    )}
                    {e?.entrada_at && !e?.cierre_at && (
                      <div className="font-figtree text-[11.5px]" style={{ color: AMBAR }}>Empezó el día y no lo cerró.</div>
                    )}
                  </div>
                )}

                {/* ── EL TEXTO DE LA IA ─────────────────────────────────
                    Javi: «no formato tarea, sino un texto generado por IA si
                    pulsas el botón que te dice qué tal va el trabajador». Va sobre
                    LA SEMANA entera y no sobre el día abierto: un día suelto no da
                    para hablar de cómo le va a nadie. */}
                <div className="mt-3 pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  {!r ? (
                    <button onClick={() => pedirResumen(f.persona)}
                      className="flex items-center gap-2 font-syne text-[8.5px] font-black tracking-widest px-3.5 py-2 rounded-xl transition-all active:scale-95"
                      style={{ background: `${VIO}1E`, border: `1px solid ${VIO}44`, color: '#C9B6FF' }}>
                      <LucideIcon name="sparkles" size={12} color="#C9B6FF" />
                      ¿QUÉ TAL VA {(f.persona.name || '').split(' ')[0].toUpperCase()}?
                    </button>
                  ) : r.cargando ? (
                    <div className="font-figtree text-[12px]" style={{ color: 'rgba(255,255,255,0.35)' }}>Leyendo su semana…</div>
                  ) : r.error ? (
                    <div className="font-figtree text-[12px] break-words" style={{ color: AMBAR }}>{r.error}</div>
                  ) : (
                    <div className="rounded-xl px-3.5 py-3" style={{ background: `${VIO}10`, border: `1px solid ${VIO}2A` }}>
                      <div className="font-syne text-[7px] font-black tracking-[0.2em] mb-1.5" style={{ color: 'rgba(201,182,255,0.55)' }}>SEGÚN SU PARTE DE LA SEMANA</div>
                      <div className="font-figtree text-[13px] leading-relaxed break-words" style={{ color: 'rgba(238,235,255,0.86)' }}>{r.texto}</div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )
      })}

      {/* ── LA SEMANA, Y SE PUEDE PULSAR ──────────────────────────────── */}
      <div className="mt-5 pt-4" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="font-syne text-[8px] font-black tracking-[0.24em] mb-2.5" style={{ color: 'rgba(255,255,255,0.26)' }}>
          LA SEMANA · PULSA UN DÍA
        </div>
        <div className="grid gap-1 items-center" style={{ gridTemplateColumns: `130px repeat(${dias.length}, 1fr)` }}>
          <div />
          {dias.map(d => {
            const act = d === dia
            const dd = new Date(`${d}T12:00:00`)
            return (
              <button key={d} onClick={() => setDia(d)}
                className="font-syne text-[7px] font-black tracking-[0.1em] py-1 rounded-md transition-all"
                style={{ color: act ? '#fff' : 'rgba(255,255,255,0.28)', background: act ? 'rgba(255,255,255,0.09)' : 'transparent' }}>
                {['D', 'L', 'M', 'X', 'J', 'V', 'S'][dd.getDay()]}<br />
                <span style={{ fontSize: 6.5, opacity: 0.7 }}>{dd.getDate()}</span>
              </button>
            )
          })}
          {brief.equipo.map(f => (
            <div key={f.persona.id} className="contents">
              <div className="font-figtree text-[11px] font-bold truncate" style={{ color: 'rgba(255,255,255,0.5)' }}>{f.persona.name}</div>
              {dias.map(d => {
                const est = ESTADOS[estadoDe(f.entradas.find(e => e.dia === d))]
                const fin = new Date(`${d}T12:00:00`).getDay()
                const finde = fin === 0 || fin === 6
                return (
                  <button key={d} onClick={() => setDia(d)} title={`${f.persona.name} · ${d} · ${est.l.toLowerCase()}`}
                    className="rounded transition-all" style={{
                      height: 17,
                      background: finde ? 'rgba(255,255,255,0.03)' : `${est.c}${est.c.startsWith('rgba') ? '' : '66'}`,
                      outline: d === dia ? '1.5px solid rgba(255,255,255,0.22)' : 'none',
                    }} />
                )
              })}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-3 mt-3 font-syne text-[7.5px] font-black tracking-wide" style={{ color: 'rgba(255,255,255,0.32)' }}>
          {(['cerrado', 'curso', 'tarde', 'bloqueado', 'sinFichar'] as const).map(k => (
            <span key={k} className="flex items-center gap-1.5">
              <i className="inline-block rounded-sm" style={{ width: 8, height: 8, background: ESTADOS[k].c }} />
              {ESTADOS[k].l}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
