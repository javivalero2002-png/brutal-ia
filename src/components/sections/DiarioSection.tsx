'use client'
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { BLU, GRN, AMBAR, RED, VIO, SURFACE, SURF2, BORDER } from '@/components/shared/design-tokens'
import { LucideIcon, useIsMobile, plural, ProgressRing, todayKey, localDayKey } from '@/components/shared'
import type { NexusData, Profile } from '@/types'
import type { IrASeccion } from '@/components/shared/secciones'
import CalendarioDiario from '@/components/shared/CalendarioDiario'
import SemanaDiario from '@/components/shared/SemanaDiario'

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
  /** Cómo fue el día: productivo · normal · bloqueado. `null` = no lo ha dicho, que NO es «normal». */
  animo?: 'productivo' | 'normal' | 'bloqueado' | null
  autor?: { id: string; name: string; initials?: string; avatar_color?: string } | null
}

interface TareaPropuesta { text: string; level: 'urgent' | 'high' | 'normal'; hecha: boolean }

/** Lo que hizo una persona un día: su diario y las tareas que cerró. */
interface PersonaDelDia {
  persona: { id: string; name?: string; initials?: string; avatar_color?: string; role?: string }
  entrada: Entrada | null
  tareas: { id: string; text: string; level: string }[]
}

interface Props {
  data: NexusData
  profile: Profile
  showToast: (m: string) => void
  onNavigate: IrASeccion
  /** Manda una pregunta ya escrita a Harvey. Mismo mecanismo que usa Inbox. */
  onAskHarvey?: (mensaje: string) => void
  /**
   * Entradas de muestra para /preview. Con esto la sección NO toca la red.
   *
   * Sin ellas, el demo llamaba a la API real sin sesión: cada autoguardado
   * devolvía 401 y la sección se pintaba con «no se pudo cargar». Un demo que
   * enseña una sección rota es peor que no enseñarla.
   */
  demo?: Entrada[]
  /** Días de muestra para el calendario del demo. */
  diasDemo?: Record<string, { personas: { id: string; name?: string; initials?: string; avatar_color?: string }[]; objetivos: number; cerrados: number }>
}

const horaCorta = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }) : ''

/**
 * Para comparar textos de tarea sin que una tilde o una mayúscula los haga
 * distintos. Se usa para no volver a proponer lo que ya es una tarea.
 */
