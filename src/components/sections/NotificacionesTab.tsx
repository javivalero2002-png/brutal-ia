'use client'

import { useState, useEffect } from 'react'
import { BLU, GRN, SURFACE, BORDER, LucideIcon } from '@/components/shared'

function NotificacionesTab({ showToast }: any) {
  const [supported, setSupported] = useState(true)
  const [needsInstall, setNeedsInstall] = useState(false)
  const [permission, setPermission] = useState<NotificationPermission | 'unknown'>('unknown')
  const [subscribed, setSubscribed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)

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
      const r = await fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON() }) })
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
    } catch { showToast('Error al enviar la prueba') }
    finally { setTesting(false) }
  }

  return (
    <div className="p-8 max-w-[680px] mx-auto space-y-4">
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
      <div className="px-5 py-4 rounded-2xl text-[11.5px] leading-relaxed" style={{background:'rgba(255,255,255,0.02)',border:`1px solid ${BORDER}`,color:'rgba(255,255,255,0.3)'}}>
        Cada persona activa las notificaciones en su propio dispositivo. Se puede activar en varios (móvil y ordenador) a la vez.
      </div>
    </div>
  )
}

export default NotificacionesTab
