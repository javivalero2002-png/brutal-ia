'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { BLU, GRN, AMBAR, SURFACE, SURF2, BORDER } from '@/components/shared/design-tokens'
import { LucideIcon, useIsMobile, todayKey, plural } from '@/components/shared'
import type { NexusData, Profile } from '@/types'
import type { IrASeccion } from '@/components/shared/secciones'

// ─────────────────────────────────────────────────────────────────────────────
// DIARIO — fichar en prosa, y que de ahí salgan las tareas.
//
// El problema que resuelve: crear una tarea por cada cosa que haces cuesta más que
// hacerla, así que no se crean, y entonces nadie sabe en qué anda nadie sin
// preguntar. Aquí se escribe como se habla —«entro a las 10, hoy voy a cerrar el
// presupuesto de Nike y montar el reel»— y la IA saca las tareas de ahí.
//
// Dos campos y no uno, a propósito: lo que vas a hacer y lo que has hecho no son
// lo mismo, y la diferencia entre ambos es justo lo que hace útil mirar atrás.
//
// Es COMPARTIDO: se ve el día de todo el equipo. Ese es el punto.
// ─────────────────────────────────────────────────────────────────────────────

interface Entrada {
  id: string
  user_id: string
  dia: string
  entrada: string | null
  cierre: string | null
  entrada_at: string | null
  cierre_at: string | null
  autor?: { id: string; name: string; initials?: string; color?: string } | null
}

interface TareaPropuesta { text: string; level: 'urgent' | 'high' | 'normal'; hecha: boolean }

interface Props {
  data: NexusData
  profile: Profile
  showToast: (m: string) => void
  onNavigate: IrASeccion
}

const horaCorta = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }) : ''

