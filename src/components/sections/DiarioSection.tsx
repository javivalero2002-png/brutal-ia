'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { BLU, GRN, AMBAR, RED, SURFACE, SURF2, BORDER } from '@/components/shared/design-tokens'
import { LucideIcon, useIsMobile, plural } from '@/components/shared'
import type { NexusData, Profile } from '@/types'
import type { IrASeccion } from '@/components/shared/secciones'

// ─────────────────────────────────────────────────────────────────────────────
// DIARIO — objetivos al entrar, balance al salir, y las tareas salen solas.
//
// El problema: crear una tarea por cada cosa que haces cuesta más que hacerla,
// así que no se crean, y nadie sabe en qué anda nadie sin preguntar.
//
// Tres decisiones que hacen que funcione:
//
// 1. SE GUARDA SOLO. La primera versión perdía lo escrito al cambiar de sección —
//    el dashboard desmonta la sección y el estado local moría con ella. Un diario
//    que te pierde lo tecleado no se usa dos veces. Ahora se autoguarda mientras
//    escribes; el botón solo FICHA la hora.
//
// 2. LOS DOS CAMPOS NO SON EL MISMO. Entrar es proponerse cosas; salir es mirar
//    si salieron. Por eso el de la mañana pide objetivos —uno por línea, que es
//    lo que luego se puede tachar— y el de la tarde te los enseña y te pregunta
//    cuáles cumpliste. Dos textareas gemelas no habrían dado eso.
//
// 3. LAS TAREAS SE PROPONEN SOLAS. Sin botón: cuando dejas de escribir, se leen
//    los objetivos y aparecen abajo. Tú solo aceptas o quitas.
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

/** Los objetivos, uno por línea. Es el formato que permite tacharlos luego. */
const lineas = (t?: string | null) =>
  (t || '').split('\n').map(l => l.replace(/^[-•*\s]+/, '').trim()).filter(Boolean)

