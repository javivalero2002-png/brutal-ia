'use client'
import { useState, useEffect, useRef } from 'react'
import { BLU, RED, GRN, BORDER } from '@/components/shared/design-tokens'
import { useIsMobile } from '@/components/shared/hooks'
import { dlDate } from '@/components/shared/helpers'
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

  useEffect(() => {
    if (orbMode === 'idle' && harveyReply) setShowTranscript(true)
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
  const hour = now.getHours()
  const todayStr = now.toISOString().slice(0,10)
  const firstName = profile?.name?.split(' ')?.[0] || 'Jefe'
  const dateStr = now.toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long'})

  const urgentTasks = data.tasks.filter((t:Task)=>!t.done&&t.level==='urgent')
  const pendingAll = data.tasks.filter((t:Task)=>!t.done).length
  const activeProjectsCount = data.projects.filter((p:Project)=>p.status!=='completado').length
  const activeClients = data.clients.filter((c:Client)=>c.status==='Activo').length
  const pipeline = (data.agenda||[]).filter((a:any)=>a.status!=='publicado').length
  const overdueP = data.projects.filter((p:Project)=>p.deadline&&p.deadline!=='TBD'&&p.status!=='completado'&&dlDate(p.deadline)<new Date()).length
  const completedToday = data.tasks.filter((t:Task)=>t.done&&(t.updated_at||t.created_at).slice(0,10)===todayStr).length

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
    const unreadEmails = inboxAll.filter((m:any)=>!m.is_read).slice(0, 10)
    const emailLines = unreadEmails.map((m:any) => {
      const urg = m.ai_urgency==='urgent'?'[URGENTE]':m.ai_urgency==='high'?'[ALTA]':'[NORMAL]'
      const colabs = m.shared ? '[COLABS]' : '[PERSONAL]'
      const action = m.ai_action&&m.ai_action!=='Ninguna acción requerida'?` → Acción: ${m.ai_action}`:''
      const summary = m.ai_summary ? ` | Resumen: ${m.ai_summary}` : ''
      return `  • De: ${m.from_name||'?'} | Asunto: "${m.subject||'Sin asunto'}" ${urg}${colabs}${summary}${action}`
    }).join('\n')

    const todayStr = now.toISOString().slice(0,10)
    const calEvents = (data.calendarEvents||[]) as any[]
    const nextEvents = calEvents.filter((e:any)=>e.start>=todayStr).slice(0,5)
    const eventLines = nextEvents.map((e:any) => {
      const hasTime = e.start && e.start.includes('T')
      const timeStr = hasTime ? ` a las ${e.start.slice(11,16)}` : ''
      return `${e.title} (${e.start?.slice(0,10)||'?'}${timeStr})`
    }).join(' · ')

    return `BRUTAL STUDIOS — ${now.toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long'})}

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

CALENDARIO PRÓXIMO: ${eventLines||'sin eventos próximos'}`
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
        showToast(member ? `Tarea creada y asignada a ${member.name}` : 'Tarea creada por Harvey')

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

  const todayItems = [
    ...urgentTasks.slice(0,3).map((t:Task)=>({text:t.text,type:'URGENTE',color:RED,nav:'tareas'})),
    ...data.tasks.filter((t:Task)=>!t.done&&t.due_date?.slice(0,10)===todayStr&&t.level!=='urgent').slice(0,2).map((t:Task)=>({text:t.text,type:'HOY',color:BLU,nav:'tareas'})),
    ...(data.agenda||[]).filter((a:any)=>a.publish_date?.toString().slice(0,10)===todayStr).slice(0,2).map((a:any)=>({text:a.title||'Contenido',type:'PUBLICAR',color:'rgba(193,53,132,0.85)',nav:'contenido'})),
    ...(data.calendarEvents||[]).filter((e:any)=>e.start?.slice(0,10)===todayStr).slice(0,1).map((e:any)=>({text:e.title,type:'EVENTO',color:'rgba(167,139,250,0.85)',nav:'calendario'})),
  ].slice(0,5)

  const statCards = [
    {v:pendingAll, l:'Tareas pend.', c:urgentTasks.length>0?RED:BLU, alert:urgentTasks.length>0?`${urgentTasks.length} urgentes`:null, nav:'tareas'},
    {v:activeProjectsCount, l:'Proyectos', c:overdueP>0?RED:BLU, alert:overdueP>0?`${overdueP} atrasados`:null, nav:'proyectos'},
    {v:activeClients, l:'Clientes', c:GRN, alert:null, nav:'clientes'},
    {v:pipeline, l:'Pipeline', c:'rgba(193,53,132,0.85)', alert:null, nav:'contenido'},
    {v:unreadCount, l:'Inbox', c:unreadCount>0?'rgba(255,176,32,0.9)':BLU, alert:null, nav:'inbox'},
    {v:completedToday, l:'Completadas hoy', c:completedToday>0?GRN:'rgba(255,255,255,0.18)', alert:null, nav:'tareas'},
  ]

  return (
    <div className={isMobile ? 'h-full flex flex-col overflow-y-auto' : 'h-full flex overflow-hidden'} style={{background:'#030308'}}>

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

          <div className="relative flex items-center justify-center" style={{
            width:'320px',height:'320px',
            animation: orbMode==='recording' ? 'glowPulseR 1.4s ease-in-out infinite' : orbMode!=='idle' ? 'glowPulse 1.4s ease-in-out infinite' : undefined,
          }}>

            <div className="absolute rounded-full pointer-events-none" style={{
              width:'300px',height:'300px',
              background:`radial-gradient(circle,${orbColor[orbMode]}20 0%,transparent 65%)`,
              filter:'blur(40px)',
              transition:'background 0.8s',
            }}/>

            {[
              {sz:292, iO:0.04, aO:0.18, bw:'1px', delay:'1.6s', idleD:'5.8s', idleE:'0s'},
              {sz:260, iO:0.06, aO:0.25, bw:'1px', delay:'1.2s', idleD:'5.2s', idleE:'0.2s'},
              {sz:224, iO:0.09, aO:0.34, bw:'1px', delay:'0.8s', idleD:'4.6s', idleE:'0.4s'},
              {sz:184, iO:0.14, aO:0.46, bw:'1.5px', delay:'0.4s', idleD:'4.0s', idleE:'0.15s'},
              {sz:148, iO:0.21, aO:0.62, bw:'1.5px', delay:'0s', idleD:'3.4s', idleE:'0.3s'},
            ].map(({sz,iO,aO,bw,delay,idleD,idleE},i)=>(
              <div key={i} className="absolute rounded-full pointer-events-none" style={{
                width:`${sz}px`,height:`${sz}px`,
                border:`${bw} solid ${orbColor[orbMode]}`,
                opacity: orbMode==='idle' ? iO : aO,
                animation: orbMode!=='idle'
                  ? `ping 2.0s cubic-bezier(0,0,0.2,1) ${delay} infinite`
                  : `ringBreathe ${idleD} ease-in-out ${idleE} infinite`,
                transition:'opacity 0.7s ease, border-color 0.6s',
              }}/>
            ))}

            <button onClick={handleOrb}
              className="relative z-10 rounded-full flex flex-col items-center justify-center transition-all duration-700 active:scale-95 disabled:cursor-wait select-none"
              style={{
                width:'118px',height:'118px',
                background:`radial-gradient(circle at 36% 30%,${orbColor[orbMode]}28 0%,${orbColor[orbMode]}08 55%,rgba(2,2,10,0.95) 100%)`,
                border:`1.5px solid ${orbColor[orbMode]}`,
                boxShadow:[
                  `0 0 0 1px ${orbColor[orbMode]}12`,
                  `0 0 28px ${orbColor[orbMode]}50`,
                  `0 0 70px ${orbColor[orbMode]}20`,
                  `0 0 140px ${orbColor[orbMode]}08`,
                  `inset 0 1px 0 rgba(255,255,255,0.09)`,
                  `inset 0 -1px 0 rgba(0,0,0,0.4)`,
                ].join(','),
              }}>

              {(orbMode==='speaking'||orbMode==='recording')&&(
                <div className="absolute bottom-5 left-0 right-0 flex items-end justify-center gap-px pointer-events-none">
                  {[4,7,11,8,14,9,12,7,5].map((h,i)=>(
                    <div key={i} className="rounded-full" style={{
                      width:'2.5px',height:`${h}px`,
                      background:orbColor[orbMode],
                      opacity:0.75,
                      animation:`pulse ${0.38+i*0.06}s ease-in-out ${i*0.04}s infinite alternate`,
                    }}/>
                  ))}
                </div>
              )}

              <div style={{filter:`drop-shadow(0 0 14px ${orbColor[orbMode]})`,marginBottom:(orbMode==='speaking'||orbMode==='recording')?'18px':'0'}}>
                {orbMode==='idle'&&<LucideIcon name="mic" size={32} color={`${orbColor[orbMode]}c0`}/>}
                {orbMode==='recording'&&<LucideIcon name="mic" size={32} color={RED}/>}
                {orbMode==='thinking'&&<LucideIcon name="cpu" size={32} color="rgba(139,92,246,0.9)"/>}
                {orbMode==='speaking'&&<LucideIcon name="volume-2" size={32} color={orbColor[orbMode]}/>}
              </div>

              {orbMode!=='speaking'&&orbMode!=='recording'&&(
                <span className="font-syne font-black tracking-[0.25em] mt-2" style={{
                  fontSize:'6px',
                  color:orbMode==='idle'?'rgba(255,255,255,0.18)':orbColor[orbMode],
                  textShadow:orbMode!=='idle'?`0 0 14px ${orbColor[orbMode]}`:'none',
                  letterSpacing:orbMode==='idle'?'0.3em':'0.25em',
                }}>{orbLabel[orbMode]}</span>
              )}
            </button>
          </div>

          <div className="flex flex-col items-center gap-2 mt-1">
            <div className="font-syne font-black tracking-[0.5em]" style={{fontSize:'6px',color:'rgba(27,95,250,0.28)'}}>HARVEY · IA</div>
            {orbMode === 'idle' && !harveyReply && (
              <button
                onClick={()=>{
                  const greeting = hour<13?'Buenos días':'Buenas tardes'
                  const urgMsg = urgentTasks.length>0?`Hay ${urgentTasks.length} tarea(s) urgente(s): ${urgentTasks.slice(0,2).map((t:Task)=>t.text).join(' y ')}.`:'Sin urgencias.'
                  const inboxMsg = unreadCount>0?`${unreadCount} email(s) sin leer en el inbox.`:'Inbox al día.'
                  const calEvts = ((data.calendarEvents||[]) as any[]).filter((e:any)=>e.start?.slice(0,10)===todayStr)
                  const calMsg = calEvts.length>0?`Hoy tienes ${calEvts.length} evento(s): ${calEvts.slice(0,2).map((e:any)=>e.title).join(', ')}.`:'Sin eventos de calendario hoy.'
                  const briefQ = `${greeting}. Dame el briefing del día de Brutal Studios. ${urgMsg} ${inboxMsg} ${calMsg} ¿Cuál es el plan?`
                  setHarveySpoken(briefQ); askHarvey(briefQ)
                }}
                className="flex items-center gap-2 px-5 py-2 rounded-full font-syne text-[8px] font-black tracking-widest transition-all hover:opacity-80 active:scale-95"
                style={{background:`linear-gradient(135deg,${BLU}22,${BLU}0a)`,border:`1px solid ${BLU}35`,color:BLU}}
              >
                <LucideIcon name="sunrise" size={11} color={BLU}/>
                BRIEFING DEL DÍA
              </button>
            )}

            {orbMode==='idle' && !harveyReply && (()=>{
              const urgentEmail = ((data.inbox||[]) as any[]).find((m:any)=>!m.is_read&&m.ai_urgency==='urgent') ||
                                  ((data.inbox||[]) as any[]).find((m:any)=>!m.is_read&&m.ai_urgency==='high')
              const urgentTask = urgentTasks[0]
              if (!urgentEmail && !urgentTask) return null
              const isEmail = !!urgentEmail
              const item = urgentEmail || urgentTask
              return (
                <div className="animate-fadeUp rounded-2xl overflow-hidden mt-4" style={{
                  background:'rgba(229,29,42,0.04)',
                  border:'1px solid rgba(229,29,42,0.18)',
                  maxWidth:'380px',
                  width: isMobile ? 'calc(100vw - 40px)' : '380px',
                }}>
                  <div className="flex items-center gap-2 px-4 py-2" style={{borderBottom:'1px solid rgba(229,29,42,0.10)',background:'rgba(229,29,42,0.05)'}}>
                    <div className="w-1.5 h-1.5 rounded-full animate-pls" style={{background:RED,boxShadow:`0 0 6px ${RED}`}}/>
                    <span className="font-syne text-[7px] font-black tracking-widest" style={{color:RED}}>FOCO AHORA</span>
                    <span className="ml-auto font-syne text-[6.5px] font-black px-2 py-0.5 rounded-full" style={{background:'rgba(229,29,42,0.10)',color:RED}}>{isEmail?'EMAIL':'TAREA'}</span>
                  </div>
                  <div className="px-4 py-3 flex items-center gap-3">
                    <div className="w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0" style={{background:'rgba(229,29,42,0.08)'}}>
                      <LucideIcon name={isEmail?'mail':'alert-triangle'} size={12} color={RED}/>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-figtree text-[13px] font-semibold truncate" style={{color:'rgba(255,255,255,0.85)'}}>
                        {isEmail ? (item.subject||'Sin asunto') : item.text}
                      </div>
                      <div className="font-syne text-[7.5px] font-black mt-0.5" style={{color:'rgba(255,255,255,0.28)'}}>
                        {isEmail ? ((item.from_name||'?')+(item.ai_client&&item.ai_client!=='Desconocido'?' · '+item.ai_client:'')) : (item.assignee?.name||'Sin asignar')}
                      </div>
                    </div>
                    <button onClick={()=>onNavigate?.(isEmail?'inbox':'tareas')}
                      className="flex-shrink-0 flex items-center gap-1 px-3 py-2 rounded-xl font-syne text-[7.5px] font-black tracking-wide transition-all hover:opacity-75 active:scale-95"
                      style={{background:'rgba(229,29,42,0.08)',border:'1px solid rgba(229,29,42,0.20)',color:RED}}>
                      VER <LucideIcon name="arrow-right" size={9} color={RED}/>
                    </button>
                  </div>
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

            <div style={{minHeight:'64px'}}>
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
              ) : harveyReply ? (
                <div ref={replyBoxRef} className="relative px-6 py-5 rounded-2xl overflow-hidden text-center" style={{
                  background:'rgba(255,255,255,0.023)',
                  border:'1px solid rgba(255,255,255,0.06)',
                }}>
                  <div className="absolute top-0 left-1/2 -translate-x-1/2" style={{width:'120px',height:'1px',background:`linear-gradient(90deg,transparent,${BLU}50,transparent)`}}/>
                  {orbMode==='speaking' && (
                    <div className="flex items-center justify-center gap-3 mb-3">
                      <div className="flex items-center gap-1.5">
                        {[0,1,2,3,4].map(i=>(
                          <div key={i} className="rounded-full" style={{width:'3px',height:`${[6,10,14,10,6][i]}px`,background:BLU,opacity:0.6,animation:`wave${i+1} 0.55s ease-in-out infinite`}}/>
                        ))}
                      </div>
                      <button onClick={()=>setShowTranscript(v=>!v)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-syne text-[7.5px] font-black tracking-widest transition-all hover:opacity-80 active:scale-95"
                        style={{background:showTranscript?`${BLU}18`:'rgba(255,255,255,0.04)',border:`1px solid ${showTranscript?`${BLU}35`:'rgba(255,255,255,0.08)'}`,color:showTranscript?BLU:'rgba(255,255,255,0.3)'}}>
                        <LucideIcon name={showTranscript?'eye-off':'eye'} size={10} color={showTranscript?BLU:'rgba(255,255,255,0.3)'}/>
                        {showTranscript?'OCULTAR TEXTO':'LEER TEXTO'}
                      </button>
                    </div>
                  )}
                  {(orbMode!=='speaking' || showTranscript) && (
                    <div style={{maxHeight:isMobile?'32vh':'300px',overflowY:'auto',WebkitOverflowScrolling:'touch'}}>
                      <p className="font-figtree leading-relaxed" style={{fontSize:'14px',color:'rgba(255,255,255,0.82)',fontWeight:400}}>
                        {harveyReply}
                      </p>
                    </div>
                  )}
                  {replayUrl && orbMode==='idle' && (
                    <button onClick={()=>{ const a=getSharedAudio(); if(!a) return; a.src=replayUrl; a.onended=()=>{ if(orbModeRef.current==='speaking') setOrbMode('idle') }; setOrbMode('speaking'); a.play().catch(()=>setOrbMode('idle')) }}
                      className="mt-3 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl font-syne text-[8px] font-black tracking-widest transition-all hover:opacity-80"
                      style={{background:'rgba(27,95,250,0.1)',border:'1px solid rgba(27,95,250,0.22)',color:BLU}}>
                      <LucideIcon name="volume-2" size={11} color={BLU}/> ESCUCHAR
                    </button>
                  )}
                </div>
              ) : (
                <p className="text-center font-figtree" style={{fontSize:'12px',color:'rgba(255,255,255,0.12)',fontStyle:'italic'}}>
                  Pulsa el orbe o escribe para hablar con Harvey
                </p>
              )}
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

            {orbMode==='idle' && (()=>{
              const chips: {label:string; q:string; color?:string}[] = []
              if (urgentTasks.length > 0) chips.push({label:`${urgentTasks.length} urgente${urgentTasks.length>1?'s':''}`, q:`¿Qué tareas urgentes son las más críticas ahora mismo?`, color:RED})
              if (overdueP > 0) chips.push({label:`${overdueP} proyecto${overdueP>1?'s':''} atrasado${overdueP>1?'s':''}`, q:`¿Cómo recuperamos los proyectos atrasados?`, color:'rgba(255,176,32,0.9)'})
              if (unreadCount > 0) chips.push({label:`${unreadCount} email${unreadCount>1?'s':''} sin leer`, q:`¿Qué emails sin leer necesitan respuesta urgente?`, color:'rgba(255,176,32,0.7)'})
              const todayCalEvts = ((data.calendarEvents||[]) as any[]).filter((e:any)=>e.start?.slice(0,10)===todayStr)
              if (todayCalEvts.length > 0) chips.push({label:`${todayCalEvts.length} evento${todayCalEvts.length>1?'s':''} hoy`, q:`Dame detalles de mis eventos de hoy y cómo prepararme.`})
              chips.push({label:'Estado general', q:'¿Cuál es el estado general de Brutal Studios hoy?'})
              chips.push({label:'Proyectos', q:'¿Cómo van los proyectos activos?'})
              if (pipeline > 0) chips.push({label:`Pipeline · ${pipeline}`, q:`¿Qué contenido deberíamos priorizar publicar esta semana?`, color:'rgba(193,53,132,0.8)'})
              return (
                <div className="flex flex-wrap justify-center gap-2 mt-5">
                  {chips.slice(0,6).map((c,i)=>(
                    <button key={i} disabled={orbMode!=='idle'}
                      onClick={()=>{setHarveySpoken(c.q);askHarvey(c.q)}}
                      className="font-syne font-black tracking-wide px-3.5 py-2 rounded-full transition-all hover:opacity-80 disabled:opacity-20"
                      style={{fontSize:'8px',background:c.color?`${c.color}10`:'rgba(255,255,255,0.03)',border:`1px solid ${c.color||'rgba(255,255,255,0.07)'}`,color:c.color||'rgba(255,255,255,0.38)'}}>
                      {c.label}
                    </button>
                  ))}
                </div>
              )
            })()}

            <form className="mt-3" onSubmit={e=>{e.preventDefault();const q=textQ.trim();if(!q||orbMode!=='idle')return;setHarveySpoken(q);setTextQ('');askHarvey(q)}}>
              <div className="flex items-center gap-3 px-5 py-3.5 rounded-2xl" style={{
                background:'rgba(255,255,255,0.03)',
                border:'1px solid rgba(255,255,255,0.06)',
              }}>
                <LucideIcon name="message-circle" size={13} color="rgba(255,255,255,0.15)"/>
                <input value={textQ} onChange={e=>setTextQ(e.target.value)} disabled={orbMode!=='idle'}
                  placeholder="Escribe a Harvey…"
                  className="flex-1 bg-transparent outline-none disabled:opacity-25 font-figtree"
                  style={{fontSize:'14px',color:'rgba(255,255,255,0.75)',caretColor:BLU}}/>
                {textQ.trim()&&orbMode==='idle'&&(
                  <button type="submit" className="font-syne font-black text-[8px] tracking-widest px-3 py-1.5 rounded-lg transition-all hover:opacity-80" style={{background:BLU,color:'white'}}>
                    ENVIAR
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      </div>

      {/* ══ RIGHT PANEL ══ */}
      <div className={isMobile ? 'w-full flex-shrink-0 flex flex-col px-5 py-6' : 'w-[292px] flex-shrink-0 flex flex-col overflow-y-auto py-7 pr-7 pl-5'} style={isMobile?{borderTop:'1px solid rgba(255,255,255,0.04)',gap:'28px'}:{borderLeft:'1px solid rgba(255,255,255,0.04)',gap:'28px'}}>

        <div>
          <div className="font-syne font-black tracking-[0.38em] mb-3" style={{fontSize:'7px',color:'rgba(255,255,255,0.12)'}}>ESTADO</div>
          <div className="flex flex-col gap-2">
            {statCards.map((s,i)=>(
              <button key={i} onClick={()=>onNavigate?.(s.nav)}
                className="flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all duration-200 hover:bg-white/[0.04] group"
                style={{background:'rgba(255,255,255,0.022)',border:'1px solid rgba(255,255,255,0.05)'}}>
                <div className="font-figtree font-black leading-none flex-shrink-0" style={{
                  fontSize:'32px',color:s.c,lineHeight:'1',
                  textShadow:s.alert?`0 0 24px ${s.c}50`:undefined,
                  minWidth:'40px',
                }}>
                  {s.v}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-syne font-black" style={{fontSize:'7.5px',color:'rgba(255,255,255,0.28)',letterSpacing:'0.14em'}}>
                    {s.l.toUpperCase()}
                  </div>
                  {s.alert&&(
                    <div className="font-syne font-black mt-0.5 inline-block px-1.5 py-px rounded-full" style={{fontSize:'6px',background:`${RED}12`,color:RED,letterSpacing:'0.08em'}}>
                      {s.alert.toUpperCase()}
                    </div>
                  )}
                </div>
                <LucideIcon name="chevron-right" size={11} color="rgba(255,255,255,0.08)"/>
              </button>
            ))}
          </div>

          {(()=>{
            const totalT = data.tasks.length
            const ctrlPct = totalT > 0 ? Math.round((totalT - urgentCount) / totalT * 100) : 100
            const ctrlColor = ctrlPct >= 90 ? GRN : ctrlPct >= 65 ? BLU : RED
            const R = 44
            const C = 2 * Math.PI * R
            const offset = C * (1 - ctrlPct / 100)
            return (
              <div className="flex items-center gap-4 mt-4 px-4 py-3 rounded-xl" style={{background:'rgba(255,255,255,0.018)',border:'1px solid rgba(255,255,255,0.04)'}}>
                <div className="relative flex-shrink-0">
                  <svg width="96" height="96" viewBox="0 0 96 96">
                    <circle cx="48" cy="48" r={R} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="7"/>
                    <circle cx="48" cy="48" r={R} fill="none"
                      stroke={ctrlColor} strokeWidth="7"
                      strokeDasharray={C} strokeDashoffset={offset}
                      strokeLinecap="round"
                      transform="rotate(-90 48 48)"
                      style={{transition:'stroke-dashoffset 1.2s ease, stroke 0.6s'}}/>
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <div className="font-figtree font-black" style={{fontSize:'20px',color:ctrlColor,lineHeight:'1'}}>{ctrlPct}%</div>
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-syne font-black mb-0.5" style={{fontSize:'8px',color:ctrlColor,letterSpacing:'0.12em'}}>
                    {ctrlPct>=90?'BAJO CONTROL':ctrlPct>=65?'EN PROGRESO':'ATENCIÓN'}
                  </div>
                  <div className="font-syne" style={{fontSize:'7px',color:'rgba(255,255,255,0.22)',lineHeight:'1.5'}}>
                    {totalT - urgentCount} de {totalT}<br/>sin urgencia
                  </div>
                </div>
              </div>
            )
          })()}
        </div>

        {todayItems.length>0&&(
          <div>
            <div className="font-syne font-black tracking-[0.38em] mb-3" style={{fontSize:'7px',color:'rgba(255,255,255,0.12)'}}>AGENDA HOY</div>
            <div className="space-y-1.5">
              {todayItems.map((item,i)=>(
                <button key={i} onClick={()=>onNavigate?.(item.nav)}
                  className="w-full text-left flex items-center gap-3 px-4 py-3 rounded-xl transition-all hover:bg-white/[0.03]"
                  style={{borderLeft:`2px solid ${item.color}`,background:'rgba(255,255,255,0.02)'}}>
                  <span className="flex-1 font-figtree truncate" style={{fontSize:'12px',color:'rgba(255,255,255,0.62)'}}>
                    {item.text}
                  </span>
                  <span className="font-syne font-black px-1.5 py-0.5 rounded-full flex-shrink-0" style={{fontSize:'6px',background:`${item.color}14`,color:item.color}}>
                    {item.type}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {(()=>{
          const focusTasks = data.tasks.filter((t:Task)=>!t.done&&(t.level==='urgent'||t.level==='high')).slice(0,5)
          if (focusTasks.length === 0) return null
          const doneToday = data.tasks.filter((t:Task)=>t.done&&(t.updated_at||t.created_at).slice(0,10)===todayStr).length
          const total = focusTasks.length + doneToday
          const pct = total > 0 ? Math.round(doneToday/total*100) : 0
          return (
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="font-syne font-black tracking-[0.38em]" style={{fontSize:'7px',color:'rgba(255,255,255,0.12)'}}>FOCUS</div>
                <div className="flex items-center gap-1.5">
                  <div className="w-20 h-1 rounded-full overflow-hidden" style={{background:'rgba(255,255,255,0.05)'}}>
                    <div className="h-full rounded-full transition-all" style={{width:`${pct}%`,background:pct===100?GRN:BLU}}/>
                  </div>
                  <span className="font-syne text-[7px] font-black" style={{color:pct===100?GRN:'rgba(255,255,255,0.2)'}}>{pct}%</span>
                </div>
              </div>
              <div className="space-y-1.5">
                {focusTasks.map((t:Task)=>(
                  <div key={t.id} className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl group/ft" style={{background:'rgba(255,255,255,0.02)',border:`1px solid ${t.level==='urgent'?`${RED}18`:BORDER}`}}>
                    <button onClick={async()=>{ try{await data.toggleTask(t.id);showToast('Tarea completada')}catch{} }}
                      className="w-4 h-4 rounded-md border flex-shrink-0 flex items-center justify-center transition-all hover:scale-110 active:scale-95"
                      style={{background:'transparent',borderColor:t.level==='urgent'?`${RED}50`:`${BLU}40`}}>
                      <LucideIcon name="check" size={9} color={t.level==='urgent'?RED:BLU}/>
                    </button>
                    <span className="flex-1 font-syne text-[9px] truncate" style={{color:'rgba(255,255,255,0.55)'}}>{t.text}</span>
                    <span className="font-syne text-[6px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0 opacity-0 group-hover/ft:opacity-100 transition-opacity" style={{background:t.level==='urgent'?`${RED}12`:`${BLU}12`,color:t.level==='urgent'?RED:BLU}}>{t.level==='urgent'?'URG':'HIGH'}</span>
                  </div>
                ))}
              </div>
              <button onClick={()=>onNavigate?.('tareas')} className="mt-2 w-full font-syne text-[7px] font-black tracking-widest text-center py-1.5 rounded-lg transition-all hover:opacity-70" style={{color:'rgba(255,255,255,0.14)',background:'rgba(255,255,255,0.02)'}}>
                VER TODAS → TAREAS
              </button>
            </div>
          )
        })()}

        <div className="mt-auto">
          <div className="font-syne font-black tracking-[0.38em] mb-3" style={{fontSize:'7px',color:'rgba(255,255,255,0.12)'}}>CREAR</div>
          <div className="grid grid-cols-2 gap-2">
            {([
              {label:'Tarea',modal:'tarea',icon:'check-square',c:BLU},
              {label:'Cliente',modal:'cliente',icon:'users',c:GRN},
              {label:'Proyecto',modal:'proyecto',icon:'folder-open',c:'rgba(167,139,250,0.85)'},
              {label:'Contenido',modal:'contenido',icon:'film',c:'rgba(193,53,132,0.85)'},
            ] as const).map((a,i)=>(
              <button key={i} onClick={()=>onOpenModal(a.modal)}
                className="flex items-center gap-2.5 px-3.5 py-3 rounded-xl transition-all hover:opacity-75"
                style={{background:'rgba(255,255,255,0.025)',border:`1px solid ${a.c}18`}}>
                <div className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0" style={{background:`${a.c}15`}}>
                  <LucideIcon name={a.icon} size={11} color={a.c}/>
                </div>
                <span className="font-syne font-black" style={{fontSize:'8px',color:'rgba(255,255,255,0.42)',letterSpacing:'0.08em'}}>
                  + {a.label}
                </span>
              </button>
            ))}
          </div>
        </div>

      </div>

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