export default function DiarioSection({ data, profile, showToast, onNavigate }: Props) {
  const isMobile = useIsMobile()
  const [entradas, setEntradas] = useState<Entrada[]>([])
  const [cargando, setCargando] = useState(true)
  const [errorCarga, setErrorCarga] = useState(false)
  const [borradorEntrada, setBorradorEntrada] = useState('')
  const [borradorCierre, setBorradorCierre] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [propuestas, setPropuestas] = useState<TareaPropuesta[]>([])
  const [extrayendo, setExtrayendo] = useState(false)
  const [creando, setCreando] = useState(false)

  // Lo que hay escrito de VERDAD en el servidor para mi día. Sirve para no pisar
  // con un borrador vacío lo que ya estaba guardado.
  const miEntrada = entradas.find(e => e.user_id === profile?.id) || null
  const tocado = useRef(false)

  const cargar = useCallback(async () => {
    try {
      const res = await fetch('/api/diario')
      if (!res.ok) { setErrorCarga(true); return }
      const j = await res.json()
      setErrorCarga(false)
      setEntradas(Array.isArray(j.entradas) ? j.entradas : [])
    } catch { setErrorCarga(true) }
    finally { setCargando(false) }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  // El borrador se siembra UNA vez con lo guardado. Si se resembrara en cada
  // recarga, escribir mientras otro ficha te borraría lo tecleado.
  useEffect(() => {
    if (tocado.current || !miEntrada) return
    setBorradorEntrada(miEntrada.entrada || '')
    setBorradorCierre(miEntrada.cierre || '')
  }, [miEntrada])

  const guardar = async (campo: 'entrada' | 'cierre') => {
    const valor = campo === 'entrada' ? borradorEntrada : borradorCierre
    if (!valor.trim()) { showToast('Escribe algo antes de guardar'); return }
    setGuardando(true)
    try {
      const res = await fetch('/api/diario', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [campo]: valor.trim() }),
      })
      if (!res.ok) { showToast('No se pudo guardar'); return }
      await cargar()
      showToast(campo === 'entrada' ? 'Día abierto' : 'Día cerrado')
    } catch { showToast('No se pudo guardar') }
    finally { setGuardando(false) }
  }

  const proponer = async (texto: string) => {
    if (!texto.trim()) { showToast('Escribe primero qué has hecho'); return }
    setExtrayendo(true)
    setPropuestas([])
    try {
      const res = await fetch('/api/diario/extraer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texto }),
        signal: AbortSignal.timeout(30000),
      })
      if (!res.ok) { showToast('No se pudieron sacar tareas'); return }
      const j = await res.json()
      const lista: TareaPropuesta[] = Array.isArray(j.tareas) ? j.tareas : []
      setPropuestas(lista)
      // Se dice también cuando NO encuentra nada: sin esto, el botón parece roto.
      if (!lista.length) showToast('No he encontrado tareas concretas en ese texto')
    } catch { showToast('No se pudieron sacar tareas') }
    finally { setExtrayendo(false) }
  }

  const crearTodas = async () => {
    if (!propuestas.length) return
    setCreando(true)
    let ok = 0
    for (const p of propuestas) {
      try {
        await data.createTask({
          text: p.text,
          level: p.level,
          done: p.hecha,
          assigned_to: profile?.id,
          source: 'ai',
        })
        ok++
      } catch { /* se cuenta abajo: no se anuncia un éxito que no hubo */ }
    }
    setCreando(false)
    setPropuestas([])
    // La verdad, incluidos los que fallaron. Decir «creadas N» cuando entraron
    // menos es el patrón que este repo lleva toda la auditoría quitando.
    showToast(ok === propuestas.length
      ? `${plural(ok, 'tarea creada', 'tareas creadas')}`
      : `${ok} de ${propuestas.length} creadas — el resto falló`)
  }

  const quitarPropuesta = (i: number) => setPropuestas(ps => ps.filter((_, k) => k !== i))

  const colorNivel = (l: string) => l === 'urgent' ? '#E51D2A' : l === 'high' ? AMBAR : BLU

  return (
    <div className="h-full overflow-y-auto" style={{ padding: isMobile ? '1rem' : '1.75rem' }}>

      {/* ── MI DÍA ─────────────────────────────────────────────────────── */}
      <div className="rounded-2xl mb-5" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
        <div className="flex items-center gap-3 px-4 pt-4 pb-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${BLU}16` }}>
            <LucideIcon name="pen-line" size={16} color={BLU} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-syne text-[9px] font-black tracking-widest" style={{ color: BLU }}>MI DÍA</div>
            <div className="font-figtree text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
              {miEntrada?.entrada_at
                ? `Entraste a las ${horaCorta(miEntrada.entrada_at)}`
                : 'Escribe con qué entras y a qué vas'}
            </div>
          </div>
        </div>

        <div className="px-4 pb-4 flex flex-col gap-4">
          <div>
            <div className="font-syne text-[7px] font-black tracking-widest mb-2" style={{ color: 'rgba(255,255,255,0.25)' }}>
              CON QUÉ ENTRO
            </div>
            <textarea
              value={borradorEntrada}
              onChange={e => { tocado.current = true; setBorradorEntrada(e.target.value) }}
              placeholder="Entro a las 10. Hoy quiero cerrar el presupuesto de Nike y montar el reel de Mango…"
              rows={3}
              className="w-full px-3 py-2.5 rounded-xl text-[12px] text-white placeholder-white/20 outline-none resize-y"
              style={{ background: 'rgba(255,255,255,0.04)', border: `1.5px solid ${BORDER}`, caretColor: BLU, minHeight: '4.5rem' }}
            />
            <div className="flex gap-2 mt-2">
              <button onClick={() => guardar('entrada')} disabled={guardando}
                className="px-4 py-2 rounded-xl font-syne text-[9px] font-black tracking-widest disabled:opacity-40"
                style={{ background: `${BLU}18`, border: `1px solid ${BLU}35`, color: BLU }}>
                {miEntrada?.entrada_at ? 'ACTUALIZAR' : 'FICHAR'}
              </button>
            </div>
          </div>

          <div>
            <div className="font-syne text-[7px] font-black tracking-widest mb-2" style={{ color: 'rgba(255,255,255,0.25)' }}>
              QUÉ HE HECHO {miEntrada?.cierre_at ? `· cerrado a las ${horaCorta(miEntrada.cierre_at)}` : ''}
            </div>
            <textarea
              value={borradorCierre}
              onChange={e => { tocado.current = true; setBorradorCierre(e.target.value) }}
              placeholder="He mandado el presupuesto a Nike, he montado el reel y me falta la locución…"
              rows={3}
              className="w-full px-3 py-2.5 rounded-xl text-[12px] text-white placeholder-white/20 outline-none resize-y"
              style={{ background: 'rgba(255,255,255,0.04)', border: `1.5px solid ${BORDER}`, caretColor: GRN, minHeight: '4.5rem' }}
            />
            <div className="flex gap-2 mt-2 flex-wrap">
              <button onClick={() => guardar('cierre')} disabled={guardando}
                className="px-4 py-2 rounded-xl font-syne text-[9px] font-black tracking-widest disabled:opacity-40"
                style={{ background: `${GRN}18`, border: `1px solid ${GRN}35`, color: GRN }}>
                CERRAR EL DÍA
              </button>
              <button onClick={() => proponer(`${borradorEntrada}\n${borradorCierre}`)} disabled={extrayendo}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl font-syne text-[9px] font-black tracking-widest disabled:opacity-40"
                style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${BORDER}`, color: 'rgba(255,255,255,0.6)' }}>
                <LucideIcon name="sparkles" size={11} color="rgba(255,255,255,0.5)" />
                {extrayendo ? 'LEYENDO…' : 'SACAR TAREAS'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── PROPUESTAS ─────────────────────────────────────────────────── */}
      {propuestas.length > 0 && (
        <div className="rounded-2xl mb-5 overflow-hidden" style={{ background: SURF2, border: `1px solid ${BLU}30` }}>
          <div className="px-4 pt-3.5 pb-2">
            <div className="font-syne text-[9px] font-black tracking-widest" style={{ color: BLU }}>
              {plural(propuestas.length, 'TAREA ENCONTRADA', 'TAREAS ENCONTRADAS').toUpperCase()}
            </div>
            {/* Se dice que decide el usuario: nada se ha escrito todavía. */}
            <div className="font-figtree text-[10px] mt-0.5" style={{ color: 'rgba(255,255,255,0.32)' }}>
              Quita las que no valgan. No se ha creado nada aún.
            </div>
          </div>
          <div className="flex flex-col">
            {propuestas.map((p, i) => (
              <div key={i} className="flex items-start gap-2.5 px-4 py-2.5" style={{ borderTop: `1px solid ${BORDER}` }}>
                <span className="mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: colorNivel(p.level) }} />
                <div className="flex-1 min-w-0">
                  <div className="font-figtree text-[12px] text-white leading-snug">{p.text}</div>
                  {p.hecha && (
                    <div className="font-syne text-[7px] font-black tracking-widest mt-1" style={{ color: GRN }}>
                      YA HECHA · se creará marcada
                    </div>
                  )}
                </div>
                <button onClick={() => quitarPropuesta(i)} aria-label="Quitar esta tarea"
                  className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: 'rgba(255,255,255,0.04)' }}>
                  <LucideIcon name="x" size={12} color="rgba(255,255,255,0.35)" />
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-2 px-4 py-3" style={{ borderTop: `1px solid ${BORDER}` }}>
            <button onClick={crearTodas} disabled={creando}
              className="px-4 py-2 rounded-xl font-syne text-[9px] font-black tracking-widest disabled:opacity-40"
              style={{ background: `${BLU}20`, border: `1px solid ${BLU}45`, color: BLU }}>
              {creando ? 'CREANDO…' : `CREAR ${propuestas.length}`}
            </button>
            <button onClick={() => setPropuestas([])}
              className="px-4 py-2 rounded-xl font-syne text-[9px] font-black tracking-widest"
              style={{ color: 'rgba(255,255,255,0.35)', border: `1px solid ${BORDER}` }}>
              DESCARTAR
            </button>
          </div>
        </div>
      )}

      {/* ── EL DÍA DEL EQUIPO ──────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-3">
        <div className="font-syne text-[9px] font-black tracking-widest" style={{ color: 'rgba(255,255,255,0.3)' }}>
          HOY EN EL EQUIPO
        </div>
        <button onClick={() => onNavigate('tareas')}
          className="font-syne text-[8px] font-black tracking-widest" style={{ color: 'rgba(255,255,255,0.28)' }}>
          VER TAREAS →
        </button>
      </div>

      {/* Un fallo de carga NO se pinta como «nadie ha fichado»: son cosas
          distintas y confundirlas es lo que hace que un error pase semanas. */}
      {errorCarga ? (
        <div className="rounded-2xl px-4 py-6 text-center" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
          <div className="font-figtree text-[12px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
            No se pudo cargar el diario de hoy.
          </div>
          <button onClick={cargar} className="mt-2 font-syne text-[9px] font-black tracking-widest" style={{ color: BLU }}>
            REINTENTAR
          </button>
        </div>
      ) : cargando ? (
        <div className="font-figtree text-[12px] px-1" style={{ color: 'rgba(255,255,255,0.25)' }}>Cargando…</div>
      ) : entradas.length === 0 ? (
        <div className="rounded-2xl px-4 py-7 text-center" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
          <div className="font-figtree text-[12px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
            Nadie ha fichado todavía hoy.
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {entradas.map(e => (
            <div key={e.id} className="rounded-2xl px-4 py-3.5" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
              <div className="flex items-center gap-2.5 mb-2">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 font-syne text-[9px] font-black"
                  style={{ background: `${e.autor?.color || BLU}22`, color: e.autor?.color || BLU }}>
                  {e.autor?.initials || (e.autor?.name || '?').slice(0, 2).toUpperCase()}
                </div>
                <div className="font-figtree text-[12px] font-bold text-white">{e.autor?.name || 'Alguien'}</div>
                <div className="font-figtree text-[10px]" style={{ color: 'rgba(255,255,255,0.25)' }}>
                  {e.entrada_at ? `entró ${horaCorta(e.entrada_at)}` : ''}
                  {e.cierre_at ? ` · cerró ${horaCorta(e.cierre_at)}` : ''}
                </div>
              </div>
              {e.entrada && (
                <div className="font-figtree text-[12px] leading-snug mb-1.5" style={{ color: 'rgba(255,255,255,0.72)', whiteSpace: 'pre-wrap' }}>
                  {e.entrada}
                </div>
              )}
              {e.cierre && (
                <div className="rounded-xl px-3 py-2 mt-1.5" style={{ background: `${GRN}0C`, borderLeft: `2px solid ${GRN}55` }}>
                  <div className="font-syne text-[7px] font-black tracking-widest mb-1" style={{ color: `${GRN}` }}>HECHO</div>
                  <div className="font-figtree text-[12px] leading-snug" style={{ color: 'rgba(255,255,255,0.72)', whiteSpace: 'pre-wrap' }}>
                    {e.cierre}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="h-16" />
    </div>
  )
}
