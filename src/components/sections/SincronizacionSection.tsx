'use client'

import { useState, useEffect, useCallback } from 'react'
import { AvisoGoogle } from '@/components/shared'
import { rutaApp } from '@/lib/appUrl'
import type { NexusData } from '@/types'
import { BLU, RED, GRN, SURFACE, SURF2, BORDER, useIsMobile, LucideIcon, AjGroup, todayKey } from '@/components/shared'
import { plural } from '@/components/shared/helpers'

const GMAIL_STATUS_LS = 'gmail_status_cache'
interface PropsSincronizacion {
  data: NexusData
  profile: any
  showToast: any
}

function SincronizacionSection({data, profile, showToast}: PropsSincronizacion) {
  const isMobile = useIsMobile()
  // Arranca con el último estado conocido (cacheado) para no parpadear "sin conectar"
  const cachedStatus = (() => { try { return JSON.parse(localStorage.getItem(GMAIL_STATUS_LS) || 'null') } catch { return null } })()
  const [gmailStatus, setGmailStatus] = useState<any>(cachedStatus)
  const [loadingGmail, setLoadingGmail] = useState(!cachedStatus)
  const [syncing, setSyncing] = useState(false)
  const [syncingColabs, setSyncingColabs] = useState(false)
  const [syncingAll, setSyncingAll] = useState(false)
  const [copied, setCopied] = useState('')
  const [syncLog, setSyncLog] = useState<{time:string; label:string; ok:boolean; detail:string}[]>([])
  const [lastPersonal, setLastPersonal] = useState<string|null>(null)
  const [lastColabs, setLastColabs] = useState<string|null>(null)
  const [expandLog, setExpandLog] = useState(false)
  const [disconnecting, setDisconnecting] = useState<string|null>(null)
  // Desconectar iba a un solo clic. Ver BotonDesconectar más abajo.
  const [confirmDisconnect, setConfirmDisconnect] = useState<'personal'|'colabs'|null>(null)
  const [teamMembers, setTeamMembers] = useState<any[]>([])
  const [syncResultMsg, setSyncResultMsg] = useState<{ok:boolean; text:string; account:'personal'|'colabs'|'all'} | null>(null)
  // El recuadro de resultado se cierra solo a los 6 s (antes se quedaba pegado)
  useEffect(() => {
    if (!syncResultMsg) return
    const t = setTimeout(() => setSyncResultMsg(null), 6000)
    return () => clearTimeout(t)
  }, [syncResultMsg])
  const [lastSyncTick, setLastSyncTick] = useState(0)

  // Tick every minute to refresh "last synced X ago" displays
  useEffect(() => {
    const id = setInterval(() => setLastSyncTick(t => t + 1), 60000)
    return () => clearInterval(id)
  }, [])

  const uid = profile?.id || 'default'
  // Optimista y con vuelta atrás: un interruptor que tarda medio segundo en
  // moverse se pulsa dos veces. Si el guardado falla se devuelve al sitio y se
  // dice — que es lo contrario de quedarse mintiendo en la posición nueva.
  const [analizaCorreo, setAnalizaCorreo] = useState<boolean>(profile?.analizar_correo !== false)
  const [veColabs, setVeColabs] = useState<boolean>(profile?.ver_colabs !== false)
  // Las cuentas de Gmail conectadas. Vienen del servidor y NO llevan token: el
  // cliente solo necesita saber qué direcciones hay.
  const [cuentas, setCuentas] = useState<{ email: string; compartida: boolean }[]>([])
  const cargarCuentas = useCallback(() => {
    fetch('/api/gmail/cuentas').then(r => (r.ok ? r.json() : null))
      .then(j => setCuentas(Array.isArray(j?.cuentas) ? j.cuentas : []))
      .catch(() => {})
  }, [])
  useEffect(() => { cargarCuentas() }, [cargarCuentas])
  const desconectarCuenta = async (email: string) => {
    try {
      const res = await fetch('/api/gmail/cuentas', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      if (!res.ok) throw new Error()
      showToast(`${email} desconectada`)
      cargarCuentas()
    } catch { showToast('No se pudo desconectar') }
  }
  const [guardandoAnalisis, setGuardandoAnalisis] = useState(false)
  const cambiarVerColabs = async (v: boolean) => {
    const antes = veColabs
    setVeColabs(v)
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ ver_colabs: v }),
      })
      if (!res.ok) throw new Error()
      showToast(v ? 'Verás el buzón de colaboraciones' : 'Ya no verás el buzón de colaboraciones')
    } catch { setVeColabs(antes); showToast('No se pudo guardar la preferencia') }
  }
  const cambiarAnalisis = async (v: boolean) => {
    const antes = analizaCorreo
    setAnalizaCorreo(v); setGuardandoAnalisis(true)
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ analizar_correo: v }),
      })
      if (!res.ok) throw new Error()
      showToast(v ? 'Tu correo personal se analizará' : 'Tu correo personal ya no se analiza')
    } catch {
      setAnalizaCorreo(antes)
      showToast('No se pudo guardar la preferencia')
    } finally { setGuardandoAnalisis(false) }
  }
  const LS_P = `bs_sync_personal_${uid}`
  const LS_C = `bs_sync_colabs_${uid}`
  const LS_L = `bs_sync_log_${uid}`

  useEffect(() => {
    try {
      const lp = localStorage.getItem(LS_P)
      const lc = localStorage.getItem(LS_C)
      if (lp) setLastPersonal(lp)
      if (lc) setLastColabs(lc)
      const log = localStorage.getItem(LS_L)
      if (log) setSyncLog(JSON.parse(log))
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid])

  const addLog = (label: string, ok: boolean, detail: string) => {
    const entry = { time: new Date().toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'}), label, ok, detail }
    setSyncLog(prev => {
      const next = [entry, ...prev].slice(0, 20)
      try { localStorage.setItem(LS_L, JSON.stringify(next)) } catch {}
      return next
    })
  }

  /**
   * El latido de lo automático.
   *
   * Sin esto, «hoy no ha llegado correo» y «el cron lleva ocho horas sin
   * ejecutarse» se ven exactamente igual desde la Bandeja. Pasó el 18 de agosto y
   * estuvo un día entero sin que nadie lo notara.
   */
  const [latidos, setLatidos] = useState<{ tarea: string; en: string | null; ok: boolean | null; detalle: string | null; retrasado: boolean | null; minutosDesde: number | null }[] | null>(null)
  const [latidoRoto, setLatidoRoto] = useState(false)
  useEffect(() => {
    let vivo = true
    fetch('/api/admin/latido')
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(j => { if (vivo) { setLatidos(j.procesos || []); setLatidoRoto(false) } })
      // «No pude leerlo» NO se pinta como «no ha corrido nada»: sería el mismo
      // fallo que este panel existe para destapar.
      .catch(() => { if (vivo) setLatidoRoto(true) })
    return () => { vivo = false }
  }, [lastSyncTick])

  const reloadStatus = () => {
    // Solo mostramos "cargando" si NO teníamos ya un estado cacheado (evita el parpadeo)
    if (!gmailStatus) setLoadingGmail(true)
    fetch('/api/gmail/status')
      .then(r => { if (!r.ok) throw new Error('estado'); return r.json() })
      .then(s => { setGmailStatus(s); try { localStorage.setItem(GMAIL_STATUS_LS, JSON.stringify(s)) } catch {} })
      // Se conserva el ultimo estado conocido: pintar "no conectado" porque fallo
      // la CONSULTA hace que alguien reconecte Gmail sin ninguna necesidad.
      .catch(()=>setGmailStatus((prev: any) => prev || {connected:false}))
      .finally(()=>setLoadingGmail(false))
  }

  const reloadTeam = () => {
    fetch('/api/gmail/team-status')
      .then(r => { if (!r.ok) throw new Error('estado'); return r.json() })
      .then(res => setTeamMembers(res.members || []))
      // Silencioso a proposito: es informacion secundaria y ya hay un aviso por el
      // estado propio. Lo que NO se hace es vaciar la lista, que se leeria como
      // "nadie del equipo tiene Gmail conectado".
      .catch(() => {})
  }

  useEffect(() => {
    reloadStatus()
    reloadTeam()
  }, [])


  const syncPersonal = async () => {
    setSyncing(true)
    setSyncResultMsg(null)
    try {
      const result = await data.syncGmail()
      const now = new Date().toISOString()
      setLastPersonal(now)
      try { localStorage.setItem(LS_P, now) } catch {}
      const synced = result?.synced ?? 0
      const total = result?.total ?? 0
      // Emails analizados con Claude que luego no se pudieron guardar. Contarlos
      // como sincronización correcta es lo que hacía que "0 nuevos de 20
      // revisados" pareciera un buzón sin novedades en vez de una escritura rota
      // —y el cron los vuelve a analizar, pagando otra vez, a la hora siguiente.
      const fallos = result?.insertFailures ?? 0
      const detail = fallos > 0
        ? `${total} revisados, ${fallos} sin guardar`
        : `${synced} nuevos de ${total} revisados`
      addLog('Gmail Personal', fallos === 0, detail)
      setSyncResultMsg({
        ok: fallos === 0,
        text: fallos > 0 ? `${fallos} no se pudieron guardar` : plural(synced, 'email nuevo', 'emails nuevos'),
        account: 'personal',
      })
      showToast(`Gmail Personal — ${detail}`)
      return fallos === 0
    } catch (err: any) {
      // `auth_rota` ademas de `token_expired`: Google devuelve `unauthorized_client`
      // para una conexion muerta y eso caia como «Error de conexion» generico, que
      // suena a fallo de red pasajero. La accion que hay que hacer es la misma —
      // reconectar— y decirlo es la diferencia entre arreglarlo y esperar.
      const hayQueReconectar = ['token_expired', 'auth_rota']
        .some(c => err?.error === c || err?.message?.includes(c))
      const msg = hayQueReconectar ? 'Conexión caducada — reconecta tu cuenta'
        : err?.message?.includes('Gmail no conectado') ? 'Cuenta no conectada' : 'Error de conexión'
      const isExpired = hayQueReconectar
      addLog('Gmail Personal', false, msg)
      setSyncResultMsg({ok:false, text:msg, account:'personal'})
      showToast(isExpired ? 'Token de Gmail caducado — reconecta desde aquí' : 'Error al sincronizar Gmail')
      if (isExpired) reloadStatus()
      // Devuelve si funcionó. syncAll usaba Promise.allSettled, pero esta función
      // captura su propio error y no lo relanza: allSettled la veía SIEMPRE como
      // cumplida y contaba los fallos como éxitos. El registro decía "2/2 OK" con
      // las dos cuentas caídas, que es justo lo contrario de lo que hace falta.
      return false
    } finally { setSyncing(false) }
  }

  const syncColabs = async () => {
    setSyncingColabs(true)
    setSyncResultMsg(null)
    try {
      const res = await fetch('/api/gmail/colabs-sync', { method: 'POST' })
      const result = await res.json()
      if (res.ok && result.saltado) {
        // El cerrojo lo tiene otra instancia: el buzon SE ESTA sincronizando. No se
        // toca `lastColabs` —no ha pasado nada aqui— y no se dice "0 nuevos", que se
        // leeria como que no habia correo.
        setSyncResultMsg({ok:true, text:'Ya se estaba sincronizando', account:'colabs'})
        showToast('Colaboraciones — ya se estaba sincronizando, los mensajes llegan solos')
        await data.reloadInbox?.()
        return true
      }
      if (res.ok) {
        const now = new Date().toISOString()
        setLastColabs(now)
        try { localStorage.setItem(LS_C, now) } catch {}
        const synced = result.synced ?? 0
        const total = result.total ?? 0
        // `insertFailures` — el camino personal lo mira cincuenta lineas mas arriba
        // y este lo tiraba. El gemelo exacto que avisa CLAUDE.md: el mismo arreglo
        // escrito una vez y vivo el otro lado.
        //
        // Sin esto, veinte correos analizados con Claude y NINGUNO guardado se
        // anuncian como «0 nuevos de 20 revisados» en VERDE. Se lee igual que «no
        // habia correo nuevo», que es justo lo que se mira cuando alguien dice que
        // no le llegan los correos — y encima el registro senala en rojo el buzon
        // personal y en verde el compartido, mandando el diagnostico al reves.
        const fallos = result.insertFailures ?? 0
        const detail = fallos > 0
          ? `${total} revisados, ${fallos} sin guardar · equipo`
          : `${synced} nuevos de ${total} revisados · equipo`
        addLog('Gmail Colaboraciones', fallos === 0, detail)
        setSyncResultMsg({
          ok: fallos === 0,
          text: fallos > 0 ? `${fallos} no se pudieron guardar` : `${synced} email${synced!==1?'s':''} compartido${synced!==1?'s':''}`,
          account: 'colabs',
        })
        showToast(`Colaboraciones — ${detail}`)
        // Se refresca igual y `lastColabs` se mueve igual: el sync SI corrio y parte
        // entro. No hacerlo seria mentir en el otro sentido.
        await data.reloadInbox?.()
        return fallos === 0
      } else {
        const isExpired = result.error === 'token_expired' || result.error === 'auth_rota'
        const errMsg = isExpired ? 'Conexión caducada — reconecta la cuenta' : (result.error || 'Error del servidor')
        addLog('Gmail Colaboraciones', false, errMsg)
        setSyncResultMsg({ok:false, text:errMsg, account:'colabs'})
        showToast(isExpired ? 'Token de Gmail Colabs caducado — reconecta desde aquí' : 'Error al sincronizar colaboraciones')
        if (isExpired) reloadStatus()
      }
    } catch {
      addLog('Gmail Colaboraciones', false, 'Error de conexión')
      setSyncResultMsg({ok:false, text:'Error de conexión', account:'colabs'})
      showToast('Error al sincronizar')
    } finally { setSyncingColabs(false) }
    return false
  }

  const syncAll = async () => {
    setSyncingAll(true)
    setSyncResultMsg(null)
    const ok1 = gmailStatus?.connected
    const ok2 = gmailStatus?.colabs_connected
    // Se cuenta lo que DEVUELVEN, no si la promesa se cumplió.
    //
    // Antes era Promise.allSettled + filter(status === 'fulfilled'), pero las dos
    // funciones capturan su propio error y no lo relanzan: allSettled las veía
    // siempre como cumplidas y contaba los fallos como éxitos. El registro decía
    // "Personal + Colabs — 2/2 OK" con las dos cuentas caídas, y ese registro es
    // lo único que se mira cuando alguien dice que no le llegan los emails.
    const resultados = await Promise.all([
      ok1 ? syncPersonal() : Promise.resolve(null),
      ok2 ? syncColabs() : Promise.resolve(null),
    ])
    const intentadas = [ok1, ok2].filter(Boolean).length
    const success = resultados.filter(r => r === true).length
    const label = [ok1?'Personal':'',ok2?'Colabs':''].filter(Boolean).join(' + ') || 'nada conectado'
    addLog('Sync All', intentadas > 0 && success === intentadas, `${label} — ${success}/${intentadas} OK`)
    setSyncingAll(false)
  }

  const disconnect = async (account: 'personal'|'colabs') => {
    setDisconnecting(account)
    try {
      // `fetch` no lanza con 4xx/5xx, solo si se cae la red. Sin mirar r.ok se
      // anunciaba "desconectado" pasara lo que pasara, y como reloadStatus()
      // repinta la tarjeta con lo que dice el servidor, quedaba conectada justo
      // debajo del mensaje que decía lo contrario.
      const r = await fetch('/api/gmail/disconnect', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({account}) })
      if (!r.ok) {
        const e = await r.json().catch(()=>({}))
        addLog('Desconectar', false, e.error || `HTTP ${r.status}`)
        showToast(e.error || 'No se pudo desconectar')
        return
      }
      addLog('Desconectar', true, account === 'colabs' ? 'Colaboraciones' : 'Personal')
      showToast(account === 'colabs' ? 'Gmail Colaboraciones desconectado' : 'Gmail Personal desconectado')
      reloadStatus()
      reloadTeam()
    } catch { showToast('Error al desconectar') }
    finally { setDisconnecting(null) }
  }

  const copyText = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(()=>{ setCopied(label); setTimeout(()=>setCopied(''), 2000) }).catch(()=>{})
    showToast('Copiado al portapapeles')
  }

  const timeAgo = (iso: string|null) => {
    if (!iso) return null
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
    if (diff < 1) return 'ahora mismo'
    if (diff < 60) return `hace ${diff}m`
    if (diff < 1440) return `hace ${Math.floor(diff/60)}h`
    return `hace ${Math.floor(diff/1440)}d`
  }

  const calCount = (data.calendarEvents||[]).length
  const waCount  = (data.inbox||[]).filter((m:any)=>m.source==='whatsapp').length
  const personalEmails = (data.inbox||[]).filter((m:any)=>m.source==='gmail'&&!m.shared).length
  const colabsEmails   = (data.inbox||[]).filter((m:any)=>m.source==='gmail'&&m.shared).length
  const unreadTotal    = (data.inbox||[]).filter((m:any)=>!m.is_read).length
  const urgentTotal    = (data.inbox||[]).filter((m:any)=>!m.is_read&&m.ai_urgency==='urgent').length
  const unreadPersonal = (data.inbox||[]).filter((m:any)=>m.source==='gmail'&&!m.shared&&!m.is_read).length
  const unreadColabs   = (data.inbox||[]).filter((m:any)=>m.source==='gmail'&&m.shared&&!m.is_read).length
  const recentPersonal = (data.inbox||[]).filter((m:any)=>m.source==='gmail'&&!m.shared).slice(0,5)
  const recentColabs   = (data.inbox||[]).filter((m:any)=>m.source==='gmail'&&m.shared).slice(0,5)
  const nextEvents     = ((data.calendarEvents||[]) as any[]).filter((e:any)=>e.start>=todayKey()).slice(0,5)
  const team: any[] = data.team || []
  // Se copia y se pega en el panel de Meta: si aqui pone un dominio viejo, el
  // webhook apunta a donde ya no esta la app y los mensajes se pierden.
  const WEBHOOK_URL = rutaApp('/api/whatsapp')
  const personalOk = !loadingGmail && gmailStatus?.connected
  const personalExpired = !loadingGmail && gmailStatus?.personal_expired
  const colabsOk   = !loadingGmail && gmailStatus?.colabs_connected
  const colabsExpired = !loadingGmail && gmailStatus?.colabs_expired
  const anyConnected = personalOk || colabsOk
  const allConnected = personalOk && colabsOk

  const urgColors: Record<string,string> = {urgent:RED, high:'rgba(255,176,32,0.9)', normal:'rgba(255,255,255,0.35)'}

  const GmailIcon = ({dim=false,size=22}: {dim?:boolean;size?:number}) => (
    <svg viewBox="0 0 24 24" width={size} height={size} style={dim?{opacity:0.35}:{}}>
      <path fill="#EA4335" d="M22.5 12.5c0-.83-.07-1.64-.2-2.42H12v4.59h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.25z"/>
      <path fill="#4285F4" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  )

  const Dot = ({ok, pulse=false}: {ok:boolean; pulse?:boolean}) => (
    <div className={`w-2 h-2 rounded-full flex-shrink-0${pulse&&ok?' animate-pulse':''}`} style={{background:ok?GRN:'rgba(255,255,255,0.12)',boxShadow:ok?`0 0 6px ${GRN}99`:undefined}}/>
  )

  // Desconectar era un icono `log-out` sin texto, del mismo tamaño y pegado a «Sync»
  // y «Reauth», y ejecutaba al primer clic. El de Colaboraciones borra el refresh
  // token de TODOS los perfiles que lo tengan (api/gmail/disconnect), o sea que un
  // dedo torcido deja a los siete sin buzón compartido y sin saber qué han pulsado.
  //
  // Dos pasos, como el resto de la app: el primer clic arma el botón y lo convierte
  // en la frase completa de lo que va a pasar, el segundo ejecuta, y hay una X para
  // salir. Va separado del par Sync/Reauth por un divisor para que no se pulse de
  // paso, y siempre con etiqueta de texto.
  const BotonDesconectar = ({account, aviso}: {account:'personal'|'colabs'; aviso:string}) => (
    <span className="flex items-center gap-2 flex-shrink-0">
      <span className="w-px h-5 flex-shrink-0" style={{background:BORDER}}/>
      {confirmDisconnect === account ? (
        <>
          <button onClick={()=>{ setConfirmDisconnect(null); disconnect(account) }} disabled={disconnecting===account}
            className="px-3 py-2 rounded-xl font-syne text-[8px] font-black tracking-wide transition-all disabled:opacity-40 hover:opacity-80"
            style={{background:`${RED}15`,color:RED,border:`1px solid ${RED}30`}}>
            {disconnecting===account ? 'DESCONECTANDO…' : aviso}
          </button>
          <button onClick={()=>setConfirmDisconnect(null)} aria-label="Cancelar"
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors hover:bg-white/5 flex-shrink-0">
            <LucideIcon name="x" size={11} color="rgba(255,255,255,0.3)"/>
          </button>
        </>
      ) : (
        <button onClick={()=>setConfirmDisconnect(account)} disabled={disconnecting===account}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl font-syne text-[8px] font-black tracking-wide transition-all disabled:opacity-40 hover:opacity-80"
          style={{background:`${RED}0A`,color:`${RED}80`,border:`1px solid ${RED}20`}}>
          <LucideIcon name="log-out" size={10} color={`${RED}80`}/>DESCONECTAR
        </button>
      )}
    </span>
  )

  return (
    <div className="h-full overflow-y-auto">
      <div className={`${isMobile?'p-4':'p-8'} space-y-6`} style={{maxWidth:'760px',margin:'0 auto'}}>

        {/* ── LATIDO DE LO AUTOMÁTICO ──────────────────────────────────────
            Va ARRIBA del todo y antes que el estado de las cuentas: si los
            procesos no corren, da igual que Gmail esté conectado. */}
        {(latidoRoto || (latidos && latidos.length > 0)) && (() => {
          const alarma = latidos?.filter(p => p.retrasado || p.ok === false) || []
          const mal = latidoRoto || alarma.length > 0
          const NOMBRES: Record<string, string> = { 'sync-colabs': 'Entrada de correo', copia: 'Copia de seguridad' }
          const hace = (m: number | null) =>
            m == null ? 'nunca' : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} d`
          return (
            <div className="rounded-2xl p-4" style={{
              background: mal ? 'rgba(240,67,81,0.06)' : 'rgba(255,255,255,0.02)',
              border: `1px solid ${mal ? 'rgba(240,67,81,0.28)' : BORDER}`,
            }}>
              <div className="font-syne text-[8px] font-black tracking-[0.2em] mb-2.5" style={{ color: mal ? RED : 'rgba(255,255,255,0.25)' }}>
                {mal ? 'ALGO AUTOMÁTICO NO ESTÁ CORRIENDO' : 'TODO LO AUTOMÁTICO, AL DÍA'}
              </div>
              {latidoRoto ? (
                <div className="font-figtree text-[12.5px]" style={{ color: 'rgba(255,255,255,0.5)' }}>
                  No se ha podido comprobar. No significa que esté parado — significa que no lo sabemos.
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {latidos!.map(p => (
                    <div key={p.tarea} className="flex items-baseline gap-2.5 flex-wrap">
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{
                        background: p.minutosDesde == null ? 'rgba(255,255,255,0.2)' : p.retrasado || p.ok === false ? RED : GRN,
                      }}/>
                      <span className="font-figtree text-[12.5px]" style={{ color: 'rgba(255,255,255,0.75)' }}>
                        {NOMBRES[p.tarea] || p.tarea}
                      </span>
                      <span className="font-figtree text-[12px]" style={{ color: p.retrasado ? RED : 'rgba(255,255,255,0.4)' }}>
                        {p.minutosDesde == null ? 'todavía no ha corrido' : hace(p.minutosDesde)}
                        {p.ok === false ? ' · falló' : ''}
                      </span>
                      {p.detalle && !p.retrasado && p.ok !== false && (
                        <span className="font-figtree text-[11.5px]" style={{ color: 'rgba(255,255,255,0.28)' }}>{p.detalle}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })()}

        {/* ── HERO PANEL ── */}
        <div className="relative rounded-3xl overflow-hidden" style={{background:allConnected?'rgba(34,197,94,0.05)':anyConnected?'rgba(27,95,250,0.06)':'rgba(255,255,255,0.03)',border:`1px solid ${allConnected?'rgba(34,197,94,0.2)':anyConnected?'rgba(27,95,250,0.18)':BORDER}`}}>
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[500px] h-[120px] opacity-20 pointer-events-none" style={{background:`radial-gradient(ellipse,${allConnected?GRN:BLU} 0%,transparent 70%)`,filter:'blur(40px)'}}/>

          <div className="relative p-6">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              {/* Left: icon + text */}
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0" style={{background:allConnected?`${GRN}12`:anyConnected?`${BLU}10`:'rgba(255,255,255,0.04)',border:`1px solid ${allConnected?GRN+'25':anyConnected?BLU+'20':BORDER}`}}>
                  <LucideIcon name={allConnected?'shield-check':anyConnected?'shield':'shield-off'} size={24} color={allConnected?GRN:anyConnected?BLU:'rgba(255,255,255,0.2)'}/>
                </div>
                <div>
                  <div className="font-syne text-[8px] font-black tracking-widest mb-1" style={{color:'rgba(255,255,255,0.2)'}}>TU CONEXIÓN PERSONAL</div>
                  <div className="font-figtree text-[20px] font-black text-white leading-tight mb-1" style={{letterSpacing:'-0.02em'}}>
                    {loadingGmail
                      ? <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full animate-pulse" style={{background:`${BLU}80`}}/><span className="w-2 h-2 rounded-full animate-pulse" style={{background:`${BLU}50`,animationDelay:'0.15s'}}/><span className="w-2 h-2 rounded-full animate-pulse" style={{background:`${BLU}30`,animationDelay:'0.3s'}}/></span>
                      : allConnected ? `${profile?.name || 'Tú'} — todo conectado`
                      : anyConnected ? 'Conexión parcial'
                      : 'Sin conectar aún'}
                  </div>
                  <div className="font-syne text-[9px] tracking-wide" style={{color:'rgba(255,255,255,0.3)'}}>
                    {allConnected
                      ? `${personalEmails} personales · ${colabsEmails} colabs · ${plural(calCount,'evento')}`
                      : anyConnected ? 'Conecta las cuentas restantes para activar todas las funciones'
                      : 'Cada miembro del equipo conecta su propio Gmail y Calendar'}
                  </div>
                  {/* Status dots row */}
                  <div className="flex items-center gap-3 mt-2">
                    {[
                      {l:'Mi Gmail', ok:personalOk},
                      {l:'Colabs BS', ok:colabsOk},
                      {l:'Mi Calendar', ok:personalOk && !data.calendarScopeError},
                    ].map((s,i)=>(
                      <div key={i} className="flex items-center gap-1.5">
                        <Dot ok={s.ok}/>
                        <span className="font-syne text-[7.5px]" style={{color:s.ok?'rgba(255,255,255,0.45)':'rgba(255,255,255,0.2)'}}>{s.l}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Right: sync all button */}
              <div className="flex flex-col items-end gap-3 flex-shrink-0">
                <button
                  onClick={syncAll}
                  disabled={syncingAll||!anyConnected||syncing||syncingColabs}
                  className="flex items-center gap-2 px-5 py-3 rounded-2xl font-syne text-[9.5px] font-black tracking-widest text-white transition-all hover:opacity-85 active:scale-95 disabled:opacity-30"
                  style={{background:`linear-gradient(135deg,${BLU},#1440CC)`,boxShadow:`0 4px 20px ${BLU}35`}}>
                  <LucideIcon name={syncingAll?'loader':'refresh-cw'} size={13} color="white"/>
                  {syncingAll?'SINCRONIZANDO…':'SYNC AHORA'}
                </button>
                {(lastPersonal || lastColabs) && (
                  <div className="flex flex-col items-end gap-0.5">
                    {lastPersonal && <span className="font-syne text-[7px]" style={{color:'rgba(255,255,255,0.18)'}}>Personal sync {timeAgo(lastPersonal)}</span>}
                    {lastColabs  && <span className="font-syne text-[7px]" style={{color:'rgba(255,255,255,0.15)'}}>Colabs sync {timeAgo(lastColabs)}</span>}
                  </div>
                )}
              </div>
            </div>

            {/* Sync progress bar */}
            {syncingAll && (
              <div className="relative mt-4 rounded-full overflow-hidden" style={{height:'2px',background:'rgba(255,255,255,0.06)'}}>
                <div className="absolute top-0 h-full animate-scanLine" style={{width:'30%',background:`linear-gradient(90deg,transparent,${BLU},transparent)`,borderRadius:'9999px'}}/>
              </div>
            )}

          {/* Quick stats bar */}
            {anyConnected && (
              <div className="grid grid-cols-5 gap-2 mt-5">
                {/* Un solo tratamiento para los cinco. Antes cada caja llevaba su
                    propio tinte —rojo, ámbar, violeta, verde— y con eso en pantalla
                    ningún número destacaba sobre los demás: cinco cosas gritando
                    equivalen a ninguna. El color se reserva para lo que SIGNIFICA
                    algo, que aquí es solo tener urgentes sin ver. */}
                {[
                  {v:personalEmails+colabsEmails, l:'Emails'},
                  {v:unreadTotal, l:'Sin leer'},
                  {v:urgentTotal, l:'Urgentes', alerta:urgentTotal>0},
                  {v:calCount, l:'Eventos'},
                  {v:waCount, l:'WhatsApp'},
                ].map((s,i)=>(
                  <div key={i} className="rounded-2xl px-3 py-3 text-center"
                    style={{background:s.alerta?`${RED}0F`:'rgba(255,255,255,0.03)',border:`1px solid ${s.alerta?RED+'2A':'rgba(255,255,255,0.05)'}`}}>
                    <div className={`font-figtree font-black leading-none mb-1 ${isMobile?'text-[16px]':'text-[20px]'}`}
                      style={{color:s.alerta?RED:s.v?'rgba(255,255,255,0.92)':'rgba(255,255,255,0.22)'}}>{s.v}</div>
                    <div className="font-syne text-[6.5px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.28)'}}>{s.l.toUpperCase()}</div>
                  </div>
                ))}
              </div>
            )}
            {/* Inline sync result */}
            {syncResultMsg && (
              <div className="mt-3 flex items-center gap-2 px-4 py-2.5 rounded-xl" style={{background:syncResultMsg.ok?`${GRN}08`:`${RED}08`,border:`1px solid ${syncResultMsg.ok?GRN+'18':RED+'18'}`}}>
                <LucideIcon name={syncResultMsg.ok?'check-circle':'alert-circle'} size={12} color={syncResultMsg.ok?GRN:RED}/>
                <span className="font-syne text-[8.5px] font-black" style={{color:syncResultMsg.ok?GRN:RED}}>
                  {syncResultMsg.account==='personal'?'Gmail Personal':'Gmail Colaboraciones'}: {syncResultMsg.text}
                </span>
                <button onClick={()=>setSyncResultMsg(null)} className="ml-auto opacity-40 hover:opacity-70 transition-opacity">
                  <LucideIcon name="x" size={10} color={syncResultMsg.ok?GRN:RED}/>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── EMAIL ── */}
        <AjGroup label="EMAIL">
          <div className="space-y-3">

            {/* Gmail Personal */}
            <div className="rounded-2xl overflow-hidden" style={{background:SURFACE, border:`1px solid ${personalOk?'rgba(234,67,53,0.22)':BORDER}`, boxShadow:personalOk?'0 0 0 1px rgba(234,67,53,0.06)':undefined}}>
              <div className="flex items-center gap-4 p-5 flex-wrap">
                <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{background:'rgba(234,67,53,0.08)',border:'1px solid rgba(234,67,53,0.15)'}}>
                  <GmailIcon dim={!personalOk}/>
                </div>
                <div className="flex-1 min-w-0" style={isMobile?{flexBasis:'calc(100% - 60px)'}:undefined}>
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <span className="font-figtree text-[14px] font-bold text-white">Gmail Personal</span>
                    {!loadingGmail && (
                      <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full" style={{background:personalOk?`${GRN}10`:'rgba(255,255,255,0.04)',border:`1px solid ${personalOk?GRN+'25':'rgba(255,255,255,0.08)'}`}}>
                        <Dot ok={personalOk}/>
                        <span className="font-syne text-[7.5px] font-black" style={{color:personalOk?GRN:'rgba(255,255,255,0.3)'}}>{personalOk?'CONECTADO':'SIN CONECTAR'}</span>
                      </div>
                    )}
                    {loadingGmail && <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{background:'rgba(255,255,255,0.15)'}}/><span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{background:'rgba(255,255,255,0.1)',animationDelay:'0.2s'}}/></span>}
                  </div>
                  <div className="font-syne text-[9px] tracking-wide" style={{color:'rgba(255,255,255,0.3)'}}>
                    {personalOk ? (gmailStatus.gmail_account || 'Cuenta conectada') : 'Cuenta no conectada'}
                  </div>
                  {/* Las cuentas conectadas, una por línea.
                  Antes había DOS ranuras fijas —«mi Gmail» y «colaboraciones»— y eso
                  obligaba a que la segunda cuenta de cualquiera fuese la compartida.
                  Los jefes necesitan dos PROPIAS, así que se enseñan como lista: lo
                  que distingue una cuenta de otra es su dirección, no la casilla
                  donde estaba guardada. */}
              {cuentas.filter(c => !c.compartida).length > 0 && (
                <div className="mt-3 rounded-2xl overflow-hidden" style={{ background: SURF2, border: `1px solid ${BORDER}` }}>
                  <div className="font-syne text-[7.5px] font-black tracking-[0.18em] px-3.5 pt-3 pb-1.5" style={{ color: 'rgba(255,255,255,0.28)' }}>
                    TUS CUENTAS
                  </div>
                  {cuentas.filter(c => !c.compartida).map(c => (
                    <div key={c.email} className="flex items-center gap-2.5 px-3.5 py-2.5">
                      <LucideIcon name="mail" size={12} color="rgba(255,255,255,0.3)" />
                      <span className="font-figtree text-[12px] truncate flex-1" style={{ color: 'rgba(255,255,255,0.65)' }}>{c.email}</span>
                      <button onClick={() => desconectarCuenta(c.email)}
                        className="font-syne text-[8px] font-black tracking-widest px-2.5 py-1 rounded-lg transition-opacity hover:opacity-70"
                        style={{ color: 'rgba(255,255,255,0.28)', border: `1px solid ${BORDER}` }}>
                        QUITAR
                      </button>
                    </div>
                  ))}
                  <a href="/api/gmail/connect?account=personal"
                    className="flex items-center justify-center gap-2 mx-3.5 mb-3 mt-1 py-2 rounded-xl font-syne text-[8.5px] font-black tracking-widest no-underline transition-opacity hover:opacity-80"
                    style={{ background: 'rgba(255,255,255,0.03)', border: `1px dashed ${BORDER}`, color: 'rgba(255,255,255,0.4)' }}>
                    <LucideIcon name="plus" size={11} color="rgba(255,255,255,0.35)" />
                    CONECTAR OTRA CUENTA
                  </a>
                </div>
              )}
              {personalOk && (
                    <div className="mt-1.5 flex items-center gap-3 flex-wrap">
                      <span className="font-syne text-[8px]" style={{color:'rgba(255,255,255,0.2)'}}>{plural(personalEmails,'email')}</span>
                      {unreadPersonal > 0 && <span className="font-syne text-[7.5px] font-black px-2 py-0.5 rounded-full" style={{background:`${BLU}15`,color:BLU}}>{unreadPersonal} sin leer</span>}
                      <span className="font-syne text-[8px]" style={{color:'rgba(167,139,250,0.4)'}}>{plural(calCount,'evento')}</span>
                      {lastPersonal && <span className="font-syne text-[8px]" style={{color:'rgba(255,255,255,0.15)'}}>sync {timeAgo(lastPersonal)}</span>}
                    </div>
                  )}
                </div>
                {/* flex-wrap: al armarse, «Desconectar» pasa de icono a frase larga y
                    en móvil ya no cabe en la misma línea que Sync y Reauth. */}
                <div className="flex items-center justify-end gap-2 flex-wrap flex-shrink-0" style={isMobile?{flexBasis:'100%'}:undefined}>
                  {personalOk ? (
                    <>
                      <button onClick={syncPersonal} disabled={syncing||syncingAll} className="flex items-center gap-1.5 px-3 py-2 rounded-xl font-syne text-[8.5px] font-black tracking-wide transition-all disabled:opacity-40 hover:opacity-80" style={{background:SURF2,color:syncing?BLU:'rgba(255,255,255,0.4)',border:`1px solid ${BORDER}`}}>
                        <LucideIcon name="refresh-cw" size={11} color={syncing?BLU:'rgba(255,255,255,0.3)'}/>{syncing?'Sync…':'Sync'}
                      </button>
                      <a href="/api/gmail/connect?account=personal" className="flex items-center gap-1.5 px-3 py-2 rounded-xl font-syne text-[8.5px] font-black tracking-wide transition-all hover:opacity-80 no-underline" style={{background:'rgba(255,255,255,0.04)',color:'rgba(255,255,255,0.3)',border:`1px solid ${BORDER}`}}>
                        <LucideIcon name="rotate-ccw" size={10} color="rgba(255,255,255,0.2)"/>Reauth
                      </a>
                      <BotonDesconectar account="personal" aviso="¿DESCONECTAR MI GMAIL PERSONAL?"/>
                    </>
                  ) : (
                    <a href="/api/gmail/connect?account=personal" className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-syne text-[9px] font-black tracking-widest text-white transition-all hover:opacity-80 no-underline" style={{background:'linear-gradient(135deg,#EA4335,#C62828)'}}>
                      <LucideIcon name="link-2" size={12} color="white"/>CONECTAR
                    </a>
                  )}
              </div>
              {/* Uno para los DOS enlaces de arriba —conectar y reauth—, porque la
                  pantalla de Google es la misma en los dos casos. Y «reauth» es
                  justo donde más falta hace: quien reconecta ya conocía la app y
                  el aviso de Google le desconcierta más, no menos. */}
              {!personalOk && <div className="mt-3"><AvisoGoogle compacto/></div>}
              {/* Solo con el buzón conectado: sin correo entrando, la pregunta no
                  significa nada y solo ocupa sitio. */}
              {personalOk && (
                <div className="mt-3 flex items-start gap-3 px-3.5 py-3 rounded-2xl" style={{background:SURF2, border:`1px solid ${BORDER}`}}>
                  <div className="flex-1 min-w-0">
                    <div className="font-figtree text-[12.5px]" style={{color:'rgba(255,255,255,0.72)'}}>
                      Que la IA lea mi correo personal
                    </div>
                    <div className="font-figtree text-[11px] mt-0.5 leading-snug" style={{color:'rgba(255,255,255,0.3)'}}>
                      {analizaCorreo
                        ? 'El asunto y el principio del cuerpo pasan por Claude para el resumen y marcar lo urgente. Nadie más ve tu correo.'
                        : 'Tu correo entra en la Bandeja y se puede buscar, pero no sale a ningún modelo. Sin resumen ni aviso de urgencia.'}
                    </div>
                    {/* Que no parezca que apaga el buzón compartido, que es la
                        confusión natural en esta pantalla. */}
                    <div className="font-figtree text-[10.5px] mt-1" style={{color:'rgba(255,255,255,0.2)'}}>
                      No afecta al buzón de colaboraciones, que es del equipo.
                    </div>
                  </div>
                  <button onClick={()=>cambiarAnalisis(!analizaCorreo)} disabled={guardandoAnalisis}
                    aria-pressed={analizaCorreo} aria-label="Que la IA lea mi correo personal"
                    className="flex-shrink-0 rounded-full transition-all disabled:opacity-40"
                    style={{width:38, height:22, padding:2, background: analizaCorreo ? BLU : 'rgba(255,255,255,0.1)', border:`1px solid ${analizaCorreo ? BLU : BORDER}`}}>
                    <div className="rounded-full transition-all" style={{width:16, height:16, background:'#FFFFFF', transform:`translateX(${analizaCorreo ? 16 : 0}px)`}}/>
                  </button>
                </div>
              )}
              {/* Ver o no el buzón del equipo. Va aquí y no en Ajustes porque es la
                  pantalla donde se entiende: al lado está el propio buzón compartido.
                  No lo desconecta ni deja de sincronizarlo — solo deja de salir en
                  TU Bandeja y en TU Harvey. */}
              <div className="mt-3 flex items-start gap-3 px-3.5 py-3 rounded-2xl" style={{background:SURF2, border:`1px solid ${BORDER}`}}>
                <div className="flex-1 min-w-0">
                  <div className="font-figtree text-[12.5px]" style={{color:'rgba(255,255,255,0.72)'}}>
                    Ver el buzón de colaboraciones
                  </div>
                  <div className="font-figtree text-[11px] mt-0.5 leading-snug" style={{color:'rgba(255,255,255,0.3)'}}>
                    {veColabs
                      ? 'El correo del equipo sale en tu Bandeja y Harvey lo tiene en cuenta.'
                      : 'Solo verás tu correo. El buzón del equipo se sigue sincronizando para los demás.'}
                  </div>
                </div>
                <button onClick={()=>cambiarVerColabs(!veColabs)}
                  aria-pressed={veColabs} aria-label="Ver el buzón de colaboraciones"
                  className="flex-shrink-0 rounded-full transition-all"
                  style={{width:38, height:22, padding:2, background: veColabs ? BLU : 'rgba(255,255,255,0.1)', border:`1px solid ${veColabs ? BLU : BORDER}`}}>
                  <div className="rounded-full transition-all" style={{width:16, height:16, background:'#FFFFFF', transform:`translateX(${veColabs ? 16 : 0}px)`}}/>
                </button>
              </div>
            </div>
            {/* Token expired warning */}
            {personalExpired && (
              <div className="border-t px-5 py-4" style={{borderColor:BORDER}}>
                <div className="rounded-2xl p-4" style={{background:`${RED}06`,border:`1px solid ${RED}18`}}>
                  <div className="flex items-start gap-3">
                    <LucideIcon name="alert-triangle" size={14} color={RED}/>
                    <div className="flex-1">
                      <div className="font-syne text-[8.5px] font-black mb-1" style={{color:RED}}>TOKEN CADUCADO</div>
                      <p className="font-syne text-[8px] leading-relaxed mb-3" style={{color:'rgba(255,255,255,0.4)'}}>
                        Tu token de Gmail Personal ha caducado. Esto ocurre cada 7 días mientras la app esté en modo de prueba de Google. Reconecta para seguir sincronizando.
                      </p>
                      <a href="/api/gmail/connect?account=personal"
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl font-syne text-[8.5px] font-black tracking-wide no-underline transition-all hover:opacity-80"
                        style={{background:`${RED}15`,color:RED,border:`1px solid ${RED}25`}}>
                        <LucideIcon name="rotate-ccw" size={11} color={RED}/>
                        RECONECTAR GMAIL PERSONAL
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {/* Recent personal emails preview */}
            {personalOk && recentPersonal.length > 0 && (
              <div className="border-t" style={{borderColor:BORDER}}>
                <div className="px-4 py-1.5 flex items-center gap-1.5">
                  <LucideIcon name="inbox" size={9} color="rgba(255,255,255,0.18)"/>
                  <span className="font-syne text-[7px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.18)'}}>ÚLTIMOS EMAILS PERSONALES</span>
                  <span className="ml-auto font-syne text-[7px]" style={{color:'rgba(255,255,255,0.12)'}}>{personalEmails} total</span>
                </div>
                {recentPersonal.map((m:any,i:number)=>(
                  <div key={i} className="flex items-start gap-3 px-4 py-2.5" style={{borderTop:`1px solid ${BORDER}`,background:!m.is_read?'rgba(27,95,250,0.02)':'transparent'}}>
                    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-[5px]" style={{background:m.is_read?'rgba(255,255,255,0.08)':urgColors[m.ai_urgency]||RED,boxShadow:!m.is_read?`0 0 4px ${urgColors[m.ai_urgency]||RED}80`:undefined}}/>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-syne text-[8.5px] font-black truncate" style={{color:m.is_read?'rgba(255,255,255,0.45)':'rgba(255,255,255,0.7)'}}>{m.from_name||'?'}</span>
                        <span className="font-syne text-[8px] truncate flex-1" style={{color:'rgba(255,255,255,0.25)'}}>{m.subject||'Sin asunto'}</span>
                        {!m.is_read && <span className="font-syne text-[6.5px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0" style={{background:`${BLU}20`,color:BLU}}>NUEVO</span>}
                        {!m.is_read && m.ai_urgency==='urgent' && <span className="font-syne text-[6.5px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0" style={{background:`${RED}15`,color:RED}}>URGENTE</span>}
                      </div>
                      {m.ai_summary && <div className="font-syne text-[7.5px] truncate mt-0.5" style={{color:'rgba(255,255,255,0.18)'}}>{m.ai_summary}</div>}
                      {m.ai_action && m.ai_action!=='Ninguna acción requerida' && (
                        <div className="font-syne text-[7px] truncate mt-0.5 flex items-center gap-1" style={{color:'rgba(255,176,32,0.5)'}}>
                          <LucideIcon name="arrow-right" size={8} color="rgba(255,176,32,0.5)"/>{m.ai_action}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Gmail Colaboraciones */}
          <div className="rounded-2xl overflow-hidden" style={{background:SURFACE, border:`1px solid ${colabsOk?'rgba(234,67,53,0.22)':BORDER}`, boxShadow:colabsOk?'0 0 0 1px rgba(234,67,53,0.06)':undefined}}>
            <div className="flex items-center gap-4 p-5 flex-wrap">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 relative" style={{background:'rgba(234,67,53,0.08)',border:'1px solid rgba(234,67,53,0.15)'}}>
                <GmailIcon dim={!colabsOk}/>
                <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
                  <span className="font-syne text-[6.5px] font-black" style={{color:'rgba(255,255,255,0.4)'}}>BS</span>
                </div>
              </div>
              <div className="flex-1 min-w-0" style={isMobile?{flexBasis:'calc(100% - 60px)'}:undefined}>
                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                  <span className="font-figtree text-[14px] font-bold text-white">Gmail Colaboraciones</span>
                  {!loadingGmail && (
                    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full" style={{background:colabsOk?`${GRN}10`:'rgba(255,255,255,0.04)',border:`1px solid ${colabsOk?GRN+'25':'rgba(255,255,255,0.08)'}`}}>
                      <Dot ok={colabsOk}/>
                      <span className="font-syne text-[7.5px] font-black" style={{color:colabsOk?GRN:'rgba(255,255,255,0.3)'}}>{colabsOk?'CONECTADO':'SIN CONECTAR'}</span>
                    </div>
                  )}
                  {loadingGmail && <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{background:'rgba(255,255,255,0.15)'}}/><span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{background:'rgba(255,255,255,0.1)',animationDelay:'0.2s'}}/></span>}
                </div>
                <div className="font-syne text-[9px] tracking-wide" style={{color:'rgba(255,255,255,0.3)'}}>
                  {colabsOk ? (gmailStatus.colabs_account || 'Cuenta compartida conectada') : 'colaboraciones@brutalstudios.es — cuenta compartida'}
                </div>
                {colabsOk && (
                  <div className="mt-1.5 flex items-center gap-3 flex-wrap">
                    <span className="font-syne text-[8px]" style={{color:'rgba(255,255,255,0.2)'}}>{plural(colabsEmails,'email compartido','emails compartidos')}</span>
                    {unreadColabs > 0 && <span className="font-syne text-[7.5px] font-black px-2 py-0.5 rounded-full" style={{background:'rgba(37,211,102,0.12)',color:GRN}}>{unreadColabs} sin leer</span>}
                    <span className="font-syne text-[8px]" style={{color:'rgba(37,211,102,0.4)'}}>Equipo completo</span>
                    {lastColabs && <span className="font-syne text-[8px]" style={{color:'rgba(255,255,255,0.15)'}}>sync {timeAgo(lastColabs)}</span>}
                  </div>
                )}
              </div>
              {/* flex-wrap: al armarse, «Desconectar» pasa de icono a frase larga y
                  en móvil ya no cabe en la misma línea que Sync y Reauth. */}
              <div className="flex items-center justify-end gap-2 flex-wrap flex-shrink-0" style={isMobile?{flexBasis:'100%'}:undefined}>
                {colabsOk ? (
                  <>
                    <button onClick={syncColabs} disabled={syncingColabs||syncingAll} className="flex items-center gap-1.5 px-3 py-2 rounded-xl font-syne text-[8.5px] font-black tracking-wide transition-all disabled:opacity-40 hover:opacity-80" style={{background:SURF2,color:syncingColabs?BLU:'rgba(255,255,255,0.4)',border:`1px solid ${BORDER}`}}>
                      <LucideIcon name="refresh-cw" size={11} color={syncingColabs?BLU:'rgba(255,255,255,0.3)'}/>{syncingColabs?'Sync…':'Sync'}
                    </button>
                    {/* Conectar colabs es cosa del propietario, igual que desconectarlo: el token
                        se guarda en el perfil de quien conecta, asi que apuntar el buzon de la
                        empresa a un Gmail personal cambia lo que leen los siete. La ruta ya
                        devuelve 403; ocultarlo evita que alguien lo pulse y se coma un error. */}
                    {profile?.role === 'owner' && (
                      <a href="/api/gmail/connect?account=colabs" className="flex items-center gap-1.5 px-3 py-2 rounded-xl font-syne text-[8.5px] font-black tracking-wide transition-all hover:opacity-80 no-underline" style={{background:'rgba(255,255,255,0.04)',color:'rgba(255,255,255,0.3)',border:`1px solid ${BORDER}`}}>
                        <LucideIcon name="rotate-ccw" size={10} color="rgba(255,255,255,0.2)"/>Reauth
                      </a>
                    )}
                    {/* Solo el propietario. El buzón compartido es infraestructura
                        de la empresa: desconectarlo deja a los siete sin sincronizar.
                        La ruta ya lo impide con un 403; ocultarlo aquí evita que
                        alguien lo pulse y se coma un error sin saber por qué. */}
                    {profile?.role === 'owner' && <BotonDesconectar account="colabs" aviso="¿DESCONECTAR COLABS PARA TODO EL EQUIPO?"/>}
                  </>
                ) : profile?.role === 'owner' ? (
                  <a href="/api/gmail/connect?account=colabs" className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-syne text-[9px] font-black tracking-widest text-white transition-all hover:opacity-80 no-underline" style={{background:'linear-gradient(135deg,#EA4335,#C62828)'}}>
                    <LucideIcon name="link-2" size={12} color="white"/>CONECTAR
                  </a>
                ) : (
                  <span className="font-syne text-[8.5px] font-black tracking-wide" style={{color:'rgba(255,255,255,0.28)'}}>SIN CONECTAR · lo conecta el propietario</span>
                )}
              </div>
            </div>
            {/* Token expired warning */}
            {colabsExpired && (
              <div className="border-t px-5 py-4" style={{borderColor:BORDER}}>
                <div className="rounded-2xl p-4" style={{background:`${RED}06`,border:`1px solid ${RED}18`}}>
                  <div className="flex items-start gap-3">
                    <LucideIcon name="alert-triangle" size={14} color={RED}/>
                    <div className="flex-1">
                      <div className="font-syne text-[8.5px] font-black mb-1" style={{color:RED}}>TOKEN CADUCADO</div>
                      <p className="font-syne text-[8px] leading-relaxed mb-3" style={{color:'rgba(255,255,255,0.4)'}}>
                        El token de Gmail Colaboraciones ha caducado. Reconecta la cuenta compartida para seguir recibiendo emails del equipo.
                      </p>
                      {profile?.role === 'owner' ? (
                        <a href="/api/gmail/connect?account=colabs"
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl font-syne text-[8.5px] font-black tracking-wide no-underline transition-all hover:opacity-80"
                          style={{background:`${RED}15`,color:RED,border:`1px solid ${RED}25`}}>
                          <LucideIcon name="rotate-ccw" size={11} color={RED}/>
                          RECONECTAR GMAIL COLABS
                        </a>
                      ) : (
                        <p className="font-syne text-[8px]" style={{color:'rgba(255,255,255,0.35)'}}>Avísale al propietario para que la reconecte.</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
            {/* Recent colabs emails preview */}
            {colabsOk && recentColabs.length > 0 && (
              <div className="border-t" style={{borderColor:BORDER}}>
                <div className="px-4 py-1.5 flex items-center gap-1.5">
                  <LucideIcon name="users" size={9} color="rgba(37,211,102,0.35)"/>
                  <span className="font-syne text-[7px] font-black tracking-widest" style={{color:'rgba(37,211,102,0.35)'}}>EMAILS COMPARTIDOS · VISIBLE PARA EL EQUIPO</span>
                  <span className="ml-auto font-syne text-[7px]" style={{color:'rgba(255,255,255,0.12)'}}>{colabsEmails} total</span>
                </div>
                {recentColabs.map((m:any,i:number)=>(
                  <div key={i} className="flex items-start gap-3 px-4 py-2.5" style={{borderTop:`1px solid ${BORDER}`,background:!m.is_read?'rgba(37,211,102,0.02)':'transparent'}}>
                    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-[5px]" style={{background:m.is_read?'rgba(255,255,255,0.08)':urgColors[m.ai_urgency]||RED,boxShadow:!m.is_read?`0 0 4px ${urgColors[m.ai_urgency]||RED}80`:undefined}}/>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-syne text-[8.5px] font-black truncate" style={{color:m.is_read?'rgba(255,255,255,0.45)':'rgba(255,255,255,0.7)'}}>{m.from_name||'?'}</span>
                        <span className="font-syne text-[8px] truncate flex-1" style={{color:'rgba(255,255,255,0.25)'}}>{m.subject||'Sin asunto'}</span>
                        {!m.is_read && <span className="font-syne text-[6.5px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0" style={{background:'rgba(37,211,102,0.12)',color:GRN}}>NUEVO</span>}
                        {!m.is_read && m.ai_urgency==='urgent' && <span className="font-syne text-[6.5px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0" style={{background:`${RED}15`,color:RED}}>URGENTE</span>}
                      </div>
                      {m.ai_summary && <div className="font-syne text-[7.5px] truncate mt-0.5" style={{color:'rgba(255,255,255,0.18)'}}>{m.ai_summary}</div>}
                      {m.ai_action && m.ai_action!=='Ninguna acción requerida' && (
                        <div className="font-syne text-[7px] truncate mt-0.5 flex items-center gap-1" style={{color:'rgba(255,176,32,0.5)'}}>
                          <LucideIcon name="arrow-right" size={8} color="rgba(255,176,32,0.5)"/>{m.ai_action}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </AjGroup>

      {/* ── CALENDARIO ── */}
      <AjGroup label="CALENDARIO" defaultOpen={false}>
        <div className="rounded-2xl overflow-hidden" style={{background:SURFACE,border:`1px solid ${personalOk?'rgba(167,139,250,0.2)':BORDER}`}}>
          <div className="flex items-center gap-4 p-5 flex-wrap">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{background:personalOk?`${BLU}12`:'rgba(255,255,255,0.03)',border:`1px solid ${personalOk?BLU+'2A':BORDER}`}}>
              <svg viewBox="0 0 24 24" width={22} height={22} fill="none" stroke={personalOk?"#A78BFA":"rgba(167,139,250,0.3)"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2.5"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><circle cx="8" cy="15" r="1" fill={personalOk?"#A78BFA":"rgba(167,139,250,0.3)"}/><circle cx="12" cy="15" r="1" fill={personalOk?"#A78BFA":"rgba(167,139,250,0.3)"}/><circle cx="16" cy="15" r="1" fill={personalOk?"#A78BFA":"rgba(167,139,250,0.3)"}/></svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="font-figtree text-[14px] font-bold text-white">Google Calendar</span>
                {(() => {
                  const wrongAccount = personalOk && gmailStatus?.gmail_account && gmailStatus?.colabs_account && gmailStatus.gmail_account === gmailStatus.colabs_account
                  const noScope = data.calendarScopeError
                  const ok = personalOk && !wrongAccount && !noScope
                  return (
                    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full" style={{background:ok?'rgba(167,139,250,0.1)':wrongAccount||noScope?'rgba(255,176,32,0.1)':'rgba(255,255,255,0.04)',border:`1px solid ${ok?'rgba(167,139,250,0.25)':wrongAccount||noScope?'rgba(255,176,32,0.3)':'rgba(255,255,255,0.08)'}`}}>
                      <Dot ok={ok}/>
                      <span className="font-syne text-[7.5px] font-black" style={{color:ok?'rgba(167,139,250,0.9)':wrongAccount||noScope?'rgba(255,176,32,0.9)':'rgba(255,255,255,0.3)'}}>
                        {ok?'ACTIVO':wrongAccount?'CUENTA INCORRECTA':noScope?'SIN PERMISOS':'INACTIVO'}
                      </span>
                    </div>
                  )
                })()}
              </div>
              <div className="font-syne text-[9px] tracking-wide" style={{color:'rgba(255,255,255,0.3)'}}>
                {personalOk ? (gmailStatus.gmail_account ? `Conectado a ${gmailStatus.gmail_account}` : 'Gmail conectado') : 'Se activa al conectar Gmail Personal'}
              </div>
              {personalOk && (
                <div className="mt-1.5 font-syne text-[8px]" style={{color:'rgba(167,139,250,0.5)'}}>{plural(calCount,'evento próximo','eventos próximos')}</div>
              )}
            </div>
            <div className="flex-shrink-0">
              {personalOk ? (
                <button onClick={syncPersonal} disabled={syncing||syncingAll} className="flex items-center gap-1.5 px-3 py-2 rounded-xl font-syne text-[8.5px] font-black transition-all disabled:opacity-40 hover:opacity-80" style={{background:'rgba(167,139,250,0.08)',color:'rgba(167,139,250,0.7)',border:'1px solid rgba(167,139,250,0.15)'}}>
                  <LucideIcon name="refresh-cw" size={11} color="rgba(167,139,250,0.6)"/>{syncing?'Sync…':'Sync'}
                </button>
              ) : (
                <span className="font-syne text-[8px]" style={{color:'rgba(255,255,255,0.18)'}}>Requiere Gmail Personal</span>
              )}
            </div>
          </div>
          {/* Calendar event previews */}
          {personalOk && nextEvents.length > 0 && (
            <div className="border-t" style={{borderColor:BORDER}}>
              <div className="px-4 py-1.5 flex items-center gap-1.5">
                <LucideIcon name="clock" size={9} color="rgba(167,139,250,0.35)"/>
                <span className="font-syne text-[7px] font-black tracking-widest" style={{color:'rgba(167,139,250,0.35)'}}>PRÓXIMOS EVENTOS</span>
              </div>
              {nextEvents.map((e:any,i:number)=>{
                const hasTime = e.start && e.start.includes('T')
                const dateStr = (e.start||'').slice(5,10)
                const timeStr = hasTime ? e.start.slice(11,16) : ''
                const isToday = (e.start||'').slice(0,10) === todayKey()
                return (
                  <div key={i} className="flex items-center gap-3 px-4 py-2.5" style={{borderTop:`1px solid ${BORDER}`}}>
                    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{background:isToday?'rgba(167,139,250,1)':'rgba(167,139,250,0.4)',boxShadow:isToday?'0 0 6px rgba(167,139,250,0.8)':undefined}}/>
                    <div className="flex-shrink-0 text-right" style={{minWidth:'50px'}}>
                      <div className="font-syne text-[8px] font-black" style={{color:isToday?'rgba(167,139,250,0.9)':'rgba(167,139,250,0.5)'}}>{isToday?'HOY':dateStr}</div>
                      {timeStr && <div className="font-syne text-[7px]" style={{color:'rgba(167,139,250,0.35)'}}>{timeStr}</div>}
                    </div>
                    <span className="font-syne text-[8.5px] font-black truncate flex-1" style={{color:isToday?'rgba(255,255,255,0.75)':'rgba(255,255,255,0.5)'}}>{e.title||'Sin título'}</span>
                  </div>
                )
              })}
            </div>
          )}
          {/* Wrong account or no scope warning */}
          {personalOk && (() => {
            const wrongAccount = gmailStatus?.gmail_account && gmailStatus?.colabs_account && gmailStatus.gmail_account === gmailStatus.colabs_account
            const noScope = data.calendarScopeError
            if (!wrongAccount && !noScope) return null
            return (
              <div className="border-t px-5 py-4" style={{borderColor:BORDER}}>
                <div className="rounded-2xl p-4" style={{background:'rgba(255,176,32,0.06)',border:'1px solid rgba(255,176,32,0.2)'}}>
                  <div className="flex items-start gap-3">
                    <LucideIcon name="alert-triangle" size={14} color="rgba(255,176,32,0.9)"/>
                    <div className="flex-1">
                      <div className="font-syne text-[8.5px] font-black mb-1" style={{color:'rgba(255,176,32,0.9)'}}>
                        {wrongAccount ? 'CUENTA INCORRECTA EN EL SLOT PERSONAL' : 'PERMISOS DE CALENDARIO INSUFICIENTES'}
                      </div>
                      <p className="font-syne text-[8px] leading-relaxed mb-3" style={{color:'rgba(255,255,255,0.4)'}}>
                        {wrongAccount
                          ? `El slot de Gmail Personal está autenticado como "${gmailStatus.gmail_account}" (tu cuenta de colaboraciones). Para ver tu Google Calendar personal, reconecta este slot con tu cuenta personal de Google.`
                          : 'El token de Gmail no tiene permiso de escritura en el calendario. Reconecta para activar la creación de eventos desde Harvey.'}
                      </p>
                      <a href="/api/gmail/connect?account=personal"
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl font-syne text-[8.5px] font-black tracking-wide no-underline transition-all hover:opacity-80"
                        style={{background:'rgba(255,176,32,0.15)',color:'rgba(255,176,32,0.9)',border:'1px solid rgba(255,176,32,0.25)'}}>
                        <LucideIcon name="rotate-ccw" size={11} color="rgba(255,176,32,0.9)"/>
                        RECONECTAR GMAIL PERSONAL
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            )
          })()}

          {personalOk && calCount === 0 && !data.calendarScopeError && (
            <div className="px-4 pb-4">
              <div className="rounded-xl px-4 py-3 font-syne text-[8.5px]" style={{background:'rgba(167,139,250,0.05)',border:'1px solid rgba(167,139,250,0.1)',color:'rgba(167,139,250,0.4)'}}>
                Sin eventos próximos en este calendario.
              </div>
            </div>
          )}
        </div>
      </AjGroup>

      {/* ── WHATSAPP ── */}
      <AjGroup label="WHATSAPP BUSINESS" defaultOpen={false}>
        <div className="space-y-3">
          {/* Webhook card */}
          <div className="rounded-2xl p-5" style={{background:'rgba(37,211,102,0.04)',border:'1px solid rgba(37,211,102,0.12)'}}>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0" style={{background:'rgba(37,211,102,0.12)'}}>
                <LucideIcon name="webhook" size={13} color="#25D366"/>
              </div>
              <div className="font-syne text-[8px] font-black tracking-widest" style={{color:'rgba(37,211,102,0.7)'}}>WEBHOOK DE ENTRADA</div>
            </div>
            <div className="nx-kbd-hints flex items-center gap-2 mb-3">
              <div className="flex-1 flex items-center gap-2 px-3 py-2.5 rounded-xl overflow-hidden" style={{background:'rgba(0,0,0,0.25)',border:`1px solid rgba(37,211,102,0.12)`}}>
                <LucideIcon name="link-2" size={10} color="rgba(37,211,102,0.4)"/>
                <code className="font-syne text-[9.5px] flex-1 truncate" style={{color:'rgba(37,211,102,0.75)'}}>{WEBHOOK_URL}</code>
              </div>
              <button onClick={()=>copyText(WEBHOOK_URL,'webhook')} className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl font-syne text-[8px] font-black transition-all hover:opacity-80 flex-shrink-0" style={{background:'rgba(37,211,102,0.1)',color:'rgba(37,211,102,0.8)',border:'1px solid rgba(37,211,102,0.18)'}}>
                <LucideIcon name={copied==='webhook'?'check':'copy'} size={11} color="rgba(37,211,102,0.8)"/>
                {copied==='webhook'?'COPIADO':'COPIAR'}
              </button>
            </div>
            <div className={`grid gap-2 ${isMobile ? 'grid-cols-1' : 'grid-cols-3'}`}>
              {[
                {n:'01', t:'Meta for Developers → WhatsApp → Config'},
                {n:'02', t:'Pega URL y token WHATSAPP_VERIFY_TOKEN'},
                {n:'03', t:'Suscribe a messages · webhook activo'},
              ].map(s=>(
                <div key={s.n} className={`rounded-xl px-3 py-2.5 ${isMobile ? 'flex items-center gap-3' : ''}`} style={{background:'rgba(0,0,0,0.15)',border:'1px solid rgba(37,211,102,0.06)'}}>
                  <div className={`font-figtree font-black flex-shrink-0 ${isMobile ? 'text-[13px]' : 'text-[16px] mb-1'}`} style={{color:'rgba(37,211,102,0.15)'}}>{s.n}</div>
                  <div className="font-syne text-[8.5px] leading-relaxed" style={{color:'rgba(255,255,255,0.3)'}}>{s.t}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Team members WhatsApp status */}
          {(teamMembers.length > 0 ? teamMembers : [{name:profile?.name||'Tú', initials:profile?.initials||'?', avatar_color:profile?.avatar_color||BLU, id:profile?.id}]).map((member:any, i:number) => {
            const isMe = member.id === profile?.id
            const isActive = isMe && waCount > 0
            return (
              <div key={member.id||i} className="flex items-center gap-4 p-4 rounded-2xl" style={{background:SURFACE,border:`1px solid ${isActive?'rgba(37,211,102,0.2)':BORDER}`}}>
                <div className="relative flex-shrink-0">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{background:'rgba(37,211,102,0.06)',border:`1px solid ${isActive?'rgba(37,211,102,0.18)':BORDER}`}}>
                    <svg viewBox="0 0 24 24" width={20} height={20} fill="#25D366" style={{opacity:isActive?1:0.22}}><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                  </div>
                  <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center font-syne text-[8px] font-black" style={{background:(member.avatar_color||BLU)+'20',border:`1px solid ${SURFACE}`,color:member.avatar_color||BLU}}>{member.initials||'?'}</div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-figtree text-[13.5px] font-bold text-white">{member.name||'Miembro'}</span>
                    {isMe && <span className="font-syne text-[6.5px] font-black px-1.5 py-0.5 rounded-full" style={{background:`${BLU}15`,color:BLU}}>TÚ</span>}
                  </div>
                  <div className="font-syne text-[8px]" style={{color:isActive?'rgba(37,211,102,0.5)':'rgba(255,255,255,0.18)'}}>{isActive?plural(waCount,'mensaje recibido','mensajes recibidos'):'Webhook pendiente de configurar'}</div>
                </div>
                <span className="font-syne text-[7.5px] font-black px-2.5 py-1 rounded-full flex-shrink-0" style={{background:isActive?'rgba(37,211,102,0.1)':'rgba(255,255,255,0.04)',color:isActive?'rgba(37,211,102,0.8)':'rgba(255,255,255,0.18)',border:`1px solid ${isActive?'rgba(37,211,102,0.2)':BORDER}`}}>{isActive?'ACTIVO':'PENDIENTE'}</span>
              </div>
            )
          })}
        </div>
      </AjGroup>

      {/* ── EQUIPO ── */}
      {teamMembers.length > 0 && (()=>{
        const connectedP = teamMembers.filter((m:any)=>m.gmail_connected).length
        const connectedC = teamMembers.filter((m:any)=>m.gmail_colabs_connected).length
        const total = teamMembers.length
        const fullPct = Math.round((connectedP + connectedC) / (total * 2) * 100)
        return (
        <AjGroup label="ESTADO DEL EQUIPO" defaultOpen={false} extra={<span className="font-syne text-[7.5px] font-black" style={{color:fullPct===100?GRN:fullPct>50?'rgba(255,176,32,0.7)':'rgba(255,255,255,0.25)'}}>{fullPct}% CONECTADO</span>}>

          {/* Barra de completitud. Los dos tramos son mitades del MISMO total que la
              etiqueta («{fullPct}% CONECTADO»), que se calcula sobre total*2 — una
              conexión personal y una de colabs por persona.

              Antes cada tramo se medía sobre `total` a secas, así que con el equipo
              al completo en personal y a cero en colabs el primer tramo pedía el 100%
              del ancho: la barra salía llena junto a un «50% CONECTADO». Y con las dos
              cuentas conectadas pedían 200%, que el flex repartía encogiéndolos — o
              sea, llena también. La barra decía «todo bien» en los tres casos. */}
          <div className="mb-3 rounded-xl overflow-hidden flex gap-px" style={{height:'4px',background:'rgba(255,255,255,0.05)'}}>
            <div style={{width:`${connectedP/(total*2)*100}%`,background:'rgba(234,67,53,0.7)',transition:'width 0.6s ease'}}/>
            <div style={{width:`${connectedC/(total*2)*100}%`,background:GRN,transition:'width 0.6s ease',opacity:0.85}}/>
          </div>
          <div className="flex items-center gap-4 mb-3">
            <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full" style={{background:'rgba(234,67,53,0.7)'}}/><span className="font-syne text-[7px]" style={{color:'rgba(255,255,255,0.28)'}}>{connectedP}/{total} Gmail Personal</span></div>
            <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full" style={{background:GRN}}/><span className="font-syne text-[7px]" style={{color:'rgba(255,255,255,0.28)'}}>{connectedC}/{total} Gmail Colabs</span></div>
          </div>

          <div className="rounded-2xl overflow-hidden" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
            {/* Header row */}
            <div className="grid px-5 py-2.5" style={{gridTemplateColumns:isMobile?'1fr 84px 84px':'1fr 120px 120px',borderBottom:`1px solid ${BORDER}`}}>
              <span className="font-syne text-[7px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.18)'}}>MIEMBRO</span>
              <span className="font-syne text-[7px] font-black tracking-widest text-center" style={{color:'rgba(234,67,53,0.45)'}}>PERSONAL</span>
              <span className="font-syne text-[7px] font-black tracking-widest text-center" style={{color:'rgba(37,211,102,0.4)'}}>COLABS</span>
            </div>
            {teamMembers.map((m: any, i: number) => {
              const isMe = m.id === profile?.id
              const pOk = !!m.gmail_connected
              const cOk = !!m.gmail_colabs_connected
              const bothOk = pOk && cOk
              return (
                <div key={m.id} className="grid items-center px-5 py-3.5" style={{gridTemplateColumns:isMobile?'1fr 84px 84px':'1fr 120px 120px', borderBottom: i < teamMembers.length - 1 ? `1px solid ${BORDER}` : 'none', background: isMe ? 'rgba(27,95,250,0.03)' : 'transparent'}}>
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <div className="w-8 h-8 rounded-xl flex items-center justify-center font-syne text-[9px] font-black flex-shrink-0" style={{background:(m.avatar_color||BLU)+'22', border:`1px solid ${(m.avatar_color||BLU)}30`, color:m.avatar_color||BLU}}>
                        {m.initials||'?'}
                      </div>
                      <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border" style={{background:bothOk?GRN:pOk||cOk?'rgba(255,176,32,0.9)':'rgba(255,255,255,0.12)',borderColor:SURFACE}}/>
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-syne text-[9px] font-black truncate" style={{color:isMe?'rgba(255,255,255,0.8)':'rgba(255,255,255,0.55)'}}>{m.name}</span>
                        {isMe && <span className="font-syne text-[6.5px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0" style={{background:`${BLU}15`,color:BLU}}>TÚ</span>}
                        {m.role === 'owner' && <span className="font-syne text-[6.5px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0" style={{background:'rgba(255,255,255,0.05)',color:'rgba(255,255,255,0.25)'}}>OWNER</span>}
                      </div>
                      <div className="font-syne text-[7.5px] truncate" style={{color:'rgba(255,255,255,0.2)'}}>{m.email}</div>
                    </div>
                  </div>
                  <div className="flex flex-col items-center gap-0.5">
                    <div className="flex items-center gap-1.5">
                      <Dot ok={pOk}/>
                      <span className="font-syne text-[7.5px] font-black" style={{color:pOk?'rgba(234,67,53,0.7)':'rgba(255,255,255,0.2)'}}>{pOk?'OK':'—'}</span>
                    </div>
                    {pOk && m.gmail_account && <span className="font-syne text-[6.5px] truncate max-w-[100px]" style={{color:'rgba(255,255,255,0.18)'}}>{m.gmail_account.split('@')[0]}</span>}
                  </div>
                  <div className="flex flex-col items-center gap-0.5">
                    <div className="flex items-center gap-1.5">
                      <Dot ok={cOk}/>
                      <span className="font-syne text-[7.5px] font-black" style={{color:cOk?`${GRN}90`:'rgba(255,255,255,0.2)'}}>{cOk?'OK':'—'}</span>
                    </div>
                    {cOk && m.gmail_colabs_account && <span className="font-syne text-[6.5px] truncate max-w-[100px]" style={{color:'rgba(255,255,255,0.18)'}}>{m.gmail_colabs_account.split('@')[0]}</span>}
                  </div>
                </div>
              )
            })}
          </div>
        </AjGroup>
        )
      })()}

      {/* ── ACTIVIDAD ── */}
      {syncLog.length > 0 && (
        <AjGroup label="HISTORIAL DE SYNC" defaultOpen={false} extra={
          <span className="flex items-center gap-2">
            <button onClick={()=>setExpandLog(v=>!v)} className="font-syne text-[7.5px] font-black tracking-wide hover:opacity-70 transition-opacity" style={{color:'rgba(255,255,255,0.2)'}}>
              {expandLog?'MENOS':'VER TODO'}
            </button>
            <button onClick={()=>{ setSyncLog([]); try{localStorage.removeItem(LS_L)}catch{} }} className="font-syne text-[7.5px] font-black tracking-wide hover:opacity-70 transition-opacity" style={{color:'rgba(229,29,42,0.3)'}}>
              LIMPIAR
            </button>
          </span>
        }>
          <div className="rounded-2xl overflow-hidden" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
            {/* Mini stats */}
            <div className="flex items-center gap-0 px-5 py-2.5" style={{borderBottom:`1px solid ${BORDER}`,background:SURF2}}>
              <span className="font-syne text-[7px]" style={{color:'rgba(255,255,255,0.18)'}}>{plural(syncLog.length,'operación','operaciones')}</span>
              <span className="mx-2 font-syne text-[7px]" style={{color:'rgba(255,255,255,0.08)'}}>·</span>
              <span className="font-syne text-[7px]" style={{color:`${GRN}60`}}>{syncLog.filter(e=>e.ok).length} OK</span>
              <span className="mx-2 font-syne text-[7px]" style={{color:'rgba(255,255,255,0.08)'}}>·</span>
              <span className="font-syne text-[7px]" style={{color:`${RED}60`}}>{syncLog.filter(e=>!e.ok).length} errores</span>
            </div>
            {(expandLog ? syncLog : syncLog.slice(0,5)).map((entry,i,arr)=>(
              <div key={i} className="flex items-center gap-3 px-5 py-3" style={{borderBottom: i<arr.length-1?`1px solid ${BORDER}`:'none', background: !entry.ok ? `${RED}04` : 'transparent'}}>
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{background:entry.ok?GRN:RED, boxShadow:entry.ok?`0 0 4px ${GRN}80`:`0 0 4px ${RED}80`}}/>
                <span className="font-syne text-[8px] font-black flex-shrink-0" style={{color:'rgba(255,255,255,0.28)',minWidth:'42px'}}>{entry.time}</span>
                <span className="font-syne text-[8.5px] font-black flex-shrink-0" style={{color:entry.ok?'rgba(255,255,255,0.6)':'rgba(229,29,42,0.6)'}}>{entry.label}</span>
                <span className="font-syne text-[8px] flex-1 truncate" style={{color:'rgba(255,255,255,0.22)'}}>{entry.detail}</span>
                <span className="font-syne text-[7px] font-black flex-shrink-0 px-2 py-0.5 rounded-full" style={{background:entry.ok?`${GRN}10`:`${RED}10`,color:entry.ok?GRN:RED,border:`1px solid ${entry.ok?GRN+'18':RED+'18'}`}}>{entry.ok?'OK':'ERR'}</span>
              </div>
            ))}
          </div>
        </AjGroup>
      )}

    </div>
    </div>
  )
}

export default SincronizacionSection
