'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { BLU, GRN, AMBAR, RED, VIO, SURFACE, SURF2, BORDER } from '@/components/shared/design-tokens'
import { LucideIcon, useIsMobile, plural, ProgressRing, todayKey, localDayKey } from '@/components/shared'
import type { NexusData, Profile } from '@/types'
import type { IrASeccion } from '@/components/shared/secciones'
import CalendarioDiario from '@/components/shared/CalendarioDiario'

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
const lineas = (t?: string | null) =>
  (t || '').split('\n').map(l => l.replace(/^[-•*\s]+/, '').trim()).filter(Boolean)

export default function DiarioSection({ data, profile, showToast, onNavigate, demo, diasDemo }: Props) {
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
  const [rango, setRango] = useState<'dia' | 'semana'>('dia')
  const [cargandoBrief, setCargandoBrief] = useState(false)
  // El día que se está mirando. Hoy por defecto; se puede retroceder para
  // consultar lo que hizo el equipo cualquier otro día — el diario es un
  // histórico que se va llenando, no solo la pantalla de hoy.
  const [dia, setDia] = useState<string>(() => todayKey())
  const esHoy = dia === todayKey()

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
  const [editando, setEditando] = useState(false)
  // El calendario se abre a demanda: la mayoria de las visitas son «abro, escribo
  // lo de hoy y me voy», y un mes entero de rejilla ahi arriba estorbaria a eso.
  const [verCalendario, setVerCalendario] = useState(false)
  const [porPersona, setPorPersona] = useState<PersonaDelDia[]>([])
  // Quién está desplegado. Uno cada vez: abrir varios convierte la lista en un
  // muro y se pierde justo lo que se venía a ver.
  const [abierto, setAbierto] = useState<string | null>(null)

  const miEntrada = entradas.find(e => e.user_id === profile?.id) || null
  const sembrado = useRef(false)
  const guardadoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const refObjetivos = useRef<HTMLTextAreaElement>(null)
  const extraerTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ultimoExtraido = useRef('')
  // Lo que has quitado a mano no vuelve. Sin esto, cada relectura del texto lo
  // resucitaba y había que quitarlo otra vez.
  const rechazadas = useRef<Set<string>>(new Set())

  const cargar = useCallback(async () => {
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
    sembrado.current = false; setObjetivos(''); setBalance('')
    // Y se olvida lo pendiente del día anterior: ya se guardó al escribirlo, y
    // arrastrarlo haría que el guardado de salida lo escribiera en el día nuevo.
    if (guardadoTimer.current) { clearTimeout(guardadoTimer.current); guardadoTimer.current = null }
    pendiente.current = { dia }
  }, [dia])

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
  // Un 401 corta el autoguardado en seco. Sin esto, una sesión caducada convierte
  // cada pulsación en una petición rechazada: decenas de errores en consola, el
  // indicador parpadeando, y el usuario escribiendo un rato entero contra nada.
  const sesionCaida = useRef(false)

  const guardarBorrador = useCallback(async (campos: { entrada?: string; cierre?: string }) => {
    if (demo || sesionCaida.current) return
    setEstadoGuardado('guardando')
    try {
      const res = await fetch('/api/diario', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // El DIA viaja: si no, rellenar el lunes el martes escribiria en el martes.
        body: JSON.stringify({ ...campos, dia, borrador: true }),
      })
      setEstadoGuardado(res.ok ? 'guardado' : 'limpio')
      if (res.status === 401) {
        sesionCaida.current = true
        showToast('Tu sesión ha caducado — vuelve a entrar para seguir guardando')
        return
      }
      if (!res.ok) showToast('No se pudo guardar el diario')
    } catch { setEstadoGuardado('limpio'); showToast('No se pudo guardar el diario') }
  }, [dia, demo, showToast])

  const alEscribir = (campo: 'entrada' | 'cierre', valor: string) => {
    if (campo === 'entrada') setObjetivos(valor); else setBalance(valor)
    setEstadoGuardado('guardando')
    // Solo lo TOCADO queda pendiente, y con el día en que se tocó.
    pendiente.current = { ...pendiente.current, [campo]: valor, dia }
    if (guardadoTimer.current) clearTimeout(guardadoTimer.current)
    guardadoTimer.current = setTimeout(() => {
      // Se limpia al dispararse: si no, queda «pendiente» para siempre y el
      // guardado de salida vuelve a mandar lo que ya está escrito.
      guardadoTimer.current = null
      guardarBorrador({ [campo]: valor })
    }, 1200)
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
  const pendiente = useRef<{ entrada?: string; cierre?: string; dia: string }>({ dia })
  pendiente.current = { ...pendiente.current, dia }
  useEffect(() => () => {
    const { entrada, cierre, dia: diaPendiente } = pendiente.current
    if (!guardadoTimer.current) return
    clearTimeout(guardadoTimer.current)
    if (entrada === undefined && cierre === undefined) return
    fetch('/api/diario', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Sin `await`: el componente se está desmontando. `keepalive` hace que el
      // navegador termine la petición aunque la página cambie.
      body: JSON.stringify({
        ...(entrada !== undefined ? { entrada } : {}),
        ...(cierre !== undefined ? { cierre } : {}),
        dia: diaPendiente, borrador: true,
      }),
      keepalive: true,
    }).catch(() => {})
  }, [])

  // ── Las tareas se proponen solas ──────────────────────────────────────────
  useEffect(() => {
    const texto = [objetivos, balance].filter(Boolean).join('\n').trim()
    if (demo || sesionCaida.current) return
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
        const yaSon = new Set(misTareasDelDia.map((t: { text?: string }) => normalizar(t.text || '')))
        const nuevas = lineas(valor).filter(o => !yaSon.has(normalizar(o)))
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

  /** Abre la edición con una línea nueva al final, lista para escribir. */
  const anadirObjetivo = () => {
    setEditando(true)
    setObjetivos(v => (v.trim() ? v.replace(/\n+$/, '') + '\n' : ''))
    // El foco va al final del textarea, que es donde acaba de aparecer el hueco.
    setTimeout(() => {
      const ta = refObjetivos.current
      if (!ta) return
      ta.focus()
      ta.setSelectionRange(ta.value.length, ta.value.length)
    }, 40)
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
        await data.createTask({ text: p.text, level: p.level, done: p.hecha, assigned_to: profile?.id, source: 'ai', diario_dia: dia, diario_objetivo: p.text })
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
      misTareasDelDia.find((t: { text?: string; diario_objetivo?: string | null }) =>
        !t.diario_objetivo && normalizar(t.text || '') === clave)
    ) as { id: string; text?: string; done?: boolean } | undefined
  }
  const estaHecho = (o: string) => !!tareaDe(o)?.done

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
  const cumplidosVivos = objetivosDeHoy.filter(estaHecho).length
  const pctObjetivos = objetivosDeHoy.length ? Math.round((cumplidosVivos / objetivosDeHoy.length) * 100) : 0
  const colorNivel = (l: string) => l === 'urgent' ? RED : l === 'high' ? AMBAR : BLU
  const yaCerrado = !!miEntrada?.cierre_at

  return (
    <div className="h-full overflow-y-auto" style={{ padding: isMobile ? '1rem' : '1.75rem' }}>

      {/* ── CABECERA ───────────────────────────────────────────────────
          Titulo, dia que se esta mirando y la accion principal. El selector de dia
          no es decoracion: el diario se llena todos los dias y sirve para mirar
          atras, asi que llegar a "el martes pasado" tiene que costar dos clics. */}
      <div className="flex items-start gap-3 mb-4 flex-wrap">
        {/* La misma cabecera que las otras once secciones: kicker Syne + título
            Figtree. Esta era la única en Syne mayúsculas con caja de icono
            violeta — el acento genérico que ya se retiró de la puesta en marcha. */}
        <div className="flex-1 min-w-0">
          <div className="font-syne text-[9px] font-black tracking-[0.25em] mb-2" style={{ color: 'rgba(255,255,255,0.18)' }}>
            DÍA A DÍA
          </div>
          <h1 className="font-figtree text-[26px] font-black text-white leading-none" style={{ letterSpacing: '-0.03em' }}>
            Diario
          </h1>
          <div className="font-figtree text-[11.5px] mt-1.5" style={{ color: 'rgba(255,255,255,0.35)' }}>
            Lo que se propone y lo que hace el equipo, cada día.
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Navegar dias. `esHoy` desactiva el "siguiente": no hay futuro que ver. */}
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
            <button onClick={() => setDia(sumarDias(dia, 1))} disabled={esHoy} aria-label="Día siguiente"
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

        <div className="relative flex items-center gap-5 px-6 py-6">
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
              {objetivosDeHoy.length
                ? `${cumplidosVivos} de ${plural(objetivosDeHoy.length, 'objetivo', 'objetivos')}`
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
        </div>
      </div>

      {/* ── LOS DOS PANELES ────────────────────────────────────────────
          Lado a lado en escritorio: proponerse y cumplir son las dos mitades de lo
          mismo, y verlas juntas es la mitad del valor. Apilados en móvil. */}
      <div className={isMobile ? 'flex flex-col gap-3 mb-4' : 'grid gap-3 mb-4'} style={isMobile ? undefined : { gridTemplateColumns: '1fr 1fr' }}>

        {/* OBJETIVOS — lista para leer, textarea para editar. */}
        <div className="rounded-3xl flex flex-col overflow-hidden" style={{ background: SURFACE, border: `1px solid ${BLU}26` }}>
          <div className="flex items-center gap-2 px-4 pt-3.5 pb-2.5">
            <LucideIcon name="target" size={14} color={BLU} />
            <div className="font-syne text-[9px] font-black tracking-widest flex-1" style={{ color: BLU }}>¿QUÉ ME PROPONGO?</div>
            {(
              <button onClick={() => setEditando(e => !e)} aria-label={editando ? 'Ver la lista' : 'Editar objetivos'}
                className="w-7 h-7 rounded-lg flex items-center justify-center transition-all active:scale-90"
                style={{ background: editando ? `${BLU}20` : 'rgba(255,255,255,0.04)' }}>
                <LucideIcon name={editando ? 'check' : 'pencil'} size={12} color={editando ? BLU : 'rgba(255,255,255,0.4)'} />
              </button>
            )}
          </div>
          <div className="px-4 pb-4 flex-1 flex flex-col">
            {editando || (!objetivosDeHoy.length && esHoy) ? (
              <textarea
                ref={refObjetivos}
                value={objetivos}
                onChange={e => alEscribir('entrada', e.target.value)}
                // Sin esto el campo se desmontaba al teclear la PRIMERA letra, y
                // solo le pasaba a quien no había escrito nada ese día: la
                // condición de arriba mira `objetivosDeHoy`, que sale del propio
                // texto, así que en cuanto había una línea dejaba de cumplirse y
                // React cambiaba el <textarea> por la lista de solo lectura. Se
                // perdía el foco y lo que siguieras escribiendo no llegaba a
                // ninguna parte. Al enfocar se marca `editando`, y entonces el
                // campo ya no depende de su propio contenido para existir.
                onFocus={() => setEditando(true)}
                onBlur={() => setEditando(false)}
                placeholder={'Cerrar el presupuesto de Nike\nMontar el reel de Mango\nLlamar al proveedor'}
                rows={5}
                className="w-full px-3.5 py-3 rounded-2xl text-[12.5px] text-white placeholder-white/20 outline-none resize-none leading-relaxed flex-1"
                style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${BORDER}`, caretColor: BLU, minHeight: '7rem' }}
              />
            ) : (
              <div className="rounded-2xl px-4 py-3.5 flex-1" style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${BORDER}`, minHeight: '7rem' }}>
                {objetivosDeHoy.length ? (
                  <ul className="flex flex-col gap-2">
                    {objetivosDeHoy.map((o, i) => (
                      <li key={i} className="flex items-start gap-2.5">
                        <span className="mt-[7px] w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: `${BLU}AA` }} />
                        <span className="font-figtree text-[13px] leading-snug" style={{ color: 'rgba(255,255,255,0.86)' }}>{o}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="font-figtree text-[12px]" style={{ color: 'rgba(255,255,255,0.22)' }}>
                    {esHoy ? 'Sin objetivos. Pulsa NUEVO OBJETIVO para empezar.' : 'No escribió objetivos ese día.'}
                  </div>
                )}
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

          {objetivosDeHoy.length > 0 ? (
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
