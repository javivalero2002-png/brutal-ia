'use client'
import { activarPush } from '@/lib/activarPush'
import { AVISOS, ORDEN_AVISOS } from '@/lib/avisos'

import { useState, useEffect } from 'react'
import { BLU, GRN, RED, AMBAR, SURFACE, BORDER, LucideIcon, useIsMobile, relTime } from '@/components/shared'

interface NotifItem { id: string; title: string; body?: string; url?: string; tag?: string; read: boolean; created_at: string }

interface PropsNotificaciones {
  showToast: (mensaje: string) => void
}

function NotificacionesTab({ showToast }: PropsNotificaciones) {
  /**
   * Qué avisos ha silenciado esta persona.
   *
   * Optimista al pulsar y con vuelta atrás si el guardado falla: el interruptor
   * tiene que responder al dedo, pero mentir sobre lo que quedó guardado es peor
   * que ir lento — creerías tener silenciado algo que sigue sonando.
   */
  const [prefs, setPrefs] = useState<Record<string, boolean>>({})
  const [guardando, setGuardando] = useState(false)
  useEffect(() => {
    fetch('/api/push/prefs')
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(j => setPrefs(j.prefs || {}))
      .catch(() => { /* todo activo por defecto: es lo que espera quien los activó */ })
  }, [])

  const cambiarPref = async (cat: string, valor: boolean) => {
    const antes = prefs
    const nuevo = { ...prefs, [cat]: valor }
    setPrefs(nuevo)
    setGuardando(true)
    try {
      const r = await fetch('/api/push/prefs', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefs: nuevo }),
      })
      if (!r.ok) throw new Error()
    } catch {
      setPrefs(antes)
      showToast('No se pudo guardar. Sigue como estaba.')
    } finally { setGuardando(false) }
  }

  const isMobile = useIsMobile()
  const [supported, setSupported] = useState(true)
  const [needsInstall, setNeedsInstall] = useState(false)
  const [permission, setPermission] = useState<NotificationPermission | 'unknown'>('unknown')
  const [subscribed, setSubscribed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [history, setHistory] = useState<NotifItem[]>([])
  const [histLoaded, setHistLoaded] = useState(false)
  const [histError, setHistError] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)

  const loadHistory = async () => {
    try {
      const r = await fetch('/api/notifications/history')
      const d = await r.json().catch(() => null)
      // La ruta responde 200 con `{ items: [], unavailable: true }` cuando la
      // consulta a notification_log falla (p.ej. la tabla aun no existe). Leyendo
      // solo `items`, «la tabla esta caida» y «no tienes avisos» se pintaban
      // exactamente igual: la bandeja vacia afirmaba algo que nadie habia
      // comprobado. Un 401 con la sesion caducada hacia lo mismo.
      if (!r.ok || !d || d.unavailable) { setHistError(true); setHistory([]); return }
      setHistError(false)
      setHistory(Array.isArray(d.items) ? d.items : [])
    } catch { setHistError(true); setHistory([]) }
    finally { setHistLoaded(true) }
  }
  useEffect(() => { loadHistory() }, [])

  // El vaciado local iba ANTES del DELETE, dentro de un `try {} catch {}` que ni
  // miraba r.ok. Con la sesion caducada la ruta responde 401 y con el delete roto
  // 500: ninguno de los dos lanza, asi que el catch vacio ni se ejecutaba. El
  // historial desaparecia de la pantalla, nadie decia nada, y volvia entero al
  // recargar — la app afirmaba haber borrado algo que seguia ahi. Mismo orden que
  // clearChat: primero el servidor, y solo si confirma se vacia la pantalla.
  const clearHistory = async () => {
    try {
      const r = await fetch('/api/notifications/history', { method: 'DELETE' })
      if (!r.ok) { showToast('No se pudo vaciar el historial'); return }
      setHistory([])
    } catch { showToast('Error al vaciar el historial') }
  }

  useEffect(() => {
    const hasApi = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
    setSupported(hasApi)
    // En iOS las notificaciones web solo funcionan con la app instalada en pantalla de inicio
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true
    setNeedsInstall(isIOS && !standalone)
    if (!hasApi) return
    setPermission(Notification.permission)
    navigator.serviceWorker.getRegistration('/sw.js').then(reg => reg?.pushManager.getSubscription()).then(sub => setSubscribed(!!sub)).catch(() => {})
  }, [])

  // La activación vive en `src/lib/activarPush.ts`, compartida con la puesta en
  // marcha. Estaba escrita solo aquí, y la copia de la puesta en marcha se quedó
  // a medias —pedía el permiso y nada más—, así que prometía avisos que no
  // llegaban. Una sola copia es lo que impide que vuelva a pasar.
  const activate = async () => {
    setBusy(true)
    const r = await activarPush()
    setPermission(typeof Notification !== 'undefined' ? Notification.permission : 'default')
    setBusy(false)
    if (!r.ok) { showToast(r.mensaje); return }
    setSubscribed(true)
    showToast('Notificaciones activadas en este dispositivo')
  }

  const deactivate = async () => {
    setBusy(true)
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js')
      const sub = await reg?.pushManager.getSubscription()
      if (sub) {
        const r = await fetch('/api/push/subscribe', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) })
        // Mismo gemelo que el de LIMPIAR: activate() ya comprueba r.ok, aqui no se
        // miraba. Con la sesion caducada la ruta devuelve 401 (y 500 si el delete
        // falla), ninguno lanza, asi que la suscripcion seguia viva en el servidor
        // mientras la pantalla decia "Notificaciones desactivadas".
        if (!r.ok) throw new Error('unsubscribe failed')
        await sub.unsubscribe()
      }
      setSubscribed(false)
      showToast('Notificaciones desactivadas')
    } catch { showToast('Error al desactivar') }
    finally { setBusy(false) }
  }

  const sendTest = async () => {
    setTesting(true)
    try {
      const r = await fetch('/api/push/test', { method: 'POST' })
      const d = await r.json()
      // Con un error del servidor, `d.sent` no existe y el mensaje decia "Sin
      // dispositivos suscritos": un diagnostico FALSO que manda a mirar donde no
      // es. Los dispositivos podian estar perfectamente suscritos.
      if (!r.ok) { showToast(d?.error || 'No se pudo enviar la prueba'); return }
      showToast(d.sent > 0 ? 'Prueba enviada — debería sonar en unos segundos' : 'Sin dispositivos suscritos')
      setTimeout(loadHistory, 900)
    } catch { showToast('Error al enviar la prueba') }
    finally { setTesting(false) }
  }

  return (
    <div className={`${isMobile?'p-4':'p-8'} max-w-[680px] mx-auto space-y-4`}>
      <div className="p-6" style={{background:SURFACE,border:`1px solid ${BORDER}`,borderRadius:'16px'}}>
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0" style={{background:subscribed?'rgba(34,197,94,0.12)':'rgba(27,95,250,0.1)'}}>
            <LucideIcon name="bell" size={17} color={subscribed?GRN:BLU}/>
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-figtree text-[15px] font-semibold text-white">Notificaciones push</div>
            <div className="text-[12px] mt-0.5" style={{color:'rgba(255,255,255,0.35)'}}>
              {subscribed ? 'Activadas en este dispositivo' : 'Recibe avisos aunque la app esté cerrada'}
            </div>
          </div>
          <span className="font-syne text-[7.5px] font-black px-2.5 py-1 rounded-full flex-shrink-0" style={{background:subscribed?'rgba(34,197,94,0.1)':'rgba(255,255,255,0.05)',color:subscribed?GRN:'rgba(255,255,255,0.3)'}}>
            {subscribed?'● ACTIVAS':'INACTIVAS'}
          </span>
        </div>

        {/* La lista SALE del catálogo, no de aquí.
            Antes eran tres líneas escritas a mano mientras la app mandaba ocho
            avisos distintos — tres de ellos añadidos el mismo día. Prometer de
            menos es peor que no prometer: quien lee «solo me avisa de tareas y
            correos» apaga los avisos sin saber que se pierde que un cliente ha
            respondido o que su Gmail lleva una semana desconectado.

            Y ahora cada línea es un interruptor: la pantalla HACE algo en vez de
            contar algo. */}
        <div className="mt-5 flex flex-col gap-1">
          {ORDEN_AVISOS.map(cat => {
            const a = AVISOS[cat]
            const activo = prefs[cat] !== false
            return (
              <button key={cat}
                onClick={() => a.silenciable && cambiarPref(cat, !activo)}
                disabled={!a.silenciable || guardando || !subscribed}
                className="flex items-start gap-3 py-2.5 px-3 -mx-3 rounded-xl text-left transition-colors disabled:cursor-default enabled:hover:bg-white/[0.03]">
                {/* El interruptor. Apagado se ve apagado: sin color y sin bolita
                    a la derecha, para que se lea de un vistazo cuál está mudo. */}
                <div className="mt-0.5 flex-shrink-0 rounded-full transition-all"
                  style={{
                    width: '30px', height: '17px', padding: '2px',
                    background: !subscribed ? 'rgba(255,255,255,0.06)' : activo ? `${BLU}` : 'rgba(255,255,255,0.12)',
                    opacity: a.silenciable ? 1 : 0.45,
                  }}>
                  <div className="rounded-full transition-transform" style={{
                    width: '13px', height: '13px', background: '#fff',
                    transform: activo ? 'translateX(13px)' : 'translateX(0)',
                  }}/>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold" style={{color: activo ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.4)'}}>
                    {a.label}
                    {!a.silenciable && (
                      <span className="font-syne text-[7px] font-black tracking-widest ml-2 px-1.5 py-0.5 rounded-full align-middle"
                        style={{background:'rgba(255,255,255,0.06)', color:'rgba(255,255,255,0.3)'}}>SIEMPRE</span>
                    )}
                  </div>
                  <div className="text-[11.5px] mt-0.5 leading-snug" style={{color:'rgba(255,255,255,0.32)'}}>{a.desc}</div>
                </div>
              </button>
            )
          })}
        </div>

        {needsInstall ? (
          <div className="mt-5 px-4 py-3 rounded-xl text-[12px] leading-relaxed" style={{background:'rgba(27,95,250,0.06)',border:'1px solid rgba(27,95,250,0.18)',color:'rgba(160,190,255,0.85)'}}>
            En iPhone, primero instala la app: <b>Compartir → Añadir a pantalla de inicio</b>, ábrela desde el icono y vuelve aquí para activar.
          </div>
        ) : !supported ? (
          <div className="mt-5 px-4 py-3 rounded-xl text-[12px]" style={{background:'rgba(255,176,32,0.07)',border:'1px solid rgba(255,176,32,0.18)',color:'rgba(255,176,32,0.85)'}}>
            Este navegador no soporta notificaciones push.
          </div>
        ) : (
          <div className="mt-6 flex items-center gap-3 flex-wrap">
            {subscribed ? (
              <>
                <button onClick={sendTest} disabled={testing} className="px-5 py-3 rounded-2xl font-syne text-[10px] font-black tracking-widest text-white disabled:opacity-50" style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>
                  {testing?'ENVIANDO…':'ENVIAR PRUEBA'}
                </button>
                <button onClick={deactivate} disabled={busy} className="px-5 py-3 rounded-2xl font-syne text-[10px] font-black tracking-widest disabled:opacity-50" style={{color:'rgba(255,255,255,0.4)',border:`1px solid ${BORDER}`}}>
                  DESACTIVAR
                </button>
              </>
            ) : (
              <button onClick={activate} disabled={busy} className="px-6 py-3.5 rounded-2xl font-syne text-[10px] font-black tracking-widest text-white disabled:opacity-50" style={{background:`linear-gradient(135deg,${BLU},#1440CC)`,boxShadow:'0 8px 24px rgba(27,95,250,0.25)'}}>
                {busy?'ACTIVANDO…':'🔔 ACTIVAR NOTIFICACIONES'}
              </button>
            )}
          </div>
        )}
        {permission==='denied' && supported && !needsInstall && (
          <div className="mt-4 text-[11.5px]" style={{color:'rgba(229,29,42,0.7)'}}>
            El permiso está bloqueado en el navegador. Desbloquéalo en los ajustes del sitio y reintenta.
          </div>
        )}
      </div>
      {/* ── HISTORIAL ──────────────────────────────────────────────────────── */}
      <div className="p-6" style={{background:SURFACE,border:`1px solid ${BORDER}`,borderRadius:'16px'}}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <LucideIcon name="clock" size={14} color="rgba(255,255,255,0.4)"/>
            <span className="font-syne text-[10px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.55)'}}>HISTORIAL</span>
            {history.length>0 && <span className="font-syne text-[8px] font-black px-2 py-0.5 rounded-full" style={{background:'rgba(27,95,250,0.1)',color:'rgba(100,140,255,0.7)'}}>{history.length}</span>}
          </div>
          {/* Confirmacion en dos pasos, como el LIMPIAR del chat: esto borraba el
              historial entero de un solo clic, sin vuelta atras y sin preguntar. */}
          {history.length>0 && (
            confirmClear
              ? <div className="flex items-center gap-1">
                  <button onClick={()=>{ setConfirmClear(false); clearHistory() }} className="font-syne text-[8px] font-black px-3 py-1.5 rounded-xl transition-all" style={{background:'rgba(229,29,42,0.12)',color:RED,border:'1px solid rgba(229,29,42,0.25)'}}>¿BORRAR?</button>
                  <button onClick={()=>setConfirmClear(false)} className="w-6 h-6 rounded-lg flex items-center justify-center" style={{color:'rgba(255,255,255,0.3)'}}><LucideIcon name="x" size={10} color="rgba(255,255,255,0.3)"/></button>
                </div>
              : <button onClick={()=>setConfirmClear(true)} className="font-syne text-[8px] font-black tracking-wide px-2.5 py-1.5 rounded-lg transition-colors hover:bg-white/5" style={{color:'rgba(255,255,255,0.35)'}}>LIMPIAR</button>
          )}
        </div>
        {!histLoaded ? (
          <div className="text-center py-8 text-[12px]" style={{color:'rgba(255,255,255,0.2)'}}>Cargando…</div>
        ) : histError ? (
          // Nunca el vacio de «Aun no hay notificaciones»: aqui no sabemos si hay
          // avisos o no, y decir que no hay ninguno es afirmar lo que no consta.
          <div className="flex flex-col items-center gap-2.5 py-10">
            <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{background:AMBAR+'12',border:`1px solid ${AMBAR}2E`}}>
              <LucideIcon name="alert-triangle" size={18} color={AMBAR}/>
            </div>
            <div className="text-[12.5px]" style={{color:AMBAR+'D9'}}>No se pudo leer el historial</div>
            <button onClick={()=>{ setHistLoaded(false); loadHistory() }} className="font-syne text-[8px] font-black tracking-widest px-3 py-1.5 rounded-lg transition-colors hover:bg-white/5" style={{color:'rgba(255,255,255,0.35)',border:`1px solid ${BORDER}`}}>REINTENTAR</button>
          </div>
        ) : history.length === 0 ? (
          <div className="flex flex-col items-center gap-2.5 py-10">
            <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{background:'rgba(255,255,255,0.03)',border:`1px solid ${BORDER}`}}>
              <LucideIcon name="bell" size={18} color="rgba(255,255,255,0.15)"/>
            </div>
            <div className="text-[12.5px]" style={{color:'rgba(255,255,255,0.25)'}}>Aún no hay notificaciones</div>
            <div className="text-[11px] text-center max-w-[280px]" style={{color:'rgba(255,255,255,0.18)'}}>Aquí aparecerán las tareas asignadas, mensajes del equipo, emails y alertas de tus automatizaciones.</div>
          </div>
        ) : (
          <div className="space-y-1.5 -mx-1">
            {history.map(n=>(
              <div key={n.id} className="flex items-start gap-3 px-3 py-2.5 rounded-xl transition-colors" style={{background:n.read?'transparent':'rgba(27,95,250,0.04)'}}>
                <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5" style={{background:n.read?'rgba(255,255,255,0.03)':'rgba(27,95,250,0.1)'}}>
                  <LucideIcon name={n.title.startsWith('⚡')?'zap':n.tag?.startsWith('task')?'check-square':n.tag?.startsWith('auto')?'zap':'bell'} size={12} color={n.read?'rgba(255,255,255,0.3)':BLU}/>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] font-medium truncate" style={{color:'rgba(240,240,248,0.85)'}}>{n.title}</div>
                  {n.body && <div className="text-[11.5px] mt-0.5 line-clamp-2" style={{color:'rgba(255,255,255,0.35)'}}>{n.body}</div>}
                </div>
                <span className="font-syne text-[8px] font-black tracking-wide flex-shrink-0 mt-1" style={{color:'rgba(255,255,255,0.22)'}}>{relTime(n.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="px-5 py-4 rounded-2xl text-[11.5px] leading-relaxed" style={{background:'rgba(255,255,255,0.02)',border:`1px solid ${BORDER}`,color:'rgba(255,255,255,0.3)'}}>
        Cada persona activa las notificaciones en su propio dispositivo. Se puede activar en varios (móvil y ordenador) a la vez.
      </div>
    </div>
  )
}

export default NotificacionesTab
