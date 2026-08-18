'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { BLU, GRN, AMBAR, RED, VIO, SURFACE, SURF2, BORDER } from '@/components/shared/design-tokens'
import { LucideIcon, useIsMobile, plural, ProgressRing } from '@/components/shared'
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
  autor?: { id: string; name: string; initials?: string; avatar_color?: string } | null
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

/**
 * Para comparar textos de tarea sin que una tilde o una mayúscula los haga
 * distintos. Se usa para no volver a proponer lo que ya es una tarea.
 */
const normalizar = (t: string) =>
  (t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()

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
  // Briefing: solo para el propietario. Se pide bajo demanda, no al abrir la
  // sección — es una consulta pesada que la mayoría de las visitas no necesita.
  const esJefe = profile?.role === 'owner'
  const [briefing, setBriefing] = useState<any>(null)
  const [rango, setRango] = useState<'dia' | 'semana'>('dia')
  const [cargandoBrief, setCargandoBrief] = useState(false)

  const miEntrada = entradas.find(e => e.user_id === profile?.id) || null
  const sembrado = useRef(false)
  const guardadoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const extraerTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ultimoExtraido = useRef('')
  // Lo que has quitado a mano no vuelve. Sin esto, cada relectura del texto lo
  // resucitaba y había que quitarlo otra vez.
  const rechazadas = useRef<Set<string>>(new Set())

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
        const brutas: TareaPropuesta[] = Array.isArray(j.tareas) ? j.tareas : []
        // No volver a proponer lo que YA es una tarea, ni lo que ya has quitado.
        //
        // Sin esto, al escribir el balance para cerrar el día el extractor releía
        // los objetivos de la mañana y te ofrecía otra vez las tareas que acabas de
        // aceptar. Comparar contra `data.tasks` en vez de contra una lista en
        // memoria hace que siga funcionando tras recargar.
        const yaSon = new Set((data.tasks || []).map((t: { text?: string }) => normalizar(t.text || '')))
        setPropuestas(brutas.filter(p => {
          const k = normalizar(p.text)
          return k && !yaSon.has(k) && !rechazadas.current.has(k)
        }))
      } catch { /* silencioso: no se ha pedido, no se avisa de que falló */ }
      finally { setLeyendo(false) }
    }, 2500)
    return () => { if (extraerTimer.current) clearTimeout(extraerTimer.current) }
  }, [objetivos, balance])

  /**
   * Fichar. Y aquí está lo que hace que el diario sirva para algo:
   *
   *  · AL ENTRAR, cada objetivo se convierte en una tarea tuya. No hay que
   *    aceptarlas una a una: las has escrito tú, línea a línea, así que ya has
   *    dicho lo que son. La IA sigue haciendo falta para el BALANCE, que es prosa
   *    libre; para una lista de objetivos, una línea es una tarea y punto.
   *  · AL CERRAR, las que hayas tachado se marcan como completadas.
   *
   * Las tareas se emparejan por texto normalizado. No hace falta guardar ids: el
   * objetivo y la tarea nacen del mismo texto, y comparar sin tildes ni mayúsculas
   * aguanta que retoques una línea.
   */
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

      if (campo === 'entrada') {
        // Una tarea por objetivo, saltando lo que ya existe: fichar dos veces no
        // puede duplicar la lista.
        const yaSon = new Set((data.tasks || []).map((t: { text?: string }) => normalizar(t.text || '')))
        const nuevas = lineas(valor).filter(o => !yaSon.has(normalizar(o)))
        let creadas = 0
        for (const o of nuevas) {
          try {
            await data.createTask({ text: o, level: 'high', done: false, assigned_to: profile?.id, source: 'ai' })
            creadas++
          } catch { /* se cuenta abajo */ }
        }
        await cargar()
        showToast(creadas
          ? `Día abierto · ${plural(creadas, 'tarea creada', 'tareas creadas')}`
          : 'Día abierto')
        return
      }

      // Cerrar: completar lo tachado.
      const marcados = objetivosDeHoy.filter(o => cumplidos.has(o)).map(normalizar)
      const aCerrar = (data.tasks || []).filter((t: { id: string; text?: string; done?: boolean }) =>
        !t.done && marcados.includes(normalizar(t.text || '')))
      let cerradas = 0
      for (const t of aCerrar) {
        try { await data.updateTask(t.id, { done: true }); cerradas++ } catch { /* idem */ }
      }
      await cargar()
      showToast(cerradas
        ? `Día cerrado · ${plural(cerradas, 'tarea completada', 'tareas completadas')}`
        : 'Día cerrado')
    } catch { showToast('No se pudo fichar') }
    finally { setFichando(false) }
  }

  const pedirBriefing = useCallback(async (r: 'dia' | 'semana') => {
    setRango(r); setCargandoBrief(true)
    try {
      const res = await fetch(`/api/diario/briefing?rango=${r}`)
      if (!res.ok) { showToast('No se pudo cargar el briefing'); setBriefing(null); return }
      setBriefing(await res.json())
    } catch { showToast('No se pudo cargar el briefing'); setBriefing(null) }
    finally { setCargandoBrief(false) }
  }, [showToast])

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
  // Los objetivos ya no existen se descuentan solos: si borras una línea, su
  // marca de cumplido deja de contar en vez de inflar el porcentaje.
  const cumplidosVivos = objetivosDeHoy.filter(o => cumplidos.has(o)).length
  const pctObjetivos = objetivosDeHoy.length ? Math.round((cumplidosVivos / objetivosDeHoy.length) * 100) : 0
  const colorNivel = (l: string) => l === 'urgent' ? RED : l === 'high' ? AMBAR : BLU
  const yaCerrado = !!miEntrada?.cierre_at

  return (
    <div className="h-full overflow-y-auto" style={{ padding: isMobile ? '1rem' : '1.75rem' }}>

      {/* ── ESTADO DEL DÍA ─────────────────────────────────────────────
          Una franja que informa en vez de titular: a qué hora entraste, cuántos
          objetivos llevas y si el día sigue abierto. Antes eran dos cabeceras
          gemelas ocupando el doble y sin decir nada que no estuviera debajo. */}
      <div className="relative rounded-3xl mb-4 overflow-hidden" style={{ background: SURF2, border: `1px solid ${BORDER}` }}>
        {/* Halo del color del estado. Es el mismo recurso que usa el orbe de
            Harvey, y ata la sección al resto de la app en vez de inventar otro. */}
        <div className="absolute pointer-events-none" aria-hidden
          style={{ width: '60%', height: '160%', top: '-40%', right: '-10%', borderRadius: '9999px',
                   background: `radial-gradient(closest-side, ${yaCerrado ? GRN : BLU}1A, transparent)`, filter: 'blur(28px)' }} />
        <div className="relative flex items-center gap-4 px-5 py-4">
          <div className="flex-shrink-0" style={{ position: 'relative' }}>
            <ProgressRing pct={pctObjetivos} size={54} stroke={3} color={yaCerrado ? GRN : BLU} />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="font-syne text-[13px] font-black" style={{ color: yaCerrado ? GRN : BLU }}>
                {objetivosDeHoy.length ? cumplidosVivos : '·'}
              </span>
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-syne text-[8px] font-black tracking-widest mb-0.5" style={{ color: 'rgba(255,255,255,0.28)' }}>
              MI DÍA · {new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Madrid' }).toUpperCase()}
            </div>
            <div className="font-figtree text-[14px] font-bold text-white leading-tight">
              {objetivosDeHoy.length
                ? `${cumplidosVivos} de ${plural(objetivosDeHoy.length, 'objetivo', 'objetivos')}`
                : 'Sin objetivos todavía'}
            </div>
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              <span className="font-syne text-[7px] font-black tracking-widest px-2 py-0.5 rounded-full"
                style={{ background: yaCerrado ? `${GRN}18` : `${AMBAR}18`, color: yaCerrado ? GRN : AMBAR }}>
                {yaCerrado ? 'CERRADO' : miEntrada?.entrada_at ? 'EN MARCHA' : 'SIN FICHAR'}
              </span>
              {miEntrada?.entrada_at && (
                <span className="font-figtree text-[10px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
                  entrada {horaCorta(miEntrada.entrada_at)}{miEntrada.cierre_at ? ` · cierre ${horaCorta(miEntrada.cierre_at)}` : ''}
                </span>
              )}
            </div>
          </div>
          {/* El guardado, discreto pero visible: "se guarda solo" tiene que poder
              comprobarse o no es una promesa, es fe. */}
          <div className="font-syne text-[7px] font-black tracking-widest flex-shrink-0 transition-opacity"
            style={{ color: estadoGuardado === 'guardado' ? GRN : 'rgba(255,255,255,0.25)', opacity: estadoGuardado === 'limpio' ? 0 : 1 }}>
            {estadoGuardado === 'guardando' ? 'GUARDANDO' : 'GUARDADO'}
          </div>
        </div>
      </div>

      {/* ── LOS DOS PANELES ────────────────────────────────────────────────
          Lado a lado en escritorio: proponerse y cumplir son las dos mitades de
          lo mismo, y verlas juntas es la mitad del valor. Apilados en móvil. */}
      <div className={isMobile ? 'flex flex-col gap-3 mb-5' : 'grid gap-3 mb-5'} style={isMobile ? undefined : { gridTemplateColumns: '1fr 1fr' }}>

        {/* OBJETIVOS */}
        <div className="rounded-3xl flex flex-col" style={{ background: SURFACE, border: `1px solid ${miEntrada?.entrada_at ? BLU + '28' : BORDER}` }}>
          <div className="flex items-center gap-2 px-4 pt-3.5 pb-2">
            <LucideIcon name="target" size={13} color={BLU} />
            <div className="font-syne text-[8.5px] font-black tracking-widest" style={{ color: BLU }}>QUÉ ME PROPONGO</div>
          </div>
          <div className="px-4 pb-4 flex-1 flex flex-col">
            <textarea
              value={objetivos}
              onChange={e => alEscribir('entrada', e.target.value)}
              placeholder={'Cerrar el presupuesto de Nike\nMontar el reel de Mango\nLlamar al proveedor'}
              rows={4}
              className="w-full px-3 py-2.5 rounded-2xl text-[12.5px] text-white placeholder-white/20 outline-none resize-none leading-relaxed flex-1"
              style={{ background: 'rgba(255,255,255,0.035)', border: `1px solid ${BORDER}`, caretColor: BLU, minHeight: '6rem' }}
            />
            {!miEntrada?.entrada_at && (
              <button onClick={() => fichar('entrada')} disabled={fichando}
                className="mt-2.5 w-full py-2.5 rounded-2xl font-syne text-[9px] font-black tracking-widest disabled:opacity-40 transition-all active:scale-[0.99]"
                style={{ background: `${BLU}16`, border: `1px solid ${BLU}32`, color: BLU }}>
                FICHAR ENTRADA
              </button>
            )}
          </div>
        </div>

        {/* BALANCE — los objetivos como burbujas tachables. Esto es lo que hace
            que la salida no sea otra caja de texto igual que la entrada. */}
        <div className="rounded-3xl flex flex-col" style={{ background: SURFACE, border: `1px solid ${yaCerrado ? GRN + '28' : BORDER}` }}>
          <div className="flex items-center gap-2 px-4 pt-3.5 pb-2">
            <LucideIcon name="check-circle" size={13} color={GRN} />
            <div className="font-syne text-[8.5px] font-black tracking-widest" style={{ color: GRN }}>¿LO COMPLETÉ?</div>
          </div>

          {objetivosDeHoy.length > 0 ? (
            <div className="px-4 pb-2 flex flex-wrap gap-1.5">
              {objetivosDeHoy.map((o, i) => {
                const hecho = cumplidos.has(o)
                return (
                  <button key={i}
                    onClick={() => setCumplidos(s => { const n = new Set(s); n.has(o) ? n.delete(o) : n.add(o); return n })}
                    className="flex items-center gap-1.5 pl-1.5 pr-3 py-1.5 rounded-full text-left transition-all active:scale-95"
                    style={{ background: hecho ? `${GRN}16` : 'rgba(255,255,255,0.04)', border: `1px solid ${hecho ? GRN + '3A' : BORDER}`, maxWidth: '100%' }}>
                    <span className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0"
                      style={{ background: hecho ? GRN : 'transparent', border: `1.5px solid ${hecho ? GRN : 'rgba(255,255,255,0.2)'}` }}>
                      {hecho && <LucideIcon name="check" size={9} color="#06110A" />}
                    </span>
                    <span className="font-figtree text-[11.5px] truncate"
                      style={{ color: hecho ? 'rgba(255,255,255,0.42)' : 'rgba(255,255,255,0.82)', textDecoration: hecho ? 'line-through' : 'none' }}>
                      {o}
                    </span>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="px-4 pb-2 font-figtree text-[11px]" style={{ color: 'rgba(255,255,255,0.22)' }}>
              Escribe objetivos y aquí los vas tachando.
            </div>
          )}

          <div className="px-4 pt-1.5 pb-4 flex-1 flex flex-col">
            <textarea
              value={balance}
              onChange={e => alEscribir('cierre', e.target.value)}
              placeholder="Qué se quedó a medias y por qué…"
              rows={3}
              className="w-full px-3 py-2.5 rounded-2xl text-[12.5px] text-white placeholder-white/20 outline-none resize-none leading-relaxed flex-1"
              style={{ background: 'rgba(255,255,255,0.035)', border: `1px solid ${BORDER}`, caretColor: GRN, minHeight: '4.5rem' }}
            />
            {!yaCerrado && (
              <button onClick={() => fichar('cierre')} disabled={fichando}
                className="mt-2.5 w-full py-2.5 rounded-2xl font-syne text-[9px] font-black tracking-widest disabled:opacity-40 transition-all active:scale-[0.99]"
                style={{ background: `${GRN}16`, border: `1px solid ${GRN}32`, color: GRN }}>
                CERRAR EL DÍA
              </button>
            )}
          </div>
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
                    <button onClick={() => { rechazadas.current.add(normalizar(p.text)); setPropuestas(ps => ps.filter((_, k) => k !== i)) }} aria-label={`Quitar «${p.text}»`}
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
                <button onClick={() => { propuestas.forEach(p => rechazadas.current.add(normalizar(p.text))); setPropuestas([]) }}
                  className="px-4 py-2 rounded-xl font-syne text-[9px] font-black tracking-widest"
                  style={{ color: 'rgba(255,255,255,0.35)', border: `1px solid ${BORDER}` }}>
                  DESCARTAR
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── BRIEFING (solo el propietario) ─────────────────────────────── */}
      {esJefe && (
        <div className="rounded-3xl mb-5 overflow-hidden" style={{ background: SURF2, border: `1px solid ${VIO}28` }}>
          <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-2.5 flex-wrap">
            <LucideIcon name="bar-chart-2" size={13} color={VIO} />
            <div className="font-syne text-[8.5px] font-black tracking-widest flex-1" style={{ color: VIO }}>
              BRIEFING DEL EQUIPO
            </div>
            <div className="flex gap-1">
              {(['dia', 'semana'] as const).map(r => (
                <button key={r} onClick={() => pedirBriefing(r)}
                  className="px-2.5 py-1 rounded-full font-syne text-[7.5px] font-black tracking-widest transition-all"
                  style={{
                    background: briefing && rango === r ? `${VIO}22` : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${briefing && rango === r ? VIO + '40' : BORDER}`,
                    color: briefing && rango === r ? VIO : 'rgba(255,255,255,0.4)',
                  }}>
                  {r === 'dia' ? 'HOY' : 'SEMANA'}
                </button>
              ))}
            </div>
          </div>

          {cargandoBrief ? (
            <div className="px-4 pb-4 font-figtree text-[11px]" style={{ color: 'rgba(255,255,255,0.25)' }}>Cargando…</div>
          ) : !briefing ? (
            <div className="px-4 pb-4 font-figtree text-[11px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
              Elige HOY o SEMANA para ver qué ha hecho cada uno.
            </div>
          ) : (
            <>
              {/* El conjunto primero: es la pregunta que se hace un jefe antes de
                  mirar a nadie en concreto. */}
              <div className="flex gap-2 px-4 pb-3 flex-wrap">
                {[
                  { n: briefing.total?.objetivos ?? 0, l: 'objetivos', c: BLU },
                  { n: briefing.total?.completadas ?? 0, l: 'completadas', c: GRN },
                  { n: briefing.total?.diasCerrados ?? 0, l: 'días cerrados', c: VIO },
                ].map(k => (
                  <div key={k.l} className="flex items-baseline gap-1.5 px-3 py-1.5 rounded-full"
                    style={{ background: 'rgba(255,255,255,0.035)', border: `1px solid ${BORDER}` }}>
                    <span className="font-syne text-[15px] font-black" style={{ color: k.c }}>{k.n}</span>
                    <span className="font-figtree text-[10px]" style={{ color: 'rgba(255,255,255,0.35)' }}>{k.l}</span>
                  </div>
                ))}
              </div>

              <div className="flex flex-col">
                {(briefing.equipo || []).map((p: any) => (
                  <div key={p.persona.id} className="px-4 py-3" style={{ borderTop: `1px solid ${BORDER}` }}>
                    <div className="flex items-center gap-2.5 mb-1.5 flex-wrap">
                      <div className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 font-syne text-[8px] font-black"
                        style={{ background: `${p.persona.avatar_color || BLU}22`, color: p.persona.avatar_color || BLU }}>
                        {p.persona.initials || (p.persona.name || '?').slice(0, 2).toUpperCase()}
                      </div>
                      <div className="font-figtree text-[12px] font-bold text-white flex-1 min-w-0">{p.persona.name}</div>
                      <div className="font-figtree text-[10px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
                        {p.completadas} {p.completadas === 1 ? 'completada' : 'completadas'} · {p.cerrados}/{p.dias} {p.dias === 1 ? 'día cerrado' : 'días cerrados'}
                      </div>
                    </div>
                    {p.tareas.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-1">
                        {p.tareas.slice(0, 8).map((t: any) => (
                          <span key={t.id} className="font-figtree text-[10.5px] px-2 py-1 rounded-full truncate"
                            style={{ background: `${GRN}0E`, border: `1px solid ${GRN}28`, color: 'rgba(255,255,255,0.65)', maxWidth: '100%' }}>
                            {t.text}
                          </span>
                        ))}
                        {p.tareas.length > 8 && (
                          <span className="font-figtree text-[10px] px-1 py-1" style={{ color: 'rgba(255,255,255,0.3)' }}>
                            +{p.tareas.length - 8} más
                          </span>
                        )}
                      </div>
                    )}
                    {/* Un día abierto y nunca cerrado es una señal, no un hueco. */}
                    {p.dias > p.cerrados && (
                      <div className="font-figtree text-[10px]" style={{ color: AMBAR }}>
                        {p.dias - p.cerrados} {p.dias - p.cerrados === 1 ? 'día sin cerrar' : 'días sin cerrar'}
                      </div>
                    )}
                  </div>
                ))}
                {(briefing.equipo || []).length === 0 && (
                  <div className="px-4 pb-4 font-figtree text-[11px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
                    Nadie ha fichado en este tramo.
                  </div>
                )}
                {(briefing.sinActividad || []).length > 0 && (
                  <div className="px-4 py-2.5 font-figtree text-[10px]" style={{ borderTop: `1px solid ${BORDER}`, color: 'rgba(255,255,255,0.28)' }}>
                    Sin actividad: {briefing.sinActividad.join(', ')}
                  </div>
                )}
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
                    style={{ background: `${e.autor?.avatar_color || BLU}22`, color: e.autor?.avatar_color || BLU }}>
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
