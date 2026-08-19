'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { hayModalAbierto } from '@/components/shared/modalAbierto'
import { SECCIONES, esSeccion, type Section } from '@/components/shared/secciones'
import dynamic from 'next/dynamic'
import { useNexusData } from '@/hooks/useNexusData'
import type { Profile, Task, Project, Client } from '@/types'
import { createClient } from '@/lib/supabase/client'
import { PlatformLogo } from '@/components/PlatformLogo'
import CreateModal from '@/components/CreateModal'

import { BLU, RED, GRN, AMBAR, SURFACE, SURF2, BORDER, ACCENT_COLORS } from '@/components/shared/design-tokens'
import { useIsMobile, useBackClosable } from '@/components/shared/hooks'
import { dlDate, todayKey, localDayKey, daysBetweenKeys, rotuloNivel, esTareaDe } from '@/components/shared/helpers'
import { construirKanbanCols } from '@/components/shared/kanban'
import LucideIcon from '@/components/shared/LucideIcon'
import { SectionErrorBoundary } from '@/components/shared/ErrorBoundary'
import { unlockAudio } from '@/components/shared/audio'

import NexusBootScreen from '@/components/NexusBootScreen'

// "Hoy" es la vista inicial: se carga con el bundle principal.
import HoySection from '@/components/sections/HoySection'
import DiarioSection from '@/components/sections/DiarioSection'
import PuestaEnMarcha, { olvidarPasoGuardado } from '@/components/PuestaEnMarcha'

// El resto se carga bajo demanda (code splitting). Antes las 14 secciones
// viajaban en el bundle inicial, así que entrar a "Hoy" descargaba también
// Reportes, Calendario, Contenido, etc.
const sectionLoader = () => (
  <div className="h-full w-full flex items-center justify-center">
    <div className="font-syne text-[9px] font-black tracking-[0.25em]" style={{color:'rgba(255,255,255,0.18)'}}>CARGANDO…</div>
  </div>
)
const dyn = <T,>(loader: () => Promise<{ default: T }>) =>
  dynamic(loader as any, { loading: sectionLoader, ssr: false }) as any

const InboxSection            = dyn(() => import('@/components/sections/InboxSection'))
const TareasSection           = dyn(() => import('@/components/sections/TareasSection'))
const ClientesSection         = dyn(() => import('@/components/sections/ClientesSection'))
const ProyectosSection        = dyn(() => import('@/components/sections/ProyectosSection'))
const ContenidoSection        = dyn(() => import('@/components/sections/ContenidoSection'))
const CalendarioSection       = dyn(() => import('@/components/sections/CalendarioSection'))
const MemoriaSection          = dyn(() => import('@/components/sections/MemoriaSection'))
const AutomatizacionesSection = dyn(() => import('@/components/sections/AutomatizacionesSection'))
const ChatSection             = dyn(() => import('@/components/sections/ChatSection'))
const HarveySection           = dyn(() => import('@/components/sections/HarveySection'))
const EquipoSection           = dyn(() => import('@/components/sections/EquipoSection'))
const ReportesSection         = dyn(() => import('@/components/sections/ReportesSection'))
const AjustesSection          = dyn(() => import('@/components/sections/AjustesSection'))

// Precarga en segundo plano de los trozos que NO se han pedido todavía.
//
// El code splitting abarata la primera carga, pero deja dos filos: al cambiar de
// sección aparece "CARGANDO…", y si estás SIN CONEXIÓN una sección que nunca
// visitaste no se puede descargar — y esto es una PWA que se abre en el metro.
// Trayéndolos cuando la app está quieta, el cambio es instantáneo y el service
// worker los deja cacheados (todo lo de /_next/static/ es cache-first), así que
// después funcionan offline.
//
// Solo con conexión holgada: en 2G/3G o con el ahorro de datos activado, gastarle
// a alguien su tarifa en secciones que quizá no abra no está justificado.
const CARGADORES = [
  () => import('@/components/sections/InboxSection'),
  () => import('@/components/sections/TareasSection'),
  () => import('@/components/sections/ClientesSection'),
  () => import('@/components/sections/ProyectosSection'),
  () => import('@/components/sections/ContenidoSection'),
  () => import('@/components/sections/CalendarioSection'),
  () => import('@/components/sections/MemoriaSection'),
  () => import('@/components/sections/AutomatizacionesSection'),
  () => import('@/components/sections/ChatSection'),
  () => import('@/components/sections/HarveySection'),
  () => import('@/components/sections/EquipoSection'),
  () => import('@/components/sections/ReportesSection'),
  () => import('@/components/sections/AjustesSection'),
]

function precargarSecciones() {
  const con = (navigator as any).connection
  if (con?.saveData) return
  if (con?.effectiveType && !/4g|5g/.test(con.effectiveType)) return
  // De uno en uno y con hueco entre medias: si se piden los 13 a la vez compiten
  // con las llamadas a la API que la app está haciendo justo al arrancar.
  let i = 0
  const siguiente = () => {
    if (i >= CARGADORES.length) return
    CARGADORES[i++]().catch(() => {}).then(() => setTimeout(siguiente, 300))
  }
  siguiente()
}
// SECCIONES / Section / esSeccion viven en shared/secciones.ts: las secciones
// necesitan el tipo para declarar `onNavigate` y no pueden importarlo de aqui.

interface Props { profile: Profile; initialSection?: string }

// El tema va en cookie para que el servidor pueda pintarlo en el HTML inicial y
// no haya destello. Se sigue escribiendo localStorage por si queda alguna pestaña
// vieja abierta; la cookie es la que manda.
//
// Sin `Secure` a propósito: en desarrollo se sirve por http y con Secure el
// navegador descartaría la cookie en silencio, dejando el destello que se acaba
// de quitar. No lleva nada sensible: dice si el tema es claro.
function guardarTema(claro: boolean) {
  const valor = claro ? 'light' : 'dark'
  try { localStorage.setItem('nx_theme', valor) } catch {}
  try {
    document.cookie = `nx_theme=${valor}; path=/; max-age=31536000; samesite=lax`
  } catch {}
}