const normalizar = (t: string) =>
  (t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()

/**
 * Suma (o resta) días a una clave 'YYYY-MM-DD'.
 *
 * Ancla a mediodía UTC antes de mover el día: a esa hora Madrid va por la tarde,
 * así que ni el cambio de hora ni el desfase de zona pueden hacer que se salte o
 * repita una fecha. Y el resultado sale de `localDayKey`, no de cortar el ISO —
 * cortar da el día en UTC, que a partir de las ~22:00 de Madrid ya es el siguiente.
 */
const sumarDias = (clave: string, n: number): string => {
  const d = new Date(`${clave}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return localDayKey(d)
}

const fechaLarga = (clave: string) =>
  new Date(`${clave}T12:00:00Z`).toLocaleDateString('es-ES', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Madrid',
  })

/** «Hoy», «Ayer» o la fecha. Un día reciente se reconoce antes por el nombre. */
const etiquetaDia = (clave: string): string => {
  const hoy = todayKey()
  if (clave === hoy) return 'Hoy'
  if (clave === sumarDias(hoy, -1)) return 'Ayer'
  return fechaLarga(clave).replace(/^\w/, c => c.toUpperCase())
}

/** Los objetivos, uno por línea. Es el formato que permite tacharlos luego. */
/**
 * Lo que se escribe aquí, dicho con las palabras del estudio.
 *
 * Antes ponía «Cerrar el presupuesto de Nike»: lenguaje de agencia de medios, no
 * de gente que hace vídeo. Un ejemplo que no se parece a tu trabajo no enseña a
 * usar la pantalla — enseña que la pantalla es para otros.
 *
 * Van VARIOS y cambian por fila a propósito: al añadir la segunda y la tercera se
 * ve el abanico —una pieza, su guion, un retoque— en vez de repetir el mismo. Es
 * la forma más barata de enseñar que aquí cabe cualquier tamaño de tarea.
 */
const EJEMPLOS = [
  'Crear el vídeo de Instagram',
  'Pensar el guion del vídeo de Higgsfield',
  'Retocar el vídeo de Higgsfield',
  'Montar el reel de la semana',
]

const lineas = (t?: string | null) =>
  (t || '').split('\n').map(l => l.replace(/^[-•*\s]+/, '').trim()).filter(Boolean)

export default function DiarioSection({ data, profile, showToast, onNavigate, onAskHarvey, demo, diasDemo }: Props) {
  const isMobile = useIsMobile()
  const [entradas, setEntradas] = useState<Entrada[]>([])
  const [cargando, setCargando] = useState(true)
  const [errorCarga, setErrorCarga] = useState(false)
  const [objetivos, setObjetivos] = useState('')
  const [balance, setBalance] = useState('')
  const [estadoGuardado, setEstadoGuardado] = useState<'limpio' | 'guardando' | 'guardado'>('limpio')
  const [propuestas, setPropuestas] = useState<TareaPropuesta[]>([])
  const [leyendo, setLeyendo] = useState(false)
  const [creando, setCreando] = useState(false)
  const [fichando, setFichando] = useState(false)
  // Briefing: solo para el propietario. Se pide bajo demanda, no al abrir la
  // sección — es una consulta pesada que la mayoría de las visitas no necesita.
  const esJefe = profile?.role === 'owner'
  const [briefing, setBriefing] = useState<any>(null)
  // Qué ficha del briefing está desplegada. Una cada vez: el acordeón existe para
  // leer a UNA persona en detalle, no para abrir siete y volver al muro.
  const [briefAbierto, setBriefAbierto] = useState<string | null>(null)
  const [rango, setRango] = useState<'dia' | 'semana' | 'arranque'>('dia')
  const [cargandoBrief, setCargandoBrief] = useState(false)
  // El día que se está mirando. Hoy por defecto; se puede retroceder para
  // consultar lo que hizo el equipo cualquier otro día — el diario es un
  // histórico que se va llenando, no solo la pantalla de hoy.
  const [dia, setDia] = useState<string>(() => todayKey())
  const esHoy = dia === todayKey()
  // Tres tiempos, y no se comportan igual:
  //  · PASADO: solo lectura. Escribir ahí sella la hora de AHORA, así que
  //    repasar el jueves apuntaría su trabajo al viernes.
  //  · HOY: todo.
  //  · FUTURO: se PLANIFICA. Se escriben objetivos y se crean sus tareas, pero no
  //    se marca nada como hecho — nadie ha hecho aún el trabajo del jueves.
  // La guarda de la auditoría era `!esHoy` y cerraba también el futuro, que es
  // justo para lo que existe el calendario de esta sección.
  const esPasado = dia < todayKey()
  const esFuturo = dia > todayKey()

  /**
   * Las tareas contra las que se empareja el diario: las MÍAS y las de ESTE día.
   *
   * Antes se emparejaba contra `data.tasks` entero, que es el histórico completo
   * de TODO el equipo (GET /api/tasks no filtra por persona ni por fecha, a
   * propósito: el workspace es compartido). Eso rompía tres cosas a la vez:
   *
   *  · Si otra persona ya tenía una tarea con tu mismo texto, tu objetivo se
   *    descartaba al fichar —no se creaba NADA tuyo— y tu casilla marcaba la
   *    tarea de ella. El día decía «Paula · 1 hecha» y «Javi · 0».
   *  · Un objetivo recurrente («responder correos») casaba con la tarea de otro
   *    día, así que salía tachado al 100 % antes de empezar. Y destacharlo hacía
   *    `updateTask` sobre la tarea VIEJA, borrando el completado del día en que
   *    de verdad se hizo.
   *  · Dos personas nunca podían proponerse lo mismo el mismo día.
   *
   * El día se decide por `created_at`, no por `completed_at`: la tarea nace el
   * día en que la fichaste, y ahí sigue perteneciendo aunque la cierres mañana.
   */
  const misTareasDelDia = (data.tasks || []).filter((t: { assigned_to?: string | null; created_at?: string; diario_dia?: string | null }) => {
    if (t.assigned_to !== profile?.id) return false
    // Si la tarea sabe de qué día de diario nació, manda ella: planificar el
    // jueves crea hoy una tarea que pertenece al JUEVES, y por `created_at`
    // habría caído en hoy.
    if (t.diario_dia) return t.diario_dia === dia
    // Las anteriores a la migración no lo saben: se caen al día de creación,
    // que es lo que había antes y sigue siendo razonable para ellas.
    return !!t.created_at && localDayKey(t.created_at) === dia
  })
  // Los objetivos se ENSEÑAN como lista y se EDITAN en un textarea. Ver una lista
  // con viñetas y editar texto plano son dos cosas distintas, y mezclarlas en un
  // textarea siempre visible es lo que hacía que la sección pareciera un borrador.
  /**
   * Los objetivos, uno por fila.
   *
   * Antes era un `<textarea>` y una línea era un objetivo por convenio: nada te
   * decía dónde acababa uno y empezaba otro, no se podía borrar el tercero sin
   * seleccionar su línea a mano, y al leerlo era un párrafo. Para lo que es —una
   * lista corta de cosas concretas— la forma correcta es una lista.
   *
   * Se guarda IGUAL, un objetivo por línea en `entrada`: no cambia el esquema ni
   * nada de lo que hay debajo (fichar, las tareas, Harvey, el briefing). Solo se
   * escribe distinto.
   *
   * `filas` vive aparte del texto guardado porque una fila recién añadida está
   * vacía, y las vacías no se guardan: si se derivaran del texto, la fila nueva
   * desaparecería en el mismo instante de crearla.
   */
  const [filas, setFilas] = useState<string[]>([''])
  const refsFilas = useRef<(HTMLInputElement | null)[]>([])
  // El calendario se abre a demanda: la mayoria de las visitas son «abro, escribo
  // lo de hoy y me voy», y un mes entero de rejilla ahi arriba estorbaria a eso.
  const [verCalendario, setVerCalendario] = useState(false)
  const [porPersona, setPorPersona] = useState<PersonaDelDia[]>([])
  // Quién está desplegado. Uno cada vez: abrir varios convierte la lista en un
  // muro y se pierde justo lo que se venía a ver.
  const [abierto, setAbierto] = useState<string | null>(null)

  const miEntrada = entradas.find(e => e.user_id === profile?.id) || null

  /**
   * El reloj de sesión, la racha y el resumen de la semana.
   *
   * El reloj NO se guarda en ninguna parte: es `ahora - entrada_at`, calculado al
   * pintar. Guardar un contador sería inventarse un dato que ya está —y que además
   * se desincroniza en cuanto alguien cierra la pestaña—.
   *
   * Tick de 30 s y no de 1 s: se enseña en horas y minutos, así que un segundero
   * sería un `setState` por segundo para repintar el mismo texto 59 veces.
   */
  /** El panel de objetivos, para llevar la vista allí cuando aún no hay ninguno. */
  const refObjetivos = useRef<HTMLDivElement | null>(null)

  const [ahoraMs, setAhoraMs] = useState<number>(() => Date.now())
  useEffect(() => {
    if (!miEntrada?.entrada_at || miEntrada?.cierre_at) return
    const t = setInterval(() => setAhoraMs(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [miEntrada?.entrada_at, miEntrada?.cierre_at])

  /**
   * Guardar el ánimo. Optimista y con vuelta atrás, como el resto de la app.
   *
   * Pulsar el que ya está puesto lo QUITA: «no lo he dicho» tiene que poder
   * recuperarse, porque no es lo mismo que «normal» — y sin esto el primer clic
   * sería irreversible.
   */
  const marcarAnimo = async (v: 'productivo' | 'normal' | 'bloqueado' | null) => {
    const antes = miEntrada?.animo ?? null
    setEntradas(prev => prev.map(e => (e.user_id === profile?.id ? { ...e, animo: v } : e)))
    try {
      const res = await fetch('/api/diario', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dia, animo: v, borrador: true }),
      })
      if (!res.ok) throw new Error()
    } catch {
      setEntradas(prev => prev.map(e => (e.user_id === profile?.id ? { ...e, animo: antes } : e)))
      showToast('No se pudo guardar cómo fue el día')
    }
  }

  const tiempoSesion = (() => {
    if (!miEntrada?.entrada_at) return null
    const fin = miEntrada.cierre_at ? new Date(miEntrada.cierre_at).getTime() : ahoraMs
    const ms = fin - new Date(miEntrada.entrada_at).getTime()
    if (ms < 0) return null
    const h = Math.floor(ms / 3_600_000)
    const m = Math.floor((ms % 3_600_000) / 60_000)
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  })()

  /** Días seguidos fichando, hacia atrás desde hoy. Se corta en el primer hueco. */
  const [mesFichado, setMesFichado] = useState<Record<string, { personas: { id: string }[] }>>({})
  useEffect(() => {
    if (demo) return
    // Dos meses: una racha que cruza el día 1 no se ve mirando solo el mes actual.
    const mes = dia.slice(0, 7)
    const [a, m] = mes.split('-').map(Number)
    const anterior = m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`
    Promise.all([mes, anterior].map(x => fetch(`/api/diario/mes?mes=${x}`).then(r => (r.ok ? r.json() : null)).catch(() => null)))
      .then(partes => {
        const junto: Record<string, { personas: { id: string }[] }> = {}
        for (const p of partes) if (p?.dias) Object.assign(junto, p.dias)
        setMesFichado(junto)
      })
  }, [dia, demo])

  /**
   * La semana, en tres números.
   *
   * Sale de los mismos dos meses que ya se descargan para la racha — no hay una
   * consulta más. `objetivos` es cuántos se propuso el equipo y `cerrados` cuántos
   * días se cerraron; el porcentaje es de OBJETIVOS, no de días, porque cerrar un
   * día con la mitad sin hacer no es cumplir.
   */
  const semana = (() => {
    const l = new Date(`${dia}T12:00:00`)
    l.setDate(l.getDate() - ((l.getDay() + 6) % 7))          // al lunes
    let totales = 0, hechos = 0
    for (let i = 0; i < 7; i++) {
      const k = `${l.getFullYear()}-${String(l.getMonth() + 1).padStart(2, '0')}-${String(l.getDate()).padStart(2, '0')}`
      const r = mesFichado[k] as { objetivos?: number; cerrados?: number } | undefined
      totales += r?.objetivos || 0
      hechos += r?.cerrados || 0
      l.setDate(l.getDate() + 1)
    }
    return { totales, hechos, pct: totales ? Math.round((hechos / totales) * 100) : 0 }
  })()

  const racha = (() => {
    if (!profile?.id) return 0
    let n = 0
    const d = new Date(`${todayKey()}T12:00:00`)
    // Desde hoy hacia atrás. Si hoy aún no has fichado NO rompe la racha: el día no
    // ha terminado, y poner la racha a cero a las nueve de la mañana sería castigar
    // a alguien por no haber empezado todavía.
    for (let i = 0; i < 400; i++) {
      const clave = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const fichado = (mesFichado[clave]?.personas || []).some(p => p.id === profile.id)
      if (fichado) n++
      else if (i > 0) break
      d.setDate(d.getDate() - 1)
    }
    return n
  })()
  const sembrado = useRef(false)
  const guardadoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const extraerTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ultimoExtraido = useRef('')
  // Lo que has quitado a mano no vuelve. Sin esto, cada relectura del texto lo
  // resucitaba y había que quitarlo otra vez.
  const rechazadas = useRef<Set<string>>(new Set())

  const cargar = useCallback(async () => {
    // Aquí, y no en el efecto del día: ese corre DESPUÉS de este, así que ponerlo
    // allí dejaba `cargando` en true para siempre — el esqueleto fijo y el panel
    // sin dejar escribir. Lo marca quien carga.
    setCargando(true)
    if (demo) {
      setEntradas(demo)
      setPorPersona(demo.map(e => ({ persona: (e.autor || { id: e.user_id }) as PersonaDelDia['persona'], entrada: e, tareas: [] })))
      setErrorCarga(false); setCargando(false); return
    }
    try {
      const res = await fetch(`/api/diario?dia=${dia}`)
      if (!res.ok) { setErrorCarga(true); return }
      const j = await res.json()
      setErrorCarga(false)
      setEntradas(Array.isArray(j.entradas) ? j.entradas : [])
      setPorPersona(Array.isArray(j.porPersona) ? j.porPersona : [])
    } catch { setErrorCarga(true) }
    finally { setCargando(false) }
  }, [dia, demo])

  useEffect(() => { cargar() }, [cargar])

  // Se siembra UNA vez. Si se resembrara en cada recarga, escribir mientras otro
  // ficha te borraría lo tecleado — que es justo el bug que esto viene a cerrar.
  // Al cambiar de día se vuelve a sembrar: lo que se ve es de OTRO día, y
  // arrastrar el borrador del anterior sería escribir en el día equivocado.
  useEffect(() => {
    // Lo pendiente se MANDA antes de cambiar, con el día en que se escribió.
    // Tirarlo era perder lo que acababas de teclear si el retardo aún no había
    // saltado; `vaciarPendiente` ya usa el día guardado en el ref, no el nuevo.
    vaciarPendiente()
    sembrado.current = false; setObjetivos(''); setBalance(''); setFilas([''])
    setEstadoGuardado('limpio')
    // Las propuestas también: son de lo que se escribió en el día que dejas, y si
    // el día que abres está vacío el extractor no se dispara (corta por debajo de
    // 15 caracteres), así que el panel se quedaba enseñándolas y «ACEPTAR» las
    // creaba en el día equivocado — el trabajo de hoy apareciendo mañana.
    setPropuestas([]); setLeyendo(false); ultimoExtraido.current = ''
    pendiente.current = { dia }
  }, [dia])

  useEffect(() => {
    if (sembrado.current || !miEntrada) return
    sembrado.current = true
    setObjetivos(miEntrada.entrada || '')
    setFilas(lineas(miEntrada.entrada).length ? lineas(miEntrada.entrada) : [''])
    setBalance(miEntrada.cierre || '')
    // Lo sembrado cuenta como YA leído. Sin esto, abrir el Diario a mirar movía
    // `objetivos`/`balance` y disparaba el extractor con el texto de la base de
    // datos: una llamada al modelo por cada visita y por cada día que navegabas,
    // pagada para releer lo que ya era tarea. El extractor existe para lo que se
    // teclea, no para lo que se carga.
    ultimoExtraido.current = [miEntrada.entrada, miEntrada.cierre].filter(Boolean).join('\n').trim()
  }, [miEntrada])

  // ── Autoguardado ──────────────────────────────────────────────────────────
  // Con retardo: guardar en cada tecla sería una escritura por pulsación. Al
  // desmontar se vacía el temporizador y se guarda de golpe, que es lo que hace
  // que cambiar de sección ya no pierda nada.
  // Un 401 corta el autoguardado en seco. Sin esto, una sesión caducada convierte
  // cada pulsación en una petición rechazada: decenas de errores en consola, el
  // indicador parpadeando, y el usuario escribiendo un rato entero contra nada.
  const sesionCaida = useRef(false)

  const guardarBorrador = useCallback(async (campos: { entrada?: string; cierre?: string }, diaDestino: string) => {
    if (demo || sesionCaida.current) return
    setEstadoGuardado('guardando')
    try {
      const res = await fetch('/api/diario', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // El DÍA llega por PARÁMETRO, no de la clausura: al cambiar de día hay que
        // vaciar lo pendiente en el día VIEJO, y con el de la clausura se
        // escribiría en el nuevo.
        body: JSON.stringify({ ...campos, dia: diaDestino, borrador: true }),
      })
      setEstadoGuardado(res.ok ? 'guardado' : 'limpio')
      if (res.status === 401) {
        sesionCaida.current = true
        showToast('Tu sesión ha caducado — vuelve a entrar para seguir guardando')
        return
      }
      if (!res.ok) showToast('No se pudo guardar el diario')
    } catch { setEstadoGuardado('limpio'); showToast('No se pudo guardar el diario') }
  }, [demo, showToast])

  /**
   * Manda lo que quede sin guardar. El ÚNICO sitio que escribe el borrador.
   *
   * Antes cada camino hacía lo suyo y se perdía texto por dos sitios, los dos
   * introducidos hoy:
   *
   *  · Al CAMBIAR DE DÍA se hacía `clearTimeout` y se tiraba lo pendiente. El
   *    comentario decía «ya se guardó al escribirlo», que es justo lo que NO
   *    había pasado si el retardo aún no había saltado: escribías un objetivo y
   *    pulsabas la flecha para mirar ayer, y ese objetivo no había existido nunca.
   *  · Y los dos campos compartían temporizador, pero al dispararse solo se
   *    mandaba EL CAMPO que lo armó. Escribir el balance justo después de un
   *    objetivo cancelaba el guardado del objetivo y mandaba solo el balance.
   *    Peor: hasta hoy había una red —el guardado de salida se disparaba siempre—
   *    y al anular el temporizador se la quité.
   *
   * Ahora se manda TODO lo pendiente, con SU día, y se vacía. Da igual quién lo
   * llame ni desde dónde.
   */
  // El efecto de desmontaje lleva `[]`, así que su clausura se queda con la
  // primera versión de la función. Este ref le da SIEMPRE la de ahora, que es la
  // que conoce el día y el texto actuales.
  const vaciarPendienteRef = useRef<((o?: { keepalive?: boolean }) => void) | null>(null)
  const vaciarPendiente = useCallback((opciones?: { keepalive?: boolean }) => {
    if (guardadoTimer.current) { clearTimeout(guardadoTimer.current); guardadoTimer.current = null }
    const { entrada, cierre, dia: diaPendiente } = pendiente.current
    if (entrada === undefined && cierre === undefined) return
    const campos = { ...(entrada !== undefined ? { entrada } : {}), ...(cierre !== undefined ? { cierre } : {}) }
    pendiente.current = { dia: diaPendiente }
    if (opciones?.keepalive) {
      // Al desmontar no se puede esperar: `keepalive` hace que el navegador
      // termine la petición aunque la página cambie.
      if (!demo && !sesionCaida.current) {
        fetch('/api/diario', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...campos, dia: diaPendiente, borrador: true }), keepalive: true,
        }).catch(() => {})
      }
      return
    }
    guardarBorrador(campos, diaPendiente)
  }, [demo, guardarBorrador])
  vaciarPendienteRef.current = vaciarPendiente

  const alEscribir = (campo: 'entrada' | 'cierre', valor: string) => {
    if (campo === 'entrada') setObjetivos(valor); else setBalance(valor)
    setEstadoGuardado('guardando')
    pendiente.current = { ...pendiente.current, [campo]: valor, dia }
    if (guardadoTimer.current) clearTimeout(guardadoTimer.current)
    guardadoTimer.current = setTimeout(() => vaciarPendiente(), 1200)
  }

  // Guardar lo pendiente al salir de la sección. `pendienteRef` lleva lo último
  // tecleado porque el cleanup no ve el estado nuevo.
  // Lo que queda por guardar al salir de la sección. Tres cosas que parecen
  // detalles y las tres borraban texto ya escrito:
  //
  // 1. El efecto lleva `[]`, así que su clausura se queda con el `dia` del PRIMER
  //    render. Si mirabas otro día y te ibas, el guardado de salida escribía en el
  //    día de entrada. Por eso el día viaja en un ref, no capturado.
  // 2. Se mandaban SIEMPRE los dos campos. Cambiar de día vacía `objetivos` y
  //    `balance` (el efecto de [dia]), así que al salir se mandaba `''` — y el
  //    `pick` de /api/diario, a diferencia del de /api/tasks, NO descarta la
  //    cadena vacía: la escribía encima. Escribías tus objetivos, mirabas el
  //    lunes, salías, y lo de hoy había desaparecido.
  //    Es la regla que CLAUDE.md ya tenía escrita: un campo que el usuario no ha
  //    tocado no viaja en el guardado.
  // 3. El temporizador no se limpiaba al dispararse, así que quedaba «pendiente»
  //    para siempre y este guardado salía aunque ya estuviera todo escrito.
  //
  // 4. Y esta línea, que refrescaba el día en CADA render, era la que rompía las
  //    tres anteriores: al pulsar la flecha, React renderiza ANTES de correr el
  //    efecto de [dia], así que el día ya valía el NUEVO cuando `vaciarPendiente`
  //    leía el ref. Lo tecleado en el día que dejabas se guardaba en el que
  //    abrías —pisando por upsert un día que la propia UI declara de solo
  //    lectura—. No hace falta: `alEscribir` guarda el día JUNTO al texto, y el
  //    efecto de [dia] lo repone después de vaciar.
  const pendiente = useRef<{ entrada?: string; cierre?: string; dia: string }>({ dia })
  // Al salir de la sección, lo mismo: un solo camino para vaciar.
  useEffect(() => () => { vaciarPendienteRef.current?.({ keepalive: true }) }, [])

  // ── Las tareas se proponen solas ──────────────────────────────────────────
  useEffect(() => {
    const texto = [objetivos, balance].filter(Boolean).join('\n').trim()
    if (demo || sesionCaida.current) return
    // Un día pasado es de solo lectura: `crearTodas` lo rechaza. Llamar al modelo
    // ahí paga por un panel cuyo botón no puede funcionar.
    if (esPasado) return
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
        const yaSon = new Set(misTareasDelDia.map((t: { text?: string }) => normalizar(t.text || '')))
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
    // Un día pasado no se reescribe; uno futuro SÍ se planifica.
    if (esPasado) { showToast('Un día pasado no se puede modificar'); return }
    const valor = campo === 'entrada' ? objetivos : balance
    if (!valor.trim()) { showToast(campo === 'entrada' ? 'Escribe tus objetivos primero' : 'Cuenta qué has hecho'); return }
    setFichando(true)
    try {
      const res = await fetch('/api/diario', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [campo]: valor.trim(), dia }),
      })
      if (!res.ok) { showToast('No se pudo fichar'); return }

      if (campo === 'entrada') {
        // Una tarea por objetivo, saltando lo que ya existe: fichar dos veces no
        // puede duplicar la lista.
        // El MISMO criterio que usa el botón para decir cuántas va a crear
        // (`porCrear`, que empareja por el vínculo y solo cae al texto si no lo
        // hay). Con dos criterios distintos, el botón decía «CREA 0 TAREAS» y
        // creaba una duplicada: bastaba con haber retocado el texto de la tarea.
        const nuevas = lineas(valor).filter(o => !tareaDe(o))
        let creadas = 0
        for (const o of nuevas) {
          try {
            await data.createTask({ text: o, level: 'high', done: false, assigned_to: profile?.id, source: 'ai', diario_dia: dia, diario_objetivo: o })
            creadas++
          } catch { /* se cuenta abajo */ }
        }
        await cargar()
        showToast(creadas
          ? `Día abierto · ${plural(creadas, 'tarea creada', 'tareas creadas')}`
          : 'Día abierto')
        return
      }

      // Cerrar ya no marca nada: los objetivos se completan al tocarlos, contra la
      // tarea, y para cuando llegas aquí eso ya está guardado. Esto solo fija el
      // balance y la hora de cierre.
      await cargar()
      const pendientes = objetivosDeHoy.filter(o => !estaHecho(o)).length
      showToast(pendientes
        ? `Día cerrado · ${plural(pendientes, 'objetivo sin cumplir', 'objetivos sin cumplir')}`
        : 'Día cerrado · todo cumplido')
    } catch { showToast('No se pudo fichar') }
    finally { setFichando(false) }
  }

  /** Añade una fila vacía al final y pone el cursor dentro. */
  const anadirObjetivo = () => {
    // Si la última está vacía no se añade otra: se va a la que ya hay. Pulsar dos
    // veces dejaba dos huecos y parecía que no había funcionado.
    const ultima = filas[filas.length - 1]
    if (ultima !== undefined && !ultima.trim()) { enfocarFila(filas.length - 1); return }
    cambiarFilas([...filas, ''])
    enfocarFila(filas.length)
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
    // Un día pasado no se reescribe: crear una tarea ya hecha sella
    // `completed_at` con el instante actual, así que el trabajo del jueves se
    // apuntaría al viernes.
    if (esPasado) { showToast('Un día pasado no se puede modificar'); return }
    setCreando(true)
    let ok = 0
    for (const p of propuestas) {
      try {
        await data.createTask({ text: p.text, level: p.level, done: esFuturo ? false : p.hecha, assigned_to: profile?.id, source: 'ai', diario_dia: dia, diario_objetivo: p.text })
        ok++
      } catch { /* se cuenta abajo */ }
    }
    setCreando(false)
    setPropuestas([])
    showToast(ok === propuestas.length
      ? plural(ok, 'tarea creada', 'tareas creadas')
      : `${ok} de ${propuestas.length} creadas — el resto falló`)
  }

  // Lo que se PINTA sale de lo que estás editando, no de lo último guardado.
  //
  // Antes ganaba `miEntrada?.entrada`, así que en cuanto fichabas el objetivo
  // nuevo no aparecía en «¿lo completé?» hasta recargar: la sección se
  // contradecía a sí misma con el objetivo delante. `objetivos` es la verdad viva
  // porque se siembra desde la entrada al cargar; el respaldo cubre el único
  // render en que la entrada ya está y la siembra aún no ha corrido.
  const objetivosDeHoy = lineas(sembrado.current ? objetivos : (miEntrada?.entrada ?? objetivos))

  // Un objetivo está cumplido si SU TAREA está hecha. No hay estado local.
  //
  // Antes `cumplidos` era un Set en React: al recargar se perdía y ningún
  // compañero lo veía. Y no es un detalle de implementación — es que el diario
  // solo sirve si lo que marcas está donde lo mira todo el mundo.
  //
  // La tarea es la verdad y aquí solo se lee. Así el tachado, el porcentaje, la
  // lista de Tareas y lo que ve tu compañero no pueden discrepar: son el mismo
  // dato. Emparejadas por texto normalizado, que es como nacieron.
  /**
   * La tarea de un objetivo. Por el VÍNCULO primero, por el texto solo si no lo
   * hay.
   *
   * Emparejar por texto tenía un caso que ningún filtro arregla: en cuanto
   * alguien retoca el texto de la tarea desde la sección Tareas —donde `text` es
   * editable— el objetivo dejaba de encontrarla. La burbuja salía sin tachar
   * aunque la tarea estuviera hecha, y al tocarla se creaba una SEGUNDA tarea con
   * el texto viejo, ya marcada como completada: dos tareas para un trabajo y dos
   * completadas en Reportes.
   *
   * Con `diario_objetivo` el vínculo sobrevive a que cambien los dos textos. El
   * respaldo por texto se queda para las tareas anteriores a la migración, que
   * tienen las columnas vacías.
   */
  const tareaDe = (o: string) => {
    const clave = normalizar(o)
    return (
      misTareasDelDia.find((t: { diario_objetivo?: string | null }) =>
        !!t.diario_objetivo && normalizar(t.diario_objetivo) === clave) ||
      // Sin exigir `!t.diario_objetivo`: al corregir el texto de una fila, la tarea
      // conserva el vínculo VIEJO (el PATCH no lo deja mover, ver `alSalirDeFila`),
      // así que la primera rama ya no la encuentra. Si además se le pedía no tener
      // vínculo, quedaba invisible para el diario y se creaba otra tarea al lado.
      // La rama del vínculo va primero, así que un enlace explícito sigue mandando.
      misTareasDelDia.find((t: { text?: string }) =>
        normalizar(t.text || '') === clave)
    ) as { id: string; text?: string; done?: boolean } | undefined
  }
  const estaHecho = (o: string) => !!tareaDe(o)?.done

  /**
   * Toda mutación de la lista pasa por aquí: cambia las filas Y guarda el texto.
   *
   * El texto que se guarda va SIN las vacías —una fila a medio escribir no es un
   * objetivo— pero las filas se conservan tal cual, para que puedas tener una
   * abierta mientras piensas.
   */
  const cambiarFilas = (nuevas: string[]) => {
    setFilas(nuevas.length ? nuevas : [''])
    alEscribir('entrada', nuevas.map(x => x.trim()).filter(Boolean).join('\n'))
  }

  /**
   * Pedir el foco para una fila. Se apunta y lo hace un efecto DESPUÉS del
   * render, no un `requestAnimationFrame`: el rAF se adelantaba al commit de
   * React, así que la fila nueva aún no estaba en el DOM y el foco se quedaba
   * donde estaba. Enter creaba la fila pero seguías escribiendo en la anterior.
   * Medido en el navegador.
   */
  const [focoPendiente, setFocoPendiente] = useState<number | null>(null)
  const enfocarFila = (i: number) => setFocoPendiente(i)
  useEffect(() => {
    if (focoPendiente === null) return
    refsFilas.current[focoPendiente]?.focus()
    setFocoPendiente(null)
  }, [focoPendiente, filas.length])

    /**
   * Lo que me propuse en días ANTERIORES y sigue sin hacer.
   *
   * El Diario empezaba cada día en blanco: si dejabas un objetivo sin marcar,
   * al día siguiente había desaparecido de la vista. La tarea seguía viva en
   * Tareas, pero el sitio donde te organizas el día no lo sabía — así que lo que
   * no cerrabas se caía del radar justo cuando más falta hacía verlo.
   *
   * Solo se enseña en HOY: en un día pasado sería ruido, y en uno futuro no tiene
   * sentido arrastrar nada todavía.
   */
  const vienenDeAntes = useMemo(() => {
    if (!esHoy) return []
    return (data.tasks || []).filter((t: { assigned_to?: string | null; done?: boolean; diario_dia?: string | null }) =>
      t.assigned_to === profile?.id && !t.done && !!t.diario_dia && t.diario_dia < dia,
    ) as { id: string; text?: string; diario_dia?: string | null }[]
  }, [data.tasks, profile?.id, dia, esHoy])

  /**
   * El arranque de semana: lo que se arrastra y lo que viene.
   *
   * HOY y SEMANA miran hacia atrás —qué hizo cada uno—, y eso no es lo que se
   * pregunta un lunes por la mañana. Lo que se pregunta es qué quedó colgado y
   * qué se viene encima, y eso no lo contestaba ninguna pantalla.
   *
   * Se compone de lo que YA está cargado (`data.tasks`, `data.calendarEvents`):
   * ni una ruta nueva, ni una llamada a la IA, ni un céntimo. La lectura se la
   * puede pedir a Harvey quien quiera, con un botón — pero el dato está antes y
   * sin depender de nadie.
   */
  const arranque = useMemo(() => {
    const hoy = todayKey()
    const enSieteDias = sumarDias(hoy, 7)
    const equipo = (data.team || []) as { id: string; name?: string; initials?: string; avatar_color?: string }[]
    const tareas = (data.tasks || []) as {
      id: string; text?: string; done?: boolean; due_date?: string | null
      diario_dia?: string | null; assigned_to?: string | null; level?: string
    }[]

    // Lo que se arrastra: sin terminar y de un día que ya pasó. `diario_dia` es lo
    // que dice de qué día es una tarea del diario; para las que no vienen de ahí
    // vale el vencimiento pasado, que es la misma idea.
    const colgadas = tareas.filter(t => !t.done && (
      (!!t.diario_dia && t.diario_dia < hoy) || (!t.diario_dia && !!t.due_date && t.due_date < hoy)
    ))

    const porPersona = equipo.map(p => ({
      persona: p,
      colgadas: colgadas.filter(t => t.assigned_to === p.id),
    })).filter(x => x.colgadas.length > 0)

    const vienen = tareas
      .filter(t => !t.done && !!t.due_date && t.due_date >= hoy && t.due_date < enSieteDias)
      .sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''))

    const eventos = ((data.calendarEvents || []) as { id: string; title: string; start: string }[])
      .filter(e => {
        const d = (e.start || '').slice(0, 10)
        return d >= hoy && d < enSieteDias
      })
      .sort((a, b) => (a.start || '').localeCompare(b.start || ''))

    return { porPersona, vienen, eventos, totalColgadas: colgadas.length }
  }, [data.tasks, data.team, data.calendarEvents])

  /**
   * Objetivos escritos en días anteriores que siguen sin hacer y NO tienen tarea.
   *
   * `vienenDeAntes` mira tareas, y eso lo hacía depender de que la tarea
   * existiera: un objetivo cuya tarea no llegó a crearse desaparecía al día
   * siguiente sin rastro. Esto lo saca del DIARIO, que es donde el objetivo está
   * escrito de verdad, así que sobrevive aunque la tarea nunca existiera.
   */
  const [huerfanos, setHuerfanos] = useState<{ dia: string; texto: string }[]>([])
  useEffect(() => {
    if (demo || !esHoy) { setHuerfanos([]); return }
    let vivo = true
    fetch('/api/diario/pendientes')
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (vivo && j?.pendientes) setHuerfanos(j.pendientes) })
      .catch(() => { /* silencioso: `vienenDeAntes` sigue enseñando lo que sí tiene tarea */ })
    return () => { vivo = false }
  }, [demo, esHoy, dia])

  /** Trae a hoy un objetivo que no tiene tarea: se crea aquí, ya de hoy. */
  const traerHuerfano = async (texto: string) => {
    setArrastrando(true)
    try {
      await data.createTask({ text: texto, level: 'high', done: false, assigned_to: profile?.id, source: 'ai', diario_dia: dia, diario_objetivo: texto })
      cambiarFilas([...filas.map(x => x.trim()).filter(Boolean), texto])
      setHuerfanos(h => h.filter(x => x.texto !== texto))
      showToast('Traído a hoy')
    } catch { showToast('No se pudo traer') }
    finally { setArrastrando(false) }
  }

  const [arrastrando, setArrastrando] = useState(false)
  const traerAHoy = async (ids: string[]) => {
    if (!ids.length) return
    setArrastrando(true)
    try {
      const res = await fetch('/api/diario/arrastrar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { showToast(j.error || 'No se pudo traer'); return }
      // Los objetivos se añaden al texto del día, que es lo que los convierte en
      // parte de la lista de hoy; la tarea ya se ha movido en el servidor.
      const textos = ids.map(id => vienenDeAntes.find((t: { id: string }) => t.id === id)?.text || '').filter(Boolean)
      const nuevas = [...filas.map(x => x.trim()).filter(Boolean), ...textos]
      cambiarFilas(nuevas.length ? nuevas : [''])
      await data.reload?.()
      showToast(`${plural(j.movidas ?? ids.length, 'objetivo traído', 'objetivos traídos')} a hoy`)
    } catch { showToast('No se pudo traer') }
    finally { setArrastrando(false) }
  }

  /**
   * Crea la tarea de un objetivo que aún no la tiene.
   *
   * Las tareas se creaban SOLO al fichar, y ese botón desaparece en cuanto
   * fichas. O sea que un objetivo escrito después no llegaba nunca a Tareas: se
   * quedaba como texto en el diario, no salía en la carga de nadie, no contaba en
   * Reportes y —lo que lo destapó— al día siguiente no aparecía en «vienen de
   * antes», porque eso lee TAREAS. Javi lo vio con «Prueba top»: la escribió,
   * no la cerró, y al día siguiente había desaparecido.
   *
   * El único camino que quedaba era tacharla, y entonces nacía ya completada —
   * o sea que solo podías registrar lo que SÍ hiciste. Justo al revés de para lo
   * que sirve.
   *
   * Se dispara al SALIR de la fila, no mientras escribes: el retardo del
   * autoguardado crearía una tarea «Prue» a mitad de teclear, y el vínculo se
   * quedaría con ese texto.
   */
  const crearTareaDe = async (texto: string) => {
    const o = texto.trim()
    // Solo con el día ya abierto: antes de fichar es el botón quien las crea
    // todas de golpe, y adelantarse dejaría el botón prometiendo lo que ya está.
    if (!o || demo || esPasado || !miEntrada?.entrada_at || tareaDe(o)) return
    try {
      await data.createTask({ text: o, level: 'high', done: false, assigned_to: profile?.id, source: 'ai', diario_dia: dia, diario_objetivo: o })
    } catch { /* silencioso: el objetivo ya está guardado en el diario */ }
  }

  /**
   * El texto que tenía la fila al enfocarla. Es lo que distingue «objetivo nuevo»
   * de «el mismo objetivo, mejor escrito».
   */
  const textoAlEnfocar = useRef('')

  /**
   * Al salir de una fila: si el texto CAMBIÓ y lo de antes ya era tarea, se
   * renombra esa tarea. Antes se creaba otra.
   *
   * Y no hacía falta una errata para caer: bastaba con salir de la fila a medio
   * escribir. «Cerrar presu» se hacía tarea, volvías, terminabas la frase, y al
   * salir nacía «Cerrar presupuesto de Nike» al lado. Un solo trabajo, dos tareas:
   * el anillo contaba dos, Reportes contaba dos, y la vieja volvía al día
   * siguiente en «VIENEN DE ANTES» porque seguía abierta. Contra la
   * especificación —si el jefe pregunta qué hizo Javi, ve trabajo que nadie hizo.
   */
  const alSalirDeFila = async (valor: string) => {
    const nuevo = valor.trim()
    const antes = textoAlEnfocar.current.trim()
    textoAlEnfocar.current = ''
    if (!nuevo || demo || esPasado) return
    if (antes && normalizar(antes) !== normalizar(nuevo)) {
      const vieja = tareaDe(antes)
      if (vieja) {
        // Solo `text`: `diario_objetivo` NO viaja, y a propósito. El PATCH no deja
        // escribir el vínculo —y una regla lo fija— porque `diario_dia` movería una
        // tarea al día de otro; dejar pasar solo la mitad fabricaría el «vínculo a
        // medias» que el POST ya prohíbe. Emparejar por `text` basta: es lo que hace
        // la segunda rama de `tareaDe`.
        try { await data.updateTask(vieja.id, { text: nuevo }) } catch { /* el diario ya guardó el texto bueno */ }
        return
      }
    }
    await crearTareaDe(nuevo)
  }

  /** Los objetivos que todavía no son tarea mía de este día. */
  const porCrear = objetivosDeHoy.filter(o => !tareaDe(o))

  /** Marca o desmarca. Escribe en la tarea, que es donde vive el estado. */
  const alternarObjetivo = async (o: string) => {
    const t = tareaDe(o)
    try {
      if (t) await data.updateTask(t.id, { done: !t.done })
      // Sin tarea todavía —marcaste antes de fichar— se crea ya completada, que es
      // lo que acabas de decir que pasó.
      else await data.createTask({ text: o, level: 'high', done: true, assigned_to: profile?.id, source: 'ai', diario_dia: dia, diario_objetivo: o })
      // Y se recarga: el bloque «HOY EN EL EQUIPO» sale de `cargar()`, que solo
      // corría al montar, al cambiar de día y al fichar. Tachabas tres burbujas y
      // tu propia fila, dos dedos más abajo, seguía diciendo «0 HECHAS». La misma
      // verdad pintada en dos sitios que no se refrescaban igual.
      await cargar()
    } catch { showToast('No se pudo guardar') }
  }
  // Los objetivos ya no existen se descuentan solos: si borras una línea, su
  // marca de cumplido deja de contar en vez de inflar el porcentaje.
  /**
   * Las tareas de MI día que no escribí como objetivo.
   *
   * Crear una tarea en Tareas y escribir un objetivo en el Diario son dos formas
   * de decir lo mismo —esto es de mi día—, pero el Diario solo miraba lo segundo:
   * si te organizabas desde Tareas, tu día salía vacío y el anillo decía «0 de 2»
   * ignorando cinco tareas hechas. Dos maneras de marcar el día que no se hablaban.
   *
   * Van APARTE y etiquetadas, no mezcladas con los objetivos: lo que uno se
   * propuso por la mañana y lo que fue apareciendo no son lo mismo, y fundirlos
   * borraría justo la distancia que el Diario existe para enseñar.
   */
  const otrasDelDia = misTareasDelDia.filter((t: { text?: string }) =>
    !objetivosDeHoy.some(o => normalizar(o) === normalizar(t.text || '')),
  ) as { id: string; text?: string; done?: boolean }[]

  const cumplidosVivos = objetivosDeHoy.filter(estaHecho).length
  // El anillo mide el DÍA entero: los objetivos más lo que se creó por el camino.
  // Con solo los objetivos decía «0 de 2» en un día con cinco tareas cerradas.
  const totalDelDia = objetivosDeHoy.length + otrasDelDia.length
  const hechasDelDia = cumplidosVivos + otrasDelDia.filter(t => t.done).length
  const pctObjetivos = totalDelDia ? Math.round((hechasDelDia / totalDelDia) * 100) : 0
  const colorNivel = (l: string) => l === 'urgent' ? RED : l === 'high' ? AMBAR : BLU
  const yaCerrado = !!miEntrada?.cierre_at

  return (
    <div className="h-full overflow-y-auto" style={{ padding: isMobile ? '1rem' : '1.75rem' }}>

      {/* ── CABECERA ───────────────────────────────────────────────────
          Titulo, dia que se esta mirando y la accion principal. El selector de dia
          no es decoracion: el diario se llena todos los dias y sirve para mirar
          atras, asi que llegar a "el martes pasado" tiene que costar dos clics. */}
      {/* En móvil el título ocupa su propia fila y los botones bajan.
          Con `flex-1 min-w-0` los botones se llevaban 277 de 340 px y el título
          quedaba comprimido a 51: «Diario» necesita 71, así que se salía de su
          propia caja y arrastraba la sección de lado. */}
      <div className="flex items-start gap-3 mb-4 flex-wrap">
        {/* La misma cabecera que las otras once secciones: kicker Syne + título
            Figtree. Esta era la única en Syne mayúsculas con caja de icono
            violeta — el acento genérico que ya se retiró de la puesta en marcha. */}
        <div className={isMobile ? 'w-full min-w-0' : 'flex-1 min-w-0'}>
          <div className="font-syne text-[9px] font-black tracking-[0.25em] mb-2" style={{ color: 'rgba(255,255,255,0.18)' }}>
            DÍA A DÍA
          </div>
          {/* «Fichar» y no «Diario».
              Un diario suena a deberes: algo que hay que escribir y que se te
              acumula si no lo haces. Fichar es lo que de verdad se hace aquí —
              dices a qué vienes al entrar y qué has hecho al salir— y es el verbo
              que la propia pantalla ya usaba en sus botones. El identificador
              interno sigue siendo `diario`: cambiarlo rompería los atajos, los
              enlaces guardados y la columna de la base. */}
          <h1 className="font-figtree text-[26px] font-black text-white leading-none" style={{ letterSpacing: '-0.03em' }}>
            Fichar
          </h1>
          <div className="font-figtree text-[11.5px] mt-1.5" style={{ color: 'rgba(255,255,255,0.35)' }}>
            Lo que se propone y lo que hace el equipo, cada día.
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Navegar días, adelante y atrás. El «siguiente» estaba desactivado en
              hoy —«no hay futuro que ver»— y sí lo hay: planificar la semana es
              justo para lo que existe esta sección. */}
          <div className="flex items-center rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${BORDER}` }}>
            <button onClick={() => setDia(sumarDias(dia, -1))} aria-label="Día anterior"
              className="w-8 h-8 flex items-center justify-center transition-opacity hover:opacity-70">
              <LucideIcon name="chevron-left" size={14} color="rgba(255,255,255,0.45)" />
            </button>
            <button onClick={() => setVerCalendario(v => !v)}
              className="px-3 h-8 font-figtree text-[11px] whitespace-nowrap flex items-center gap-1.5"
              style={{ color: esHoy ? 'rgba(255,255,255,0.6)' : VIO }}>
              <LucideIcon name="calendar" size={11} color={esHoy ? 'rgba(255,255,255,0.4)' : VIO} />
              {etiquetaDia(dia)}
            </button>
            <button onClick={() => setDia(sumarDias(dia, 1))} aria-label="Día siguiente"
              className="w-8 h-8 flex items-center justify-center transition-opacity hover:opacity-70 disabled:opacity-20">
              <LucideIcon name="chevron-right" size={14} color="rgba(255,255,255,0.45)" />
            </button>
          </div>

          {/* Solo en hoy: no se ficha en un dia que ya paso. */}
          {(
            <button onClick={anadirObjetivo}
              className="flex items-center gap-1.5 pl-3 pr-4 h-9 rounded-full font-syne text-[9px] font-black tracking-widest transition-all active:scale-95"
              style={{ background: `linear-gradient(140deg, ${VIO}30, ${BLU}22)`, border: `1px solid ${VIO}48`, color: '#DCD3FF' }}>
              <LucideIcon name="plus" size={13} color="#DCD3FF" />
              NUEVO OBJETIVO
            </button>
          )}
        </div>
      </div>

      {verCalendario && (
        <div className="mb-4">
          {/* Se abre desde la tira de la semana y NO había forma de volver a
              cerrarlo salvo eligiendo un día — o sea que para plegarlo tenías que
              cambiar de día, que es un efecto que quizá no querías. Un panel que se
              despliega tiene que poder replegarse con el mismo gesto. */}
          <div className="flex items-center justify-between mb-2 px-1">
            <span className="font-syne text-[8px] font-black tracking-[0.18em]" style={{ color: 'rgba(255,255,255,0.28)' }}>
              CALENDARIO DEL MES
            </span>
            <button onClick={() => setVerCalendario(false)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl font-syne text-[8px] font-black tracking-widest transition-all hover:opacity-70"
              style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${BORDER}`, color: 'rgba(255,255,255,0.4)' }}>
              <LucideIcon name="chevron-up" size={11} color="rgba(255,255,255,0.35)" />
              PLEGAR
            </button>
          </div>
          <CalendarioDiario
            diaSeleccionado={dia}
            demo={diasDemo}
            onElegirDia={d => { setDia(d); setVerCalendario(false) }}
          />
        </div>
      )}

      {/* ── HÉROE: EL ESTADO DEL DÍA ───────────────────────────────────── */}
      <div className="relative rounded-3xl mb-4 overflow-hidden"
        style={{ background: `linear-gradient(120deg, ${VIO}1C 0%, ${BLU}12 45%, ${SURF2} 100%)`, border: `1px solid ${VIO}2E` }}>
        {/* Dos halos difuminados. Mismo recurso que el orbe de Harvey: ata la
            seccion al lenguaje que la app ya tiene en vez de inventar otro. */}
        <div className="absolute pointer-events-none" aria-hidden
          style={{ width: '46%', height: '190%', top: '-45%', right: '-6%', borderRadius: '9999px',
                   background: `radial-gradient(closest-side, ${VIO}30, transparent)`, filter: 'blur(34px)' }} />
        <div className="absolute pointer-events-none" aria-hidden
          style={{ width: '30%', height: '150%', top: '-25%', right: '22%', borderRadius: '9999px',
                   background: `radial-gradient(closest-side, ${BLU}26, transparent)`, filter: 'blur(30px)' }} />

        <div className={`relative flex items-center gap-5 px-6 py-6 ${isMobile ? 'flex-wrap' : ''}`}>
          <div className="flex-shrink-0" style={{ position: 'relative' }}>
            <ProgressRing pct={pctObjetivos} size={82} stroke={4} color={yaCerrado ? GRN : VIO} />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="font-syne text-[17px] font-black" style={{ color: yaCerrado ? GRN : '#E6DEFF' }}>
                {pctObjetivos}%
              </span>
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-syne text-[8px] font-black tracking-[0.18em] mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
              MI DÍA · {fechaLarga(dia).toUpperCase()}
            </div>
            <div className="font-figtree font-bold text-white leading-tight" style={{ fontSize: isMobile ? '19px' : '23px', letterSpacing: '-0.02em' }}>
              {totalDelDia
                ? (otrasDelDia.length
                    // Si hay tareas que no venían de un objetivo, se dice «del día»:
                    // llamarlas «objetivos» sería mentir sobre de dónde salieron.
                    ? `${hechasDelDia} de ${totalDelDia} del día`
                    : `${cumplidosVivos} de ${plural(objetivosDeHoy.length, 'objetivo', 'objetivos')}`)
                : 'Sin objetivos todavía'}
            </div>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className="font-syne text-[7.5px] font-black tracking-widest px-2.5 py-1 rounded-full"
                style={{ background: yaCerrado ? `${GRN}1E` : miEntrada?.entrada_at ? `${AMBAR}1E` : 'rgba(255,255,255,0.06)',
                         color: yaCerrado ? GRN : miEntrada?.entrada_at ? AMBAR : 'rgba(255,255,255,0.4)' }}>
                {yaCerrado ? 'CERRADO' : miEntrada?.entrada_at ? 'EN MARCHA' : 'SIN FICHAR'}
              </span>
              {miEntrada?.entrada_at && (
                <span className="font-figtree text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  entrada {horaCorta(miEntrada.entrada_at)}{miEntrada.cierre_at ? ` · cierre ${horaCorta(miEntrada.cierre_at)}` : ''}
                </span>
              )}
            </div>
          </div>
          <div className="font-syne text-[7px] font-black tracking-widest flex-shrink-0 transition-opacity self-start"
            style={{ color: estadoGuardado === 'guardado' ? GRN : 'rgba(255,255,255,0.3)', opacity: estadoGuardado === 'limpio' ? 0 : 1 }}>
            {estadoGuardado === 'guardando' ? 'GUARDANDO' : 'GUARDADO'}
          </div>

          {/* Sesión y racha, a la derecha del saludo.
              Los dos salen de datos que YA existen: el reloj es `ahora - entrada_at`
              y la racha son días seguidos con fichaje. No se guarda ningún contador
              — un contador guardado se desincroniza en cuanto alguien cierra la
              pestaña, y entonces miente con mucha precisión. */}
          {/* EL CRONÓMETRO. Tres estados y una sola acción en cada uno.
              Javi: «sigo sin ver un botón de marcar entrada… quiero que sea como un
              cronómetro del tiempo que hemos estado en la oficina, empieza con lo
              que me propongo y termina con lo completo».
              Estaba casi todo hecho y no se veía por dos motivos: el bloque iba
              detrás de `!isMobile` —o sea que en el móvil no existía— y el botón de
              fichar estaba enterrado al final del panel de objetivos, visible solo
              si ya habías escrito alguno.
              Ahora vive en la cabecera, se ve en las dos pantallas, y dice qué toca
              hacer ahora: marcar entrada, o terminar. El reloj no se guarda: es
              `ahora − entrada_at`, así que no hay nada que se pueda desincronizar. */}
          {esHoy && (
            <div className={`flex-shrink-0 flex items-center gap-4 ${isMobile ? 'w-full mt-4 pt-4' : 'pl-6'}`}
              style={isMobile ? { borderTop: `1px solid ${BORDER}` } : { borderLeft: `1px solid ${BORDER}` }}>

              {miEntrada?.entrada_at ? (
                <>
                  <div className="min-w-0">
                    <div className="font-syne text-[7.5px] font-black tracking-[0.18em] mb-1" style={{ color: 'rgba(255,255,255,0.3)' }}>
                      {yaCerrado ? 'DÍA COMPLETADO' : 'EN LA OFICINA'}
                    </div>
                    <div className="font-figtree font-black text-white" style={{ fontSize: isMobile ? '30px' : '26px', letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                      {tiempoSesion || '—'}
                    </div>
                    <div className="font-figtree text-[11px] mt-1.5" style={{ color: 'rgba(255,255,255,0.35)' }}>
                      desde las {horaCorta(miEntrada.entrada_at)}
                      {racha > 1 && ` · 🔥 ${racha} días`}
                    </div>
                  </div>
                  {!yaCerrado && (
                    <button onClick={() => fichar('cierre')} disabled={fichando}
                      className="flex items-center gap-2 px-4 py-3 rounded-2xl font-syne text-[9px] font-black tracking-widest transition-all hover:opacity-80 disabled:opacity-40 active:scale-[0.97] ml-auto flex-shrink-0"
                      style={{ background: `${VIO}18`, border: `1px solid ${VIO}42`, color: '#E6DEFF' }}>
                      <LucideIcon name="square" size={11} color="#E6DEFF" />
                      TERMINAR
                    </button>
                  )}
                </>
              ) : (
                <>
                  <div className="min-w-0">
                    <div className="font-syne text-[7.5px] font-black tracking-[0.18em] mb-1" style={{ color: 'rgba(255,255,255,0.3)' }}>
                      SIN FICHAR
                    </div>
                    <div className="font-figtree font-black" style={{ fontSize: isMobile ? '30px' : '26px', letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', lineHeight: 1, color: 'rgba(255,255,255,0.2)' }}>
                      00:00
                    </div>
                    <div className="font-figtree text-[11px] mt-1.5" style={{ color: 'rgba(255,255,255,0.35)' }}>
                      {porCrear.length > 0 ? 'El reloj arranca al marcar entrada' : 'Escribe tus objetivos para empezar'}
                    </div>
                  </div>
                  {/* Marcar entrada EXIGE objetivos —es lo que hace que el fichaje
                      valga para algo— así que sin ellos el botón lleva a
                      escribirlos en vez de dar un error. */}
                  <button
                    onClick={() => { if (porCrear.length > 0) fichar('entrada'); else refObjetivos.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }}
                    disabled={fichando}
                    className="flex items-center gap-2 px-4 py-3 rounded-2xl font-syne text-[9px] font-black tracking-widest transition-all hover:opacity-80 disabled:opacity-40 active:scale-[0.97] ml-auto flex-shrink-0"
                    style={{ background: `${GRN}18`, border: `1px solid ${GRN}45`, color: GRN }}>
                    <LucideIcon name="play" size={11} color={GRN} />
                    {porCrear.length > 0 ? 'MARCAR ENTRADA' : 'PONER OBJETIVOS'}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Lo que quedó sin cumplir. Se enseña ANTES de los objetivos de hoy porque
          es lo primero que hay que decidir: ¿lo retomo o lo dejo ir? Sin esto se
          caía del radar en silencio justo cuando más falta hacía verlo. */}
      {(vienenDeAntes.length > 0 || huerfanos.length > 0) && (
        <div className="rounded-2xl px-4 py-3.5 mb-4" style={{ background: `${AMBAR}0D`, border: `1px solid ${AMBAR}2E` }}>
          <div className="flex items-center gap-2 mb-2.5 flex-wrap">
            <LucideIcon name="history" size={14} color={AMBAR} />
            <div className="font-syne text-[8.5px] font-black tracking-widest flex-1" style={{ color: AMBAR }}>
              VIENEN DE ANTES · {vienenDeAntes.length + huerfanos.length}
            </div>
            <button onClick={async () => {
                if (vienenDeAntes.length) await traerAHoy(vienenDeAntes.map(t => t.id))
                for (const h of huerfanos) await traerHuerfano(h.texto)
              }} disabled={arrastrando}
              className="px-3 py-1.5 rounded-xl font-syne text-[8px] font-black tracking-widest transition-all active:scale-95 disabled:opacity-40"
              style={{ background: `${AMBAR}1E`, border: `1px solid ${AMBAR}45`, color: AMBAR }}>
              {arrastrando ? 'TRAYENDO…' : 'TRAER TODO A HOY'}
            </button>
          </div>
          <div className="flex flex-col gap-1.5">
            {vienenDeAntes.slice(0, 5).map(t => (
              <div key={t.id} className="flex items-center gap-2.5">
                <span className="font-figtree text-[10.5px] flex-shrink-0" style={{ color: 'rgba(255,255,255,0.3)' }}>
                  {etiquetaDia(t.diario_dia || '')}
                </span>
                <span className="font-figtree text-[12.5px] flex-1 min-w-0 truncate" style={{ color: 'rgba(255,255,255,0.8)' }}>{t.text}</span>
                <button onClick={() => traerAHoy([t.id])} disabled={arrastrando}
                  aria-label={`Traer «${t.text}» a hoy`}
                  className="font-syne text-[7.5px] font-black tracking-widest flex-shrink-0 transition-opacity hover:opacity-70 disabled:opacity-40"
                  style={{ color: AMBAR }}>TRAER</button>
              </div>
            ))}
            {/* Los que no llegaron a ser tarea. Van igual que los demás: para
                quien mira son lo mismo —algo que se propuso y no cerró—, y la
                diferencia de dónde salen es un detalle nuestro, no suyo. */}
            {huerfanos.slice(0, 5).map(h => (
              <div key={`${h.dia}-${h.texto}`} className="flex items-center gap-2.5">
                <span className="font-figtree text-[10.5px] flex-shrink-0" style={{ color: 'rgba(255,255,255,0.3)' }}>
                  {etiquetaDia(h.dia)}
                </span>
                <span className="font-figtree text-[12.5px] flex-1 min-w-0 truncate" style={{ color: 'rgba(255,255,255,0.8)' }}>{h.texto}</span>
                <button onClick={() => traerHuerfano(h.texto)} disabled={arrastrando}
                  aria-label={`Traer «${h.texto}» a hoy`}
                  className="font-syne text-[7.5px] font-black tracking-widest flex-shrink-0 transition-opacity hover:opacity-70 disabled:opacity-40"
                  style={{ color: AMBAR }}>TRAER</button>
              </div>
            ))}
            {vienenDeAntes.length + huerfanos.length > 10 && (
              <div className="font-figtree text-[11px] mt-0.5" style={{ color: 'rgba(255,255,255,0.3)' }}>
                y {vienenDeAntes.length + huerfanos.length - 10} más
              </div>
            )}
          </div>
        </div>
      )}

      {/* La semana entera, delante y siempre. Estaba dentro de un modal, así que
          para ver cómo venía había que abrirlo, mirar y cerrarlo — lo contrario de
          para lo que sirve: el valor de planificar está en tener el plano DELANTE
          mientras escribes. El mensual sigue estando, a un clic, para ir más lejos. */}
      <SemanaDiario
        diaSeleccionado={dia}
        onElegirDia={setDia}
        onAbrirMes={() => setVerCalendario(true)}
        miId={profile?.id}
        demo={diasDemo}
        isMobile={isMobile}
      />

      {/* ── LOS DOS PANELES ────────────────────────────────────────────
          Lado a lado en escritorio: proponerse y cumplir son las dos mitades de lo
          mismo, y verlas juntas es la mitad del valor. Apilados en móvil. */}
      <div className={isMobile ? 'flex flex-col gap-3 mb-4' : 'grid gap-3 mb-4'} style={isMobile ? undefined : { gridTemplateColumns: '1fr 1fr' }}>

        {/* OBJETIVOS — lista para leer, textarea para editar. */}
        <div ref={refObjetivos} className="rounded-3xl flex flex-col overflow-hidden" style={{ background: SURFACE, border: `1px solid ${BLU}26` }}>
          <div className="flex items-center gap-2 px-4 pt-3.5 pb-2.5">
            <LucideIcon name="target" size={14} color={BLU} />
            <div className="font-syne text-[9px] font-black tracking-widest flex-1" style={{ color: BLU }}>¿QUÉ ME PROPONGO?</div>
          </div>
          <div className="px-4 pb-4 flex-1 flex flex-col">
            {/* Mientras carga NO se enseña la lista vacía. Tardaba un segundo en
                llegar la entrada del día y en ese hueco la sección decía «Sin
                objetivos. Pulsa NUEVO OBJETIVO», que es exactamente lo contrario
                de lo que pasaba: los había, aún no habían llegado. */}
            {cargando && !sembrado.current ? (
              <div className="flex flex-col gap-1.5 flex-1" aria-busy="true">
                {[0, 1].map(i => (
                  <div key={i} className="rounded-xl animate-pls" style={{ height: '34px', background: 'rgba(255,255,255,0.04)', border: `1px solid ${BORDER}` }} />
                ))}
              </div>
            ) : (
            <div className="flex flex-col gap-1.5 flex-1">
              {filas.map((fila, i) => {
                const hecho = !!fila.trim() && estaHecho(fila)
                return (
                  <div key={i} className="group flex items-center gap-2 rounded-xl pl-2 pr-1.5 py-1"
                    style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${BORDER}` }}>
                    <span className="flex items-center justify-center flex-shrink-0 rounded-md font-syne text-[8.5px] font-black"
                      style={{ width: '18px', height: '18px', background: hecho ? `${GRN}22` : `${BLU}18`, color: hecho ? GRN : BLU }}>
                      {hecho ? '✓' : i + 1}
                    </span>
                    <input
                      ref={el => { refsFilas.current[i] = el }}
                      value={fila}
                      onChange={e => cambiarFilas(filas.map((f, k) => (k === i ? e.target.value : f)))}
                      onFocus={() => { textoAlEnfocar.current = fila }}
                      onBlur={() => alSalirDeFila(fila)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          const nuevas = [...filas]
                          nuevas.splice(i + 1, 0, '')
                          cambiarFilas(nuevas)
                          enfocarFila(i + 1)
                        } else if (e.key === 'Backspace' && !fila && filas.length > 1) {
                          e.preventDefault()
                          cambiarFilas(filas.filter((_, k) => k !== i))
                          enfocarFila(Math.max(0, i - 1))
                        }
                      }}
                      placeholder={EJEMPLOS[i] || 'Otro objetivo…'}
                      className="flex-1 min-w-0 bg-transparent text-[12.5px] text-white placeholder-white/20 outline-none py-1"
                      style={{ caretColor: BLU, textDecoration: hecho ? 'line-through' : undefined, opacity: hecho ? 0.55 : 1 }}
                    />
                    {(filas.length > 1 || !!fila) && (
                      <button
                        onClick={() => { cambiarFilas(filas.filter((_, k) => k !== i)); enfocarFila(Math.max(0, i - 1)) }}
                        aria-label={`Quitar objetivo ${i + 1}`}
                        className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 transition-opacity opacity-0 group-hover:opacity-100 focus:opacity-100"
                        style={{ opacity: isMobile ? 1 : undefined }}>
                        <LucideIcon name="x" size={11} color="rgba(255,255,255,0.35)" />
                      </button>
                    )}
                  </div>
                )
              })}

              <button
                // Por `anadirObjetivo`, que es quien comprueba si la última fila
                // ya está vacía. Llamando a `cambiarFilas` a pelo, pulsarlo dos
                // veces dejaba dos huecos y parecía que no había funcionado.
                onClick={anadirObjetivo}
                className="flex items-center gap-2 px-2 py-2 rounded-xl font-syne text-[8.5px] font-black tracking-widest transition-all active:scale-[0.99] self-start"
                style={{ color: BLU }}>
                <LucideIcon name="plus" size={12} color={BLU} /> AÑADIR OBJETIVO
              </button>
            </div>
            )}

            {!miEntrada?.entrada_at && objetivosDeHoy.length > 0 && (
              <button onClick={() => fichar('entrada')} disabled={fichando}
                className="mt-2.5 w-full py-2.5 rounded-2xl font-syne text-[9px] font-black tracking-widest disabled:opacity-40 transition-all active:scale-[0.99]"
                style={{ background: `${BLU}18`, border: `1px solid ${BLU}38`, color: BLU }}>
                {/* El número sale de lo que SE VA A CREAR, no de los objetivos
                    escritos: los que ya son tarea se saltan, y prometer «CREA 3»
                    para luego crear una es lo que hacía dudar de si había fichado. */}
                FICHAR ENTRADA · CREA {plural(porCrear.length, 'TAREA', 'TAREAS').toUpperCase()}
              </button>
            )}
          </div>
        </div>

        {/* ¿LO COMPLETÉ? — burbujas con círculo, y el balance debajo. */}
        <div className="rounded-3xl flex flex-col overflow-hidden" style={{ background: SURFACE, border: `1px solid ${yaCerrado ? GRN + '2E' : BORDER}` }}>
          <div className="flex items-center gap-2 px-4 pt-3.5 pb-2.5">
            <LucideIcon name="check-circle" size={14} color={GRN} />
            <div className="font-syne text-[9px] font-black tracking-widest" style={{ color: GRN }}>¿LO COMPLETÉ?</div>
          </div>

          {totalDelDia > 0 ? (
            <div className="px-4 pb-2.5 flex flex-wrap gap-2">
              {objetivosDeHoy.map((o, i) => {
                const hecho = estaHecho(o)
                return (
                  <button key={i}
                    onClick={() => alternarObjetivo(o)}
                    // Solo en HOY. En un día pasado, marcar sellaba `completed_at`
                    // con el instante actual: el jueves seguía en cero y hoy se
                    // inflaba. Repasar la semana no puede reescribir la semana.
                    // La clase `disabled:` ya estaba escrita; faltaba el prop.
                    disabled={!esHoy}
                    title={esHoy ? undefined : 'Solo se puede marcar en el día de hoy'}
                    className="flex items-center gap-2 pl-2 pr-3.5 py-2 rounded-full text-left transition-all active:scale-95 disabled:active:scale-100 disabled:cursor-default"
                    style={{ background: hecho ? `${GRN}16` : 'rgba(255,255,255,0.045)', border: `1px solid ${hecho ? GRN + '42' : BORDER}`, maxWidth: '100%' }}>
                    <span className="w-[18px] h-[18px] rounded-full flex items-center justify-center flex-shrink-0"
                      style={{ background: hecho ? GRN : 'transparent', border: `1.5px solid ${hecho ? GRN : 'rgba(255,255,255,0.22)'}` }}>
                      {hecho && <LucideIcon name="check" size={10} color="#06110A" />}
                    </span>
                    <span className="font-figtree text-[12px] truncate"
                      style={{ color: hecho ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.86)', textDecoration: hecho ? 'line-through' : 'none' }}>
                      {o}
                    </span>
                  </button>
                )
              })}

              {/* Lo que apareció por el camino, desde Tareas. Etiquetado y detrás:
                  cuenta para el día, pero no es lo que uno se propuso. */}
              {otrasDelDia.length > 0 && (
                <>
                  <div className="w-full font-syne text-[7px] font-black tracking-widest mt-1 mb-0.5" style={{ color: 'rgba(255,255,255,0.25)' }}>
                    TAMBIÉN HOY · DESDE TAREAS
                  </div>
                  {otrasDelDia.map(t => (
                    <button key={t.id}
                      onClick={() => { if (esHoy) data.updateTask(t.id, { done: !t.done }).then(() => cargar()).catch(() => showToast('No se pudo guardar')) }}
                      disabled={!esHoy}
                      title={esHoy ? undefined : 'Solo se puede marcar en el día de hoy'}
                      className="flex items-center gap-2 pl-2 pr-3.5 py-2 rounded-full text-left transition-all active:scale-95 disabled:active:scale-100 disabled:cursor-default"
                      style={{ background: t.done ? `${GRN}12` : 'rgba(255,255,255,0.03)', border: `1px dashed ${t.done ? GRN + '3A' : BORDER}`, maxWidth: '100%' }}>
                      <span className="w-[18px] h-[18px] rounded-full flex items-center justify-center flex-shrink-0"
                        style={{ background: t.done ? GRN : 'transparent', border: `1.5px solid ${t.done ? GRN : 'rgba(255,255,255,0.18)'}` }}>
                        {t.done && <LucideIcon name="check" size={10} color="#06110A" />}
                      </span>
                      <span className="font-figtree text-[12px] truncate"
                        style={{ color: t.done ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.7)', textDecoration: t.done ? 'line-through' : 'none' }}>
                        {t.text}
                      </span>
                    </button>
                  ))}
                </>
              )}
            </div>
          ) : (
            <div className="px-4 pb-2.5 font-figtree text-[12px]" style={{ color: 'rgba(255,255,255,0.22)' }}>
              Escribe objetivos y aquí los vas tachando.
            </div>
          )}

          <div className="px-4 pt-1 pb-4 flex-1 flex flex-col">
            <div className="relative flex-1 flex">
              <textarea
                value={balance}
                onChange={e => alEscribir('cierre', e.target.value)}
                  placeholder="Qué se quedó a medias y por qué…"
                rows={3}
                className="w-full px-3.5 py-3 pr-12 rounded-2xl text-[12.5px] text-white placeholder-white/20 outline-none resize-none leading-relaxed flex-1"
                style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${BORDER}`, caretColor: GRN, minHeight: '5.5rem' }}
              />
              {/* Cerrar el día, dentro del propio campo: es la acción que sigue a
                  escribirlo, y así no hace falta bajar la vista a otro botón. */}
              {!yaCerrado && (
                <button onClick={() => fichar('cierre')} disabled={fichando} aria-label="Cerrar el día"
                  className="absolute bottom-3 right-3 w-8 h-8 rounded-xl flex items-center justify-center transition-all active:scale-90 disabled:opacity-40"
                  style={{ background: `${GRN}1E`, border: `1px solid ${GRN}45` }}>
                  <LucideIcon name="check" size={14} color={GRN} />
                </button>
              )}
            </div>

            {/* ¿Cómo fue el día? Tres botones, al lado del texto y no en su lugar.
                El texto libre cuenta bien UN día y se agrega fatal: no se suma, no
                se ordena, y no se sabe si la semana ha ido peor que la anterior sin
                releerlo todo. Tres botones sí — y no le quitan sitio a escribir.
                Se guarda al pulsar, sin botón de confirmar: es un dato de un toque,
                y pedir dos gestos para uno sobra. */}
            <div className="mt-3">
              <div className="font-syne text-[7.5px] font-black tracking-[0.18em] mb-2" style={{ color: 'rgba(255,255,255,0.28)' }}>
                ¿CÓMO CALIFICAS TU DÍA?
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {([
                  { v: 'productivo', l: 'Productivo', c: GRN, icon: 'smile' },
                  { v: 'normal', l: 'Normal', c: AMBAR, icon: 'meh' },
                  { v: 'bloqueado', l: 'Bloqueado', c: RED, icon: 'frown' },
                ] as const).map(o => {
                  const puesto = miEntrada?.animo === o.v
                  return (
                    <button key={o.v} onClick={() => marcarAnimo(puesto ? null : o.v)} disabled={!esHoy}
                      title={esHoy ? undefined : 'Solo se califica el día de hoy'}
                      className="flex items-center gap-2 px-3.5 py-2 rounded-2xl font-figtree text-[12px] transition-all active:scale-95 disabled:opacity-40 disabled:active:scale-100"
                      style={{ background: puesto ? `${o.c}16` : 'rgba(255,255,255,0.03)',
                               border: `1px solid ${puesto ? o.c + '4A' : BORDER}`,
                               color: puesto ? o.c : 'rgba(255,255,255,0.5)' }}>
                      <LucideIcon name={o.icon} size={13} color={puesto ? o.c : 'rgba(255,255,255,0.35)'} />
                      {o.l}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── PULSO DEL EQUIPO Y LA SEMANA ────────────────────────────────
          Los dos salen de datos que YA se descargan: `porPersona` viene con el día
          y el resumen sale de los dos meses que se piden para la racha. Ni una
          consulta más.
          Van juntos y al final a propósito: lo tuyo primero —tus objetivos, tu
          cierre— y el equipo después. Al revés convierte Fichar en un panel de
          control de los demás, que es otra cosa y no la que se pidió. */}
      {!demo && porPersona.length > 0 && (
        <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: isMobile ? '1fr' : 'minmax(0,1.6fr) minmax(0,1fr)' }}>

          <div className="rounded-3xl overflow-hidden" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
            <div className="flex items-baseline gap-2.5 px-5 pt-4 pb-3">
              <span className="font-figtree text-[14px] font-bold text-white">Pulso del equipo</span>
              <span className="font-figtree text-[11.5px]" style={{ color: 'rgba(255,255,255,0.3)' }}>Así va el equipo hoy</span>
            </div>
            <div className="px-2 pb-2">
              {porPersona.map(p => {
                const objetivos = (p.entrada?.entrada || '').split('\n').filter(l => l.trim()).length
                // TODAS las de `p.tareas` estan hechas: /api/diario las trae con
                // `.eq('done', true)`, acotadas al dia de Madrid y ya atribuidas a esta
                // persona. Aqui habia un `.filter(t => (t as {done?:boolean}).done)` — y el
                // `select` de esa consulta NO trae la columna `done`, asi que el filtro daba
                // 0 SIEMPRE: el «Pulso del equipo» ensenaba 0 y 0% a todo el mundo, todos
                // los dias, desde que se escribio.
                //
                // Lo tapaba el `as`. Es el mismo patron que CLAUDE.md ya senala con `as any`
                // en HoySection: el cast no arregla el tipo, apaga al unico que iba a avisar.
                const hechas = p.tareas.length
                const pct = objetivos ? Math.min(100, Math.round((hechas / objetivos) * 100)) : 0
                const cerrado = !!p.entrada?.cierre_at
                const estado = cerrado ? { l: 'Todo completado', c: GRN }
                  : p.entrada?.animo === 'bloqueado' ? { l: 'Bloqueado', c: RED }
                  : p.entrada?.entrada_at ? { l: 'En progreso', c: AMBAR }
                  : { l: 'Sin fichar', c: 'rgba(255,255,255,0.25)' }
                const yo = p.persona.id === profile?.id
                return (
                  <div key={p.persona.id} className="flex items-center gap-3 px-3 py-2.5 rounded-2xl"
                    style={{ background: yo ? 'rgba(255,255,255,0.025)' : 'transparent' }}>
                    <span className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 font-syne text-[9px] font-black"
                      style={{ background: (p.persona.avatar_color || VIO) + '22', color: p.persona.avatar_color || VIO }}>
                      {p.persona.initials || (p.persona.name || '?').slice(0, 2).toUpperCase()}
                    </span>
                    <span className="font-figtree text-[12.5px] flex-shrink-0" style={{ color: 'rgba(255,255,255,0.72)', width: isMobile ? 74 : 96 }}>
                      {yo ? `${p.persona.name || 'Tú'} (Tú)` : p.persona.name || '—'}
                    </span>
                    {!isMobile && (
                      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: cerrado ? GRN : VIO }} />
                      </div>
                    )}
                    <span className="font-syne text-[10px] font-black flex-shrink-0" style={{ color: 'rgba(255,255,255,0.45)', width: 34, textAlign: 'right' }}>{pct}%</span>
                    <span className="font-figtree text-[11px] flex-shrink-0" style={{ color: 'rgba(255,255,255,0.28)', width: 34, textAlign: 'right' }}>
                      {hechas}/{objetivos}
                    </span>
                    <span className="flex items-center gap-1.5 flex-shrink-0" style={{ width: isMobile ? 96 : 128 }}>
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: estado.c }} />
                      <span className="font-figtree text-[11px] truncate" style={{ color: estado.c }}>{estado.l}</span>
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="rounded-3xl p-5" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
            <div className="font-figtree text-[14px] font-bold text-white mb-4">Resumen semanal</div>
            {([
              { icon: 'check-square', n: semana.hechos, l: 'Objetivos completados' },
              { icon: 'list', n: semana.totales, l: 'Objetivos totales' },
              { icon: 'trending-up', n: `${semana.pct}%`, l: 'Cumplimiento semanal' },
            ] as const).map(x => (
              <div key={x.l} className="flex items-center gap-3 mb-3.5">
                <span className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${BORDER}` }}>
                  <LucideIcon name={x.icon} size={13} color="rgba(255,255,255,0.4)" />
                </span>
                <div className="min-w-0">
                  <div className="font-figtree text-[17px] font-black text-white leading-none">{x.n}</div>
                  <div className="font-figtree text-[11px] mt-1" style={{ color: 'rgba(255,255,255,0.3)' }}>{x.l}</div>
                </div>
              </div>
            ))}
            <button onClick={() => setRango('semana')}
              className="font-syne text-[9px] font-black tracking-widest transition-opacity hover:opacity-70" style={{ color: VIO }}>
              VER ANÁLISIS SEMANAL →
            </button>
          </div>
        </div>
      )}

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
              {/* Tres botones y DOS preguntas distintas: HOY y SEMANA miran hacia
                  atrás («qué se ha hecho»), el tercero mira hacia delante («qué
                  queda»). Puestos en fila parecían tres tramos de tiempo, así que
                  el tercero se llama por lo que enseña —LO QUE VIENE— y va
                  separado por una barrita. Se llamaba ARRANQUE, que es jerga: solo
                  lo entiende quien lo escribió. */}
              {(['dia', 'semana'] as const).map(r => {
                const activo = !!briefing && rango === r
                return (
                  <button key={r} onClick={() => pedirBriefing(r)}
                    className="px-2.5 py-1 rounded-full font-syne text-[7.5px] font-black tracking-widest transition-all"
                    style={{
                      background: activo ? `${VIO}22` : 'rgba(255,255,255,0.04)',
                      border: `1px solid ${activo ? VIO + '40' : BORDER}`,
                      color: activo ? VIO : 'rgba(255,255,255,0.4)',
                    }}>
                    {r === 'dia' ? 'HOY' : 'SEMANA'}
                  </button>
                )
              })}

              {/* La barrita: es lo que dice, sin escribirlo, que la de la derecha
                  responde a otra pregunta. */}
              <div className="self-stretch w-px mx-1" style={{ background: BORDER }} />

              <button onClick={() => setRango('arranque')}
                className="px-2.5 py-1 rounded-full font-syne text-[7.5px] font-black tracking-widest transition-all"
                style={{
                  background: rango === 'arranque' ? `${VIO}22` : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${rango === 'arranque' ? VIO + '40' : BORDER}`,
                  color: rango === 'arranque' ? VIO : 'rgba(255,255,255,0.4)',
                }}>
                LO QUE VIENE
              </button>
            </div>
          </div>

          {rango === 'arranque' ? (
            <div className="px-4 pb-4">
              {arranque.totalColgadas === 0 && !arranque.vienen.length && !arranque.eventos.length ? (
                <div className="font-figtree text-[12px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
                  Nada colgado y nada con fecha esta semana. Empezáis en limpio.
                </div>
              ) : (
                <div className="flex flex-col gap-3.5">
                  {arranque.porPersona.length > 0 && (
                    <div>
                      <div className="font-syne text-[7.5px] font-black tracking-widest mb-2" style={{ color: AMBAR }}>
                        SE ARRASTRA · {arranque.totalColgadas}
                      </div>
                      <div className="flex flex-col gap-1.5">
                        {arranque.porPersona.map(x => (
                          <div key={x.persona.id} className="flex items-start gap-2.5">
                            <div className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 font-syne text-[7px] font-black mt-0.5"
                              style={{ background: `${x.persona.avatar_color || BLU}22`, color: x.persona.avatar_color || BLU }}>
                              {x.persona.initials || (x.persona.name || '?').slice(0, 2).toUpperCase()}
                            </div>
                            <div className="font-figtree text-[12px] flex-1 min-w-0" style={{ color: 'rgba(255,255,255,0.75)' }}>
                              <span className="font-bold text-white">{x.persona.name}</span>{' · '}
                              {x.colgadas.slice(0, 3).map(t => t.text).filter(Boolean).join(' · ')}
                              {x.colgadas.length > 3 ? ` y ${x.colgadas.length - 3} más` : ''}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {(arranque.vienen.length > 0 || arranque.eventos.length > 0) && (
                    <div>
                      <div className="font-syne text-[7.5px] font-black tracking-widest mb-2" style={{ color: BLU }}>
                        LO QUE VIENE · 7 DÍAS
                      </div>
                      <div className="flex flex-col gap-1">
                        {arranque.vienen.slice(0, 5).map(t => (
                          <div key={t.id} className="font-figtree text-[12px] flex items-baseline gap-2">
                            <span className="font-syne text-[9px] flex-shrink-0" style={{ color: 'rgba(255,255,255,0.3)' }}>{etiquetaDia(t.due_date || '')}</span>
                            <span className="min-w-0 truncate" style={{ color: 'rgba(255,255,255,0.75)' }}>{t.text}</span>
                          </div>
                        ))}
                        {arranque.eventos.slice(0, 4).map(e => (
                          <div key={e.id} className="font-figtree text-[12px] flex items-baseline gap-2">
                            <span className="font-syne text-[9px] flex-shrink-0" style={{ color: `${VIO}AA` }}>{etiquetaDia((e.start || '').slice(0, 10))}</span>
                            <span className="min-w-0 truncate" style={{ color: 'rgba(255,255,255,0.6)' }}>{e.title}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* La lectura se la pide quien quiera. El DATO está antes y sin
                      depender de que la IA responda ni de gastar una llamada. */}
                  {onAskHarvey && (
                    <button
                      onClick={() => onAskHarvey(
                        `Arranque de semana. Dame la lectura en 3 o 4 frases: qué es lo más urgente, quién va más cargado y qué riesgo ves.\n\n` +
                        `SE ARRASTRA de días anteriores (${arranque.totalColgadas}):\n` +
                        (arranque.porPersona.map(x => `  ${x.persona.name}: ${x.colgadas.map(t => t.text).filter(Boolean).join(' · ')}`).join('\n') || '  nada') +
                        `\n\nCON FECHA ESTA SEMANA:\n` +
                        (arranque.vienen.map(t => `  ${t.due_date}: ${t.text}`).join('\n') || '  nada') +
                        `\n\nEN EL CALENDARIO:\n` +
                        (arranque.eventos.map(e => `  ${(e.start || '').slice(0, 10)}: ${e.title}`).join('\n') || '  nada'),
                      )}
                      className="self-start flex items-center gap-2 px-3.5 py-2 rounded-xl font-syne text-[8px] font-black tracking-widest transition-all active:scale-95"
                      style={{ background: `${VIO}18`, border: `1px solid ${VIO}3A`, color: VIO }}>
                      <LucideIcon name="sparkles" size={11} color={VIO} />
                      QUE LO LEA HARVEY
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : cargandoBrief ? (
            <div className="px-4 pb-4 font-figtree text-[11px]" style={{ color: 'rgba(255,255,255,0.25)' }}>Cargando…</div>
          ) : !briefing ? (
            <div className="px-4 pb-4 font-figtree text-[11px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
              Elige HOY o SEMANA para ver qué ha hecho cada uno.
            </div>
          ) : (
            <>
              {/* UNA CIFRA DOMINANTE, no tres píldoras iguales.
                  Tres números del mismo tamaño no dicen qué mirar primero. La
                  pregunta de un jefe es «¿se está haciendo lo que se prometió?»,
                  y eso es UNA fracción: hechas de propuestas. Lo demás la apoya.
                  Y el rango ESCRITO: `desde` y `hasta` viajaban en la respuesta y
                  no se pintaban en ningún sitio — «SEMANA» sin fechas obliga a
                  adivinar qué semana. */}
              <div className="px-4 pb-4">
                <div className="flex items-end gap-3 flex-wrap">
                  <div className="font-figtree font-black leading-none" style={{ fontSize: '34px', letterSpacing: '-0.03em', color: '#FFFFFF' }}>
                    {briefing.total?.completadas ?? 0}
                    <span style={{ fontSize: '17px', color: 'rgba(255,255,255,0.35)' }}> / {briefing.total?.objetivos ?? 0}</span>
                  </div>
                  <div className="font-figtree text-[12px] pb-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>
                    hechas de lo propuesto
                    <span className="block text-[11px]" style={{ color: 'rgba(255,255,255,0.28)' }}>
                      {briefing.desde === briefing.hasta ? `hoy, ${briefing.hasta}` : `del ${briefing.desde} al ${briefing.hasta}`}
                      {' · '}{briefing.total?.diasCerrados ?? 0} {briefing.total?.diasCerrados === 1 ? 'día cerrado' : 'días cerrados'}
                    </span>
                  </div>
                  {/* El bloqueo, arriba y en ámbar: es lo único que pide acción HOY. */}
                  {(briefing.equipo || []).some((p: any) => p.bloqueos > 0) && (
                    <span className="ml-auto font-syne text-[8px] font-black tracking-widest px-2.5 py-1.5 rounded-full"
                      style={{ background: `${AMBAR}14`, border: `1px solid ${AMBAR}38`, color: AMBAR }}>
                      {(briefing.equipo || []).filter((p: any) => p.bloqueos > 0).map((p: any) => p.persona.name?.split(' ')[0]).join(', ')} CON BLOQUEOS
                    </span>
                  )}
                </div>
              </div>

              <div className="flex flex-col">
                {/* ORDEN POR SEÑAL, no por el orden de la tabla `profiles`.
                    Primero quien tiene bloqueos —es lo único que pide acción hoy—,
                    luego quien dejó días sin cerrar, y el resto por lo hecho. Un
                    listado en el orden de la base le pide al jefe que escanee
                    siete filas para encontrar la que importa. */}
                {([...(briefing.equipo || [])].sort((a: any, b: any) =>
                  (b.bloqueos - a.bloqueos)
                  || ((b.dias - b.cerrados) - (a.dias - a.cerrados))
                  || (b.completadas - a.completadas)
                )).map((p: any) => (
                  <div key={p.persona.id} className="px-4 py-3" style={{ borderTop: `1px solid ${BORDER}` }}>
                    <div className="flex items-center gap-2.5 mb-1.5 flex-wrap cursor-pointer" onClick={() => setBriefAbierto(briefAbierto === p.persona.id ? null : p.persona.id)}>
                      <div className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 font-syne text-[8px] font-black"
                        style={{ background: `${p.persona.avatar_color || BLU}22`, color: p.persona.avatar_color || BLU }}>
                        {p.persona.initials || (p.persona.name || '?').slice(0, 2).toUpperCase()}
                      </div>
                      <div className="font-figtree text-[13px] font-bold text-white flex-1 min-w-0">{p.persona.name}</div>
                      {p.bloqueos > 0 && (
                        <span className="font-syne text-[7.5px] font-black tracking-widest px-2 py-0.5 rounded-full"
                          style={{ background: `${AMBAR}14`, border: `1px solid ${AMBAR}38`, color: AMBAR }}>
                          BLOQUEADO
                        </span>
                      )}
                      <div className="font-figtree text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
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

                    {/* EL TEXTO DEL DIARIO, que viajaba en la respuesta y no se
                        pintaba NUNCA. Es la parte con más información del briefing
                        —qué se propuso cada uno y qué cuenta que hizo, con sus
                        palabras— y estaba muerta en el JSON. Al tocar la fila se
                        despliega, día a día, con el ánimo al lado. */}
                    {briefAbierto === p.persona.id && (p.entradas || []).length > 0 && (
                      <div className="mt-2.5 flex flex-col gap-2.5 pl-2" style={{ borderLeft: `2px solid ${(p.persona.avatar_color || BLU)}30` }}>
                        {(p.entradas || []).map((e: any) => (
                          <div key={e.dia}>
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="font-syne text-[7.5px] font-black tracking-widest" style={{ color: 'rgba(255,255,255,0.35)' }}>{e.dia}</span>
                              {e.animo && (
                                <span className="font-figtree text-[10px]" style={{ color: e.animo === 'bloqueado' ? AMBAR : e.animo === 'productivo' ? GRN : 'rgba(255,255,255,0.35)' }}>
                                  {e.animo}
                                </span>
                              )}
                            </div>
                            {e.entrada && (
                              <div className="font-figtree text-[12px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.55)' }}>
                                <span style={{ color: 'rgba(255,255,255,0.3)' }}>se propuso · </span>{e.entrada}
                              </div>
                            )}
                            {e.cierre && (
                              <div className="font-figtree text-[12px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.75)' }}>
                                <span style={{ color: 'rgba(255,255,255,0.3)' }}>hizo · </span>{e.cierre}
                              </div>
                            )}
                          </div>
                        ))}
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
      ) : porPersona.length === 0 ? (
        <div className="rounded-2xl px-4 py-7 text-center" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
          <div className="font-figtree text-[12px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
            {dia > todayKey() ? 'Nadie ha planificado este día todavía.' : 'Nadie fichó ni cerró tareas este día.'}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {porPersona.map(p => {
            const e = p.entrada
            const objs = lineas(e?.entrada)
            const desplegado = abierto === p.persona.id
            const color = p.persona.avatar_color || BLU
            return (
              <div key={p.persona.id} className="rounded-2xl overflow-hidden"
                style={{ background: SURFACE, border: `1px solid ${desplegado ? color + '3A' : BORDER}` }}>
                {/* La fila es el BOTÓN. Pulsar el nombre despliega lo que hizo —era
                    el encargo— y con toda la fila activa no hay que apuntar. */}
                <button onClick={() => setAbierto(a => a === p.persona.id ? null : p.persona.id)}
                  aria-expanded={desplegado}
                  className="w-full flex items-center gap-2.5 px-4 py-3 text-left transition-all active:scale-[0.995]">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 font-syne text-[9px] font-black"
                    style={{ background: `${color}22`, color }}>
                    {p.persona.initials || (p.persona.name || '?').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-figtree text-[12.5px] font-bold text-white">{p.persona.name || 'Alguien'}</div>
                    <div className="font-figtree text-[10.5px]" style={{ color: 'rgba(255,255,255,0.32)' }}>
                      {e?.entrada_at ? `entró ${horaCorta(e.entrada_at)}` : objs.length ? 'planificado' : 'sin fichar'}
                      {e?.cierre_at ? ` · cerró ${horaCorta(e.cierre_at)}` : ''}
                      {objs.length ? ` · ${plural(objs.length, 'objetivo', 'objetivos')}` : ''}
                    </div>
                  </div>
                  {/* El número que de verdad se busca: cuántas sacó adelante. */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="font-syne text-[7px] font-black tracking-widest px-2 py-1 rounded-full"
                      style={{ background: `${GRN}16`, color: GRN }}>
                      {p.tareas.length} {p.tareas.length === 1 ? 'HECHA' : 'HECHAS'}
                    </span>
                    <LucideIcon name={desplegado ? 'chevron-up' : 'chevron-down'} size={13} color="rgba(255,255,255,0.3)" />
                  </div>
                </button>

                {desplegado && (
                  <div className="px-4 pb-3.5 flex flex-col gap-2.5" style={{ borderTop: `1px solid ${BORDER}` }}>
                    {objs.length > 0 && (
                      <div className="pt-3">
                        <div className="font-syne text-[7px] font-black tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.28)' }}>
                          SE PROPUSO
                        </div>
                        <ul className="flex flex-col gap-1">
                          {objs.map((o, k) => (
                            <li key={k} className="flex items-start gap-2">
                              <span className="mt-[6px] w-1 h-1 rounded-full flex-shrink-0" style={{ background: 'rgba(255,255,255,0.25)' }} />
                              <span className="font-figtree text-[12px] leading-snug" style={{ color: 'rgba(255,255,255,0.72)' }}>{o}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className={objs.length ? '' : 'pt-3'}>
                      <div className="font-syne text-[7px] font-black tracking-widest mb-1.5" style={{ color: `${GRN}` }}>
                        TAREAS COMPLETADAS
                      </div>
                      {p.tareas.length ? (
                        <div className="flex flex-wrap gap-1.5">
                          {p.tareas.map(t => (
                            <span key={t.id} className="font-figtree text-[11px] px-2.5 py-1.5 rounded-full"
                              style={{ background: `${GRN}0E`, border: `1px solid ${GRN}28`, color: 'rgba(255,255,255,0.72)' }}>
                              {t.text}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div className="font-figtree text-[11px]" style={{ color: 'rgba(255,255,255,0.25)' }}>
                          Ninguna cerrada este día.
                        </div>
                      )}
                    </div>

                    {e?.cierre && (
                      <div className="rounded-xl px-3 py-2" style={{ background: `${GRN}0C`, borderLeft: `2px solid ${GRN}55` }}>
                        <div className="font-syne text-[7px] font-black tracking-widest mb-1" style={{ color: GRN }}>BALANCE</div>
                        <div className="font-figtree text-[12px] leading-snug" style={{ color: 'rgba(255,255,255,0.72)', whiteSpace: 'pre-wrap' }}>{e.cierre}</div>
                      </div>
                    )}
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
