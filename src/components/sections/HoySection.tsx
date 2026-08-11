'use client'
import { useState, useEffect, useRef } from 'react'
import { BLU, RED, GRN, BORDER } from '@/components/shared/design-tokens'
import { useIsMobile } from '@/components/shared/hooks'
import { dlDate, todayKey, localDayKey, madridHour, madridDateLabel } from '@/components/shared/helpers'
import { getSharedAudio, playAck, isIOSDevice, matchTeamMember, splitForTTS, stopAllVoices, isSRBroken, markSRBroken } from '@/components/shared/audio'
import LucideIcon from '@/components/shared/LucideIcon'
import type { Task, Project, Client } from '@/types'

export default function HoySection({profile,data,urgentCount,unreadCount,onOpenModal,showToast,isOwner,onNavigate}: any) {
  const isMobile = useIsMobile()
  type OrbMode = 'idle'|'recording'|'thinking'|'speaking'
  const [orbMode, setOrbMode] = useState<OrbMode>('idle')
  const [harveySpoken, setHarveySpoken] = useState('')
  const [harveyReply, setHarveyReply] = useState('')
  const [replayUrl, setReplayUrl] = useState<string|null>(null)
  const replayUrlRef = useRef<string|null>(null)
  const [textQ, setTextQ] = useState('')
  const [pendingAction, setPendingAction] = useState<{type:'tarea'|'evento'|'proyecto'|'cliente'|'pieza';text:string;level?:string;date?:string;time?:string;industry?:string;clientName?:string;platform?:string;contentType?:string;assigneeName?:string;invitees?:string}|null>(null)
  const [confirmingAction, setConfirmingAction] = useState(false)
  const [showTranscript, setShowTranscript] = useState(false)
  const orbModeRef = useRef<OrbMode>('idle')
  orbModeRef.current = orbMode
  const recognitionRef = useRef<any>(null)
  const audioRef = useRef<HTMLAudioElement|null>(null)
  const mediaRecorderRef = useRef<MediaRecorder|null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const recordingTimerRef = useRef<ReturnType<typeof setTimeout>|null>(null)
  const actionCardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (pendingAction && isMobile) actionCardRef.current?.scrollIntoView({behavior:'smooth',block:'center'})
  }, [pendingAction, isMobile])

  // Al terminar, mostramos SIEMPRE el resumen visual (nunca el muro de texto); el texto completo va bajo demanda
  useEffect(() => {
    if (orbMode === 'idle' && harveyReply) setShowTranscript(false)
  }, [orbMode, harveyReply])

  const replyBoxRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (harveyReply && isMobile) setTimeout(() => replyBoxRef.current?.scrollIntoView({behavior:'smooth',block:'nearest'}), 150)
  }, [harveyReply, isMobile])

  const voiceRunRef = useRef(0)
  const aliveRef = useRef(true)
  useEffect(()=>{
    aliveRef.current = true
    return ()=>{
      aliveRef.current = false
      voiceRunRef.current++
      stopAllVoices()
      audioRef.current = null
      if (replayUrlRef.current) { URL.revokeObjectURL(replayUrlRef.current); replayUrlRef.current = null }
      if (mediaRecorderRef.current?.state==='recording') try { mediaRecorderRef.current.stop() } catch {}
      if (recordingTimerRef.current) clearTimeout(recordingTimerRef.current)
      try { recognitionRef.current?.stop() } catch {}
      recognitionRef.current = null
    }
  },[])

  const onOpenModalRef = useRef(onOpenModal)
  onOpenModalRef.current = onOpenModal
  useEffect(()=>{
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'n' && !['INPUT','TEXTAREA'].includes((e.target as HTMLElement).tagName) && !(e.metaKey||e.ctrlKey||e.altKey)) {
        e.preventDefault()
        onOpenModalRef.current('tarea')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const now = new Date()
  // Madrid explícito, no la zona de quien ejecuta: esta sección es la ÚNICA que
  // se renderiza en servidor, y allí getHours() da UTC. Entre las 13:00 y las
  // 15:00 de Madrid el servidor mandaba "Buenos días" y el cliente pintaba
  // "Buenas tardes" → React descartaba el HTML del servidor y re-renderizaba.
  const hour = madridHour()
  const todayStr = todayKey()
  const firstName = profile?.name?.split(' ')?.[0] || 'Jefe'
  const dateStr = madridDateLabel()

  const urgentTasks = data.tasks.filter((t:Task)=>!t.done&&t.level==='urgent')
  const pendingAll = data.tasks.filter((t:Task)=>!t.done).length
  const activeProjectsCount = data.projects.filter((p:Project)=>p.status!=='completado').length
  const activeClients = data.clients.filter((c:Client)=>c.status==='Activo').length
  const pipeline = (data.agenda||[]).filter((a:any)=>a.status!=='publicado').length
  const overdueP = data.projects.filter((p:Project)=>p.deadline&&p.deadline!=='TBD'&&p.status!=='completado'&&dlDate(p.deadline)<new Date()).length
  const completedToday = data.tasks.filter((t:Task)=>t.done&&localDayKey(t.completed_at||t.updated_at||t.created_at)===todayStr).length
  // Refuerzo del resumen ejecutivo: vencen hoy, deadlines de la semana, automatizaciones de hoy
  const weekEnd = new Date(Date.now()+7*86400000)
  const dueTodayTasks = data.tasks.filter((t:Task)=>!t.done&&!!t.due_date&&t.due_date.slice(0,10)===todayStr)
  const upcomingDeadlines = data.projects
    .filter((p:Project)=>p.deadline&&p.deadline!=='TBD'&&p.status!=='completado'&&dlDate(p.deadline)>=new Date()&&dlDate(p.deadline)<=weekEnd)
    .sort((a:Project,b:Project)=>dlDate(a.deadline).getTime()-dlDate(b.deadline).getTime())
  const autosToday = ((data.reglas||[]) as any[]).filter((r:any)=>r.last_triggered_at&&(Date.now()-new Date(r.last_triggered_at).getTime())<86400000)

  const stopAudio = () => {
    voiceRunRef.current++
    stopAllVoices()
    audioRef.current = null
  }
  const speak = async (text: string, prefetch?: { text: string; promise: Promise<Response> }) => {
    if (!text?.trim()) { setOrbMode('idle'); return }
    const run = voiceRunRef.current
    stopAllVoices()
    setOrbMode('speaking')
    try {
      const chunks = splitForTTS(text)
      const requests = chunks.map((c, i) =>
        (i === 0 && prefetch && prefetch.text === c)
          ? prefetch.promise
          : fetch('/api/harvey/speak',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:c}),signal:AbortSignal.timeout(45000)}))
      const audio = getSharedAudio() || new Audio()
      audioRef.current = audio
      const blobs: Blob[] = []
      for (let i = 0; i < requests.length; i++) {
        const res = await requests[i].catch(() => null)
        if (!aliveRef.current || run !== voiceRunRef.current) return
        if (!res?.ok) { if (i === 0) setOrbMode('idle'); break }
        const blob = await res.blob()
        if (!blob.size) { if (i === 0) setOrbMode('idle'); break }
        if (!aliveRef.current || run !== voiceRunRef.current) return
        blobs.push(blob)
        const url = URL.createObjectURL(blob)
        const done = new Promise<void>(resolve => {
          const fin = () => resolve()
          audio.onended = fin; audio.onerror = fin
          audio.onpause = () => {
            if (audio.ended) return
            if (!aliveRef.current || run !== voiceRunRef.current) { fin(); return }
            let tries = 0
            const resume = () => {
              if (!aliveRef.current || run !== voiceRunRef.current || audio.ended) return
              if (!audio.paused) return
              audio.play().catch(() => {
                if (++tries < 4) setTimeout(resume, 80)
                else fin()
              })
            }
            setTimeout(resume, 60)
          }
        })
        audio.src = url
        const played = await audio.play().then(() => true).catch(() => false)
        if (!played) { setOrbMode('idle'); URL.revokeObjectURL(url); return }
        await done
        audio.onpause = null
        URL.revokeObjectURL(url)
        if (!aliveRef.current || run !== voiceRunRef.current) return
      }
      if (blobs.length) {
        const full = URL.createObjectURL(new Blob(blobs, { type: 'audio/mpeg' }))
        setReplayUrl(prev => { if (prev) URL.revokeObjectURL(prev); return full })
        replayUrlRef.current = full
      }
      if (orbModeRef.current === 'speaking') setOrbMode('idle')
    } catch { setOrbMode('idle') }
  }
  const buildCtx = () => {
    const active = (data.projects as Project[]).filter(p=>p.status!=='completado')
    const overdue = (data.projects as Project[]).filter(p=>p.deadline&&p.deadline!=='TBD'&&p.status!=='completado'&&dlDate(p.deadline)<new Date())
    const clients = (data.clients as Client[]).filter(c=>c.status==='Activo')
    const highTasks = data.tasks.filter((t:Task)=>!t.done&&t.level==='high')
    const pip = (data.agenda||[]).filter((a:any)=>a.status!=='publicado')
    const urgentLines = urgentTasks.slice(0,5).map((t:Task)=>`"${t.text}"${t.assignee?.name?' ('+t.assignee.name+')':''}`).join(', ')
    const projLines = active.slice(0,8).map((p:Project)=>`${p.name} ${p.progress}%${overdue.find(o=>o.id===p.id)?' [ATRASADO]':''}`).join(' | ')

    const inboxAll: any[] = data.inbox || []
    // No leídos + urgentes/altos de HOY aunque ya se hayan abierto: leer un email
    // importante no debe borrarlo del contexto de Harvey.
    const todayForInbox = todayKey()
    const unreadEmails = inboxAll.filter((m:any)=>
      !m.is_read || ((m.ai_urgency==='urgent'||m.ai_urgency==='high') && (m.received_at||'').slice(0,10)===todayForInbox)
    ).slice(0, 10)
    const emailLines = unreadEmails.map((m:any) => {
      const urg = m.ai_urgency==='urgent'?'[URGENTE]':m.ai_urgency==='high'?'[ALTA]':'[NORMAL]'
      const colabs = m.shared ? '[COLABS]' : '[PERSONAL]'
      const action = m.ai_action&&m.ai_action!=='Ninguna acción requerida'?` → Acción: ${m.ai_action}`:''
      const summary = m.ai_summary ? ` | Resumen: ${m.ai_summary}` : ''
      return `  • De: ${m.from_name||'?'} | Asunto: "${m.subject||'Sin asunto'}" ${urg}${colabs}${summary}${action}`
    }).join('\n')

    const todayStr = todayKey()
    const calEvents = (data.calendarEvents||[]) as any[]
    const nextEvents = calEvents.filter((e:any)=>e.start>=todayStr).slice(0,5)
    const eventLines = nextEvents.map((e:any) => {
      const hasTime = e.start && e.start.includes('T')
      const timeStr = hasTime ? ` a las ${e.start.slice(11,16)}` : ''
      return `${e.title} (${e.start?.slice(0,10)||'?'}${timeStr})`
    }).join(' · ')

    const memAll = (data.memoria||[]) as any[]
    const memLines = memAll.slice(0,12).map((m:any)=>`  - ${m.title}${m.category?` [${m.category}]`:''}: ${(m.content||'').replace(/\s+/g,' ').slice(0,400)}`).join('\n')

    return `BRUTAL STUDIOS — ${madridDateLabel()}

TAREAS: ${pendingAll} pendientes | ${completedToday} completadas hoy
URGENTES (${urgentTasks.length}): ${urgentLines||'ninguna'}
ALTA PRIORIDAD (${highTasks.length}): ${highTasks.slice(0,3).map((t:Task)=>t.text).join(', ')||'ninguna'}

PROYECTOS ACTIVOS (${active.length}): ${projLines||'ninguno'}
${overdue.length>0?`ATRASADOS (${overdue.length}): ${overdue.map((p:Project)=>p.name).join(', ')}\n`:''}
CLIENTES ACTIVOS (${clients.length}): ${clients.map(c=>c.name).join(', ')||'ninguno'}
EQUIPO: ${((data.team||[]) as any[]).map((m:any)=>m.name).filter(Boolean).join(', ')||'sin datos'}
PIPELINE CONTENIDO: ${pip.length} piezas pendientes

INBOX — ${unreadCount} sin leer (${inboxAll.length} total):
${emailLines||'  Sin emails sin leer'}

CALENDARIO PRÓXIMO: ${eventLines||'sin eventos próximos'}

DOCUMENTOS Y CONOCIMIENTO (memoria — úsalo si es relevante):
${memLines||'  sin documentos'}`
  }
  const askHarvey = async (userMsg: string) => {
    const run = ++voiceRunRef.current
    setOrbMode('thinking')
    setPendingAction(null)
    setHarveyReply('')
    setShowTranscript(false)
    try {
      const res = await fetch('/api/harvey/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:userMsg,context:buildCtx(),stream:true}),signal:AbortSignal.timeout(60000)})
      if (!aliveRef.current || run !== voiceRunRef.current) return
      if (!res.ok) { const j = await res.json().catch(()=>({})); throw new Error(j.error||'Error') }

      let reply = ''
      let prefetch: { text: string; promise: Promise<Response> } | undefined
      const ct = res.headers.get('content-type') || ''
      if (res.body && ct.includes('text/plain')) {
        const reader = res.body.getReader()
        const dec = new TextDecoder()
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (!aliveRef.current || run !== voiceRunRef.current) { try { reader.cancel() } catch {}; return }
          reply += dec.decode(value, { stream: true })
          if (!prefetch && !reply.includes('[ACCION')) {
            const parts = reply.split(/(?<=[.!?…])\s+/)
            const complete = parts.slice(0, -1)
            if (complete.length) {
              let first = complete.shift()!
              while (first.length < 25 && complete.length) first += ' ' + complete.shift()
              if (first.length >= 25) {
                prefetch = { text: first, promise: fetch('/api/harvey/speak',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:first}),signal:AbortSignal.timeout(45000)}) }
              }
            }
          }
        }
      } else {
        const json = await res.json()
        reply = (json.reply as string) || ''
      }
      if (!aliveRef.current || run !== voiceRunRef.current) return
      reply = reply.trim()
      if (!reply) { setOrbMode('idle'); return }

      const actionMatch = reply.match(/\[ACCION:([^\]]+)\]/)
      if (actionMatch) {
        reply = reply.replace(/\[ACCION:[^\]]*\]/g, '').trim()
        const parts = actionMatch[1].split('|')
        const type = parts[0] as 'tarea'|'evento'|'proyecto'|'cliente'|'pieza'
        if (type === 'tarea')    setPendingAction({type:'tarea',    text:parts[1]||'', level:parts[2]||'high', assigneeName:parts[3]?.trim()||''})
        if (type === 'evento')   setPendingAction({type:'evento',   text:parts[1]||'', date:parts[2]||'', time:parts[3]||'', invitees:parts[4]?.trim()||''})
        if (type === 'proyecto') setPendingAction({type:'proyecto', text:parts[1]||'', clientName:parts[2]||'', date:parts[3]||''})
        if (type === 'cliente')  setPendingAction({type:'cliente',  text:parts[1]||'', industry:parts[2]||'—'})
        if (type === 'pieza')    setPendingAction({type:'pieza',    text:parts[1]||'', platform:parts[2]||'Instagram', contentType:parts[3]||'Post'})
      }

      setHarveyReply(reply)
      await speak(reply, prefetch)
    } catch { setOrbMode('idle'); showToast('Error con Harvey') }
  }

  const confirmHarveyAction = async () => {
    if (!pendingAction) return
    setConfirmingAction(true)
    try {
      const colors = ['#1B5FFA','#E51D2A','#22c55e','#F97316','#A78BFA','#F59E0B','#06B6D4','#EC4899']
      const rColor = colors[Math.floor(Math.random()*colors.length)]

      if (pendingAction.type === 'tarea') {
        const member = pendingAction.assigneeName ? matchTeamMember((data.team||[]) as any[], pendingAction.assigneeName) : null
        await data.createTask({ text: pendingAction.text, level: pendingAction.level as any || 'high', source: 'ai', ...(member ? { assigned_to: member.id } : {}) })
        showToast(member ? `Tarea creada y asignada a ${member.name}`
          : pendingAction.assigneeName ? `Tarea creada (sin asignar: no encontré a "${pendingAction.assigneeName}")`
          : 'Tarea creada por Harvey')

      } else if (pendingAction.type === 'proyecto') {
        const client = pendingAction.clientName
          ? (data.clients as any[]).find((c:any)=>c.name.toLowerCase().includes(pendingAction.clientName!.toLowerCase()))
          : null
        await data.createProject({ name: pendingAction.text, client_id: client?.id, status: 'activo', progress: 0, deadline: pendingAction.date||'TBD', color: client?.color||rColor })
        showToast('Proyecto creado por Harvey')

      } else if (pendingAction.type === 'cliente') {
        await data.createClient({ name: pendingAction.text, industry: pendingAction.industry||'—', revenue: '—', color: rColor, status: 'Activo' })
        showToast('Cliente creado por Harvey')

      } else if (pendingAction.type === 'pieza') {
        const client = pendingAction.clientName
          ? (data.clients as any[]).find((c:any)=>c.name.toLowerCase().includes((pendingAction.clientName||'').toLowerCase()))
          : null
        await data.createAgenda({ title: pendingAction.text, platform: pendingAction.platform||'Instagram', content_type: pendingAction.contentType||'Post', status: 'borrador', publish_date: pendingAction.date||undefined, client_id: client?.id })
        showToast('Pieza añadida al pipeline de contenido')

      } else if (pendingAction.type === 'evento') {
        if (!pendingAction.date) {
          showToast('Harvey no especificó fecha — dile "para el [fecha]" y vuelve a intentarlo')
        } else {
          const team = (data.team||[]) as any[]
          const inv = (pendingAction.invitees||'').trim()
          const attendees = !inv ? [] : /^todos?$/i.test(inv)
            ? team.map((m:any)=>m.email).filter((e:string)=>e && e!==profile?.email)
            : inv.split(',').map(s=>matchTeamMember(team, s)).filter(Boolean).map((m:any)=>m.email).filter((e:string)=>e && e!==profile?.email)
          const res = await fetch('/api/calendar/events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: pendingAction.text, date: pendingAction.date, time: pendingAction.time, attendees }),
          })
          const json = await res.json()
          if (res.ok) {
            showToast(attendees.length ? `Reunión creada · invitación enviada a ${attendees.length} persona${attendees.length>1?'s':''}` : 'Evento añadido a Google Calendar')
            await data.reload?.()
          } else if (json.error === 'insufficient_scope') {
            showToast('Re-conecta Gmail en Operativa → Sincronización → Reauth para activar la escritura')
          } else {
            showToast('Error al crear el evento en Google Calendar')
          }
        }
      }
      setPendingAction(null)
    } catch { showToast('Error al ejecutar la acción') }
    finally { setConfirmingAction(false) }
  }

  const transcribeAndAsk = async (blob: Blob) => {
    const run = ++voiceRunRef.current
    setOrbMode('thinking')
    playAck()
    try {
      const fd = new FormData()
      const ext = blob.type.includes('mp4') ? 'mp4' : 'webm'
      fd.append('audio', blob, `r.${ext}`)
      const res = await fetch('/api/harvey/transcribe', { method:'POST', body:fd, signal:AbortSignal.timeout(30000) })
      if (!aliveRef.current || run !== voiceRunRef.current) return
      if (res.ok) {
        const { text } = await res.json()
        if (text?.trim()) { setHarveySpoken(text); await askHarvey(text); return }
      }
      setOrbMode('idle')
      if (res.status === 402) showToast('Transcripción agotada este mes — activa el dictado de iOS en Ajustes → General → Teclado')
      else showToast('No se entendió el audio — vuelve a pulsar')
    } catch { setOrbMode('idle'); showToast('Error al procesar el audio') }
  }

  const stopRecording = () => {
    if (recordingTimerRef.current) { clearTimeout(recordingTimerRef.current); recordingTimerRef.current = null }
    if (recognitionRef.current) {
      const r = recognitionRef.current
      recognitionRef.current = null
      try { r.stop() } catch {}
      setTimeout(() => { if (orbModeRef.current === 'recording') setOrbMode('idle') }, 3000)
    }
    if (mediaRecorderRef.current?.state==='recording') {
      setOrbMode('thinking')
      mediaRecorderRef.current.stop()
    }
  }

  const startBrowserSR = (): boolean => {
    const SR = (window as any).SpeechRecognition||(window as any).webkitSpeechRecognition
    if (!SR) return false
    if (recognitionRef.current) { try { recognitionRef.current.stop() } catch {} }
    recognitionRef.current = null
    const r = new SR()
    r.lang='es-ES'; r.continuous=false; r.interimResults=true
    let gotResult = false
    let finalText = '', interimText = ''
    const fire = (txt: string) => { gotResult = true; setHarveySpoken(txt); askHarvey(txt) }
    r.onstart = ()=>setOrbMode('recording')
    r.onresult = (e:any)=>{
      if (recognitionRef.current !== null && recognitionRef.current !== r) return
      if (gotResult) return
      finalText = ''; interimText = ''
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i]
        if (res.isFinal) finalText += res[0].transcript
        else interimText += res[0].transcript
      }
      if (finalText.trim()) fire(finalText.trim())
    }
    r.onerror = (e:any)=>{
      if (e.error === 'aborted') return
      if (recognitionRef.current !== null && recognitionRef.current !== r) return
      recognitionRef.current = null
      if (gotResult) return
      if (['service-not-allowed','network','audio-capture'].includes(e.error)) {
        markSRBroken()
        startMediaRecording()
        return
      }
      setOrbMode('idle')
      if (e.error==='not-allowed') showToast('Permite el micrófono en el navegador')
      else if (e.error==='no-speech') showToast('No escuché nada — vuelve a pulsar')
      else showToast('No se entendió — vuelve a pulsar')
    }
    r.onend = ()=>{
      if (recognitionRef.current !== null && recognitionRef.current !== r) return
      recognitionRef.current = null
      if (gotResult) return
      const txt = (finalText || interimText).trim()
      if (txt) { fire(txt); return }
      if (orbModeRef.current==='recording') setOrbMode('idle')
    }
    recognitionRef.current = r
    try { r.start(); return true } catch { recognitionRef.current = null; setOrbMode('idle'); return false }
  }

  const startMediaRecording = async () => {
    if (typeof MediaRecorder !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio:true, video:false })
        const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
          : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
        const mr = new MediaRecorder(stream, { mimeType:mime, audioBitsPerSecond:32000 })
        audioChunksRef.current = []
        mr.ondataavailable = (e)=>{ if(e.data.size>0) audioChunksRef.current.push(e.data) }
        mr.onstop = ()=>{
          stream.getTracks().forEach(t=>t.stop())
          if (orbModeRef.current === 'idle') return
          const blob = new Blob(audioChunksRef.current, { type:mime })
          if (blob.size < 800) { setOrbMode('idle'); return }
          transcribeAndAsk(blob)
        }
        mr.start(100)
        mediaRecorderRef.current = mr
        setOrbMode('recording')
        recordingTimerRef.current = setTimeout(stopRecording, 25000)
        return
      } catch(err: any) {
        if (err.name==='NotAllowedError'||err.name==='PermissionDeniedError') {
          showToast('Permite el micrófono en el navegador'); setOrbMode('idle'); return
        }
      }
    }
    showToast('Micrófono no disponible en este navegador'); setOrbMode('idle')
  }

  const startRecording = async () => {
    voiceRunRef.current++
    stopAllVoices()
    if (!isIOSDevice() && !isSRBroken() && startBrowserSR()) return
    await startMediaRecording()
  }

  const handleOrb = () => {
    if (orbMode==='speaking') { voiceRunRef.current++; stopAudio(); setOrbMode('idle') }
    else if (orbMode==='recording') stopRecording()
    else if (orbMode==='idle') startRecording()
    else if (orbMode==='thinking') {
      voiceRunRef.current++
      stopAllVoices()
      if (recognitionRef.current) { try { recognitionRef.current.stop() } catch {}; recognitionRef.current = null }
      if (mediaRecorderRef.current?.state==='recording') try { mediaRecorderRef.current.stop() } catch {}
      setOrbMode('idle')
    }
  }

  const orbColor: Record<OrbMode,string> = {idle:BLU,recording:RED,thinking:'rgba(139,92,246,0.9)',speaking:BLU}
  const orbLabel: Record<OrbMode,string> = {idle:'PULSA',recording:'STOP',thinking:'PIENSA',speaking:'STOP'}
  const rimCol = orbColor[orbMode]
  // Orbe de cristal líquido — 100% CSS (Safari-safe). Colores por estado.
  const _rec = orbMode==='recording', _thk = orbMode==='thinking'
  const orbBase = _rec ? 'radial-gradient(circle at 50% 30%,#24080c 0%,#180509 42%,#0d0305 68%,#060102 100%)'
    : _thk ? 'radial-gradient(circle at 50% 30%,#1a0f34 0%,#120a26 42%,#080512 68%,#020109 100%)'
    : 'radial-gradient(circle at 50% 30%,#0a1130 0%,#070b22 42%,#03050f 68%,#010208 100%)'
  const blob1 = _rec ? '#ff3b2f' : _thk ? '#8b5cff' : '#1e5bff'
  const blob2 = _rec ? '#ff7a3c' : _thk ? '#b06bff' : '#7b3dff'
  const blob3 = _rec ? '#ffb347' : _thk ? '#5f8bff' : '#00c6ff'
  const rimGrad = _rec ? 'radial-gradient(circle,transparent 82%,rgba(255,110,70,0.12) 92%,rgba(255,185,155,0.97) 98.5%,rgba(255,120,80,0.6) 100%)'
    : _thk ? 'radial-gradient(circle,transparent 82%,rgba(150,110,255,0.12) 92%,rgba(200,180,255,0.95) 98.5%,rgba(160,120,255,0.6) 100%)'
    : 'radial-gradient(circle,transparent 82%,rgba(60,120,255,0.12) 92%,rgba(155,198,255,0.95) 98.5%,rgba(150,120,255,0.55) 100%)'
  const rimShadow = _rec ? 'inset 0 0 40px rgba(255,80,50,0.22),inset -14px -18px 56px rgba(255,120,60,0.2)'
    : _thk ? 'inset 0 0 40px rgba(139,92,246,0.22),inset -14px -18px 56px rgba(160,120,255,0.2)'
    : 'inset 0 0 40px rgba(30,90,255,0.22),inset -14px -18px 56px rgba(139,92,246,0.2)'
  const glowC = _rec ? 'rgba(255,90,60,0.32)' : _thk ? 'rgba(150,110,255,0.3)' : 'rgba(40,90,255,0.32)'

  return (
    <div className={isMobile ? 'h-full flex flex-col overflow-y-auto overflow-x-hidden' : 'h-full flex overflow-hidden'} style={{background:'#030308'}}>

      {/* ══ HARVEY ══ */}
      <div className={`flex flex-col relative ${isMobile?'':'flex-1 overflow-hidden'}`} style={isMobile?{minHeight:'78vh',flexShrink:0}:undefined}>
        <div className="absolute inset-0 pointer-events-none" style={{
          background:`radial-gradient(ellipse 70% 80% at 50% 48%,${orbMode==='recording'?'rgba(229,29,42,0.10)':orbMode==='thinking'?'rgba(139,92,246,0.09)':'rgba(27,95,250,0.10)'} 0%,transparent 65%)`,
          transition:'background 0.8s',
        }}/>

        <div className="absolute top-7 z-10" style={{left:isMobile?'20px':'40px'}}>
          <div className="font-syne font-black tracking-[0.45em]" style={{fontSize:'6.5px',color:'rgba(255,255,255,0.1)',marginBottom:'6px'}}>
            {dateStr.toUpperCase()}
          </div>
          <div className="font-figtree" style={{fontSize:'16px',fontWeight:300,color:'rgba(255,255,255,0.3)'}}>
            {hour<13?'Buenos días':hour<20?'Buenas tardes':'Buenas noches'},&nbsp;
            <span style={{fontWeight:600,color:'rgba(255,255,255,0.72)'}}>{firstName}</span>
          </div>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center gap-0" style={isMobile?{paddingTop:'72px'}:undefined}>

          <div className="relative flex items-center justify-center flex-shrink-0" style={{width:isMobile?'300px':'400px',height:isMobile?'300px':'400px'}}>

            {/* Órbitas elípticas */}
            <div className="absolute pointer-events-none" style={{width:isMobile?'320px':'580px',height:isMobile?'200px':'350px',borderRadius:'50%',border:'1px dashed rgba(120,150,255,0.05)',transform:'rotate(-20deg)'}}/>
            <div className="absolute pointer-events-none" style={{width:isMobile?'295px':'540px',height:isMobile?'185px':'325px',borderRadius:'50%',border:'1px solid rgba(120,150,255,0.10)',transform:'rotate(-20deg)',animation:'orbSpin 44s linear infinite'}}>
              <div className="absolute rounded-full" style={{top:'50%',left:0,width:'5px',height:'5px',background:'#5b8bff',boxShadow:'0 0 8px #5b8bff,0 0 18px #5b8bff',transform:'translate(-50%,-50%)'}}/>
            </div>

            {/* Halo exterior */}
            <div className="absolute rounded-full pointer-events-none" style={{
              width:isMobile?'250px':'320px',height:isMobile?'250px':'320px',
              background:`radial-gradient(circle,${rimCol}2e,rgba(139,92,246,0.06) 45%,transparent 70%)`,
              filter:'blur(30px)',transition:'background 0.8s',
              animation: orbMode!=='idle' ? 'haloPulse 2.4s ease-in-out infinite' : undefined,
            }}/>

            {/* Esfera de cristal líquido (botón · 100% CSS, Safari-safe) */}
            <button onClick={handleOrb} aria-label="Hablar con Harvey"
              className="relative rounded-full overflow-hidden transition-transform duration-500 active:scale-95 select-none"
              style={{
                width:isMobile?'260px':'320px',height:isMobile?'260px':'320px',
                background:orbBase,
                boxShadow:`0 30px 80px rgba(0,0,0,0.6), 0 0 70px ${glowC}`,
                transition:'background 0.8s, box-shadow 0.8s',
                isolation:'isolate',
              }}>
              {/* Líquido interior (blobs, blend screen) */}
              <div className="absolute rounded-full pointer-events-none" style={{width:'78%',height:'52%',left:'11%',bottom:'-8%',background:`radial-gradient(circle,${blob1},transparent 68%)`,filter:'blur(30px)',mixBlendMode:'screen',opacity:0.5,animation:'orbDrift 11s ease-in-out infinite',transition:'background 0.8s'}}/>
              <div className="absolute rounded-full pointer-events-none" style={{width:'52%',height:'40%',right:'8%',bottom:'4%',background:`radial-gradient(circle,${blob2},transparent 70%)`,filter:'blur(30px)',mixBlendMode:'screen',opacity:0.5,animation:'orbDrift2 14s ease-in-out infinite',transition:'background 0.8s'}}/>
              <div className="absolute rounded-full pointer-events-none" style={{width:'44%',height:'34%',left:'24%',bottom:'8%',background:`radial-gradient(circle,${blob3},transparent 72%)`,filter:'blur(30px)',mixBlendMode:'screen',opacity:0.55,animation:'orbDrift3 9s ease-in-out infinite',transition:'background 0.8s'}}/>
              {/* Top oscuro (efecto cristal) */}
              <div className="absolute inset-0 rounded-full pointer-events-none" style={{background:'radial-gradient(circle at 50% 26%,rgba(0,0,0,0.62) 0%,rgba(0,0,0,0.35) 34%,transparent 58%)'}}/>
              {/* Brillo especular */}
              <div className="absolute rounded-full pointer-events-none" style={{top:'7%',left:'16%',width:'48%',height:'27%',background:'radial-gradient(circle at 42% 40%,rgba(220,232,255,0.34),rgba(220,232,255,0.05) 52%,transparent 70%)',filter:'blur(4px)'}}/>
              <div className="absolute rounded-full pointer-events-none" style={{bottom:'15%',right:'23%',width:'18%',height:'10%',background:'radial-gradient(circle,rgba(180,205,255,0.35),transparent 70%)',filter:'blur(4px)'}}/>
              {/* Rim brillante */}
              <div className="absolute inset-0 rounded-full pointer-events-none" style={{background:rimGrad,boxShadow:rimShadow,transition:'background 0.8s, box-shadow 0.8s'}}/>

              {/* Contenido central */}
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 pointer-events-none">
                {orbMode==='thinking' ? (
                  <div className="flex items-center gap-2">
                    {[0,1,2,3].map(i=>(<div key={i} className="rounded-full" style={{width:'7px',height:'7px',background:'rgba(167,139,250,0.95)',boxShadow:'0 0 10px rgba(167,139,250,0.8)',animation:`pulse ${0.55+i*0.09}s ease-in-out ${i*0.11}s infinite alternate`}}/>))}
                  </div>
                ) : orbMode==='recording' ? (
                  <>
                    <div className="font-syne font-black tracking-[0.3em]" style={{fontSize:isMobile?'13px':'15px',color:'#ffd0d0',textShadow:'0 0 16px rgba(229,29,42,0.8)'}}>ESCUCHANDO</div>
                    <div className="flex items-center gap-[3px]" style={{height:'18px'}}>
                      {[8,14,20,11,17,9,15].map((h,i)=>(<div key={i} style={{width:'3px',height:`${h}px`,borderRadius:'2px',background:'#ff6b6b',boxShadow:'0 0 8px #ff6b6b',transformOrigin:'center',animation:`eqBar ${0.4+i*0.07}s ease-in-out ${i*0.05}s infinite alternate`}}/>))}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="font-syne" style={{fontWeight:700,fontSize:isMobile?'19px':'23px',letterSpacing:'0.42em',textIndent:'0.42em',color:'#dbe4ff',textShadow:'0 0 18px rgba(120,160,255,0.7)'}}>HARVEY</div>
                    <div className="flex items-center gap-[3px]" style={{height:'18px'}}>
                      {[8,13,18,10,15,8].map((h,i)=>(<div key={i} style={{width:'3px',height:`${h}px`,borderRadius:'2px',background:'#6f9bff',boxShadow:'0 0 8px #6f9bff',transformOrigin:'center',opacity:orbMode==='speaking'?1:0.5,animation:orbMode==='speaking'?`eqBar ${0.5+i*0.08}s ease-in-out ${i*0.06}s infinite alternate`:'none'}}/>))}
                    </div>
                  </>
                )}
              </div>
            </button>
          </div>

          <div className="flex flex-col items-center gap-2 mt-4 w-full" style={{maxWidth:'600px'}}>
            {orbMode==='idle' && !harveyReply && (()=>{
              const inboxArr = (data.inbox||[]) as any[]
              const unread = inboxArr.filter((m:any)=>!m.is_read)
              const importante = unread.filter((m:any)=>m.ai_urgency==='urgent'||m.ai_urgency==='high').length
              const todayEvts = ((data.calendarEvents||[]) as any[]).filter((e:any)=>e.start?.slice(0,10)===todayStr)
              const focusEmail = unread.find((m:any)=>m.ai_urgency==='urgent') || unread.find((m:any)=>m.ai_urgency==='high')
              type BItem = {icon:string;color:string;text:string;nav:string}
              const items: BItem[] = []
              if (focusEmail) items.push({icon:'mail',color:'rgba(255,176,32,0.95)',text:`Responde a ${focusEmail.from_name||'un contacto'}${focusEmail.ai_client&&focusEmail.ai_client!=='Desconocido'?' ('+focusEmail.ai_client+')':''}: ${focusEmail.subject||'propuesta'}`,nav:'inbox'})
              if (urgentTasks.length>0) items.push({icon:'alert-triangle',color:RED,text:`${urgentTasks.length} tarea${urgentTasks.length>1?'s':''} urgente${urgentTasks.length>1?'s':''} por cerrar: ${urgentTasks[0].text}`,nav:'tareas'})
              if (dueTodayTasks.length>0) items.push({icon:'clock',color:'rgba(255,176,32,0.95)',text:`${dueTodayTasks.length} tarea${dueTodayTasks.length>1?'s':''} vence${dueTodayTasks.length>1?'n':''} hoy: ${dueTodayTasks[0].text}`,nav:'tareas'})
              if (importante>0 && !focusEmail) items.push({icon:'mail',color:'rgba(255,176,32,0.95)',text:`${importante} correo${importante>1?'s':''} importante${importante>1?'s':''} esperan respuesta`,nav:'inbox'})
              if (todayEvts.length>0) items.push({icon:'calendar',color:'rgba(167,139,250,0.9)',text:`${todayEvts.length} evento${todayEvts.length>1?'s':''} hoy: ${todayEvts.slice(0,2).map((e:any)=>e.title).join(', ')}`,nav:'calendario'})
              if (overdueP>0) items.push({icon:'folder',color:RED,text:`${overdueP} proyecto${overdueP>1?'s':''} atrasado${overdueP>1?'s':''} por recuperar`,nav:'proyectos'})
              if (upcomingDeadlines.length>0) { const p0=upcomingDeadlines[0]; const dLeft=Math.max(0,Math.round((dlDate(p0.deadline).getTime()-Date.now())/86400000)); items.push({icon:'folder-open',color:'rgba(255,176,32,0.95)',text:`Deadline cercano: ${p0.name} vence ${dLeft===0?'hoy':`en ${dLeft}d`}${upcomingDeadlines.length>1?` (+${upcomingDeadlines.length-1})`:''}`,nav:'proyectos'}) }
              if (pipeline>0) items.push({icon:'film',color:'rgba(193,53,132,0.9)',text:`${pipeline} pieza${pipeline>1?'s':''} de contenido en el pipeline`,nav:'contenido'})
              if (autosToday.length>0) items.push({icon:'zap',color:GRN,text:`El motor ejecutó ${autosToday.length} automatización${autosToday.length>1?'es':''} hoy`,nav:'automatizaciones'})
              if (unread.length>0 && importante===0 && !focusEmail) items.push({icon:'mail',color:BLU,text:`Revisa ${unread.length} correo${unread.length>1?'s':''} sin leer`,nav:'inbox'})
              const shown = items.slice(0,5)
              const greeting = hour<13?'Buenos días':hour<20?'Buenas tardes':'Buenas noches'
              const urgMsg = urgentTasks.length>0?`Hay ${urgentTasks.length} tarea(s) urgente(s): ${urgentTasks.slice(0,2).map((t:Task)=>t.text).join(' y ')}.`:'Sin urgencias.'
              const inboxMsg = unreadCount>0?`${unreadCount} email(s) sin leer en el inbox.`:'Inbox al día.'
              const calMsg = todayEvts.length>0?`Hoy tienes ${todayEvts.length} evento(s): ${todayEvts.slice(0,2).map((e:any)=>e.title).join(', ')}.`:'Sin eventos de calendario hoy.'
              const briefQ = `${greeting}. Dame el briefing del día de Brutal Studios. ${urgMsg} ${inboxMsg} ${calMsg} ¿Cuál es el plan?`
              return (
                <div className="animate-fadeUp rounded-3xl px-6 py-5 w-full" style={{background:'rgba(255,255,255,0.02)',border:'1px solid rgba(255,255,255,0.06)',backdropFilter:'blur(4px)'}}>
                  <div className="flex items-center gap-2">
                    <LucideIcon name="sparkles" size={16} color="#6f9bff"/>
                    <span className="font-figtree" style={{fontSize:'16px',fontWeight:600,color:'rgba(255,255,255,0.9)'}}>Tu briefing</span>
                    <button onClick={()=>{setHarveySpoken(briefQ);askHarvey(briefQ)}}
                      className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full font-syne text-[7.5px] font-black tracking-widest transition-all hover:opacity-80 active:scale-95"
                      style={{background:`${BLU}14`,border:`1px solid ${BLU}30`,color:BLU}}>
                      <LucideIcon name="volume-2" size={10} color={BLU}/> ESCUCHAR
                    </button>
                  </div>
                  <div className="mt-3 mb-1" style={{height:'1px',background:'rgba(255,255,255,0.06)'}}/>
                  {shown.length>0 ? (
                    <div className="flex flex-col">
                      {shown.map((it,i)=>(
                        <button key={i} onClick={()=>onNavigate?.(it.nav)}
                          className="flex items-center gap-3 py-2.5 text-left transition-all hover:opacity-80 active:scale-[0.99]">
                          <LucideIcon name={it.icon} size={16} color={it.color}/>
                          <span className="font-figtree flex-1 truncate" style={{fontSize:'14px',color:'rgba(255,255,255,0.66)'}}>{it.text}</span>
                          <LucideIcon name="chevron-right" size={13} color="rgba(255,255,255,0.14)"/>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col">
                      <div className="flex items-center gap-3 py-3">
                        <LucideIcon name="check-circle" size={16} color={GRN}/>
                        <span className="font-figtree" style={{fontSize:'14px',color:'rgba(255,255,255,0.5)'}}>Todo al día. Sin pendientes ahora mismo.</span>
                      </div>
                      {(()=>{
                        const d3 = new Date(); d3.setDate(d3.getDate()+3)
                        const d3str = localDayKey(d3)
                        const upcoming3 = ((data.tasks||[]) as any[]).filter((t:any)=>!t.done&&t.due_date&&t.due_date.slice(0,10)>todayStr&&t.due_date.slice(0,10)<=d3str).sort((a:any,b:any)=>a.due_date.localeCompare(b.due_date)).slice(0,3)
                        const nextEvts = ((data.calendarEvents||[]) as any[]).filter((e:any)=>e.start&&e.start.slice(0,10)>todayStr).sort((a:any,b:any)=>a.start.localeCompare(b.start)).slice(0,2)
                        if (upcoming3.length===0 && nextEvts.length===0) return null
                        return (
                          <div style={{borderTop:'1px solid rgba(255,255,255,0.06)'}}>
                            <div className="font-syne text-[7px] font-black tracking-widest pt-2 pb-0.5" style={{color:'rgba(255,255,255,0.18)'}}>PRÓXIMOS DÍAS</div>
                            {upcoming3.map((t:any)=>(
                              <button key={t.id} onClick={()=>onNavigate?.('tareas')} className="flex items-center gap-3 py-2 w-full text-left transition-all hover:opacity-80">
                                <LucideIcon name="circle-check" size={14} color={t.level==='urgent'?RED:t.level==='high'?'rgba(255,176,32,0.9)':BLU}/>
                                <span className="font-figtree flex-1 truncate" style={{fontSize:'13px',color:'rgba(255,255,255,0.48)'}}>{t.text}</span>
                                <span className="font-syne text-[8px] font-black flex-shrink-0" style={{color:'rgba(255,255,255,0.22)'}}>{new Date(t.due_date+'T12:00:00').toLocaleDateString('es-ES',{weekday:'short',day:'numeric'})}</span>
                              </button>
                            ))}
                            {nextEvts.map((e:any)=>(
                              <button key={e.id} onClick={()=>onNavigate?.('calendario')} className="flex items-center gap-3 py-2 w-full text-left transition-all hover:opacity-80">
                                <LucideIcon name="calendar" size={14} color="rgba(167,139,250,0.85)"/>
                                <span className="font-figtree flex-1 truncate" style={{fontSize:'13px',color:'rgba(255,255,255,0.48)'}}>{e.title}</span>
                                <span className="font-syne text-[8px] font-black flex-shrink-0" style={{color:'rgba(255,255,255,0.22)'}}>{new Date(e.start).toLocaleDateString('es-ES',{weekday:'short',day:'numeric'})}</span>
                              </button>
                            ))}
                          </div>
                        )
                      })()}
                    </div>
                  )}
                </div>
              )
            })()}

          </div>

          <div className={`w-full mt-6 ${isMobile?'px-5':'px-10'}`} style={{maxWidth:'600px'}}>

            {harveySpoken&&(
              <div className="text-center mb-3 font-figtree italic" style={{fontSize:'12px',color:'rgba(255,255,255,0.22)'}}>
                &quot;{harveySpoken}&quot;
              </div>
            )}

            <div style={{minHeight:(orbMode==='thinking'||harveyReply)?'64px':'0'}}>
              {orbMode==='thinking' ? (
                <div className="flex items-center justify-center gap-2 py-5">
                  {[0,1,2,3].map(i=>(
                    <div key={i} className="rounded-full" style={{
                      width:'6px',height:'6px',
                      background:'rgba(139,92,246,0.8)',
                      animation:`pulse ${0.55+i*0.09}s ease-in-out ${i*0.11}s infinite alternate`,
                      boxShadow:'0 0 8px rgba(139,92,246,0.5)',
                    }}/>
                  ))}
                </div>
              ) : harveyReply ? (()=>{
                const clean = harveyReply.replace(/\s+/g,' ').trim()
                const sentences = clean.split(/(?<=[.!?…])\s+/).map(s=>s.trim()).filter(s=>s.length>0)
                const question = sentences.length>1 && /[?？]$/.test(sentences[sentences.length-1]) ? sentences[sentences.length-1] : null
                const body = question ? sentences.slice(0,-1) : sentences
                // Saltamos saludos/frases muy cortas para que el titular tenga contenido real
                const GREET = /^(buen[oa]s\s+(d[ií]as|tardes|noches)|hola|hey|vale|perfecto|claro|de acuerdo|entendido)\b/i
                const bodyT = [...body]
                while (bodyT.length>1 && (bodyT[0].length<22 || GREET.test(bodyT[0]))) bodyT.shift()
                const titular = bodyT[0] || body[0] || clean
                const points = bodyT.slice(1).filter(s=>s.length>10).slice(0,3)
                const trunc = (s:string,n:number)=> s.length>n ? s.slice(0,n-1).trimEnd()+'…' : s
                return (
                <div ref={replyBoxRef} className="relative rounded-2xl overflow-hidden animate-fadeUp" style={{
                  background:'rgba(255,255,255,0.023)',
                  border:'1px solid rgba(255,255,255,0.06)',
                }}>
                  <div className="absolute top-0 left-1/2 -translate-x-1/2" style={{width:'120px',height:'1px',background:`linear-gradient(90deg,transparent,${BLU}50,transparent)`}}/>
                  <div className="flex items-center gap-2 px-5 pt-4 pb-2">
                    {orbMode==='speaking' ? (
                      <div className="flex items-center gap-1">
                        {[0,1,2,3,4].map(i=>(
                          <div key={i} className="rounded-full" style={{width:'2.5px',height:`${[5,9,13,9,5][i]}px`,background:BLU,opacity:0.65,animation:`wave${i+1} 0.55s ease-in-out infinite`}}/>
                        ))}
                      </div>
                    ) : (
                      <LucideIcon name="sparkles" size={12} color={BLU}/>
                    )}
                    <span className="font-syne text-[7.5px] font-black tracking-widest" style={{color:'rgba(27,95,250,0.7)'}}>HARVEY{orbMode==='speaking'?' · HABLANDO':''}</span>
                    <button onClick={()=>setShowTranscript(v=>!v)}
                      className="ml-auto inline-flex items-center gap-1 px-2.5 py-1 rounded-lg font-syne text-[7px] font-black tracking-widest transition-all hover:opacity-80 active:scale-95"
                      style={{background:showTranscript?`${BLU}18`:'rgba(255,255,255,0.04)',border:`1px solid ${showTranscript?`${BLU}30`:'rgba(255,255,255,0.07)'}`,color:showTranscript?BLU:'rgba(255,255,255,0.32)'}}>
                      <LucideIcon name={showTranscript?'eye-off':'eye'} size={9} color={showTranscript?BLU:'rgba(255,255,255,0.32)'}/>
                      {showTranscript?'RESUMEN':'VER TEXTO'}
                    </button>
                  </div>
                  {showTranscript ? (
                    <div className="px-5 pb-4" style={{maxHeight:isMobile?'30vh':'260px',overflowY:'auto',WebkitOverflowScrolling:'touch'}}>
                      <p className="font-figtree leading-relaxed text-left" style={{fontSize:'13.5px',color:'rgba(255,255,255,0.82)'}}>
                        {harveyReply}
                      </p>
                    </div>
                  ) : (
                    <div className="px-5 pb-4 text-left">
                      <div className="font-figtree font-semibold" style={{fontSize:'15px',color:'rgba(255,255,255,0.9)',lineHeight:'1.35',display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden'}}>
                        {titular}
                      </div>
                      {points.length>0 && (
                        <div className="flex flex-col gap-2 mt-3">
                          {points.map((p,i)=>(
                            <div key={i} className="flex items-start gap-2.5">
                              <div className="rounded-full flex-shrink-0" style={{width:'5px',height:'5px',marginTop:'6px',background:BLU,boxShadow:`0 0 5px ${BLU}80`}}/>
                              <span className="font-figtree" style={{fontSize:'12.5px',color:'rgba(255,255,255,0.62)',lineHeight:'1.35'}}>{trunc(p,90)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {question && (
                        <div className="mt-3 flex items-start gap-2.5 px-3 py-2.5 rounded-xl" style={{background:`${BLU}0d`,border:`1px solid ${BLU}22`}}>
                          <div className="flex-shrink-0" style={{marginTop:'1px'}}><LucideIcon name="message-circle" size={12} color={BLU}/></div>
                          <span className="font-figtree font-medium" style={{fontSize:'12.5px',color:'rgba(27,95,250,0.92)',lineHeight:'1.35'}}>{trunc(question,120)}</span>
                        </div>
                      )}
                    </div>
                  )}
                  {replayUrl && orbMode==='idle' && (
                    <div className="px-5 pb-4">
                      <button onClick={()=>{ const a=getSharedAudio(); if(!a) return; a.src=replayUrl; a.onended=()=>{ if(orbModeRef.current==='speaking') setOrbMode('idle') }; setOrbMode('speaking'); a.play().catch(()=>setOrbMode('idle')) }}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl font-syne text-[8px] font-black tracking-widest transition-all hover:opacity-80"
                        style={{background:'rgba(27,95,250,0.1)',border:'1px solid rgba(27,95,250,0.22)',color:BLU}}>
                        <LucideIcon name="volume-2" size={11} color={BLU}/> ESCUCHAR
                      </button>
                    </div>
                  )}
                </div>
                )
              })() : null}
            </div>

            {pendingAction && orbMode==='idle' && !isMobile && (()=>{
              const iconMap: Record<string,string> = {tarea:'check-square',evento:'calendar',proyecto:'folder',cliente:'user-plus',pieza:'film'}
              const labelMap: Record<string,string> = {tarea:'CREAR TAREA',evento:'CREAR EVENTO',proyecto:'CREAR PROYECTO',cliente:'CREAR CLIENTE',pieza:'AÑADIR AL PIPELINE'}
              return (
                <div ref={actionCardRef} className="mt-4 rounded-2xl overflow-hidden animate-fadeUp" style={{border:`1px solid ${BLU}35`,background:`${BLU}08`}}>
                  <div className="px-5 py-3 flex items-center gap-2" style={{borderBottom:`1px solid ${BLU}18`,background:`${BLU}0c`}}>
                    <LucideIcon name={iconMap[pendingAction.type]||'zap'} size={12} color={BLU}/>
                    <span className="font-syne text-[8px] font-black tracking-widest" style={{color:BLU}}>HARVEY — {labelMap[pendingAction.type]||pendingAction.type.toUpperCase()}</span>
                  </div>
                  <div className="px-5 py-4">
                    <p className="font-figtree text-[14px] font-semibold mb-1.5" style={{color:'rgba(255,255,255,0.88)'}}>{pendingAction.text}</p>
                    <div className="flex flex-wrap gap-2 mb-3">
                      {pendingAction.level && <span className="font-syne text-[7.5px] font-black px-2 py-0.5 rounded-full" style={{background:pendingAction.level==='urgent'?`${RED}15`:pendingAction.level==='high'?'rgba(255,176,32,0.12)':`${BLU}15`,color:pendingAction.level==='urgent'?RED:pendingAction.level==='high'?'rgba(255,176,32,0.9)':BLU}}>{pendingAction.level.toUpperCase()}</span>}
                      {pendingAction.platform && <span className="font-syne text-[7.5px] font-black px-2 py-0.5 rounded-full" style={{background:'rgba(193,53,132,0.12)',color:'rgba(193,53,132,0.9)'}}>{pendingAction.platform}</span>}
                      {pendingAction.contentType && <span className="font-syne text-[7.5px] font-black px-2 py-0.5 rounded-full" style={{background:'rgba(255,255,255,0.06)',color:'rgba(255,255,255,0.4)'}}>{pendingAction.contentType}</span>}
                      {pendingAction.clientName && <span className="font-syne text-[7.5px] font-black px-2 py-0.5 rounded-full" style={{background:'rgba(255,255,255,0.06)',color:'rgba(255,255,255,0.4)'}}>Cliente: {pendingAction.clientName}</span>}
                      {pendingAction.industry && pendingAction.type==='cliente' && <span className="font-syne text-[7.5px] font-black px-2 py-0.5 rounded-full" style={{background:'rgba(255,255,255,0.06)',color:'rgba(255,255,255,0.4)'}}>{pendingAction.industry}</span>}
                      {pendingAction.date && <span className="font-syne text-[7.5px] font-black px-2 py-0.5 rounded-full" style={{background:'rgba(255,255,255,0.06)',color:'rgba(255,255,255,0.4)'}}>{pendingAction.date}{pendingAction.time?' '+pendingAction.time:''}</span>}{pendingAction.assigneeName && <span className="font-syne text-[7.5px] font-black px-2 py-0.5 rounded-full" style={{background:'rgba(34,197,94,0.12)',color:'rgba(34,197,94,0.9)'}}>→ {pendingAction.assigneeName.toUpperCase()}</span>}{pendingAction.invitees && <span className="font-syne text-[7.5px] font-black px-2 py-0.5 rounded-full" style={{background:'rgba(167,139,250,0.12)',color:'rgba(167,139,250,0.9)'}}>INVITA: {pendingAction.invitees.toUpperCase()}</span>}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={confirmHarveyAction} disabled={confirmingAction} className="flex-1 py-2.5 rounded-xl font-syne text-[8.5px] font-black tracking-widest transition-all disabled:opacity-40" style={{background:BLU,color:'white'}}>
                        {confirmingAction?'CREANDO…':'CONFIRMAR'}
                      </button>
                      <button onClick={()=>setPendingAction(null)} className="flex-1 py-2.5 rounded-xl font-syne text-[8.5px] font-black tracking-widest transition-all hover:bg-white/5" style={{border:`1px solid rgba(255,255,255,0.08)`,color:'rgba(255,255,255,0.25)'}}>
                        CANCELAR
                      </button>
                    </div>
                  </div>
                </div>
              )
            })()}

            <form className="mt-4 w-full" style={{maxWidth:'600px'}} onSubmit={e=>{e.preventDefault();const q=textQ.trim();if(!q||orbMode!=='idle')return;setHarveySpoken(q);setTextQ('');askHarvey(q)}}>
              <div className="flex items-center gap-3 pl-5 pr-2 py-2 rounded-full" style={{background:'rgba(255,255,255,0.03)',border:'1px solid rgba(255,255,255,0.07)'}}>
                <LucideIcon name="message-circle" size={14} color="rgba(255,255,255,0.2)"/>
                <input value={textQ} onChange={e=>setTextQ(e.target.value)} disabled={orbMode!=='idle'}
                  placeholder="Escribe a Harvey…"
                  className="flex-1 bg-transparent outline-none disabled:opacity-25 font-figtree"
                  style={{fontSize:'15px',color:'rgba(255,255,255,0.75)',caretColor:BLU}}/>
                {textQ.trim()&&orbMode==='idle' ? (
                  <button type="submit" aria-label="Enviar" className="w-10 h-10 rounded-full flex items-center justify-center transition-all hover:opacity-85 active:scale-95" style={{background:BLU}}>
                    <LucideIcon name="arrow-right" size={16} color="white"/>
                  </button>
                ) : (
                  <button type="button" onClick={handleOrb} aria-label="Hablar con Harvey"
                    className="w-11 h-11 rounded-full flex items-center justify-center transition-all active:scale-95"
                    style={{background:`radial-gradient(circle at 40% 35%,${BLU}59,${BLU}14)`,border:`1px solid ${BLU}66`}}>
                    <div className="flex items-center gap-[2px]" style={{height:'14px'}}>
                      {[6,10,8,11,7].map((h,i)=>(<div key={i} style={{width:'2px',height:`${h}px`,borderRadius:'2px',background:'#6f9bff',boxShadow:'0 0 6px #6f9bff',transformOrigin:'center',animation:orbMode==='recording'?`eqBar ${0.4+i*0.08}s ease-in-out ${i*0.05}s infinite alternate`:'none'}}/>))}
                    </div>
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      </div>

      {/* ══ RIGHT RAIL (stats slim) ══ */}
      {(()=>{
        const railStats = [
          {n:unreadCount, l:'sin leer', c:unreadCount>0?'rgba(255,176,32,0.95)':'rgba(255,255,255,0.5)', icon:'mail', nav:'inbox'},
          {n:pendingAll, l:pendingAll===1?'tarea':'tareas', c:urgentTasks.length>0?RED:BLU, icon:'check-square', nav:'tareas'},
          {n:pipeline, l:pipeline===1?'oportunidad':'oportunidades', c:'rgba(167,139,250,0.9)', icon:'target', nav:'contenido'},
          {n:activeProjectsCount, l:activeProjectsCount===1?'proyecto':'proyectos', c:overdueP>0?RED:BLU, icon:'folder', nav:'proyectos'},
          {n:activeClients, l:activeClients===1?'cliente':'clientes', c:GRN, icon:'users', nav:'clientes'},
        ]
        if (isMobile) {
          return (
            <div className="w-full flex-shrink-0 px-4 py-4" style={{borderTop:'1px solid rgba(255,255,255,0.04)'}}>
              <div className="flex gap-2 overflow-x-auto pb-1" style={{WebkitOverflowScrolling:'touch'}}>
                {railStats.map((s,i)=>(
                  <button key={i} onClick={()=>onNavigate?.(s.nav)} className="flex flex-col items-center gap-1 px-4 py-3 rounded-2xl flex-shrink-0 active:scale-95 transition-transform" style={{background:'rgba(255,255,255,0.025)',border:'1px solid rgba(255,255,255,0.06)',minWidth:'80px'}}>
                    <div className="font-figtree font-black" style={{fontSize:'22px',color:s.c,lineHeight:'1'}}>{s.n}</div>
                    <div className="font-figtree" style={{fontSize:'9px',color:'rgba(255,255,255,0.35)'}}>{s.l}</div>
                    <LucideIcon name={s.icon} size={13} color={s.c}/>
                  </button>
                ))}
                <button onClick={()=>onOpenModal('tarea')} className="flex flex-col items-center justify-center gap-1.5 px-4 py-3 rounded-2xl flex-shrink-0 active:scale-95 transition-transform" style={{background:`${BLU}12`,border:`1px solid ${BLU}30`,minWidth:'66px'}}>
                  <LucideIcon name="plus" size={18} color={BLU}/>
                  <div className="font-figtree" style={{fontSize:'9px',color:BLU}}>crear</div>
                </button>
              </div>
            </div>
          )
        }
        return (
          <div className="flex-shrink-0 flex items-start justify-center pt-14 pr-7 pl-2" style={{width:'162px'}}>
            <div className="flex flex-col items-center px-3 py-6 rounded-[46px]" style={{width:'92px',background:'linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.012))',border:'1px solid rgba(255,255,255,0.08)',boxShadow:'inset 0 1px 0 rgba(255,255,255,0.05),0 20px 50px rgba(0,0,0,0.4)'}}>
              <div className="mb-3 opacity-60"><LucideIcon name="sun" size={15} color="rgba(160,175,220,0.5)"/></div>
              {railStats.map((s,i)=>(
                <div key={i} className="w-full flex flex-col items-center">
                  {i>0 && <div style={{width:'30px',height:'1px',background:'rgba(255,255,255,0.06)',margin:'2px 0'}}/>}
                  <button onClick={()=>onNavigate?.(s.nav)} className="group/rs flex flex-col items-center gap-1 py-4 transition-all active:scale-95" title={s.l}>
                    <div className="font-figtree tabular-nums" style={{fontSize:'27px',fontWeight:400,color:s.c,lineHeight:'1',letterSpacing:'-0.01em',transition:'color 0.3s'}}>{s.n}</div>
                    <div className="font-figtree" style={{fontSize:'9px',color:'rgba(255,255,255,0.34)',letterSpacing:'0.02em'}}>{s.l}</div>
                    <div className="mt-1 opacity-55 group-hover/rs:opacity-100 transition-opacity"><LucideIcon name={s.icon} size={13} color={s.c}/></div>
                  </button>
                </div>
              ))}
              <div style={{width:'30px',height:'1px',background:'rgba(255,255,255,0.06)',margin:'4px 0'}}/>
              <button onClick={()=>onOpenModal('tarea')} className="mt-3 w-11 h-11 rounded-full flex items-center justify-center transition-all hover:opacity-85 active:scale-95" style={{background:`radial-gradient(circle at 40% 35%,${BLU}40,${BLU}12)`,border:`1px solid ${BLU}40`,boxShadow:`0 0 16px ${BLU}22`}} title="Crear tarea">
                <LucideIcon name="plus" size={18} color="#9dc0ff"/>
              </button>
            </div>
          </div>
        )
      })()}

      {isMobile && pendingAction && orbMode==='idle' && (()=>{
        const iconMap: Record<string,string> = {tarea:'check-square',evento:'calendar',proyecto:'folder',cliente:'user-plus',pieza:'film'}
        const labelMap: Record<string,string> = {tarea:'CREAR TAREA',evento:'CREAR EVENTO',proyecto:'CREAR PROYECTO',cliente:'CREAR CLIENTE',pieza:'AÑADIR AL PIPELINE'}
        return (
          <>
            <div className="fixed inset-0 z-[90] bg-black/60" onClick={()=>setPendingAction(null)}/>
            <div ref={actionCardRef} className="fixed bottom-0 left-0 right-0 z-[91] rounded-t-3xl animate-fadeUp" style={{background:'#0A0A14',border:`1px solid ${BLU}35`,borderBottom:'none',paddingBottom:'env(safe-area-inset-bottom,0px)'}}>
              <div className="w-10 h-1 rounded-full mx-auto mt-2.5 mb-1" style={{background:'rgba(255,255,255,0.12)'}}/>
              <div className="px-5 py-2.5 flex items-center gap-2" style={{borderBottom:`1px solid ${BLU}18`}}>
                <LucideIcon name={iconMap[pendingAction.type]||'zap'} size={12} color={BLU}/>
                <span className="font-syne text-[8px] font-black tracking-widest" style={{color:BLU}}>HARVEY — {labelMap[pendingAction.type]||pendingAction.type.toUpperCase()}</span>
              </div>
              <div className="px-5 py-4">
                <p className="font-figtree text-[14px] font-semibold mb-1.5" style={{color:'rgba(255,255,255,0.88)'}}>{pendingAction.text}</p>
                <div className="flex flex-wrap gap-2 mb-3">
                  {pendingAction.level && <span className="font-syne text-[7.5px] font-black px-2 py-0.5 rounded-full" style={{background:pendingAction.level==='urgent'?`${RED}15`:pendingAction.level==='high'?'rgba(255,176,32,0.12)':`${BLU}15`,color:pendingAction.level==='urgent'?RED:pendingAction.level==='high'?'rgba(255,176,32,0.9)':BLU}}>{pendingAction.level.toUpperCase()}</span>}
                  {pendingAction.platform && <span className="font-syne text-[7.5px] font-black px-2 py-0.5 rounded-full" style={{background:'rgba(193,53,132,0.12)',color:'rgba(193,53,132,0.9)'}}>{pendingAction.platform}</span>}
                  {pendingAction.contentType && <span className="font-syne text-[7.5px] font-black px-2 py-0.5 rounded-full" style={{background:'rgba(255,255,255,0.06)',color:'rgba(255,255,255,0.4)'}}>{pendingAction.contentType}</span>}
                  {pendingAction.clientName && <span className="font-syne text-[7.5px] font-black px-2 py-0.5 rounded-full" style={{background:'rgba(255,255,255,0.06)',color:'rgba(255,255,255,0.4)'}}>Cliente: {pendingAction.clientName}</span>}
                  {pendingAction.industry && pendingAction.type==='cliente' && <span className="font-syne text-[7.5px] font-black px-2 py-0.5 rounded-full" style={{background:'rgba(255,255,255,0.06)',color:'rgba(255,255,255,0.4)'}}>{pendingAction.industry}</span>}
                  {pendingAction.date && <span className="font-syne text-[7.5px] font-black px-2 py-0.5 rounded-full" style={{background:'rgba(255,255,255,0.06)',color:'rgba(255,255,255,0.4)'}}>{pendingAction.date}{pendingAction.time?' '+pendingAction.time:''}</span>}{pendingAction.assigneeName && <span className="font-syne text-[7.5px] font-black px-2 py-0.5 rounded-full" style={{background:'rgba(34,197,94,0.12)',color:'rgba(34,197,94,0.9)'}}>→ {pendingAction.assigneeName.toUpperCase()}</span>}{pendingAction.invitees && <span className="font-syne text-[7.5px] font-black px-2 py-0.5 rounded-full" style={{background:'rgba(167,139,250,0.12)',color:'rgba(167,139,250,0.9)'}}>INVITA: {pendingAction.invitees.toUpperCase()}</span>}
                </div>
                <div className="flex gap-2">
                  <button onClick={confirmHarveyAction} disabled={confirmingAction} className="flex-1 py-3 rounded-xl font-syne text-[9px] font-black tracking-widest transition-all disabled:opacity-40" style={{background:BLU,color:'white'}}>
                    {confirmingAction?'CREANDO…':'CONFIRMAR'}
                  </button>
                  <button onClick={()=>setPendingAction(null)} className="flex-1 py-3 rounded-xl font-syne text-[9px] font-black tracking-widest transition-all" style={{border:`1px solid rgba(255,255,255,0.12)`,color:'rgba(255,255,255,0.35)'}}>
                    CANCELAR
                  </button>
                </div>
              </div>
            </div>
          </>
        )
      })()}
    </div>
  )
}
