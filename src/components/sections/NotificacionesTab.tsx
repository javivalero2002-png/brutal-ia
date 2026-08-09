'use client'

import { useState, useEffect } from 'react'
import { BLU, GRN, SURFACE, BORDER, LucideIcon, useIsMobile, relTime } from '@/components/shared'

interface NotifItem { id: string; title: string; body?: string; url?: string; tag?: string; read: boolean; created_at: string }

function NotificacionesTab({ showToast }: any) {
  const isMobile = useIsMobile()
  const [supported, setSupported] = useState(true)
  const [needsInstall, setNeedsInstall] = useState(false)
  const [permission, setPermission] = useState<NotificationPermission | 'unknown'>('unknown')
  const [subscribed, setSubscribed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [history, setHistory] = useState<NotifItem[]>([])
  const [histLoaded, setHistLoaded] = useState(false)

  const loadHistory = async () => {
    try {
      const r = await fetch('/api/notifications/history')
      const d = await r.json()
      setHistory(Array.isArray(d.items) ? d.items : [])
    } catch { /* silencioso */ }
    finally { setHistLoaded(true) }
  }
  useEffect(() => { loadHistory() }, [])

  const clearHistory = async () => {
    setHistory([])
    try { await fetch('/api/notifications/history', { method: 'DELETE' }) } catch {}
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

  const activate = async () => {
    setBusy(true)
    try {
      const reg = await navigator.serviceWorker.register('/sw.js')
      await navigator.serviceWorker.ready
      const perm = await Notification.requestPermission()
      setPermission(perm)
      if (perm !== 'granted') { showToast('Permiso denegado — actívalo en los ajustes del navegador'); return }
      const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || ''
      const raw = atob(key.replace(/-/g, '+').replace(/_/g, '/'))
      const appKey = new Uint8Array([...raw].map(c => c.charCodeAt(0)))
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey })
      const r = await fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON(), userAgent: navigator.userAgent }) })
      if (!r.ok) throw new Error('subscribe failed')
      setSubscribed(true)
      showToast('Notificaciones activadas en este dispositivo')
    } catch {
      showToast('No se pudieron activar. Inténtalo de nuevo.')
    } finally { setBusy(false) }
  }

  const deactivate = async () => {
    setBusy(true)
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js')
      const sub = await reg?.pushManager.getSubscription()
      if (sub) {
        await fetch('/api/push/subscribe', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) })
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

        <div className="mt-5 space-y-2.5">
          {[
            {icon:'check-square', txt:'Cuando te asignan una tarea'},
            {icon:'message-circle', txt:'Cuando recibes un mensaje del equipo'},
            {icon:'inbox', txt:'Cuando entran emails nuevos (personal y colabs)'},
          ].map(x=>(
            <div key={x.txt} className="flex items-center gap-3">
              <LucideIcon name={x.icon} size={13} color="rgba(27,95,250,0.55)"/>
              <span className="text-[12.5px]" style={{color:'rgba(255,255,255,0.5)'}}>{x.txt}</span>
            </div>
          ))}
        </div>

        {!supported ? (
          <div className="mt-5 px-4 py-3 rounded-xl text-[12px]" style={{background:'rgba(255,176,32,0.07)',border:'1px solid rgba(255,176,32,0.18)',color:'rgba(255,176,32,0.85)'}}>
            Este navegador no soporta notificaciones push.
          </div>
        ) : needsInstall ? (
          <div className="mt-5 px-4 py-3 rounded-xl text-[12px] leading-relaxed" style={{background:'rgba(27,95,250,0.06)',border:'1px solid rgba(27,95,250,0.18)',color:'rgba(160,190,255,0.85)'}}>
            En iPhone, primero instala la app: <b>Compartir → Añadir a pantalla de inicio</b>, ábrela desde el icono y vuelve aquí para activar.
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
          {history.length>0 && (
            <button onClick={clearHistory} className="font-syne text-[8px] font-black tracking-wide px-2.5 py-1.5 rounded-lg transition-colors hover:bg-white/5" style={{color:'rgba(255,255,255,0.35)'}}>LIMPIAR</button>
          )}
        </div>
        {!histLoaded ? (
          <div className="text-center py-8 text-[12px]" style={{color:'rgba(255,255,255,0.2)'}}>Cargando…</div>
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