export default function DiarioSection({ data, profile, showToast, onNavigate }: Props) {
  const isMobile = useIsMobile()
  const [entradas, setEntradas] = useState<Entrada[]>([])
  const [cargando, setCargando] = useState(true)
  const [errorCarga, setErrorCarga] = useState(false)
  const [objetivos, setObjetivos] = useState('')
  const [balance, setBalance] = useState('')
  const [cumplidos, setCumplidos] = useState<Set<string>>(new Set())
  const [estadoGuardado, setEstadoGuardado] = useState<'limpio' | 'guardando' | 'guardado'>('limpio')
  const [propuestas, setPropuestas] = useState<TareaPropuesta[]>([])
  const [leyendo, setLeyendo] = useState(false)
  const [creando, setCreando] = useState(false)
  const [fichando, setFichando] = useState(false)

  const miEntrada = entradas.find(e => e.user_id === profile?.id) || null
  const sembrado = useRef(false)
  const guardadoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const extraerTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ultimoExtraido = useRef('')

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

  // Se siembra UNA vez. Si se resembrara en cada recarga, escribir mientras otro
  // ficha te borraría lo tecleado — que es justo el bug que esto viene a cerrar.
  useEffect(() => {
    if (sembrado.current || !miEntrada) return
    sembrado.current = true
    setObjetivos(miEntrada.entrada || '')
    setBalance(miEntrada.cierre || '')
  }, [miEntrada])

  // ── Autoguardado ──────────────────────────────────────────────────────────
  // Con retardo: guardar en cada tecla sería una escritura por pulsación. Al
  // desmontar se vacía el temporizador y se guarda de golpe, que es lo que hace
  // que cambiar de sección ya no pierda nada.
  const guardarBorrador = useCallback(async (campos: { entrada?: string; cierre?: string }) => {
    setEstadoGuardado('guardando')
    try {
      const res = await fetch('/api/diario', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...campos, borrador: true }),
      })
      setEstadoGuardado(res.ok ? 'guardado' : 'limpio')
      if (!res.ok) showToast('No se pudo guardar el diario')
    } catch { setEstadoGuardado('limpio'); showToast('No se pudo guardar el diario') }
  }, [showToast])

  const alEscribir = (campo: 'entrada' | 'cierre', valor: string) => {
    if (campo === 'entrada') setObjetivos(valor); else setBalance(valor)
    setEstadoGuardado('guardando')
    if (guardadoTimer.current) clearTimeout(guardadoTimer.current)
    guardadoTimer.current = setTimeout(() => guardarBorrador({ [campo]: valor }), 1200)
  }

  // Guardar lo pendiente al salir de la sección. `pendienteRef` lleva lo último
  // tecleado porque el cleanup no ve el estado nuevo.
  const pendiente = useRef<{ entrada?: string; cierre?: string }>({})
  pendiente.current = { entrada: objetivos, cierre: balance }
  useEffect(() => () => {
    if (guardadoTimer.current) {
      clearTimeout(guardadoTimer.current)
      // Sin `await`: el componente se está desmontando. `keepalive` hace que el
      // navegador termine la petición aunque la página cambie.
      fetch('/api/diario', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...pendiente.current, borrador: true }),
        keepalive: true,
      }).catch(() => {})
    }
  }, [])

  // ── Las tareas se proponen solas ──────────────────────────────────────────
  useEffect(() => {
    const texto = [objetivos, balance].filter(Boolean).join('\n').trim()
    if (texto.length < 15 || texto === ultimoExtraido.current) return
    if (extraerTimer.current) clearTimeout(extraerTimer.current)
    // 2,5 s tras dejar de escribir: bastante para no llamar a mitad de frase, poco
    // para que aparezcan sin tener que pedirlo.
    extraerTimer.current = setTimeout(async () => {
      ultimoExtraido.current = texto
      setLeyendo(true)
      try {
        const res = await fetch('/api/diario/extraer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ texto }),
          signal: AbortSignal.timeout(30000),
        })
        if (!res.ok) return
        const j = await res.json()
        setPropuestas(Array.isArray(j.tareas) ? j.tareas : [])
      } catch { /* silencioso: no se ha pedido, no se avisa de que falló */ }
      finally { setLeyendo(false) }
    }, 2500)
    return () => { if (extraerTimer.current) clearTimeout(extraerTimer.current) }
  }, [objetivos, balance])

  const fichar = async (campo: 'entrada' | 'cierre') => {
    const valor = campo === 'entrada' ? objetivos : balance
    if (!valor.trim()) { showToast(campo === 'entrada' ? 'Escribe tus objetivos primero' : 'Cuenta qué has hecho'); return }
    setFichando(true)
    try {
      const res = await fetch('/api/diario', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [campo]: valor.trim() }),
      })
      if (!res.ok) { showToast('No se pudo fichar'); return }
      await cargar()
      showToast(campo === 'entrada' ? 'Día abierto' : 'Día cerrado')
    } catch { showToast('No se pudo fichar') }
    finally { setFichando(false) }
  }

  const crearTodas = async () => {
    if (!propuestas.length) return
    setCreando(true)
    let ok = 0
    for (const p of propuestas) {
      try {
        await data.createTask({ text: p.text, level: p.level, done: p.hecha, assigned_to: profile?.id, source: 'ai' })
        ok++
      } catch { /* se cuenta abajo */ }
    }
    setCreando(false)
    setPropuestas([])
    showToast(ok === propuestas.length
      ? plural(ok, 'tarea creada', 'tareas creadas')
      : `${ok} de ${propuestas.length} creadas — el resto falló`)
  }

  const objetivosDeHoy = lineas(miEntrada?.entrada || objetivos)
  const colorNivel = (l: string) => l === 'urgent' ? RED : l === 'high' ? AMBAR : BLU
  const yaCerrado = !!miEntrada?.cierre_at

  return (
    <div className="h-full overflow-y-auto" style={{ padding: isMobile ? '1rem' : '1.75rem' }}>

      {/* ── ENTRADA: OBJETIVOS ─────────────────────────────────────────── */}
      <div className="rounded-2xl mb-4" style={{ background: SURFACE, border: `1px solid ${miEntrada?.entrada_at ? BLU + '30' : BORDER}` }}>
        <div className="flex items-center gap-3 px-4 pt-4 pb-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${BLU}16` }}>
            <LucideIcon name="target" size={16} color={BLU} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-syne text-[9px] font-black tracking-widest" style={{ color: BLU }}>QUÉ ME PROPONGO HOY</div>
            <div className="font-figtree text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
              {miEntrada?.entrada_at ? `Fichaste a las ${horaCorta(miEntrada.entrada_at)}` : 'Un objetivo por línea'}
            </div>
          </div>
          {/* El estado del guardado, en pequeño. Sin esto, "se guarda solo" es una
              promesa que el usuario no puede comprobar. */}
          <div className="font-syne text-[7.5px] font-black tracking-widest flex-shrink-0" style={{ color: estadoGuardado === 'guardado' ? GRN : 'rgba(255,255,255,0.2)' }}>
            {estadoGuardado === 'guardando' ? 'GUARDANDO…' : estadoGuardado === 'guardado' ? 'GUARDADO' : ''}
          </div>
        </div>
        <div className="px-4 pb-4">
          <textarea
            value={objetivos}
            onChange={e => alEscribir('entrada', e.target.value)}
            placeholder={'Cerrar el presupuesto de Nike\nMontar el reel de Mango\nLlamar al proveedor'}
            rows={4}
            className="w-full px-3 py-2.5 rounded-xl text-[12.5px] text-white placeholder-white/20 outline-none resize-y leading-relaxed"
            style={{ background: 'rgba(255,255,255,0.04)', border: `1.5px solid ${BORDER}`, caretColor: BLU, minHeight: '5.5rem' }}
          />
          {!miEntrada?.entrada_at && (
            <button onClick={() => fichar('entrada')} disabled={fichando}
              className="mt-2 px-4 py-2 rounded-xl font-syne text-[9px] font-black tracking-widest disabled:opacity-40"
              style={{ background: `${BLU}18`, border: `1px solid ${BLU}35`, color: BLU }}>
              FICHAR ENTRADA
            </button>
          )}
        </div>
      </div>

      {/* ── SALIDA: ¿LOS CUMPLISTE? ────────────────────────────────────── */}
      <div className="rounded-2xl mb-5" style={{ background: SURFACE, border: `1px solid ${yaCerrado ? GRN + '30' : BORDER}` }}>
        <div className="flex items-center gap-3 px-4 pt-4 pb-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${GRN}16` }}>
            <LucideIcon name="check-circle" size={16} color={GRN} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-syne text-[9px] font-black tracking-widest" style={{ color: GRN }}>¿LO COMPLETASTE TODO?</div>
            <div className="font-figtree text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
              {yaCerrado ? `Cerraste a las ${horaCorta(miEntrada?.cierre_at)}` : 'Marca lo que sí, y cuenta el resto'}
            </div>
          </div>
        </div>

        {/* Los objetivos de la mañana, para tacharlos. Esto es lo que hace que la
            salida no sea otra caja de texto igual que la entrada. */}
        {objetivosDeHoy.length > 0 ? (
          <div className="px-4 pb-1 flex flex-col gap-1">
            {objetivosDeHoy.map((o, i) => {
              const hecho = cumplidos.has(o)
              return (
                <button key={i}
                  onClick={() => setCumplidos(s => { const n = new Set(s); n.has(o) ? n.delete(o) : n.add(o); return n })}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-left transition-all active:scale-[0.99]"
                  style={{ background: hecho ? `${GRN}0E` : 'rgba(255,255,255,0.03)', border: `1px solid ${hecho ? GRN + '30' : BORDER}` }}>
                  <span className="w-4 h-4 rounded-md flex items-center justify-center flex-shrink-0"
                    style={{ background: hecho ? GRN : 'transparent', border: `1.5px solid ${hecho ? GRN : 'rgba(255,255,255,0.18)'}` }}>
                    {hecho && <LucideIcon name="check" size={10} color="#06110A" />}
                  </span>
                  <span className="font-figtree text-[12px] flex-1 min-w-0"
                    style={{ color: hecho ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.8)', textDecoration: hecho ? 'line-through' : 'none' }}>
                    {o}
                  </span>
                </button>
              )
            })}
            <div className="font-figtree text-[10px] px-1 pt-1" style={{ color: 'rgba(255,255,255,0.25)' }}>
              {cumplidos.size} de {plural(objetivosDeHoy.length, 'objetivo', 'objetivos')}
            </div>
          </div>
        ) : (
          <div className="px-4 pb-2 font-figtree text-[11px]" style={{ color: 'rgba(255,255,255,0.25)' }}>
            Escribe arriba tus objetivos y aquí podrás ir tachándolos.
          </div>
        )}

        <div className="px-4 pt-3 pb-4">
          <textarea
            value={balance}
            onChange={e => alEscribir('cierre', e.target.value)}
            placeholder="Qué salió, qué se quedó a medias y por qué…"
            rows={3}
            className="w-full px-3 py-2.5 rounded-xl text-[12.5px] text-white placeholder-white/20 outline-none resize-y leading-relaxed"
            style={{ background: 'rgba(255,255,255,0.04)', border: `1.5px solid ${BORDER}`, caretColor: GRN, minHeight: '4.5rem' }}
          />
          {!yaCerrado && (
            <button onClick={() => fichar('cierre')} disabled={fichando}
              className="mt-2 px-4 py-2 rounded-xl font-syne text-[9px] font-black tracking-widest disabled:opacity-40"
              style={{ background: `${GRN}18`, border: `1px solid ${GRN}35`, color: GRN }}>
              CERRAR EL DÍA
            </button>
          )}
        </div>
      </div>

      {/* ── TAREAS QUE SALEN SOLAS ─────────────────────────────────────── */}
      {(propuestas.length > 0 || leyendo) && (
        <div className="rounded-2xl mb-5 overflow-hidden" style={{ background: SURF2, border: `1px solid ${BLU}30` }}>
          <div className="flex items-center gap-2 px-4 pt-3.5 pb-2">
            <LucideIcon name="sparkles" size={13} color={BLU} />
            <div className="font-syne text-[9px] font-black tracking-widest" style={{ color: BLU }}>
              {leyendo ? 'LEYENDO TU DÍA…' : plural(propuestas.length, 'TAREA ENCONTRADA', 'TAREAS ENCONTRADAS').toUpperCase()}
            </div>
          </div>
          {propuestas.length > 0 && (
            <>
              <div className="px-4 pb-1 font-figtree text-[10px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
                Salen de lo que has escrito. Quita las que no valgan; no se ha creado nada aún.
              </div>
              <div className="flex flex-col mt-1.5">
                {propuestas.map((p, i) => (
                  <div key={i} className="flex items-start gap-2.5 px-4 py-2.5" style={{ borderTop: `1px solid ${BORDER}` }}>
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: colorNivel(p.level) }} />
                    <div className="flex-1 min-w-0">
                      <div className="font-figtree text-[12px] text-white leading-snug">{p.text}</div>
                      {p.hecha && (
                        <div className="font-syne text-[7px] font-black tracking-widest mt-1" style={{ color: GRN }}>
                          YA HECHA · se creará marcada
                        </div>
                      )}
                    </div>
                    <button onClick={() => setPropuestas(ps => ps.filter((_, k) => k !== i))} aria-label={`Quitar «${p.text}»`}
                      className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(255,255,255,0.04)' }}>
                      <LucideIcon name="x" size={12} color="rgba(255,255,255,0.35)" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 px-4 py-3" style={{ borderTop: `1px solid ${BORDER}` }}>
                <button onClick={crearTodas} disabled={creando}
                  className="px-4 py-2 rounded-xl font-syne text-[9px] font-black tracking-widest disabled:opacity-40"
                  style={{ background: `${BLU}20`, border: `1px solid ${BLU}45`, color: BLU }}>
                  {creando ? 'CREANDO…' : `ACEPTAR ${propuestas.length}`}
                </button>
                <button onClick={() => setPropuestas([])}
                  className="px-4 py-2 rounded-xl font-syne text-[9px] font-black tracking-widest"
                  style={{ color: 'rgba(255,255,255,0.35)', border: `1px solid ${BORDER}` }}>
                  DESCARTAR
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── EL DÍA DEL EQUIPO ──────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-3">
        <div className="font-syne text-[9px] font-black tracking-widest" style={{ color: 'rgba(255,255,255,0.3)' }}>HOY EN EL EQUIPO</div>
        <button onClick={() => onNavigate('tareas')} className="font-syne text-[8px] font-black tracking-widest" style={{ color: 'rgba(255,255,255,0.28)' }}>
          VER TAREAS →
        </button>
      </div>

      {errorCarga ? (
        <div className="rounded-2xl px-4 py-6 text-center" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
          <div className="font-figtree text-[12px]" style={{ color: 'rgba(255,255,255,0.4)' }}>No se pudo cargar el diario de hoy.</div>
          <button onClick={cargar} className="mt-2 font-syne text-[9px] font-black tracking-widest" style={{ color: BLU }}>REINTENTAR</button>
        </div>
      ) : cargando ? (
        <div className="font-figtree text-[12px] px-1" style={{ color: 'rgba(255,255,255,0.25)' }}>Cargando…</div>
      ) : entradas.length === 0 ? (
        <div className="rounded-2xl px-4 py-7 text-center" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
          <div className="font-figtree text-[12px]" style={{ color: 'rgba(255,255,255,0.35)' }}>Nadie ha fichado todavía hoy.</div>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {entradas.map(e => {
            const objs = lineas(e.entrada)
            return (
              <div key={e.id} className="rounded-2xl px-4 py-3.5" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
                <div className="flex items-center gap-2.5 mb-2 flex-wrap">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 font-syne text-[9px] font-black"
                    style={{ background: `${e.autor?.color || BLU}22`, color: e.autor?.color || BLU }}>
                    {e.autor?.initials || (e.autor?.name || '?').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="font-figtree text-[12px] font-bold text-white">{e.autor?.name || 'Alguien'}</div>
                  <div className="font-figtree text-[10px]" style={{ color: 'rgba(255,255,255,0.25)' }}>
                    {e.entrada_at ? `entró ${horaCorta(e.entrada_at)}` : ''}{e.cierre_at ? ` · cerró ${horaCorta(e.cierre_at)}` : ''}
                  </div>
                  {/* Se ve de un vistazo si sigue en marcha o ya cerró. */}
                  <span className="font-syne text-[7px] font-black tracking-widest px-1.5 py-0.5 rounded-md"
                    style={{ background: e.cierre_at ? `${GRN}18` : `${AMBAR}18`, color: e.cierre_at ? GRN : AMBAR }}>
                    {e.cierre_at ? 'CERRADO' : 'EN MARCHA'}
                  </span>
                </div>
                {objs.length > 0 && (
                  <div className="flex flex-col gap-1 mb-1.5">
                    {objs.map((o, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <span className="mt-1.5 w-1 h-1 rounded-full flex-shrink-0" style={{ background: 'rgba(255,255,255,0.25)' }} />
                        <span className="font-figtree text-[12px] leading-snug" style={{ color: 'rgba(255,255,255,0.72)' }}>{o}</span>
                      </div>
                    ))}
                  </div>
                )}
                {e.cierre && (
                  <div className="rounded-xl px-3 py-2 mt-2" style={{ background: `${GRN}0C`, borderLeft: `2px solid ${GRN}55` }}>
                    <div className="font-syne text-[7px] font-black tracking-widest mb-1" style={{ color: GRN }}>BALANCE</div>
                    <div className="font-figtree text-[12px] leading-snug" style={{ color: 'rgba(255,255,255,0.72)', whiteSpace: 'pre-wrap' }}>{e.cierre}</div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="h-16" />
    </div>
  )
}