export default function NexusDashboard({ profile, initialSection }: Props) {
  const data = useNexusData(profile, (msg) => {
    const sender = msg.from_name || 'Alguien'
    const label = msg.source === 'internal' ? `Mensaje de ${sender}` : `Nuevo mensaje de ${sender}`
    setToast(label)
    setTimeout(() => setToast(null), 4000)
  })
  // `initialSection` llega del servidor (los atajos de la PWA, `?s=`). Se valida
  // aquí porque es una cadena que viene de la URL: cualquiera puede escribir
  // ?s=loquesea y no debe dejar la app en una sección inexistente.
  const [section, setSection_] = useState<Section>(esSeccion(initialSection ?? null) ? initialSection as Section : 'hoy')
  const [sectionStack, setSectionStack] = useState<Section[]>([])
  const setSection = (s: Section) => {
    setSection_(prev => { if (prev !== s && !popNavRef.current) setSectionStack(stack => [...stack.slice(-9), prev]); return s })
  }
  const goBack = () => {
    setSectionStack(stack => {
      const prev = stack[stack.length - 1]
      if (prev) { setSection_(prev); return stack.slice(0, -1) }
      setSection_('hoy'); return []
    })
  }
  const isMobile = useIsMobile()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  // El estado inicial se lee del DOM, no de localStorage: el layout ya ha puesto
  // la clase leyendo la cookie en el servidor, así que aquí solo hay que
  // reflejarla. Arrancar en `false` haría que el botón mostrara "oscuro" durante
  // un instante estando en claro.
  const [lightMode, setLightMode] = useState(false)
  // Refrescar al volver a la app, y al recuperar la conexion.
  //
  // Instalada como PWA en el movil, esta app NO se recarga nunca: se deja abierta y
  // se vuelve a ella. Sin esto pasaban dos cosas a la vez, y la segunda es la mala:
  // las listas se quedaban congeladas con lo de la ultima vez, y las URL firmadas
  // de los ficheros (12 h) acababan caducando, asi que las portadas y los PDF
  // empezaban a dar 400 sin que el usuario hubiera hecho nada.
  //
  // load() esta escrito para esto: usa allSettled y no pisa lo que hay en pantalla
  // si una consulta falla, asi que es seguro llamarlo con datos delante. Y de paso
  // vuelve a firmar todas las URLs.
  //
  // El margen de 5 minutos evita recargar por cada cambio de pestaña: alternar
  // entre la app y el correo dispararia diez recargas seguidas.
  const ultimoRefrescoRef = useRef(Date.now())
  useEffect(() => {
    const MARGEN_MS = 5 * 60 * 1000
    const refrescar = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - ultimoRefrescoRef.current < MARGEN_MS) return
      ultimoRefrescoRef.current = Date.now()
      data.reload?.()
    }
    document.addEventListener('visibilitychange', refrescar)
    window.addEventListener('online', refrescar)
    return () => {
      document.removeEventListener('visibilitychange', refrescar)
      window.removeEventListener('online', refrescar)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const yaEnClaro = document.documentElement.classList.contains('theme-light')
    if (yaEnClaro) { setLightMode(true); return }
    // Migración: quien tuviera el tema en localStorage de antes no tiene cookie
    // todavía. Se pasa aquí y a partir de la siguiente carga ya no hay destello.
    try {
      if (localStorage.getItem('nx_theme') === 'light') {
        setLightMode(true)
        document.documentElement.classList.add('theme-light')
        guardarTema(true)
      }
    } catch {}
  }, [])
  const toggleTheme = () => {
    setLightMode(v => {
      const next = !v
      document.documentElement.classList.toggle('theme-light', next)
      guardarTema(next)
      return next
    })
  }

  useEffect(() => { if (isMobile) { setSidebarOpen(false); setProjView('list') } }, [isMobile])

  useEffect(() => {
    if (!isMobile) return
    const reset = () => setTimeout(() => window.scrollTo(0, 0), 60)
    document.addEventListener('focusout', reset)
    return () => document.removeEventListener('focusout', reset)
  }, [isMobile])

  // Cuando el navegador esté ocioso, trae el resto de secciones. Va aquí y no en
  // el arranque para no competir con la carga de datos del dashboard.
  useEffect(() => {
    if (typeof window === 'undefined' || !navigator.onLine) return
    const ric = (window as any).requestIdleCallback
    const id = ric ? ric(precargarSecciones, { timeout: 6000 }) : setTimeout(precargarSecciones, 3000)
    return () => { const cic = (window as any).cancelIdleCallback; if (ric && cic) cic(id); else clearTimeout(id) }
  }, [])

  const [offline, setOffline] = useState(false)
  useEffect(() => {
    const on = () => setOffline(false), off = () => setOffline(true)
    setOffline(!navigator.onLine)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  useEffect(() => {
    if (!isMobile) return
    let startX = 0, startY = 0, fromEdge = false, tracking = false
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0]
      startX = t.clientX; startY = t.clientY
      fromEdge = t.clientX < 28
      tracking = true
    }
    const onEnd = (e: TouchEvent) => {
      if (!tracking) return
      tracking = false
      const t = e.changedTouches[0]
      const dx = t.clientX - startX, dy = t.clientY - startY
      if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx) * 0.8) return
      if (dx > 0 && fromEdge) setSidebarOpen(true)
      else if (dx < 0) setSidebarOpen(o => o ? false : o)
    }
    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchend', onEnd, { passive: true })
    return () => { window.removeEventListener('touchstart', onStart); window.removeEventListener('touchend', onEnd) }
  }, [isMobile])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const gmailStatus = params.get('gmail')
    if (gmailStatus === 'connected' || gmailStatus === 'colabs_connected') {
      window.history.replaceState({}, '', '/dashboard')
      setTimeout(() => {
        setToast(gmailStatus === 'colabs_connected' ? 'Colaboraciones conectado' : 'Gmail personal conectado')
        setSection('ajustes')
      }, 400)
    } else if (gmailStatus === 'colabs_no_autorizado') {
      // Sin este caso, el rechazo caía en el `error` genérico y decía «Error
      // conectando», que hace que se reintente en bucle sin entender por qué.
      window.history.replaceState({}, '', '/dashboard')
      setToast('El buzón de Colaboraciones es de la empresa: solo el propietario puede conectarlo')
      setTimeout(() => setSection('ajustes'), 400)
    } else if (gmailStatus === 'denied') {
      window.history.replaceState({}, '', '/dashboard')
      setToast('Google bloqueó esta cuenta. Debe estar autorizada en la pantalla de consentimiento de Google Cloud (o usa una cuenta @brutalstudios.es).')
      setTimeout(() => setSection('ajustes'), 400)
    } else if (gmailStatus === 'expired') {
      // Caso propio: el nonce anti-CSRF caducó porque el consentimiento tardó
      // demasiado. Con el mensaje genérico era indistinguible de un fallo de red
      // y el usuario no sabía que basta con repetirlo.
      window.history.replaceState({}, '', '/dashboard')
      setToast('La conexión tardó demasiado y caducó. Vuelve a intentarlo — esta vez completa el permiso de Google sin pausas.')
    } else if (gmailStatus === 'error' || gmailStatus === 'no_refresh_token') {
      window.history.replaceState({}, '', '/dashboard')
      setToast('Error al conectar. Inténtalo de nuevo desde Operativa → Sincronización.')
    } else if (params.get('s')) {
      // La sección ya la aplicó el servidor vía `initialSection`; aquí solo se
      // limpia la URL para que un F5 no vuelva a fijarla. Los atajos de la PWA
      // son una puerta de entrada, no un estado que deba persistir.
      window.history.replaceState({}, '', '/dashboard')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchIdx, setSearchIdx] = useState(-1)
  const [modal, setModal] = useState<string|null>(null)
  const [mf, setMf] = useState<Record<string,string>>({})
  const [modalSaving, setModalSaving] = useState(false)
  const [toast, setToast] = useState<string|null>(null)
  const [notifOpen, setNotifOpen] = useState(false)
  const [quickCreateOpen, setQuickCreateOpen] = useState(false)
  // `parcial` lo manda /api/notifications cuando una de sus dos consultas falla:
  // devuelve 200 con lo que sí pudo contar. Nadie lo leía, así que "no tienes
  // avisos" y "no he podido mirar" se pintaban idénticos —el panel decía "Todo
  // está al día" con la consulta caída— y esto se sondea cada 30 segundos, así
  // que la campana podía estar apagada durante días sin que nadie lo supiera.
  const [notifData, setNotifData] = useState<{dmCount:number;urgentCount:number;total:number;dms:any[];urgent:any[];parcial?:boolean}>({dmCount:0,urgentCount:0,total:0,dms:[],urgent:[]})

  useEffect(() => {
    // Un 500 o un fallo de red son el mismo caso que `parcial`: no se sabe lo que
    // hay. Antes se descartaban en silencio y se seguía enseñando el último
    // recuento bueno como si fuera de ahora.
    const fetchNotifs = () => fetch('/api/notifications')
      .then(r=>r.ok?r.json():null)
      .then(d=>{ if(d) setNotifData(d); else setNotifData(p=>({...p, parcial:true})) })
      .catch(()=>{ setNotifData(p=>({...p, parcial:true})) })
    // No sondear con la pestaña en segundo plano: eran 2.880 invocaciones diarias
    // por pestaña abierta, la mayoría con nadie mirando. Al volver se refresca
    // inmediatamente, así que no se pierde nada.
    const tick = () => { if (document.visibilityState === 'visible') fetchNotifs() }
    tick()
    const iv = setInterval(tick, 30000)
    const onVis = () => { if (document.visibilityState === 'visible') fetchNotifs() }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', onVis) }
  }, [])

  useEffect(() => {
    let alive = true
    const LS_AUTO = 'colabs_auto_sync_at'
    // 15 min (antes 3): cada sync analiza emails con Claude, así que un intervalo
    // corto multiplicaba el gasto de IA por cada miembro con la app abierta.
    // El cron horario de Vercel hace el trabajo de fondo y Realtime empuja los
    // mensajes nuevos al instante; esto es solo una red de seguridad.
    const AUTO_SYNC_MS = 15 * 60 * 1000
    const autoSync = async () => {
      try {
        const last = Number(localStorage.getItem(LS_AUTO) || 0)
        if (Date.now() - last < AUTO_SYNC_MS) return
        localStorage.setItem(LS_AUTO, String(Date.now()))
        const r = await fetch('/api/gmail/colabs-sync', { method: 'POST' })
        if (r.ok && alive) { const d = await r.json(); if (d?.synced > 0) data.reloadInbox?.() }
      } catch {}
    }
    autoSync()
    const iv = setInterval(autoSync, AUTO_SYNC_MS)
    const onVis = () => { if (document.visibilityState === 'visible') autoSync() }
    document.addEventListener('visibilitychange', onVis)
    return () => { alive = false; clearInterval(iv); document.removeEventListener('visibilitychange', onVis) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // La puesta en marcha se enseña una vez por PERSONA, no por aparato: la marca
  // vive en `profiles.onboarding_at`. Se guarda en estado local para que al
  // terminarla desaparezca sin esperar a que el perfil se recargue.
  const [puestaHecha, setPuestaHecha] = useState(!!profile?.onboarding_at)

  const [selectedClient, setSelectedClient] = useState<string|null>(null)
  const [selectedProject, setSelectedProject] = useState<string|null>(null)
  const [justCreatedProjId, setJustCreatedProjId] = useState<string|null>(null)
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [harveyPreload, setHarveyPreload] = useState<string|null>(null)
  const [masOpen, setMasOpen] = useState(false)
  const [projView, setProjView] = useState<'board'|'list'>('board')
  const [projStatusFilter, setProjStatusFilter] = useState('Todos')
  const [memFilter, setMemFilter] = useState('Todos')
  const [showShortcuts, setShowShortcuts] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const sr = useRef<any[]>([])
  const showShortcutsRef = useRef(false)
  // Refs porque el handler de teclado se registra una sola vez (deps vacías) y
  // leería valores obsoletos del closure.
  const modalRef = useRef<string|null>(null)
  const mfRef = useRef<Record<string,string>>({})

  // El modal de creación ocupa la pantalla entera en móvil, así que el ATRÁS
  // parece que debería cerrarlo — y en su lugar te sacaba de la app, perdiendo
  // el formulario. Las seis secciones con panel a pantalla completa ya lo tenían;
  // el modal, que es el que más se abre, no.
  //
  // Con el mismo aviso que Escape y que el fondo: si hay algo escrito, el atrás
  // no cierra. El hook repone la entrada de historial cuando se veta.
  useBackClosable(
    !!modal,
    () => setModal(null),
    () => {
      if (!Object.values(mfRef.current).some(v => (v || '').trim())) return true
      setToast('Tienes cambios sin guardar — usa Cancelar para descartarlos')
      setTimeout(() => setToast(null), 3000)
      return false
    },
  )


  // Abrir un modal SIEMPRE limpia los campos. Antes solo lo hacía el menú rápido:
  // las secciones reciben `setModal` tal cual como `onOpenModal`, así que abrir
  // "Cliente" tras haber escrito en "Proyecto" arrastraba los campos del anterior
  // y el guardado reventaba con un error crudo de Postgres (columna inexistente).
  // El prellenado va COMO PARAMETRO, no con un setMf() previo.
  //
  // Los botones de "crear desde aquí" hacían `onSetMf?.({cliente: X}); onOpenModal('tarea')`
  // en el mismo handler, y openModal hacía setMf({}) justo después: React agrupa
  // las dos actualizaciones y gana la última, así que el prellenado se borraba
  // siempre. Los siete botones de ese tipo abrían el formulario en blanco.
  //
  // Y el setMf({}) tiene que seguir estando: `mf` NO se limpia al cerrar por
  // Escape ni por la X, así que sin él los campos de un modal se colarían en el
  // siguiente. Por eso el valor por defecto es {} y no se toca lo que ya hubiera.
  const openModal = useCallback((type: string | null, prellenado: Record<string,string> = {}) => {
    setMf(prellenado)
    setModal(type)
  }, [])
  const sectionRef = useRef<Section>('hoy')
  const supabaseRef = useRef(createClient())
  const supabase = supabaseRef.current

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }, [])

  const popNavRef = useRef(false)
  useEffect(() => {
    if (!window.history.state?.nxSection) {
      window.history.replaceState({ nxSection: 'hoy' }, '', '#hoy')
    }
    const onPop = (e: PopStateEvent) => {
      const s = e.state?.nxSection
      if (s) {
        // El flag SOLO se arma si la sección cambia de verdad.
        //
        // Lo desarma el efecto de [section], y ese efecto no se ejecuta si el
        // estado no cambia. Cuando el popstate apuntaba a la sección en la que ya
        // estábamos —lo que pasa al cerrar un detalle en el móvil, que hace
        // history.back()— el flag se quedaba armado para siempre. La siguiente
        // navegación de verdad lo encontraba puesto, se lo tomaba como «esto viene
        // del botón atrás» y NO metía la entrada en el historial: a partir de ahí,
        // atrás se saltaba esa pantalla.
        if (s !== sectionRef.current) popNavRef.current = true
        setModal(null)
        setSearchOpen(false)
        setSidebarOpen(open => open && window.matchMedia('(max-width: 767px)').matches ? false : open)
        setSection(s)
      }
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (popNavRef.current) { popNavRef.current = false; return }
    if (window.history.state?.nxSection !== section) {
      window.history.pushState({ nxSection: section }, '', '#' + section)
    }
  }, [section])

  useEffect(() => {
    const unlock = () => unlockAudio()
    window.addEventListener('touchend', unlock, { passive: true })
    window.addEventListener('click', unlock)
    return () => { window.removeEventListener('touchend', unlock); window.removeEventListener('click', unlock) }
  }, [])

  const gPendingRef = useRef(false)
  const gTimerRef = useRef<ReturnType<typeof setTimeout>|null>(null)
  useEffect(() => {
    const NAV: Record<string, Section> = { d:'diario', h:'hoy', t:'tareas', i:'inbox', c:'clientes', p:'proyectos', k:'contenido', a:'calendario', m:'memoria', e:'equipo', r:'reportes', s:'ajustes', v:'automatizaciones', n:'chat', y:'harvey' }
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setSearchOpen(true); setSearchQuery(''); setSearchIdx(-1); return }
      if (e.key === 'Escape') {
        if (showShortcutsRef.current) { setShowShortcuts(false); return }
        setSearchOpen(false)
        // Escape ya no descarta un formulario con datos escritos: pedía cerrar y
        // se perdía todo sin aviso. Con campos vacíos cierra como siempre.
        if (modalRef.current && Object.values(mfRef.current).some(v => (v || '').trim())) {
          setToast('Tienes cambios sin guardar — usa Cancelar para descartarlos')
          setTimeout(() => setToast(null), 3000)
          return
        }
        setModal(null)
        return
      }
      // A partir de aqui van los atajos de una sola letra (?, g+tecla). Con un modal
      // abierto el foco puede estar en BODY, y entonces la guarda por tagName de la
      // linea siguiente no protege: escribir en el formulario los ejecutaba.
      //
      // La guarda va AQUI y no arriba a proposito: Escape y Cmd+K tienen que seguir
      // funcionando con el modal abierto — Escape es justo lo que lo cierra.
      if (hayModalAbierto()) return
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === '?' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); setShowShortcuts(s => !s); return }
      if (e.key.toLowerCase() === 'g' && !e.metaKey && !e.ctrlKey) {
        gPendingRef.current = true
        if (gTimerRef.current) clearTimeout(gTimerRef.current)
        gTimerRef.current = setTimeout(() => { gPendingRef.current = false }, 1000)
        return
      }
      if (gPendingRef.current && NAV[e.key.toLowerCase()]) {
        e.preventDefault()
        setSection(NAV[e.key.toLowerCase()])
        gPendingRef.current = false
        if (gTimerRef.current) clearTimeout(gTimerRef.current)
      }
    }
    window.addEventListener('keydown', handler)
    return () => { window.removeEventListener('keydown', handler); if (gTimerRef.current) clearTimeout(gTimerRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const LS_GMAIL = 'gmail_auto_sync_at'
    const SYNC_MS = 15 * 60 * 1000
    // Mismo guard que el sync de colabs: sin él, cada recarga de página disparaba
    // un sync completo (hasta 20 llamadas a Claude secuenciales). Con varias
    // pestañas o refrescos seguidos, eso multiplicaba el gasto de IA sin traer
    // nada nuevo — el cron horario ya hace el trabajo de fondo.
    const sync = () => {
      if (!profile.gmail_connected) return
      try {
        const last = Number(localStorage.getItem(LS_GMAIL) || 0)
        if (Date.now() - last < SYNC_MS) return
        localStorage.setItem(LS_GMAIL, String(Date.now()))
      } catch {}
      data.syncGmail().catch(()=>{})
    }
    sync()
    const interval = setInterval(sync, SYNC_MS)
    return () => clearInterval(interval)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.gmail_connected])

  const handleSearchKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSearchIdx(i => Math.min(i+1, sr.current.length-1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSearchIdx(i => Math.max(i-1, -1)) }
    else if (e.key === 'Enter' && searchIdx >= 0 && sr.current[searchIdx]) sr.current[searchIdx].act()
    else if (e.key === 'Escape') setSearchOpen(false)
  }

  const searchResults = (() => {
    const q = searchQuery.toLowerCase().trim()
    if (q.length < 2) return []
    return [
      ...data.clients.map(c => ({ type:'Cliente', title:c.name, sub:c.industry, act:()=>{ setSelectedClient(c.id); setSection('clientes'); setSearchOpen(false) }})),
      ...data.projects.map(p => ({ type:'Proyecto', title:p.name, sub:p.client?.name||'—', act:()=>{ setSelectedProject(p.id); setProjView('list'); setSection('proyectos'); setSearchOpen(false) }})),
      ...data.tasks.map(t => ({ type:'Tarea', title:t.text, sub:rotuloNivel(t.level), act:()=>{ setSection('tareas'); setSearchOpen(false) }})),
      ...data.memoria.map(m => ({ type:'Memoria', title:m.title, sub:m.category, act:()=>{ setSection('memoria'); setSearchOpen(false) }})),
      ...data.agenda.map((a: any) => ({ type:'Contenido', title:a.title, sub:a.platform, act:()=>{ setSection('contenido'); setSearchOpen(false) }})),
      ...data.inbox.map((m: any) => ({ type:'Inbox', title:m.subject||m.from_name||'Sin asunto', sub:m.from_name||'', act:()=>{ setSection('inbox'); setSearchOpen(false) }})),
      ...data.team.map((p: any) => ({ type:'Equipo', title:p.name, sub:p.role||'Miembro', act:()=>{ setSection('equipo'); setSearchOpen(false) }})),
    ].filter(r => r.title.toLowerCase().includes(q) || (r.sub||'').toLowerCase().includes(q)).slice(0, 9)
  })()
  sr.current = searchResults

  const typeColor: Record<string,string> = { Cliente:BLU, Proyecto:'rgba(255,176,32,0.9)', Tarea:RED, Memoria:'rgba(240,240,248,0.4)', Contenido:'#C13584', Inbox:'rgba(100,180,255,0.7)', Equipo:GRN }

  // Días de retraso de un deadline. Un deadline es un DÍA, no un instante:
  // restar timestamps y dividir entre 86.400.000 cuenta bloques de 24 horas, y
  // un proyecto vencido AYER daba 0,4 → Math.round → «0d» en el panel de
  // notificaciones toda la mañana, hasta que pasaba el mediodía. Se comparan
  // claves de día de Madrid, que es la verdad que usa el resto de la UI
  // (estadoDeadline); dlDate sigue delante para entender los deadlines en texto
  // libre ("ago 2026"), que estadoDeadline no sabe leer.
  const diasAtraso = (deadline?: string|null) => daysBetweenKeys(localDayKey(dlDate(deadline)), todayKey())
  const overdueProjs = data.projects.filter((p: Project) => p.deadline && p.deadline !== 'TBD' && p.status !== 'completado' && diasAtraso(p.deadline) > 0)

  const saveModal = async () => {
    setModalSaving(true)
    try {
      if (modal === 'cliente') {
        if (!mf.name?.trim()) { showToast('Escribe el nombre del cliente'); return }
        const color = ACCENT_COLORS[data.clients.length % ACCENT_COLORS.length]
        await data.createClient({ name:mf.name.trim(), industry:mf.industria||'—', revenue:mf.facturacion||'—', color })
        showToast('Cliente creado: '+mf.name)
      } else if (modal === 'proyecto') {
        if (!mf.nombre?.trim()) { showToast('Escribe el nombre'); return }
        const client = mf.cliente?.trim()
          ? data.clients.find((c: Client) => c.name.toLowerCase().includes(mf.cliente.toLowerCase()) || mf.cliente.toLowerCase().includes(c.name.toLowerCase().split(' ')[0]))
          : null
        const color = client?.color || ACCENT_COLORS[data.projects.length % ACCENT_COLORS.length]
        const projStatus = (mf.estado || 'activo') as 'plan.'|'activo'|'urgente'|'revisión'|'completado'
        const createdProj = await data.createProject({ name:mf.nombre.trim(), client_id:client?.id, status:projStatus, progress:0, deadline:mf.deadline||'TBD', color })
        showToast('Proyecto creado: '+mf.nombre)
        if (createdProj?.id) { setSelectedProject(createdProj.id); setJustCreatedProjId(createdProj.id); setProjView('list'); setSection('proyectos') }
      } else if (modal === 'tarea') {
        if (!mf.text?.trim()) { showToast('Escribe la tarea'); return }
        const level: 'urgent'|'high'|'normal' = mf.priority==='urgente'?'urgent':mf.priority==='high'?'high':'normal'
        const assignee = data.team.find((m: Profile) => m.name === mf.asignado)
        const taskClient = mf.cliente?.trim()
          ? data.clients.find((c: Client) => c.name.toLowerCase().includes(mf.cliente.toLowerCase()) || mf.cliente.toLowerCase().includes(c.name.toLowerCase().split(' ')[0]))
          : null
        const taskProject = mf.proyecto?.trim()
          ? data.projects.find((p: Project) => p.name.toLowerCase().includes(mf.proyecto.toLowerCase()) || mf.proyecto.toLowerCase().includes(p.name.toLowerCase().split(' ')[0]))
          : null
        await data.createTask({ text:mf.text.trim(), level, assigned_to:assignee?.id, source:'manual', due_date:mf.due_date?.trim()||undefined, client_id:taskClient?.id, project_id:taskProject?.id })
        showToast('Tarea creada' + (taskProject ? ` · ${taskProject.name}` : taskClient ? ` · ${taskClient.name}` : ''))
      } else if (modal === 'memoria') {
        if (!mf.titulo?.trim()) { showToast('Escribe el título'); return }
        await data.createMemoria({ title:mf.titulo.trim(), category:mf.categoria||'General', content:mf.contenido||'' })
        showToast('Entrada guardada')
      } else if (modal === 'regla') {
        if (!mf.nombre?.trim()) { showToast('Escribe el nombre de la regla'); return }
        const trigType = mf.trigger || 'email_urgent'
        const actType = mf.action || 'create_task'
        if ((trigType === 'email_from_client' || trigType === 'client_followup') && !mf.trg_client) { showToast('Elige un cliente'); return }
        if (actType === 'create_task' && !mf.act_task?.trim()) { showToast('Escribe el texto de la tarea'); return }
        if ((actType === 'notify_team' || actType === 'notify_owner') && !mf.act_message?.trim()) { showToast('Escribe el mensaje del aviso'); return }
        // trigger config
        const trigClient = trigType === 'email_from_client' ? data.clients.find((c: Client) => c.id === mf.trg_client) : null
        const trigger: any = { type: trigType }
        if (trigType === 'email_from_client') { trigger.clientId = mf.trg_client; trigger.clientName = trigClient?.name }
        if (trigType === 'project_deadline') trigger.days = Math.max(0, parseInt(mf.trg_days || '7', 10) || 7)
        if (trigType === 'task_overdue') trigger.days = Math.max(0, parseInt(mf.trg_days || '0', 10) || 0)
        if (trigType === 'unread_pileup') trigger.threshold = Math.max(1, parseInt(mf.trg_threshold || '10', 10) || 10)
        if (trigType === 'many_overdue') trigger.threshold = Math.max(1, parseInt(mf.trg_threshold || '5', 10) || 5)
        if (trigType === 'client_followup') { trigger.clientId = mf.trg_client; trigger.clientName = trigClient?.name; trigger.days = Math.max(1, parseInt(mf.trg_days || '14', 10) || 14) }
        // action config
        const action: any = { type: actType }
        if (actType === 'create_task') { action.taskText = mf.act_task.trim(); action.level = mf.act_level || 'normal'; if (mf.act_assignee) action.assignTo = mf.act_assignee }
        else { action.message = mf.act_message.trim() }
        // resumen legible
        const condTxt = trigType==='email_urgent'?'Email urgente sin leer'
          : trigType==='email_from_client'?`Email de ${trigClient?.name||'cliente'} sin leer`
          : trigType==='project_deadline'?`Deadline en < ${trigger.days} días`
          : trigType==='task_overdue'?'Tarea vencida'
          : trigType==='unread_pileup'?`${trigger.threshold}+ emails sin leer`
          : trigType==='many_overdue'?`${trigger.threshold}+ tareas vencidas`
          : trigType==='high_priority_unassigned'?'Tareas urgentes sin responsable'
          : `Sin emails de ${trigClient?.name||'cliente'} en ${trigger.days} días`
        const actTxt = actType==='create_task'?`Crear tarea${action.level&&action.level!=='normal'?` (${rotuloNivel(action.level).toLowerCase()})`:''}`
          : actType==='notify_team'?'Notificar al equipo':'Avisarme a mí'
        await data.createRegla({ name:mf.nombre.trim(), condition_text: JSON.stringify({ v:1, trigger, action }), action_text: `${condTxt} › ${actTxt}`, active:true })
        showToast('Regla creada · el motor la ejecutará')
      } else if (modal === 'contenido') {
        if (!mf.titulo?.trim()) { showToast('Escribe el título'); return }
        const contentClient = mf.cliente?.trim()
          ? data.clients.find((c: Client) => c.name.toLowerCase().includes(mf.cliente.toLowerCase()) || mf.cliente.toLowerCase().includes(c.name.toLowerCase().split(' ')[0]))
          : null
        await data.createAgenda({ title:mf.titulo.trim(), platform:mf.plataforma||'Instagram', account_name:mf.cuenta?.trim()||undefined, content_type:'Post', status:(mf.estado||'borrador') as 'borrador'|'pendiente'|'listo'|'publicado', publish_date:mf.fecha, client_id:contentClient?.id })
        showToast('Pieza añadida' + (contentClient ? ` · ${contentClient.name}` : ''))
      }
      setModal(null); setMf({})
    } catch (err: any) { showToast('Error: '+err.message) }
    finally { setModalSaving(false) }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  const unreadCount = data.inbox.filter(m => !m.is_read).length
  // MÍAS. Sin el filtro contaba las urgentes del equipo entero —`GET /api/tasks`
  // devuelve todas a propósito—, así que la insignia del menú decía 23 mientras la
  // campana de al lado, que sí acota por persona, decía 0. Dos números del mismo
  // concepto en la misma pantalla: o asustas el primer día, o se aprende a ignorar
  // las insignias, y entonces tampoco se ve la que sí era tuya.
  const urgentCount = data.tasks.filter(t => !t.done && t.level === 'urgent' && esTareaDe(t, profile)).length
  const isOwner = profile.role === 'owner'
  const todayCalCount = (data.calendarEvents||[]).filter((e: any) => e.start?.slice(0,10) === todayKey()).length

  const filteredProjects = projStatusFilter === 'Todos' ? data.projects : data.projects.filter(p => p.status === projStatusFilter)
  // «Plan.» y «Revisión» declaraban su color en rgba() mientras las otras tres
  // eran hex, y ProyectosSection concatena opacidad sobre col.color: esas dos
  // columnas se pintaban sin barra de acento y con el contador sin fondo. El
  // array estaba además duplicado en PreviewClient, con el mismo fallo; ahora
  // sale del módulo compartido y no puede divergir.
  const kanbanCols = construirKanbanCols(filteredProjects)

  const dragRef = useRef<string|null>(null)
  showShortcutsRef.current = showShortcuts
  modalRef.current = modal
  mfRef.current = mf
  sectionRef.current = section

  const NAV_SC: Partial<Record<Section,string>> = { diario:'D', hoy:'H', tareas:'T', inbox:'I', clientes:'C', proyectos:'P', contenido:'K', calendario:'A', memoria:'M', equipo:'E', reportes:'R', ajustes:'S', automatizaciones:'V', chat:'N', harvey:'Y' }

  const navItem = (id: Section, label: string, icon: string, badge?: number) => {
    const act = section === id
    const sc = NAV_SC[id]
    return (
      <button key={id} onClick={()=>{setSection(id); if (isMobile) setSidebarOpen(false)}}
        className="flex items-center gap-3 w-full py-2.5 px-3 rounded-xl text-left transition-all duration-150 group active:scale-[0.98] active:opacity-80"
        style={{
          background: act ? 'rgba(84,116,232,0.13)' : 'transparent',
          border: act ? '1px solid rgba(124,152,255,0.16)' : '1px solid transparent',
          color: act ? '#eef1fb' : 'rgba(230,235,247,0.5)',
          fontSize: '14px',
          fontWeight: act ? 600 : 450,
          marginBottom: '2px',
          boxShadow: act ? '0 0 22px rgba(70,100,225,0.10), inset 0 1px 0 rgba(255,255,255,0.04)' : 'none',
        }}
        onMouseEnter={e=>{ if(!act) e.currentTarget.style.background='rgba(255,255,255,0.032)' }}
        onMouseLeave={e=>{ if(!act) e.currentTarget.style.background='transparent' }}>
        <LucideIcon name={icon} size={17} color={act ? '#93b4ff' : 'rgba(206,216,240,0.42)'}/>
        <span className="flex-1 truncate">{label}</span>
        {badge !== undefined && badge > 0 && (
          <span className="font-figtree text-[10px] font-bold px-2 py-0.5 rounded-full min-w-[20px] text-center" style={{background:'rgba(214,172,102,0.16)', color:'#e2b877'}}>{badge}</span>
        )}
        {sc && !(badge && badge > 0) && (
          <span className="opacity-0 group-hover:opacity-100 transition-opacity font-syne text-[7px] font-black flex-shrink-0" style={{color:'rgba(255,255,255,0.15)'}}>G·{sc}</span>
        )}
      </button>
    )
  }

  const navLabel = (text: string) => (
    <div className="px-3 pt-4 pb-1.5">
      <span className="font-syne font-black" style={{fontSize:'8.5px',letterSpacing:'0.22em',color:'rgba(230,235,250,0.24)'}}>{text}</span>
    </div>
  )

  if (data.loading) {
    return <NexusBootScreen />
  }

  return (
    <div className="flex h-[100dvh] w-full font-figtree overflow-hidden nx-app-root" style={{ background:'radial-gradient(ellipse 1400px 700px at 80% -10%,rgba(27,95,250,0.055) 0%,transparent 60%),radial-gradient(ellipse 500px 400px at 5% 95%,rgba(27,95,250,0.025) 0%,transparent 55%),#030308', color:'#F0F0F8' }}
      onClick={()=>notifOpen&&setNotifOpen(false)}>

      {/* SIDEBAR */}
      {isMobile && sidebarOpen && (
        <div onClick={()=>setSidebarOpen(false)} className="fixed inset-0 z-[85]" style={{background:'rgba(0,0,0,0.65)',backdropFilter:'blur(2px)'}}/>
      )}
      <aside className="flex-shrink-0 flex flex-col overflow-hidden transition-all duration-200"
        style={isMobile
          ? { position:'fixed', top:0, bottom:0, left:0, zIndex:90, width:'280px', maxWidth:'85vw', paddingTop:'env(safe-area-inset-top)', paddingBottom:'env(safe-area-inset-bottom)', transform:sidebarOpen?'translateX(0)':'translateX(-105%)', background:'rgba(8,8,18,0.98)', borderRight:`1px solid ${BORDER}`, boxShadow:sidebarOpen?'8px 0 40px rgba(0,0,0,0.6)':'none' }
          : { width:sidebarOpen?'248px':'0', background:'rgba(8,8,18,0.95)', borderRight:`1px solid ${BORDER}` }}>
        {/* Logo */}
        <div className="px-5 pt-6 pb-5 flex-shrink-0">
          <div className="flex items-center gap-3">
            <img src="/brutal-logo.svg" alt="Brutal Studios" style={{height:'22px',opacity:0.88,filter:`drop-shadow(0 0 8px ${BLU}40)`}} />
            <div className="h-5 w-px" style={{background:BORDER}}/>
            <span className="font-syne text-[10px] font-black tracking-widest" style={{color:BLU,textShadow:`0 0 10px ${BLU}60`}}>IA</span>
            <div className="ml-auto flex items-center gap-2">
              {/* Notification bell */}
              <div className="relative">
                <button onClick={e=>{e.stopPropagation();setNotifOpen(o=>!o)}} className="w-7 h-7 rounded-xl flex items-center justify-center relative transition-all" style={{background:notifOpen?'rgba(27,95,250,0.15)':'transparent'}}>
                  {/* Ámbar —ni azul ni apagado— cuando la consulta ha fallado:
                      la campana apagada significa "no tienes nada", y eso es
                      justo lo que no se sabe. */}
                  <LucideIcon name="bell" size={13} color={(notifData.total+overdueProjs.length)>0?BLU:notifData.parcial?AMBAR:'rgba(255,255,255,0.2)'}/>
                  {(notifData.total+overdueProjs.length)>0 && <div className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full flex items-center justify-center pointer-events-none" style={{background:RED,boxShadow:`0 0 6px ${RED}80`}}><span className="font-syne text-[7px] font-black text-white leading-none">{(notifData.total+overdueProjs.length)>9?'9+':(notifData.total+overdueProjs.length)}</span></div>}
                </button>
                {notifOpen && (
                  <div onClick={e=>e.stopPropagation()} className="rounded-2xl overflow-hidden z-[999]" style={{position:'fixed',top:'62px',left:'12px',width:'268px',background:'#0C0C1C',border:`1px solid rgba(255,255,255,0.1)`,boxShadow:'0 24px 64px rgba(0,0,0,0.8),0 0 0 1px rgba(255,255,255,0.04)'}}>
                    {/* Header */}
                    <div className="px-4 py-3 flex items-center justify-between" style={{borderBottom:`1px solid rgba(255,255,255,0.06)`}}>
                      <div className="flex items-center gap-2">
                        <LucideIcon name="bell" size={11} color={BLU}/>
                        <span className="font-syne text-[9px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.5)'}}>NOTIFICACIONES</span>
                      </div>
                      {(notifData.total+overdueProjs.length) > 0 && <span className="font-figtree text-[11px] font-black" style={{color:RED}}>{notifData.total+overdueProjs.length}</span>}
                    </div>
                    {(notifData.total+overdueProjs.length)===0 ? (
                      notifData.parcial ? (
                        <div className="px-4 py-6 text-center">
                          <div className="font-syne text-[9px] font-black tracking-widest mb-1" style={{color:AMBAR}}>NO SE PUDIERON CONSULTAR LOS AVISOS</div>
                          <div className="text-[11px]" style={{color:'rgba(255,255,255,0.3)'}}>Puede que tengas mensajes o tareas urgentes sin contar</div>
                        </div>
                      ) : (
                        <div className="px-4 py-6 text-center">
                          <div className="font-syne text-[9px] font-black tracking-widest mb-1" style={{color:'rgba(255,255,255,0.18)'}}>SIN NOTIFICACIONES</div>
                          <div className="text-[11px]" style={{color:'rgba(255,255,255,0.2)'}}>Todo está al día</div>
                        </div>
                      )
                    ) : (
                      <div className="max-h-[320px] overflow-y-auto">
                        {/* Con `parcial` puede haber DMs y no tareas (o al revés):
                            lo que se ve es media respuesta, y sin avisar el
                            recuento de arriba se lee como si fuera todo. */}
                        {notifData.parcial && (
                          <div className="px-4 py-2" style={{background:`${AMBAR}14`,borderBottom:`1px solid ${AMBAR}28`}}>
                            <span className="font-syne text-[7.5px] font-black tracking-widest" style={{color:AMBAR}}>LISTA INCOMPLETA — FALTAN AVISOS POR CONTAR</span>
                          </div>
                        )}
                        {notifData.dms.length > 0 && (
                          <div className="px-4 pt-3 pb-1">
                            <span className="font-syne text-[7.5px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.2)'}}>MENSAJES DIRECTOS</span>
                          </div>
                        )}
                        {notifData.dms.map((dm:any,i:number)=>(
                          <button key={i} onClick={()=>{setNotifOpen(false);setSection('inbox'); if (isMobile) setSidebarOpen(false)}} className="w-full text-left px-4 py-2.5 transition-colors" style={{borderBottom:`1px solid rgba(255,255,255,0.04)`}} onMouseEnter={e=>(e.currentTarget.style.background='rgba(27,95,250,0.06)')} onMouseLeave={e=>(e.currentTarget.style.background='transparent')}>
                            <div className="flex items-center gap-2.5">
                              <div className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center font-syne text-[8px] font-black" style={{background:BLU+'18',color:BLU}}>{(dm.from_name||'?').slice(0,2).toUpperCase()}</div>
                              <div className="min-w-0 flex-1">
                                <div className="font-syne text-[9px] font-black truncate" style={{color:'rgba(255,255,255,0.8)'}}>{dm.from_name}</div>
                                <div className="text-[10px] truncate mt-0.5" style={{color:'rgba(255,255,255,0.3)'}}>{dm.subject}</div>
                              </div>
                              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{background:BLU}}/>
                            </div>
                          </button>
                        ))}
                        {notifData.urgent.length > 0 && (
                          <div className="px-4 pt-3 pb-1">
                            <span className="font-syne text-[7.5px] font-black tracking-widest" style={{color:'rgba(229,29,42,0.6)'}}>TAREAS URGENTES</span>
                          </div>
                        )}
                        {notifData.urgent.map((t:any,i:number)=>(
                          <button key={i} onClick={()=>{setNotifOpen(false);setSection('tareas'); if (isMobile) setSidebarOpen(false)}} className="w-full text-left px-4 py-2.5 transition-colors" style={{borderBottom:i<notifData.urgent.length-1?`1px solid rgba(255,255,255,0.04)`:'none'}} onMouseEnter={e=>(e.currentTarget.style.background='rgba(229,29,42,0.05)')} onMouseLeave={e=>(e.currentTarget.style.background='transparent')}>
                            <div className="flex items-center gap-2.5">
                              <div className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center" style={{background:`${RED}18`}}>
                                <div className="w-1.5 h-1.5 rounded-full" style={{background:RED}}/>
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="text-[10.5px] truncate" style={{color:'rgba(255,255,255,0.75)'}}>{t.text}</div>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <div className="font-syne text-[8px] font-black" style={{color:`${RED}80`}}>URGENTE</div>
                                  {t.due_date && <span className="font-syne text-[7px] font-black px-1.5 py-0.5 rounded-full" style={{background:'rgba(229,29,42,0.1)',color:RED}}>{new Date(t.due_date+'T12:00:00').toLocaleDateString('es-ES',{day:'numeric',month:'short'})}</span>}
                                </div>
                              </div>
                            </div>
                          </button>
                        ))}
                        {overdueProjs.length > 0 && (
                          <div className="px-4 pt-3 pb-1">
                            <span className="font-syne text-[7.5px] font-black tracking-widest" style={{color:'rgba(255,176,32,0.6)'}}>PROYECTOS ATRASADOS</span>
                          </div>
                        )}
                        {overdueProjs.slice(0,3).map((p:any,i:number)=>{
                          const daysOver = diasAtraso(p.deadline)
                          return (
                            <button key={i} onClick={()=>{setNotifOpen(false);setSection('proyectos'); if (isMobile) setSidebarOpen(false)}} className="w-full text-left px-4 py-2.5 transition-colors" style={{borderBottom:i<Math.min(overdueProjs.length,3)-1?`1px solid rgba(255,255,255,0.04)`:'none'}} onMouseEnter={e=>(e.currentTarget.style.background='rgba(255,176,32,0.05)')} onMouseLeave={e=>(e.currentTarget.style.background='transparent')}>
                              <div className="flex items-center gap-2.5">
                                <div className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center" style={{background:'rgba(255,176,32,0.12)',border:'1px solid rgba(255,176,32,0.2)'}}>
                                  <div className="w-1.5 h-1.5 rounded-full" style={{background:'rgba(255,176,32,0.9)'}}/>
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="text-[10.5px] truncate" style={{color:'rgba(255,255,255,0.75)'}}>{p.name}</div>
                                  <div className="flex items-center gap-2 mt-0.5">
                                    <div className="font-syne text-[8px] font-black" style={{color:'rgba(255,176,32,0.7)'}}>ATRASADO</div>
                                    <span className="font-syne text-[7px] font-black px-1.5 py-0.5 rounded-full" style={{background:'rgba(255,176,32,0.1)',color:'rgba(255,176,32,0.9)'}}>{daysOver}d</span>
                                  </div>
                                </div>
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    )}
                    {(notifData.total+overdueProjs.length) > 0 && (
                      <div className="px-4 py-2.5" style={{borderTop:`1px solid rgba(255,255,255,0.06)`}}>
                        <button onClick={()=>{setNotifOpen(false);setSection('inbox'); if (isMobile) setSidebarOpen(false)}} className="w-full text-center font-syne text-[8.5px] font-black tracking-wide transition-opacity hover:opacity-60" style={{color:BLU}}>VER TODO EL INBOX</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="w-1.5 h-1.5 rounded-full animate-glowPulse" style={{background:BLU}}/>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-2.5 pb-2">
          {navLabel('TRABAJO')}
          {navItem('hoy','Hoy','sun',urgentCount)}
          {navItem('inbox','Inbox','inbox',unreadCount)}
          {navItem('calendario','Calendario','calendar',todayCalCount||undefined)}

          {navLabel('GESTIÓN')}
          {navItem('tareas','Tareas','check-square',data.tasks.filter((t:Task)=>!t.done&&t.level==='urgent').length||undefined)}
          {navItem('diario','Fichar','pen-line')}
          {navItem('clientes','Clientes','users')}
          {/* La cuenta del badge estaba escrita otra vez aquí, con la misma resta
              de timestamps: la campana y el menú podían discrepar. Es la misma
              lista, así que se reutiliza. */}
          {navItem('proyectos','Proyectos','folder-open', overdueProjs.length||undefined)}
          {navItem('contenido','Contenido','film')}
          {/* Memoria, Equipo, Automatizaciones y Reportes NO van aquí, y es
              deliberado: las cuatro ya son pestañas dentro de Operativa, así que
              ponerlas también en el menú era duplicar la puerta y alargar la
              lista. Un menú con todo dentro no es más accesible — es más difícil
              de recorrer, y lo del día a día se pierde entre lo de vez en cuando.

              Lo que se conserva del intento anterior: el buscador (⌘K) llega a
              las cuatro, la cabecera del móvil sabe cómo se llaman, y Reportes
              solo se le ofrece al propietario. */}

          {navLabel('IA')}
          {navItem('chat','Brutal.IA','message-square')}
          {/* Sin candado. Lo llevaba, pero era el ÚNICO de la app: a Harvey se
              llega igual por G·Y, por el panel MÁS del móvil y por los botones
              «pregúntale a Harvey» de Inbox y Diario, y su orbe vive en la
              portada de todo el mundo. Lo único que hacía el candado era que un
              miembro aterrizara ahí sin entrada por la que volver. */}
          {(
            <button onClick={()=>{setSection('harvey'); if (isMobile) setSidebarOpen(false)}}
              className="flex items-center gap-3 w-full py-2.5 px-3 rounded-xl text-left transition-all duration-150"
              style={{
                background: section==='harvey' ? 'rgba(84,116,232,0.15)' : 'rgba(84,116,232,0.05)',
                border: `1px solid ${section==='harvey' ? 'rgba(124,152,255,0.2)' : 'rgba(124,152,255,0.1)'}`,
                color: section==='harvey' ? '#eef1fb' : 'rgba(147,180,255,0.7)',
                fontSize:'14px', fontWeight:section==='harvey'?600:500, marginBottom:'2px',
                boxShadow: section==='harvey' ? '0 0 22px rgba(70,100,225,0.12)' : 'none',
              }}>
              <LucideIcon name="cpu" size={17} color={section==='harvey'?'#93b4ff':'rgba(147,180,255,0.6)'}/>
              <span className="flex-1 truncate">Harvey</span>
              <span className="font-syne text-[7px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0" style={{background:'rgba(124,152,255,0.14)',color:'rgba(147,180,255,0.7)',letterSpacing:'0.1em'}}>AI</span>
            </button>
          )}
          {navItem('ajustes','Operativa','settings')}
        </nav>

        {/* Footer */}
        <div className="p-3 flex-shrink-0" style={{borderTop:`1px solid ${BORDER}`}}>
          {!profile.gmail_connected && (
            <button onClick={()=>{setSection('ajustes'); if (isMobile) setSidebarOpen(false)}} className="flex items-center gap-2 w-full px-3 py-2 rounded-xl mb-2 font-syne text-[9px] font-black tracking-wide transition-all hover:opacity-80" style={{background:'rgba(27,95,250,0.06)',color:'rgba(27,95,250,0.6)',border:`1px solid rgba(27,95,250,0.14)`}}>
              <LucideIcon name="link-2" size={11} color="rgba(27,95,250,0.5)"/>Conectar cuentas
            </button>
          )}
          <div className="flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-white/2 transition-colors cursor-default">
            <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 font-syne text-[11px] font-black" style={{background:profile.avatar_color+'18',border:`1.5px solid ${profile.avatar_color}35`,color:profile.avatar_color}}>{profile.initials}</div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium text-white/75 truncate leading-tight">{profile.name}</div>
              <div className="text-[10px] mt-0.5" style={{color:'rgba(255,255,255,0.2)'}}>{profile.role === 'owner' ? 'Propietario' : 'Equipo'}</div>
            </div>
            <button onClick={toggleTheme} title={lightMode?'Modo oscuro':'Modo claro'} aria-label={lightMode?'Cambiar a modo oscuro':'Cambiar a modo claro'} className="w-10 h-10 -m-1 flex items-center justify-center opacity-30 hover:opacity-60 transition-opacity flex-shrink-0"><LucideIcon name={lightMode?'moon':'sun'} size={14}/></button>
            <button onClick={handleLogout} title="Cerrar sesión" aria-label="Cerrar sesión" className="w-10 h-10 -m-1 flex items-center justify-center opacity-30 hover:opacity-60 transition-opacity flex-shrink-0"><LucideIcon name="log-out" size={14}/></button>
          </div>
          <button onClick={()=>setSidebarOpen(false)} className="flex items-center justify-center w-full py-1.5 mt-1 transition-colors" style={{color:'rgba(255,255,255,0.12)'}}>
            <LucideIcon name="panel-left-close" size={13}/>
          </button>
        </div>
      </aside>

      {!sidebarOpen && !isMobile && (
        <button onClick={()=>setSidebarOpen(true)} className="fixed top-5 left-4 z-50 w-8 h-8 flex items-center justify-center rounded-xl transition-all" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
          <LucideIcon name="panel-left-open" size={14} color="rgba(240,240,248,0.4)"/>
        </button>
      )}

      {/* MAIN */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {isMobile && (
          <div className="flex items-center gap-2 px-3 flex-shrink-0" style={{height:'calc(50px + env(safe-area-inset-top))',paddingTop:'env(safe-area-inset-top)',borderBottom:`1px solid ${BORDER}`,background:'rgba(8,8,18,0.92)'}}>
            {/* ☰ Hamburger — abre el panel lateral */}
            <button onClick={()=>setSidebarOpen(true)} className="w-9 h-9 flex items-center justify-center rounded-xl flex-shrink-0" style={{background:'rgba(255,255,255,0.03)',border:`1px solid ${BORDER}`}}>
              <LucideIcon name="menu" size={17} color="rgba(240,240,248,0.55)"/>
            </button>
            {/* 🏠 Home — siempre visible, vuelve a HOY */}
            <button onClick={()=>{ setSectionStack([]); setSection_('hoy') }} className="w-9 h-9 flex items-center justify-center rounded-xl flex-shrink-0 transition-all" style={{background:section==='hoy'?'rgba(27,95,250,0.12)':'rgba(255,255,255,0.03)',border:`1px solid ${section==='hoy'?'rgba(27,95,250,0.3)':BORDER}`}}>
              <LucideIcon name="house" size={16} color={section==='hoy'?BLU:'rgba(240,240,248,0.55)'}/>
            </button>
            {/* ← Atrás — solo si hay historial */}
            {sectionStack.length > 0 && (
              <button onClick={goBack} className="w-9 h-9 flex items-center justify-center rounded-xl flex-shrink-0" style={{background:'rgba(255,255,255,0.03)',border:`1px solid ${BORDER}`}} aria-label="Volver"><LucideIcon name="arrow-left" size={16} color="rgba(240,240,248,0.55)"/></button>
            )}
            {/* Título de sección */}
            <span className="font-syne text-[10px] font-black tracking-[0.25em] truncate flex-1" style={{color:'rgba(255,255,255,0.55)'}}>
              {({hoy:'HOY',inbox:'INBOX',calendario:'CALENDARIO',tareas:'TAREAS',diario:'FICHAR',clientes:'CLIENTES',proyectos:'PROYECTOS',contenido:'CONTENIDO',chat:'BRUTAL.IA',harvey:'HARVEY',ajustes:'OPERATIVA',memoria:'MEMORIA',equipo:'EQUIPO',reportes:'REPORTES',automatizaciones:'AUTOMATIZACIONES'} as Record<string,string>)[section] || 'BRUTAL.IA'}
            </span>
            {/* Sin gate de owner en el menú: tarea, cliente, proyecto y pieza los
                puede crear cualquiera —sus rutas no miran el rol— y ocultar el
                acceso rápido dejaba sin él a los miembros, que son quienes más
                usan el móvil.
                REGLA es la excepción, y va filtrada abajo: POST /api/reglas SÍ
                exige owner. Un comentario anterior aquí afirmaba lo contrario, y
                por creerlo se ofrecía a los miembros: rellenaban el formulario
                entero —nombre, disparador, acción— y al guardar les salía
                "Error: Forbidden". La sección de Automatizaciones ya gatea crear
                con isOwner; esto era el único sitio que no. */}
            {(
              <div className="relative">
                <button onClick={()=>setQuickCreateOpen(!quickCreateOpen)} className="w-9 h-9 flex items-center justify-center rounded-xl" style={{background:quickCreateOpen?'rgba(27,95,250,0.15)':'rgba(255,255,255,0.03)',border:`1px solid ${quickCreateOpen?'rgba(27,95,250,0.3)':BORDER}`}}>
                  <LucideIcon name="plus" size={16} color={quickCreateOpen?BLU:'rgba(240,240,248,0.55)'}/>
                </button>
                {quickCreateOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={()=>setQuickCreateOpen(false)}/>
                    <div className="absolute right-0 top-full mt-2 z-50 rounded-2xl py-2 min-w-[180px] animate-fadeUp" style={{background:'#12122A',border:`1px solid ${BORDER}`,boxShadow:'0 12px 40px rgba(0,0,0,0.6)'}}>
                      {([{icon:'check-square',label:'Tarea',modal:'tarea'},{icon:'users',label:'Cliente',modal:'cliente'},{icon:'folder-open',label:'Proyecto',modal:'proyecto'},{icon:'film',label:'Pieza',modal:'contenido'},{icon:'zap',label:'Regla',modal:'regla'}] as const).filter(item=>item.modal!=='regla'||isOwner).map(item=>(
                        <button key={item.modal} onClick={()=>{setQuickCreateOpen(false);setModal(item.modal);setMf({})}} className="flex items-center gap-3 w-full px-4 py-2.5 text-left transition-colors hover:bg-white/5">
                          <LucideIcon name={item.icon} size={14} color="rgba(240,240,248,0.4)"/>
                          <span className="font-syne text-[10px] font-black tracking-wide" style={{color:'rgba(240,240,248,0.7)'}}>{item.label}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            <button onClick={()=>{setSearchOpen(true);setSearchQuery('');setSearchIdx(-1)}} className="w-9 h-9 flex items-center justify-center rounded-xl" style={{background:'rgba(255,255,255,0.03)',border:`1px solid ${BORDER}`}}>
              <LucideIcon name="search" size={15} color="rgba(240,240,248,0.45)"/>
            </button>
          </div>
        )}
        {offline && (
          <div className="flex items-center justify-center gap-2 px-4 py-2 flex-shrink-0" style={{background:'rgba(229,29,42,0.12)',borderBottom:'1px solid rgba(229,29,42,0.25)'}}>
            <div className="w-1.5 h-1.5 rounded-full" style={{background:RED}}/>
            <span className="font-syne text-[8px] font-black tracking-widest" style={{color:RED}}>SIN CONEXIÓN — LOS CAMBIOS NO SE GUARDARÁN</span>
          </div>
        )}
        {/* Sin esto, un endpoint caído se ve EXACTAMENTE igual que un estudio vacío:
            "Todo al día, sin pendientes" mientras la API devuelve 500. El usuario
            actúa sobre información falsa y no tiene forma de saberlo ni de reintentar. */}
        {!offline && data.loadError && (
          <div className="flex items-center justify-center gap-3 px-4 py-2 flex-shrink-0" style={{background:'rgba(255,176,32,0.10)',borderBottom:'1px solid rgba(255,176,32,0.22)'}}>
            <div className="w-1.5 h-1.5 rounded-full" style={{background:'rgb(255,176,32)'}}/>
            <span className="font-syne text-[8px] font-black tracking-widest" style={{color:'rgba(255,176,32,0.9)'}}>NO SE PUDO CARGAR TODO — LOS DATOS PUEDEN ESTAR INCOMPLETOS</span>
            <button onClick={()=>data.reload?.()} className="font-syne text-[8px] font-black tracking-widest px-2 py-0.5 rounded-lg" style={{color:'rgb(255,176,32)',border:'1px solid rgba(255,176,32,0.35)'}}>REINTENTAR</button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          {section === 'hoy' && <SectionErrorBoundary section="hoy"><HoySection profile={profile} data={data} urgentCount={urgentCount} unreadCount={unreadCount} onOpenModal={openModal} showToast={showToast} isOwner={isOwner} onNavigate={setSection} /></SectionErrorBoundary>}
          {section === 'inbox' && <SectionErrorBoundary section="inbox"><InboxSection data={data} showToast={showToast} profile={profile} onNavigate={setSection} onSelectClient={setSelectedClient} onAskHarvey={(msg: string)=>{ setHarveyPreload(msg); setSection('harvey') }} /></SectionErrorBoundary>}
          {section === 'tareas' && <SectionErrorBoundary section="tareas"><TareasSection data={data} onOpenModal={openModal} showToast={showToast} isOwner={isOwner} profile={profile} onNavigate={setSection} onSelectProject={setSelectedProject} onSelectClient={setSelectedClient} /></SectionErrorBoundary>}
          {section === 'equipo' && <SectionErrorBoundary section="equipo"><EquipoSection data={data} profile={profile} showToast={showToast} /></SectionErrorBoundary>}
          {section === 'reportes' && <SectionErrorBoundary section="reportes">{isOwner ? <ReportesSection data={data} onNavigate={setSection} /> : <div className="h-full flex items-center justify-center"><div className="text-center"><div className="font-syne text-[10px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.2)'}}>SECCIÓN RESTRINGIDA</div><div className="text-[12px]" style={{color:'rgba(255,255,255,0.3)'}}>Solo disponible para propietarios</div></div></div>}</SectionErrorBoundary>}
          {section === 'diario' && <SectionErrorBoundary section="diario"><DiarioSection data={data} profile={profile} showToast={showToast} onNavigate={setSection} onAskHarvey={(msg: string)=>{ setHarveyPreload(msg); setSection('harvey') }} /></SectionErrorBoundary>}
          {section === 'clientes' && <SectionErrorBoundary section="clientes"><ClientesSection data={data} selectedId={selectedClient} onSelect={setSelectedClient} onOpenModal={openModal} showToast={showToast} isOwner={isOwner} onNavigate={setSection} onSelectProject={setSelectedProject} /></SectionErrorBoundary>}
          {section === 'proyectos' && <SectionErrorBoundary section="proyectos"><ProyectosSection data={data} filteredProjects={filteredProjects} kanbanCols={kanbanCols} projView={projView} setProjView={setProjView} projStatusFilter={projStatusFilter} setProjStatusFilter={setProjStatusFilter} dragRef={dragRef} selectedId={selectedProject} onSelect={setSelectedProject} onOpenModal={openModal} showToast={showToast} isOwner={isOwner} onNavigate={setSection} onSelectClient={setSelectedClient} justCreatedId={justCreatedProjId} onJustCreatedScrolled={()=>setJustCreatedProjId(null)} /></SectionErrorBoundary>}
          {section === 'contenido' && <SectionErrorBoundary section="contenido"><ContenidoSection data={data} onOpenModal={openModal} showToast={showToast} onNavigate={setSection} onSelectClient={setSelectedClient} profile={profile} /></SectionErrorBoundary>}
          {section === 'calendario' && <SectionErrorBoundary section="calendario"><CalendarioSection data={data} profile={profile} showToast={showToast} onOpenModal={openModal} /></SectionErrorBoundary>}
          {section === 'memoria' && <SectionErrorBoundary section="memoria"><MemoriaSection data={data} memFilter={memFilter} setMemFilter={setMemFilter} onOpenModal={openModal} showToast={showToast} /></SectionErrorBoundary>}
          {section === 'automatizaciones' && <SectionErrorBoundary section="automatizaciones"><AutomatizacionesSection data={data} onOpenModal={openModal} showToast={showToast} isOwner={isOwner} /></SectionErrorBoundary>}
          {section === 'chat' && <SectionErrorBoundary section="chat"><ChatSection profile={profile} data={data} chatInput={chatInput} setChatInput={setChatInput} chatLoading={chatLoading} setChatLoading={setChatLoading} showToast={showToast} onNavigate={setSection} /></SectionErrorBoundary>}
          {section === 'harvey' && <SectionErrorBoundary section="harvey"><HarveySection data={data} profile={profile} showToast={showToast} onNavigate={setSection} preloadMessage={harveyPreload} onClearPreload={()=>setHarveyPreload(null)} /></SectionErrorBoundary>}
          {section === 'ajustes' && <SectionErrorBoundary section="ajustes"><AjustesSection profile={profile} data={data} showToast={showToast} memFilter={memFilter} setMemFilter={setMemFilter} onOpenModal={openModal} isOwner={isOwner} onNavigate={setSection} onVerPuestaEnMarcha={() => { olvidarPasoGuardado(); setPuestaHecha(false) }} /></SectionErrorBoundary>}
        </div>

        {/* Tab bar inferior móvil */}
        {isMobile && (
          <>
          <nav className="flex items-stretch flex-shrink-0" style={{borderTop:`1px solid ${BORDER}`,background:'#080812',backdropFilter:'blur(14px)'}}>
            {([
              {id:'hoy' as Section, icon:'sun', label:'HOY'},
              {id:'inbox' as Section, icon:'inbox', label:'INBOX', badge: unreadCount},
              {id:'tareas' as Section, icon:'check-square', label:'TAREAS', badge: urgentCount},
              {id:'proyectos' as Section, icon:'folder-open', label:'PROY.'},
              {id:'chat' as Section, icon:'message-square', label:'IA'},
            ]).map(t => {
              const act = section === t.id
              return (
                <button key={t.id} onClick={()=>{setSection(t.id); setSidebarOpen(false)}} className="flex-1 flex flex-col items-center justify-center gap-1 pt-2.5 pb-2 relative transition-all active:scale-95 active:opacity-70">
                  <div style={{height:'2px',width:'26px',borderRadius:'2px',background:act?BLU:'transparent',position:'absolute',top:0}}/>
                  <div className="relative">
                    <LucideIcon name={t.icon} size={18} color={act?BLU:'rgba(240,240,248,0.28)'}/>
                    {(t as any).badge > 0 && (
                      <div className="absolute -top-1.5 -right-2 min-w-[14px] h-[14px] px-0.5 rounded-full flex items-center justify-center" style={{background:RED}}>
                        <span className="font-syne text-[7px] font-black text-white leading-none">{(t as any).badge>9?'9+':(t as any).badge}</span>
                      </div>
                    )}
                  </div>
                  <span className="font-syne text-[6.5px] font-black tracking-[0.15em]" style={{color:act?BLU:'rgba(240,240,248,0.22)'}}>{t.label}</span>
                </button>
              )
            })}
            {/* Más — abre bottom sheet con todas las secciones */}
            {(()=>{
              const masActive = masOpen || !(['hoy','inbox','tareas','proyectos','chat'] as string[]).includes(section)
              return (
                <button onClick={()=>setMasOpen(o=>!o)} className="flex-1 flex flex-col items-center justify-center gap-1 pt-2.5 pb-2 relative transition-all active:scale-95 active:opacity-70">
                  <div style={{height:'2px',width:'26px',borderRadius:'2px',background:masActive?BLU:'transparent',position:'absolute',top:0}}/>
                  <LucideIcon name="grid-2x2" size={18} color={masActive?BLU:'rgba(240,240,248,0.28)'}/>
                  <span className="font-syne text-[6.5px] font-black tracking-[0.15em]" style={{color:masActive?BLU:'rgba(240,240,248,0.22)'}}>MÁS</span>
                </button>
              )
            })()}
          </nav>
          {/* Relleno safe-area para PWA — cubre el hueco negro bajo el tab bar en iPhone */}
          <div style={{height:'env(safe-area-inset-bottom)',background:'#080812',flexShrink:0}}/>
          </>
        )}

        {/* Bottom sheet MÁS */}
        {isMobile && masOpen && (
          <>
            <div onClick={()=>setMasOpen(false)} className="fixed inset-0 z-[80]" style={{background:'rgba(0,0,0,0.6)',backdropFilter:'blur(3px)'}}/>
            <div className="fixed bottom-0 left-0 right-0 z-[85] rounded-t-3xl" style={{background:'#0A0A18',borderTop:'1px solid rgba(255,255,255,0.08)',boxShadow:'0 -20px 60px rgba(0,0,0,0.7)',paddingBottom:'max(env(safe-area-inset-bottom),16px)'}}>
              <div className="w-10 h-1 rounded-full mx-auto mt-3 mb-4" style={{background:'rgba(255,255,255,0.12)'}}/>
              <div className="px-4 pb-2 grid grid-cols-3 gap-3">
                {([
                  {id:'clientes' as Section, icon:'users', label:'Clientes'},
                  {id:'contenido' as Section, icon:'layout', label:'Contenido'},
                  {id:'calendario' as Section, icon:'calendar', label:'Calendario'},
                  {id:'harvey' as Section, icon:'mic', label:'Harvey'},
                  {id:'ajustes' as Section, icon:'settings', label:'Operativa'},
                  {id:'equipo' as Section, icon:'user-check', label:'Equipo'},
                  // Diario SÍ: faltaba en las dos navegaciones del móvil y es de uso
                  // diario. El botón MÁS se encendía al estar en Diario y al
                  // abrirlo no había nada marcado.
                  //
                  // Memoria, Automatizaciones y Reportes no: se llega por
                  // Operativa, que ya está aquí arriba. Este panel es para lo que
                  // se abre a menudo, no para inventariar la app.
                  {id:'diario' as Section, icon:'pen-line', label:'Fichar'},
                ] as {id:Section,icon:string,label:string}[]).map(item=>(
                  <button key={item.id} onClick={()=>{setSection(item.id);setMasOpen(false)}}
                    className="flex flex-col items-center gap-2 py-4 rounded-2xl transition-all active:scale-95"
                    style={{background:section===item.id?'rgba(27,95,250,0.12)':'rgba(255,255,255,0.03)',border:`1px solid ${section===item.id?'rgba(27,95,250,0.25)':'rgba(255,255,255,0.06)'}`}}>
                    <LucideIcon name={item.icon as any} size={20} color={section===item.id?BLU:'rgba(255,255,255,0.5)'}/>
                    <span className="font-syne text-[9px] font-black tracking-wide" style={{color:section===item.id?BLU:'rgba(255,255,255,0.45)'}}>{item.label.toUpperCase()}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </main>

      {/* SEARCH */}
      {searchOpen && (
        <div onClick={()=>setSearchOpen(false)} className={`fixed inset-0 z-[110] flex items-start justify-center ${isMobile?'pt-[8vh] px-3':'pt-[14vh]'}`} style={{ background:'rgba(2,2,8,0.7)' }}>
          <div onClick={e=>e.stopPropagation()} className="w-[540px] max-w-full rounded-2xl overflow-hidden" style={{ background:'#0C0C1C', border:'1px solid rgba(27,95,250,0.25)', boxShadow:'0 32px 80px rgba(0,0,0,0.75)' }}>
            <div className="flex items-center gap-3 px-5 py-4 border-b border-white/6">
              <LucideIcon name="search" size={16} color="rgba(27,95,250,0.6)" />
              <input ref={searchRef} autoFocus value={searchQuery} onChange={e=>{setSearchQuery(e.target.value);setSearchIdx(-1)}} onKeyDown={handleSearchKey} placeholder="Busca clientes, proyectos, tareas…" className="flex-1 text-sm bg-transparent text-white placeholder-white/20 outline-none" style={{ caretColor:BLU }} />
              {!isMobile && <kbd className="font-syne text-[9px] font-bold text-white/20 px-2 py-1 rounded border border-white/10">ESC</kbd>}
              {isMobile && <button onClick={()=>setSearchOpen(false)} className="font-syne text-[9px] font-black text-white/30 px-2 py-1">✕</button>}
            </div>
            <div className={`${isMobile?'max-h-[45vh]':'max-h-[340px]'} overflow-y-auto p-1.5`}>
              {searchQuery.length >= 2 && searchResults.length === 0 && <div className="py-8 text-center text-white/25 text-sm">Sin resultados</div>}
              {searchResults.map((r,i) => (
                <button key={i} onClick={r.act} className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-left transition-colors" style={{ background:i===searchIdx?'rgba(27,95,250,0.14)':'transparent' }}>
                  <span className="font-syne text-[8px] font-black tracking-widest px-2 py-0.5 rounded" style={{ background:'rgba(255,255,255,0.05)', color:typeColor[r.type]||'rgba(240,240,248,0.4)' }}>{r.type}</span>
                  <span className="flex-1 text-[13px] text-white/85 truncate">{r.title}</span>
                  <span className="text-[11px] text-white/30 flex-shrink-0">{r.sub}</span>
                </button>
              ))}
              {searchQuery.length === 0 && !isMobile && (
                <div className="px-4 py-4">
                  <div className="font-syne text-[8px] font-black tracking-widest mb-3" style={{color:'rgba(255,255,255,0.1)'}}>ATAJOS DE SECCIÓN · G + …</div>
                  <div className="flex flex-wrap gap-1.5">
                    {([['H','HOY'],['T','TAREAS'],['I','INBOX'],['C','CLIENTES'],['P','PROYECTOS'],['K','CONTENIDO'],['A','CALENDARIO'],['M','MEMORIA'],['E','EQUIPO'],['R','REPORTES'],['V','AUTOM.'],['N','CHAT'],['S','OPERATIVA']] as [string,string][]).map(([k,l])=>(
                      <div key={k} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl" style={{background:'rgba(255,255,255,0.03)',border:'1px solid rgba(255,255,255,0.06)'}}>
                        <kbd className="font-syne text-[9px] font-black" style={{color:BLU}}>G·{k}</kbd>
                        <span className="font-syne text-[8px] font-black tracking-wide" style={{color:'rgba(255,255,255,0.18)'}}>{l}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {searchQuery.length === 0 && isMobile && (
                <div className="px-4 py-6 text-center">
                  <div className="font-syne text-[8px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.12)'}}>ESCRIBE PARA BUSCAR</div>
                </div>
              )}
            </div>
            {!isMobile && <div className="px-5 py-2.5 border-t border-white/5 text-[10px] text-white/20">↑↓ navegar · Enter seleccionar · Esc cerrar</div>}
          </div>
        </div>
      )}

      {/* MODAL */}
      {modal && (
        <CreateModal
          modal={modal}
          onClose={() => setModal(null)}
          // El clic en el FONDO pasa por la misma comprobacion que Escape. Cancelar y
          // la X siguen usando onClose, que descarta a proposito: ahi el usuario ha
          // dicho explicitamente que no lo quiere. El fondo, no — es el gesto que se
          // hace sin querer, y se llevaba el formulario entero sin avisar.
          onDismiss={() => {
            if (Object.values(mfRef.current).some(v => (v || '').trim())) {
              setToast('Tienes cambios sin guardar — usa Cancelar para descartarlos')
              setTimeout(() => setToast(null), 3000)
              return
            }
            setModal(null)
          }}
          mf={mf}
          setMf={setMf}
          saving={modalSaving}
          onSave={saveModal}
          team={data.team}
          clients={data.clients}
        />
      )}


      {!puestaHecha && (
        <PuestaEnMarcha
          profile={profile}
          showToast={showToast}
          onTerminar={() => setPuestaHecha(true)}
        />
      )}

      {/* TOAST */}
      {toast && (() => {
        const isErr = /^error/i.test(toast)||toast.toLowerCase().includes(' error')
        const isOk = /^✓|creado|guardado|actualizado|eliminado|leído|enviado|añadid|salvo|pieza/i.test(toast)&&!isErr
        const tc = isErr ? RED : isOk ? GRN : BLU
        return (
          <div className="fixed left-1/2 z-[200] flex items-center gap-3 px-5 py-3 rounded-xl animate-riseT" style={{ bottom: isMobile ? 'calc(72px + env(safe-area-inset-bottom, 0px))' : '24px', transform:'translateX(-50%)', width:'max-content', maxWidth:'calc(100vw - 24px)', background:'#14142A', border:`1px solid ${tc}35`, boxShadow:`0 16px 44px rgba(0,0,0,0.55),0 0 0 1px ${tc}10` }}>
            <div className="w-1.5 h-1.5 rounded-full animate-pls" style={{ background:tc }} />
            <span className="text-sm" style={{color:'rgba(255,255,255,0.88)'}}>{toast}</span>
          </div>
        )
      })()}

      {/* SHORTCUTS OVERLAY */}
      {showShortcuts && !isMobile && (() => {
        const SECTION_HINTS: Partial<Record<Section,{key:string;label:string}[]>> = {
          hoy: [{key:'N',label:'Nueva tarea'}],
          tareas: [{key:'J / K',label:'Navegar lista'},{key:'N',label:'Nueva tarea'},{key:'C',label:'Completar tarea'},{key:'L',label:'Ciclar nivel'},{key:'D',label:'Establecer fecha'},{key:'S',label:'Guardar cambios'},{key:'1–8',label:'Filtrar por estado'}],
          inbox: [{key:'J / K',label:'Navegar mensajes'},{key:'E',label:'Marcar leído'},{key:'T',label:'Crear tarea desde msg'},{key:'A',label:'Todo leído'},{key:'ESC',label:'Cerrar detalle'}],
          clientes: [{key:'N',label:'Nuevo cliente'},{key:'ESC',label:'Cerrar detalle'}],
          proyectos: [{key:'N',label:'Nuevo proyecto'},{key:'V',label:'Cambiar vista'},{key:'S',label:'Ciclar estado'},{key:'P',label:'Editar progreso'}],
          contenido: [{key:'J / K',label:'Navegar pipeline'},{key:'S',label:'Ciclar estado'},{key:'F',label:'Buscar pieza'},{key:'N',label:'Nueva pieza'}],
          memoria: [{key:'N',label:'Nueva entrada'},{key:'E',label:'Editar'},{key:'P',label:'Anclar/desanclar'},{key:'F',label:'Buscar'}],
          equipo: [{key:'J / K',label:'Navegar equipo'},{key:'M',label:'Escribir mensaje'},{key:'ESC',label:'Cerrar perfil'}],
          chat: [{key:'N',label:'Enfocar input'},{key:'1–6',label:'Enviar prompt rápido'}],
          automatizaciones: [{key:'J / K',label:'Navegar reglas'},{key:'E',label:'Activar/pausar'},{key:'N',label:'Nueva regla'}],
        }
        const sectionHints = SECTION_HINTS[section] || []
        const sectionLabels: Record<Section,string> = {hoy:'Hoy',diario:'Fichar',tareas:'Tareas',inbox:'Inbox',clientes:'Clientes',proyectos:'Proyectos',contenido:'Contenido',calendario:'Calendario',memoria:'Memoria',equipo:'Equipo',chat:'Chat IA',automatizaciones:'Automatizaciones',reportes:'Reportes',ajustes:'Operativa',harvey:'Harvey'}
        return (
          <div onClick={()=>setShowShortcuts(false)} className="fixed inset-0 z-[120] flex items-center justify-center" style={{background:'rgba(2,2,8,0.75)',backdropFilter:'blur(6px)'}}>
            <div onClick={e=>e.stopPropagation()} className="w-[560px] max-w-[94vw] rounded-3xl" style={{background:'linear-gradient(180deg,#0D0D1E 0%,#080810 100%)',border:`1px solid rgba(27,95,250,0.2)`,boxShadow:'0 40px 100px rgba(0,0,0,0.85),0 0 0 1px rgba(27,95,250,0.04)',maxHeight:'94dvh',overflowY:'auto'}}>
              <div className="h-[2px]" style={{background:`linear-gradient(90deg,transparent,${BLU},transparent)`}}/>
              <div className="flex items-center justify-between px-7 py-5" style={{borderBottom:`1px solid ${BORDER}`}}>
                <div>
                  <div className="font-syne text-[8.5px] font-black tracking-widest mb-1.5" style={{color:'rgba(100,140,255,0.5)'}}>ATAJOS DE TECLADO</div>
                  <h2 className="font-figtree text-[22px] font-black text-white leading-none">{sectionLabels[section]}</h2>
                </div>
                <div className="flex items-center gap-2.5">
                  <kbd className="font-syne text-[9px] font-black px-2.5 py-1.5 rounded-lg" style={{background:SURF2,color:BLU,border:'1px solid rgba(27,95,250,0.2)'}}>?</kbd>
                  <button onClick={()=>setShowShortcuts(false)} className="w-8 h-8 rounded-xl flex items-center justify-center transition-colors hover:bg-white/5" style={{background:SURF2}}>
                    <LucideIcon name="x" size={14} color="rgba(240,240,248,0.4)"/>
                  </button>
                </div>
              </div>
              <div className="px-7 py-6 grid grid-cols-2 gap-x-8">
                <div>
                  <div className="font-syne text-[7.5px] font-black tracking-widest mb-4" style={{color:'rgba(255,255,255,0.14)'}}>NAVEGACIÓN GLOBAL</div>
                  <div className="space-y-2.5">
                    {([['⌘K','Búsqueda global'],['G·H','Hoy'],['G·T','Tareas'],['G·I','Inbox'],['G·C','Clientes'],['G·P','Proyectos'],['G·K','Contenido'],['G·A','Calendario'],['G·M','Memoria'],['G·E','Equipo'],['G·R','Reportes'],['G·V','Automatizaciones'],['G·N','Chat IA'],['G·S','Operativa'],['?','Mostrar esta ayuda'],['ESC','Cerrar paneles']] as [string,string][]).map(([k,l])=>(
                      <div key={k} className="flex items-center gap-3">
                        <kbd className="font-syne text-[8px] font-black px-2 py-1 rounded-lg flex-shrink-0 text-center" style={{background:SURF2,color:BLU,border:'1px solid rgba(27,95,250,0.15)',minWidth:'46px'}}>{k}</kbd>
                        <span className="text-[11.5px]" style={{color:'rgba(255,255,255,0.38)'}}>{l}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="font-syne text-[7.5px] font-black tracking-widest mb-4" style={{color:'rgba(255,255,255,0.14)'}}>EN {sectionLabels[section].toUpperCase()}</div>
                  {sectionHints.length > 0 ? (
                    <div className="space-y-2.5">
                      {sectionHints.map(h=>(
                        <div key={h.key} className="flex items-center gap-3">
                          <kbd className="font-syne text-[8px] font-black px-2 py-1 rounded-lg flex-shrink-0 text-center" style={{background:SURF2,color:'rgba(240,240,248,0.55)',border:`1px solid rgba(255,255,255,0.09)`,minWidth:'46px'}}>{h.key}</kbd>
                          <span className="text-[11.5px]" style={{color:'rgba(255,255,255,0.38)'}}>{h.label}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[12px]" style={{color:'rgba(255,255,255,0.14)'}}>Sin atajos específicos</div>
                  )}
                </div>
              </div>
              <div className="px-7 py-3.5 flex items-center gap-2" style={{borderTop:`1px solid ${BORDER}`}}>
                <span className="text-[10px]" style={{color:'rgba(255,255,255,0.14)'}}>Presiona</span>
                <kbd className="font-syne font-black text-[8.5px] px-1.5 py-0.5 rounded" style={{background:SURF2,color:'rgba(255,255,255,0.28)',border:`1px solid ${BORDER}`}}>?</kbd>
                <span className="text-[10px]" style={{color:'rgba(255,255,255,0.14)'}}>o</span>
                <kbd className="font-syne font-black text-[8.5px] px-1.5 py-0.5 rounded" style={{background:SURF2,color:'rgba(255,255,255,0.28)',border:`1px solid ${BORDER}`}}>ESC</kbd>
                <span className="text-[10px]" style={{color:'rgba(255,255,255,0.14)'}}>para cerrar</span>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Search shortcut button — solo escritorio */}
      {!isMobile && <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2">
        <button onClick={()=>setShowShortcuts(s=>!s)} className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl font-syne text-[10px] font-bold tracking-widest opacity-50 hover:opacity-100 transition-opacity" style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)', color:'rgba(255,255,255,0.25)' }}>
          <span>?</span>
        </button>
        <button onClick={()=>setSearchOpen(true)} className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-syne text-[10px] font-bold tracking-widest opacity-60 hover:opacity-100 transition-opacity" style={{ background:'rgba(27,95,250,0.08)', border:'1px solid rgba(27,95,250,0.15)', color:'rgba(255,255,255,0.3)' }}>
          <LucideIcon name="search" size={12} color="rgba(27,95,250,0.5)" />
          <span>⌘K</span>
        </button>
      </div>}
    </div>
  )
}

