'use client'
import { useState, useEffect, useRef } from 'react'
import { BLU, RED, GRN, SURFACE, BORDER, useIsMobile, dlDate, LucideIcon, getSharedAudio, splitForTTS, stopAllVoices, playAck, isIOSDevice, isSRBroken, markSRBroken, matchTeamMember, todayKey, localDayKey, madridDateLabel, AMBAR} from '@/components/shared'

function HarveySection({data, profile, showToast, onNavigate, preloadMessage, onClearPreload}: any) {
  const isMobile = useIsMobile()
  type HarveyMode = 'idle'|'recording'|'thinking'|'speaking'
  const [mode, setMode] = useState<HarveyMode>('idle')
  const [lastAudioUrl, setLastAudioUrl] = useState<string|null>(null)
  const lastAudioUrlRef = useRef<string|null>(null)
  const [conversation, setConversation] = useState<Array<{role:'user'|'harvey',text:string,searched?:boolean,ts?:string}>>([])
  const [textInput, setTextInput] = useState('')
  const [copiedHarveyIdx, setCopiedHarveyIdx] = useState<number|null>(null)
  const [pendingAction, setPendingAction] = useState<{type:'tarea'|'evento'|'proyecto'|'cliente'|'pieza';text:string;level?:string;date?:string;time?:string;industry?:string;clientName?:string;platform?:string;contentType?:string;assigneeName?:string;invitees?:string}|null>(null)
  const [confirmingAction, setConfirmingAction] = useState(false)
  const [recSeconds, setRecSeconds] = useState(0)
  const [followUps, setFollowUps] = useState<string[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const audioRef = useRef<HTMLAudioElement|null>(null)
  const mediaRecorderRef = useRef<MediaRecorder|null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const recordingTimerRef = useRef<ReturnType<typeof setTimeout>|null>(null)
  const recIntervalRef = useRef<ReturnType<typeof setInterval>|null>(null)
  const modeRef = useRef<HarveyMode>('idle')
  modeRef.current = mode
  const recognitionRef = useRef<any>(null)
  const convEndRef = useRef<HTMLDivElement>(null)
  const harveyActionCardRef = useRef<HTMLDivElement>(null)

  useEffect(() => { convEndRef.current?.scrollIntoView({behavior:'smooth'}) }, [conversation])
  useEffect(() => {
    if (pendingAction && isMobile) setTimeout(() => harveyActionCardRef.current?.scrollIntoView({behavior:'smooth',block:'center'}), 150)
  }, [pendingAction, isMobile])

  const voiceRunRef = useRef(0)
  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      voiceRunRef.current++
      stopAllVoices()
      audioRef.current = null
      if (lastAudioUrlRef.current) { URL.revokeObjectURL(lastAudioUrlRef.current); lastAudioUrlRef.current = null }
      if (mediaRecorderRef.current?.state === 'recording') try { mediaRecorderRef.current.stop() } catch {}
      if (recordingTimerRef.current) clearTimeout(recordingTimerRef.current)
      if (recIntervalRef.current) clearInterval(recIntervalRef.current)
      try { recognitionRef.current?.stop() } catch {}
      recognitionRef.current = null
    }
  }, [])

  // Auto-fire when a message is pre-loaded from another section (e.g. "Ask Harvey about this email")
  useEffect(() => {
    if (!preloadMessage) return
    const msg = preloadMessage
    onClearPreload?.()
    setConversation(prev=>[...prev,{role:'user',text:msg,ts:new Date().toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'})}])
    askHarvey(msg)
  }, [preloadMessage]) // eslint-disable-line react-hooks/exhaustive-deps

  // Spacebar shortcut: toggle recording (only when not typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input,textarea')) return
      if (e.code !== 'Space' || e.metaKey || e.ctrlKey || e.altKey) return
      e.preventDefault()
      if (mode === 'idle') startRecording()
      else if (mode === 'recording') {
        if (recordingTimerRef.current) clearTimeout(recordingTimerRef.current)
        if (recognitionRef.current) {
          const r = recognitionRef.current
          recognitionRef.current = null
          try { r.stop() } catch {}
          setTimeout(() => { if (modeRef.current === 'recording') setMode('idle') }, 3000)
        }
        if (mediaRecorderRef.current?.state==='recording') { setMode('thinking'); mediaRecorderRef.current.stop() }
      } else if (mode === 'speaking') { voiceRunRef.current++; stopAudio(); setMode('idle') }
      else if (mode === 'thinking') { voiceRunRef.current++; stopAllVoices(); setIsSearching(false); setMode('idle') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

  const buildContext = () => {
    const tasks = (data.tasks||[]) as any[]
    const projects = (data.projects||[]) as any[]
    const clients = (data.clients||[]) as any[]
    const agenda = (data.agenda||[]) as any[]
    const inbox = (data.inbox||[]) as any[]
    const calEvents = (data.calendarEvents||[]) as any[]
    const urgentTasks = tasks.filter(t=>!t.done&&t.level==='urgent')
    const highTasks = tasks.filter(t=>!t.done&&t.level==='high')
    const overdueProjects = projects.filter(p=>p.deadline&&p.deadline!=='TBD'&&p.status!=='completado'&&dlDate(p.deadline)<new Date())
    const activeProjects = projects.filter(p=>p.status!=='completado')
    const activeClients = clients.filter(c=>c.status==='Activo')
    const pipeline = agenda.filter((a:any)=>a.status!=='publicado')
    const todayStr = todayKey()
    // Incluye los no leídos + los urgentes/altos recibidos HOY aunque ya se hayan
    // leído: si acabas de abrir un email importante, Harvey debe seguir sabiéndolo.
    const unreadEmails = inbox.filter((m:any)=>
      // localDayKey, no slice(0,10): el ISO viene en UTC y todayStr es el dia de
      // Madrid. De 00:00 a 02:00 no son el mismo dia y el email de hoy no contaba.
      !m.is_read || ((m.ai_urgency==='urgent'||m.ai_urgency==='high') && localDayKey(m.received_at)===todayStr)
    ).slice(0, 8)
    const completedToday = tasks.filter(t=>t.done&&localDayKey(t.completed_at||t.updated_at||t.created_at)===todayStr).length
    const nextEvents = calEvents.filter((e:any)=>e.start>=todayStr).slice(0,5)
    const todayTasks = tasks.filter(t=>!t.done&&t.due_date===todayStr)

    const emailLines = unreadEmails.map((m:any) => {
      const urg = m.ai_urgency==='urgent'?'[URGENTE]':m.ai_urgency==='high'?'[ALTA]':'[NORMAL]'
      const colabs = m.shared ? '[COLABS]' : '[PERSONAL]'
      const summary = m.ai_summary ? ` → "${m.ai_summary}"` : ''
      const action = !m.ai_summary && m.ai_action&&m.ai_action!=='Ninguna acción requerida'?` → ${m.ai_action}`:''
      return `  • ${m.from_name||'?'}: "${m.subject||'Sin asunto'}" ${urg}${colabs}${summary||action}`
    }).join('\n')

    const eventLines = nextEvents.map((e:any) => {
      const hasTime = e.start && e.start.includes('T')
      const timeStr = hasTime ? ` a las ${e.start.slice(11,16)}` : ''
      return `${e.title} (${e.start?.slice(0,10)||'?'}${timeStr})`
    }).join(' · ')

    const memLines2 = ((data.memoria||[]) as any[]).slice(0,12).map((m:any)=>`  - ${m.title}${m.category?` [${m.category}]`:''}: ${(m.content||'').replace(/\s+/g,' ').slice(0,400)}`).join('\n')

    return `BRUTAL STUDIOS — ${madridDateLabel()}

TAREAS: ${tasks.filter(t=>!t.done).length} pendientes | ${completedToday} completadas hoy
URGENTES (${urgentTasks.length}): ${urgentTasks.slice(0,5).map((t:any)=>t.text).join(' · ')||'ninguna'}
ALTA PRIORIDAD (${highTasks.length}): ${highTasks.slice(0,3).map((t:any)=>t.text).join(' · ')||'ninguna'}
${todayTasks.length>0?`VENCEN HOY (${todayTasks.length}): ${todayTasks.map((t:any)=>t.text).join(' · ')}\n`:''}
PROYECTOS ACTIVOS (${activeProjects.length}): ${activeProjects.slice(0,6).map((p:any)=>`${p.name} ${p.progress}%${overdueProjects.find((op:any)=>op.id===p.id)?' [ATRASADO]':''}`).join(' | ')||'ninguno'}
CLIENTES ACTIVOS (${activeClients.length}): ${activeClients.map((c:any)=>c.name).join(', ')||'ninguno'}
EQUIPO: ${((data.team||[]) as any[]).map((m:any)=>m.name).filter(Boolean).join(', ')||'sin datos'}
PIPELINE CONTENIDO: ${pipeline.length} piezas pendientes

INBOX — ${unreadEmails.length} sin leer:
${emailLines||'  (inbox vacío)'}

CALENDARIO PRÓXIMO: ${eventLines||'sin eventos próximos'}

DOCUMENTOS Y CONOCIMIENTO (memoria — úsalo si es relevante):
${memLines2||'  sin documentos'}`
  }

  const stopAudio = () => {
    voiceRunRef.current++
    stopAllVoices()
    audioRef.current = null
  }

  // ÚNICA voz (Vega, servidor). Si falla, silencio + texto en pantalla;
  // jamás la voz robótica del navegador.
  const speak = async (text: string, prefetch?: { text: string; promise: Promise<Response> }) => {
    if (!text?.trim()) { setMode('idle'); return }
    const run = voiceRunRef.current
    stopAllVoices()
    setMode('speaking')
    try {
      // Trocea: la primera frase se pide y suena YA (~1,5s); el resto se
      // genera en paralelo mientras la primera se reproduce. Si la primera
      // frase ya se pidió DURANTE el streaming del chat (prefetch), se reutiliza.
      const chunks = splitForTTS(text)
      const requests = chunks.map((c, i) =>
        (i === 0 && prefetch && prefetch.text === c)
          ? prefetch.promise
          : fetch('/api/harvey/speak', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({text:c}), signal:AbortSignal.timeout(45000) }))
      const audio = getSharedAudio() || new Audio()
      audioRef.current = audio
      const blobs: Blob[] = []
      for (let i = 0; i < requests.length; i++) {
        const res = await requests[i].catch(() => null)
        if (!aliveRef.current || run !== voiceRunRef.current) return
        if (!res?.ok) { if (i === 0) setMode('idle'); break }
        const blob = await res.blob()
        if (!blob.size) { if (i === 0) setMode('idle'); break }
        if (!aliveRef.current || run !== voiceRunRef.current) return
        blobs.push(blob)
        const url = URL.createObjectURL(blob)
        // Fin natural (onended) o stop del usuario (run cambia). iOS a veces
        // PAUSA el audio al hacer scroll — eso no es un fin: se reanuda.
        const done = new Promise<void>(resolve => {
          const fin = () => resolve()
          audio.onended = fin; audio.onerror = fin
          audio.onpause = () => {
            if (audio.ended) return
            if (!aliveRef.current || run !== voiceRunRef.current) { fin(); return }
            // Pausa espuria (scroll iOS): reanudar con reintentos rápidos
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
        // Si el autoplay está bloqueado queda el botón ESCUCHAR, que reproduce
        // dentro del gesto del usuario.
        const played = await audio.play().then(() => true).catch(() => false)
        if (!played) { setMode('idle'); URL.revokeObjectURL(url); return }
        await done
        audio.onpause = null
        URL.revokeObjectURL(url)
        if (!aliveRef.current || run !== voiceRunRef.current) return
      }
      // Audio completo para el botón ESCUCHAR
      if (blobs.length) {
        const full = URL.createObjectURL(new Blob(blobs, { type: 'audio/mpeg' }))
        setLastAudioUrl(prev => { if (prev) URL.revokeObjectURL(prev); return full })
        lastAudioUrlRef.current = full
      }
      if (modeRef.current === 'speaking') setMode('idle')
    } catch { setMode('idle') }
  }

  const generateFollowUps = (userText: string, reply: string): string[] => {
    const low = (userText + ' ' + reply).toLowerCase()
    const suggestions: string[] = []
    if (low.includes('urgente') || low.includes('tarea')) suggestions.push('¿Cuáles son las más críticas?')
    if (low.includes('proyecto') || low.includes('atrasado')) suggestions.push('¿Qué proyecto necesita más atención?')
    if (low.includes('email') || low.includes('inbox') || low.includes('mensaje')) suggestions.push('¿Hay alguno urgente?')
    if (low.includes('cliente')) suggestions.push('¿Algún cliente necesita seguimiento?')
    if (low.includes('contenido') || low.includes('pipeline') || low.includes('pieza')) suggestions.push('Añade una pieza a Instagram')
    if (!suggestions.length) {
      suggestions.push('¿Qué debería hacer primero?', '¿Y el pipeline de contenido?')
    }
    return suggestions.slice(0, 3)
  }

  const askHarvey = async (userText: string) => {
    const run = ++voiceRunRef.current
    setMode('thinking')
    setFollowUps([])
    const searchTriggers = /busca|encuentra|consigue|influencer|instagram|tiktok|youtube|precio|tendencia|trend|noticias|actualidad|últim|listado|lista de|quién es|qué es|estadística|hashtag|seguidores|marca|agencia|competencia|referente|ejemplo de|casos de|cómo se hace|qué plataforma|cuánto cuesta|cuánto cobra/i
    if (searchTriggers.test(userText)) setIsSearching(true)
    try {
      const res = await fetch('/api/harvey/chat', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ message:userText, context:buildContext(), history:conversation.slice(-10), stream:true }),
        signal: AbortSignal.timeout(60000),
      })
      if (!aliveRef.current || run !== voiceRunRef.current) { setIsSearching(false); return }
      if (!res.ok) { const j = await res.json().catch(()=>({})); throw new Error(j.error||'Error') }

      let reply = ''
      let searched = false
      let prefetch: { text: string; promise: Promise<Response> } | undefined
      const ct = res.headers.get('content-type') || ''
      if (res.body && ct.includes('text/plain')) {
        // Streaming: en cuanto hay una primera frase completa, se pide su voz
        // EN PARALELO mientras el resto de la respuesta sigue generándose
        searched = res.headers.get('x-searched') === '1'
        const reader = res.body.getReader()
        const dec = new TextDecoder()
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (!aliveRef.current || run !== voiceRunRef.current) { try { reader.cancel() } catch {}; setIsSearching(false); return }
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
        searched = !!json.searched
      }
      if (!aliveRef.current || run !== voiceRunRef.current) { setIsSearching(false); return }
      reply = reply.trim()
      if (!reply) { setIsSearching(false); setMode('idle'); return }

      // Parse action command
      const actionMatch = reply.match(/\[ACCION:([^\]]+)\]/)
      if (actionMatch) {
        reply = reply.replace(/\[ACCION:[^\]]*\]/g, '').trim()
        const parts = actionMatch[1].split('|')
        const type = parts[0] as 'tarea'|'evento'|'proyecto'|'cliente'|'pieza'
        if (type==='tarea')    setPendingAction({type:'tarea',    text:parts[1]||'', level:parts[2]||'high', assigneeName:parts[3]?.trim()||''})
        if (type==='evento')   setPendingAction({type:'evento',   text:parts[1]||'', date:parts[2]||'', time:parts[3]||'', invitees:parts[4]?.trim()||''})
        if (type==='proyecto') setPendingAction({type:'proyecto', text:parts[1]||'', clientName:parts[2]||'', date:parts[3]||''})
        if (type==='cliente')  setPendingAction({type:'cliente',  text:parts[1]||'', industry:parts[2]||'—'})
        if (type==='pieza')    setPendingAction({type:'pieza',    text:parts[1]||'', platform:parts[2]||'Instagram', contentType:parts[3]||'Post'})
      }

      setIsSearching(false)
      setConversation(prev=>[...prev,{role:'harvey',text:reply,searched,ts:new Date().toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'})}])
      setFollowUps(generateFollowUps(userText, reply))
      await speak(reply, prefetch)
    } catch { setIsSearching(false); setMode('idle'); showToast('Error conectando con Harvey') }
  }

  const transcribeAndAsk = async (blob: Blob, preText?: string) => {
    const run = ++voiceRunRef.current
    setMode('thinking')
    playAck()
    try {
      let text = (preText || '').trim()

      // Transcripción en servidor (solo si venía de grabación, no de reconocimiento del navegador)
      if (!text && blob) {
        const form = new FormData()
        form.append('audio', blob, blob.type.includes('mp4')?'rec.mp4':'rec.webm')
        const res = await fetch('/api/harvey/transcribe', { method:'POST', body:form, signal:AbortSignal.timeout(30000) })
        if (!aliveRef.current || run !== voiceRunRef.current) return
        const json = await res.json()
        text = (json.text||'').trim()
      }

      if (!text) { setMode('idle'); showToast('No te escuché — vuelve a intentarlo'); return }
      setConversation(prev=>[...prev,{role:'user',text,ts:new Date().toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'})}])
      await askHarvey(text)
    } catch { setMode('idle'); showToast('Error al procesar audio') }
  }

  const startRecording = async () => {
    // Nueva consulta: invalida cualquier flujo anterior y corta la voz en curso
    voiceRunRef.current++
    stopAllVoices()
    // Escritorio: SR del navegador. iOS: SIEMPRE MediaRecorder + Groq
    // (el SR nativo de iOS falla silenciosamente en la 2ª sesión).
    const SR = (window as any).SpeechRecognition||(window as any).webkitSpeechRecognition
    if (SR && !isIOSDevice() && !isSRBroken()) {
      if (recognitionRef.current) { try { recognitionRef.current.stop() } catch {} }
      recognitionRef.current = null
      const r = new SR()
      // interimResults: iOS a veces nunca marca el resultado como final —
      // acumulamos los parciales y los rescatamos en onend.
      r.lang='es-ES'; r.continuous=false; r.interimResults=true
      let gotResult = false
      let finalText = '', interimText = ''
      const fire = (txt: string) => { gotResult = true; transcribeAndAsk(null as any, txt) }
      r.onstart = ()=>{ setMode('recording'); setRecSeconds(0); if(recIntervalRef.current) clearInterval(recIntervalRef.current); recIntervalRef.current = setInterval(()=>setRecSeconds(s=>s+1),1000) }
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
        if(recIntervalRef.current) clearInterval(recIntervalRef.current)
        if (gotResult) return
        if (['service-not-allowed','network','audio-capture'].includes(e.error)) { markSRBroken(); startMediaRecording(); return }
        setMode('idle')
        if(e.error==='not-allowed') showToast('Permite el micrófono en el navegador')
        else if(e.error!=='no-speech') showToast('No se entendió — vuelve a pulsar')
      }
      r.onend = ()=>{
        if (recognitionRef.current !== null && recognitionRef.current !== r) return
        recognitionRef.current = null
        if(recIntervalRef.current) clearInterval(recIntervalRef.current)
        setRecSeconds(0)
        if (gotResult) return
        // Rescate iOS: si nunca llegó un final, usa el último parcial
        const txt = (finalText || interimText).trim()
        if (txt) { fire(txt); return }
        if (modeRef.current==='recording') setMode('idle')
      }
      recognitionRef.current = r
      try { r.start(); return } catch { recognitionRef.current = null }
    }
    // 2) Fallback: grabar + transcribir en servidor (Groq → OpenAI Whisper)
    await startMediaRecording()
  }

  const startMediaRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({audio:true})
      // Si el constructor de MediaRecorder lanza (mimeType no soportado en este
      // navegador), el stream ya está abierto: sin este catch el micrófono se
      // quedaba encendido —con su indicador rojo— hasta recargar la página.
      let mr: MediaRecorder
      try {
        mr = new MediaRecorder(stream, {mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')?'audio/webm;codecs=opus':MediaRecorder.isTypeSupported('audio/webm')?'audio/webm':'audio/mp4', audioBitsPerSecond:128000})
      } catch (err) {
        stream.getTracks().forEach(t=>t.stop())
        throw err
      }
      audioChunksRef.current = []
      mr.ondataavailable = e => { if(e.data.size>0) audioChunksRef.current.push(e.data) }
      mr.onstop = () => {
        stream.getTracks().forEach(t=>t.stop())
        if(recIntervalRef.current) clearInterval(recIntervalRef.current)
        setRecSeconds(0)
        if (modeRef.current === 'idle') return
        const blob = new Blob(audioChunksRef.current, {type: mr.mimeType})
        transcribeAndAsk(blob)
      }
      mr.start(100)
      mediaRecorderRef.current = mr
      setMode('recording')
      setRecSeconds(0)
      recIntervalRef.current = setInterval(() => setRecSeconds(s=>s+1), 1000)
      recordingTimerRef.current = setTimeout(() => { if(mediaRecorderRef.current?.state==='recording') mediaRecorderRef.current.stop() }, 30000)
    } catch (err: any) {
      setMode('idle')
      if (err?.name==='NotAllowedError') showToast('Permite el micrófono en el navegador')
      else showToast('Error al acceder al micrófono')
    }
  }

  const handleOrb = () => {
    if (mode==='speaking') { voiceRunRef.current++; stopAudio(); setMode('idle') }
    else if (mode==='recording') {
      if (recordingTimerRef.current) clearTimeout(recordingTimerRef.current)
      if (recognitionRef.current) {
        const r = recognitionRef.current
        recognitionRef.current = null
        try { r.stop() } catch {}
        // Watchdog: si el SR no emite ni resultado ni fin en 3s, libera el orbe
        setTimeout(() => { if (modeRef.current === 'recording') setMode('idle') }, 3000)
      }
      if (mediaRecorderRef.current?.state==='recording') { setMode('thinking'); mediaRecorderRef.current.stop() }
    }
    else if (mode==='idle') startRecording()
    else if (mode==='thinking') {
      // Escape: si una petición se cuelga, un toque resetea el orbe SIEMPRE
      voiceRunRef.current++
      stopAllVoices()
      if (recognitionRef.current) { try { recognitionRef.current.stop() } catch {}; recognitionRef.current = null }
      if (mediaRecorderRef.current?.state==='recording') try { mediaRecorderRef.current.stop() } catch {}
      if (recIntervalRef.current) clearInterval(recIntervalRef.current)
      setIsSearching(false)
      setMode('idle')
    }
  }

  const confirmHarveyAction = async () => {
    if (!pendingAction) return
    setConfirmingAction(true)
    try {
      const rColor = ['#6366f1','#8b5cf6','#ec4899','#f59e0b','#10b981','#3b82f6'][Math.floor(Math.random()*6)]
      if (pendingAction.type==='tarea') {
        const member = pendingAction.assigneeName ? matchTeamMember((data.team||[]) as any[], pendingAction.assigneeName) : null
        await data.createTask({text:pendingAction.text, level:pendingAction.level||'high', source:'ai', ...(member ? { assigned_to: member.id } : {})})
        showToast(member ? `Tarea creada y asignada a ${member.name}`
          : pendingAction.assigneeName ? `Tarea creada (sin asignar: no encontré a "${pendingAction.assigneeName}")`
          : 'Tarea creada por Harvey')
      } else if (pendingAction.type==='proyecto') {
        const client = pendingAction.clientName
          ? (data.clients as any[]).find((c:any)=>c.name.toLowerCase().includes((pendingAction.clientName||'').toLowerCase()))
          : null
        await data.createProject({name:pendingAction.text, client_id:client?.id, status:'activo', progress:0, deadline:pendingAction.date||'TBD', color:client?.color||rColor})
        showToast('Proyecto creado por Harvey')
      } else if (pendingAction.type==='cliente') {
        await data.createClient({name:pendingAction.text, industry:pendingAction.industry||'—', revenue:'—', color:rColor, status:'Activo'})
        showToast('Cliente creado por Harvey')
      } else if (pendingAction.type==='pieza') {
        const client = pendingAction.clientName
          ? (data.clients as any[]).find((c:any)=>c.name.toLowerCase().includes((pendingAction.clientName||'').toLowerCase()))
          : null
        await data.createAgenda({title:pendingAction.text, platform:pendingAction.platform||'Instagram', content_type:pendingAction.contentType||'Post', status:'borrador', publish_date:pendingAction.date||undefined, client_id:client?.id})
        showToast('Pieza añadida al pipeline de contenido')
      } else if (pendingAction.type==='evento') {
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
    } catch { showToast('Error al crear') }
    finally { setConfirmingAction(false) }
  }

  // React ejecuta los efectos en orden de declaración, así que este corría ANTES
  // del de carga (justo debajo) con `conversation` todavía vacía: hacía
  // removeItem y borraba el historial del día un instante antes de que el otro
  // efecto intentara leerlo. Resultado: la conversación no se restauraba nunca y
  // cada recarga empezaba de cero con el saludo.
  //
  // El flag lo pone el efecto de carga cuando termina. Hasta entonces aquí no se
  // escribe nada, así que el borrado por conversación vacía solo ocurre cuando de
  // verdad la ha vaciado alguien (el botón de reiniciar).
  const historialCargado = useRef(false)

  // Save conversation to localStorage on every change (max 50KB to avoid quota errors)
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!historialCargado.current) return
    try {
      const key = 'harvey_conv_' + todayKey()
      if (conversation.length === 0) { localStorage.removeItem(key); return }
      let slice = conversation.slice(-60)
      let serialized = JSON.stringify(slice)
      while (serialized.length > 50_000 && slice.length > 1) {
        slice = slice.slice(1)
        serialized = JSON.stringify(slice)
      }
      localStorage.setItem(key, serialized)
    } catch {}
  }, [conversation])

  // Load persisted conversation or show greeting
  useEffect(() => {
    if (typeof window === 'undefined') return
    // El flag se pone SIEMPRE al salir, por cualquiera de las tres vías: si no,
    // el efecto de guardado quedaría inhibido para toda la sesión y no se
    // persistiría nada de lo que se hable a partir de ahí.
    try {
      const key = 'harvey_conv_' + todayKey()
      const saved = localStorage.getItem(key)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed) && parsed.length > 0) {
          setConversation(parsed)
          historialCargado.current = true
          return
        }
      }
    } catch {}
    historialCargado.current = true
    // No saved conv — show greeting once per day
    const SK = 'harvey_greeted_' + todayKey()
    if (sessionStorage.getItem(SK)) return
    sessionStorage.setItem(SK, '1')
    const nUrgent = (data.tasks||[]).filter((t:any)=>!t.done&&t.level==='urgent').length
    const nOverdue = (data.projects||[]).filter((p:any)=>p.deadline&&p.deadline!=='TBD'&&p.status!=='completado'&&dlDate(p.deadline)<new Date()).length
    const nUnread = (data.inbox||[]).filter((m:any)=>!m.is_read).length
    const firstName = profile?.name?.split(' ')?.[0]||'Jefe'
    const h = new Date().getHours()
    const saludo = h<13?'Buenos días':h<20?'Buenas tardes':'Buenas noches'
    let g = `${saludo}, ${firstName}.`
    if (nUrgent>0) g += ` ${nUrgent} tarea${nUrgent>1?'s urgentes':' urgente'}.`
    if (nOverdue>0) g += ` ${nOverdue} proyecto${nOverdue>1?'s atrasados':' atrasado'}.`
    if (nUnread>0) g += ` ${nUnread} email${nUnread>1?'s sin leer':' sin leer'}.`
    if (!nUrgent&&!nOverdue&&!nUnread) g += ' Todo bajo control.'
    g += ' ¿En qué te ayudo?'
    setConversation([{role:'harvey',text:g,ts:new Date().toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'})}])
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const MC: Record<HarveyMode,string> = { idle:BLU, recording:RED, thinking:'rgba(139,92,246,0.9)', speaking:BLU }
  const orbLabel: Record<HarveyMode,string> = { idle:'ESPACIO / CLIC · HABLA', recording:`GRABANDO ${recSeconds}s · SUELTA`, thinking: isSearching ? 'BUSCANDO EN INTERNET…' : 'PROCESANDO…', speaking:'REPRODUCIENDO · CLIC PARA PARAR' }

  const urgentTasks = (data.tasks||[]).filter((t:any)=>!t.done&&t.level==='urgent')
  const activeProjects = (data.projects||[]).filter((p:any)=>p.status!=='completado')
  const unreadEmails = (data.inbox||[]).filter((m:any)=>!m.is_read)

  const pipeline = (data.agenda||[]).filter((a:any)=>a.status!=='publicado')
  const todayStrH = todayKey()
  const overdueProjectsH = (data.projects||[]).filter((p:any)=>p.deadline&&p.deadline!=='TBD'&&p.status!=='completado'&&dlDate(p.deadline)<new Date())
  const todayCalEvtsH = ((data.calendarEvents||[]) as any[]).filter((e:any)=>e.start?.slice(0,10)===todayStrH)
  const urgentUnread = unreadEmails.filter((m:any)=>m.ai_urgency==='urgent')
  const quickActions = [
    ...(urgentTasks.length>0 ? [{t:`Prioriza mis ${urgentTasks.length} tareas urgentes`, icon:'zap', c:RED}] : []),
    ...(urgentUnread.length>0 ? [{t:`Tengo ${urgentUnread.length} email${urgentUnread.length>1?'s':''} urgente${urgentUnread.length>1?'s':''}, ¿qué hago?`, icon:'mail', c:RED}] : unreadEmails.length>0 ? [{t:`Resume los ${unreadEmails.length} emails sin leer`, icon:'mail', c:'rgba(234,67,53,0.8)'}] : []),
    ...(overdueProjectsH.length>0 ? [{t:`¿Cómo recuperamos "${overdueProjectsH[0]?.name}"?`, icon:'alert-circle', c:AMBAR}] : []),
    ...(todayCalEvtsH.length>0 ? [{t:`Prepárame para "${todayCalEvtsH[0]?.title}"`, icon:'calendar', c:'#A78BFA'}] : []),
    ...(urgentTasks.length===0&&urgentUnread.length===0 ? [{t:'¿Cómo está Brutal Studios hoy?', icon:'bar-chart-2', c:GRN}] : []),
    ...(pipeline.length>0 ? [{t:`Crea una pieza para Instagram`, icon:'film', c:'rgba(193,53,132,0.9)'}] : []),
    {t:'Crea una tarea urgente', icon:'plus-circle', c:BLU},
  ].slice(0,4)

  return (
    <div className="h-full flex flex-col overflow-hidden relative" style={{background:`radial-gradient(ellipse 90% 50% at 50% -10%,rgba(27,95,250,0.12) 0%,transparent 65%),${SURFACE}`}}>

      {/* Ambient glow layer */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] rounded-full opacity-20" style={{background:`radial-gradient(ellipse,${MC[mode]} 0%,transparent 70%)`,filter:'blur(60px)',transition:'background 0.8s ease'}}/>
      </div>

      {/* Header bar */}
      <div className={`flex items-center justify-between px-7 pt-6 pb-4 flex-shrink-0 relative z-10${isMobile?' flex-wrap gap-y-3':''}`} style={{borderBottom:`1px solid ${BORDER}`}}>
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{background:'rgba(27,95,250,0.12)',border:`1px solid rgba(27,95,250,0.2)`}}>
            <LucideIcon name="cpu" size={14} color={BLU}/>
          </div>
          <div className="min-w-0">
            <div className="font-figtree text-[18px] font-black text-white leading-none" style={{letterSpacing:'-0.03em'}}>Harvey</div>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className="font-syne text-[7.5px] tracking-widest whitespace-nowrap" style={{color:'rgba(27,95,250,0.5)'}}>EXECUTIVE AI{isMobile?'':' · BRUTAL STUDIOS'}</span>
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full" style={{background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.07)'}}>
                <span className="w-1 h-1 rounded-full" style={{background:GRN}}/>
                <span className="font-syne text-[6.5px] font-black tracking-wide" style={{color:'rgba(255,255,255,0.28)'}}>
                  Vega · voz IA
                </span>
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2" style={isMobile?{flexBasis:'100%',justifyContent:'space-between'}:undefined}>
          {([
            {v:urgentTasks.length, l:'URG', c:RED},
            {v:activeProjects.length, l:'PROJ', c:BLU},
            {v:unreadEmails.length, l:'INBOX', c:AMBAR},
          ] as {v:number,l:string,c:string}[]).map((m,i)=>(
            <div key={i} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl" style={{background:m.v>0?m.c+'12':'rgba(255,255,255,0.03)',border:`1px solid ${m.v>0?m.c+'30':BORDER}`}}>
              <span className="font-figtree text-[15px] font-black leading-none" style={{color:m.v>0?m.c:'rgba(255,255,255,0.2)'}}>{m.v}</span>
              <span className="font-syne text-[6.5px] font-black tracking-widest" style={{color:m.v>0?m.c:'rgba(255,255,255,0.15)'}}>{m.l}</span>
            </div>
          ))}
          <button onClick={()=>{ stopAudio(); setConversation([]); setPendingAction(null); setFollowUps([]); if(typeof window!=='undefined'){sessionStorage.removeItem('harvey_greeted_'+todayKey());try{localStorage.removeItem('harvey_conv_'+todayKey())}catch{}} }} className={`${isMobile?'w-9 h-9':'w-7 h-7'} rounded-lg flex items-center justify-center transition-all hover:opacity-60`} style={{background:'rgba(255,255,255,0.04)',border:`1px solid ${BORDER}`}} title="Reiniciar conversación">
            <LucideIcon name="rotate-ccw" size={12} color="rgba(255,255,255,0.3)"/>
          </button>
        </div>
      </div>

      {/* Conversation */}
      <div className={`flex-1 overflow-y-auto ${isMobile?'px-4':'px-7'} py-4 space-y-3 relative z-10`}>
        {conversation.map((msg,i)=>(
          <div key={i} className={`flex items-end gap-2.5 group/hconv ${msg.role==='user'?'justify-end':'justify-start'}`}>
            {msg.role==='harvey' && (
              <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mb-0.5" style={{background:'rgba(27,95,250,0.15)',border:'1px solid rgba(27,95,250,0.25)'}}>
                <LucideIcon name="cpu" size={10} color={BLU}/>
              </div>
            )}
            <div className="flex flex-col" style={{alignItems:msg.role==='harvey'?'flex-start':'flex-end',maxWidth:'75%'}}>
              <div className={`px-4 py-3 rounded-2xl ${msg.role==='harvey'?'rounded-bl-sm':'rounded-br-sm'}`} style={{
                background: msg.role==='harvey' ? 'rgba(27,95,250,0.08)' : 'rgba(255,255,255,0.06)',
                border: `1px solid ${msg.role==='harvey' ? 'rgba(27,95,250,0.2)' : 'rgba(255,255,255,0.1)'}`,
                backdropFilter: 'blur(8px)',
              }}>
                {msg.role==='harvey' && (
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="font-syne text-[7px] font-black tracking-[0.2em]" style={{color:'rgba(27,95,250,0.6)'}}>HARVEY</span>
                    {msg.searched && (
                      <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full font-syne text-[6.5px] font-black tracking-wide" style={{background:'rgba(34,197,94,0.1)',border:'1px solid rgba(34,197,94,0.25)',color:'rgba(34,197,94,0.8)'}}>
                        <LucideIcon name="globe" size={7} color="rgba(34,197,94,0.8)"/>WEB
                      </span>
                    )}
                  </div>
                )}
                <div className="font-figtree text-[13.5px] leading-relaxed whitespace-pre-wrap" style={{color:msg.role==='harvey'?'rgba(255,255,255,0.88)':'rgba(255,255,255,0.7)'}}>{msg.text}</div>
              </div>
              {/* Meta row: copy + timestamp (siempre visible en móvil, hover en escritorio) */}
              <div className={`flex items-center gap-2 mt-1 px-1 transition-opacity ${isMobile?'opacity-100':'opacity-0 group-hover/hconv:opacity-100'}`}>
                {msg.ts && <span className="font-syne text-[7px]" style={{color:'rgba(255,255,255,0.15)'}}>{msg.ts}</span>}
                {msg.role==='harvey' && i===conversation.length-1 && lastAudioUrl && (
                  <button onClick={()=>{ const a=getSharedAudio(); if(!a) return; a.src=lastAudioUrl; a.onended=()=>{ if(modeRef.current==='speaking') setMode('idle') }; setMode('speaking'); a.play().catch(()=>setMode('idle')) }}
                    className="flex items-center gap-1 px-2 py-0.5 rounded-lg transition-all"
                    style={{background:'rgba(27,95,250,0.08)',color:BLU}}>
                    <LucideIcon name="volume-2" size={9} color={BLU}/>
                    <span className="font-syne text-[6.5px] font-black tracking-wide">ESCUCHAR</span>
                  </button>
                )}
                {msg.role==='harvey' && (
                  <button onClick={()=>{ navigator.clipboard.writeText(msg.text).catch(()=>{}); setCopiedHarveyIdx(i); setTimeout(()=>setCopiedHarveyIdx(null),1800) }}
                    className="flex items-center gap-1 px-2 py-0.5 rounded-lg transition-all"
                    style={{background:'transparent',color:copiedHarveyIdx===i?GRN:'rgba(255,255,255,0.22)'}}>
                    <LucideIcon name={copiedHarveyIdx===i?'check':'copy'} size={9} color={copiedHarveyIdx===i?GRN:'rgba(255,255,255,0.22)'}/>
                    <span className="font-syne text-[6.5px] font-black tracking-wide">{copiedHarveyIdx===i?'COPIADO':'COPIAR'}</span>
                  </button>
                )}
              </div>
            </div>
            {msg.role==='user' && (
              <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mb-5 font-syne text-[8px] font-black" style={{background:profile?.avatar_color+'20',border:`1px solid ${profile?.avatar_color}35`,color:profile?.avatar_color}}>{profile?.initials||'?'}</div>
            )}
          </div>
        ))}
        {mode==='thinking' && (
          <div className="flex items-end gap-2.5 justify-start">
            <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{background: isSearching?'rgba(34,197,94,0.15)':'rgba(27,95,250,0.15)',border:`1px solid ${isSearching?'rgba(34,197,94,0.3)':'rgba(27,95,250,0.25)'}`}}>
              <LucideIcon name={isSearching?'globe':'cpu'} size={10} color={isSearching?GRN:BLU}/>
            </div>
            <div className="px-4 py-3 rounded-2xl rounded-bl-sm" style={{background: isSearching?'rgba(34,197,94,0.06)':'rgba(27,95,250,0.08)',border:`1px solid ${isSearching?'rgba(34,197,94,0.2)':'rgba(27,95,250,0.2)'}`}}>
              <div className="flex gap-1.5 items-center">
                <div className="w-1.5 h-1.5 rounded-full animate-dot1" style={{background:isSearching?GRN:BLU}}/>
                <div className="w-1.5 h-1.5 rounded-full animate-dot2" style={{background:isSearching?GRN:BLU}}/>
                <div className="w-1.5 h-1.5 rounded-full animate-dot3" style={{background:isSearching?GRN:BLU}}/>
                {isSearching && <span className="font-syne text-[7px] font-black tracking-wide ml-1" style={{color:'rgba(34,197,94,0.7)'}}>BUSCANDO EN WEB…</span>}
              </div>
            </div>
          </div>
        )}
        {/* Follow-up suggestions after Harvey replies */}
        {followUps.length > 0 && mode === 'idle' && !pendingAction && (
          <div className="flex flex-wrap gap-2 justify-start pt-1 animate-fadeUp">
            {followUps.map((f,i)=>(
              <button key={i} onClick={()=>{ setFollowUps([]); setConversation(prev=>[...prev,{role:'user',text:f,ts:new Date().toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'})}]); askHarvey(f) }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-syne text-[8px] font-black tracking-wide transition-all hover:opacity-80"
                style={{background:'rgba(27,95,250,0.08)',border:'1px solid rgba(27,95,250,0.18)',color:'rgba(255,255,255,0.5)'}}>
                <LucideIcon name="corner-down-right" size={9} color={BLU}/>
                {f}
              </button>
            ))}
          </div>
        )}
        <div ref={convEndRef}/>
      </div>

      {/* Pending action card — inline on desktop */}
      {pendingAction && mode==='idle' && !isMobile && (
        <div ref={harveyActionCardRef} className="mx-7 mb-3 rounded-2xl overflow-hidden flex-shrink-0 relative z-10 animate-fadeUp" style={{background:'rgba(27,95,250,0.07)',border:'1px solid rgba(27,95,250,0.22)'}}>
          <div className="px-4 pt-3.5 pb-1 flex items-center gap-2">
            <LucideIcon name={pendingAction.type==='tarea'?'check-square':pendingAction.type==='evento'?'calendar':pendingAction.type==='proyecto'?'folder':pendingAction.type==='pieza'?'film':'user'} size={12} color={BLU}/>
            <span className="font-syne text-[7.5px] font-black tracking-widest" style={{color:'rgba(27,95,250,0.7)'}}>HARVEY PROPONE — {pendingAction.type==='pieza'?'PIPELINE':pendingAction.type.toUpperCase()}</span>
          </div>
          <div className="px-4 pb-3.5">
            <p className="font-figtree text-[14px] font-semibold mb-2" style={{color:'rgba(255,255,255,0.9)'}}>{pendingAction.text}</p>
            <div className="flex items-center gap-1.5 mb-3 flex-wrap">
              {pendingAction.level && <span className="font-syne text-[7px] font-black px-2 py-0.5 rounded-full" style={{background:pendingAction.level==='urgent'?`${RED}15`:pendingAction.level==='high'?'rgba(255,176,32,0.12)':`${BLU}15`,color:pendingAction.level==='urgent'?RED:pendingAction.level==='high'?AMBAR:BLU}}>{pendingAction.level.toUpperCase()}</span>}
              {pendingAction.platform && <span className="font-syne text-[7px] font-black px-2 py-0.5 rounded-full" style={{background:'rgba(193,53,132,0.12)',color:'rgba(193,53,132,0.9)'}}>{pendingAction.platform}</span>}
              {pendingAction.contentType && <span className="font-syne text-[7px] px-2 py-0.5 rounded-full" style={{background:'rgba(255,255,255,0.06)',color:'rgba(255,255,255,0.4)'}}>{pendingAction.contentType}</span>}
              {pendingAction.clientName && <span className="font-syne text-[7px] px-2 py-0.5 rounded-full" style={{background:'rgba(255,255,255,0.06)',color:'rgba(255,255,255,0.4)'}}>Cliente: {pendingAction.clientName}</span>}
              {pendingAction.industry && pendingAction.type==='cliente' && <span className="font-syne text-[7px] px-2 py-0.5 rounded-full" style={{background:'rgba(255,255,255,0.06)',color:'rgba(255,255,255,0.4)'}}>{pendingAction.industry}</span>}
              {pendingAction.date && <span className="font-syne text-[7px] px-2 py-0.5 rounded-full" style={{background:'rgba(255,255,255,0.06)',color:'rgba(255,255,255,0.4)'}}>{pendingAction.date}</span>}{pendingAction.assigneeName && <span className="font-syne text-[7px] font-black px-2 py-0.5 rounded-full" style={{background:'rgba(34,197,94,0.12)',color:'rgba(34,197,94,0.9)'}}>→ {pendingAction.assigneeName.toUpperCase()}</span>}{pendingAction.invitees && <span className="font-syne text-[7px] font-black px-2 py-0.5 rounded-full" style={{background:'rgba(167,139,250,0.12)',color:'rgba(167,139,250,0.9)'}}>INVITA: {pendingAction.invitees.toUpperCase()}</span>}
            </div>
            <div className="flex gap-2">
              <button onClick={confirmHarveyAction} disabled={confirmingAction} className="flex-1 py-2 rounded-xl font-syne text-[8.5px] font-black tracking-widest transition-all disabled:opacity-40 text-white" style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>
                {confirmingAction?'CREANDO…':'CONFIRMAR'}
              </button>
              <button onClick={()=>setPendingAction(null)} className="px-4 py-2 rounded-xl font-syne text-[8.5px] font-black tracking-wide transition-all hover:opacity-70" style={{background:'rgba(255,255,255,0.05)',color:'rgba(255,255,255,0.4)',border:`1px solid ${BORDER}`}}>CANCELAR</button>
            </div>
          </div>
        </div>
      )}

      {/* Orb + input row — pt-6 da espacio al glow del orbe para no ser recortado */}
      <div className={`${isMobile?'px-4':'px-7'} pt-6 flex-shrink-0 relative z-10`} style={{paddingBottom:'max(env(safe-area-inset-bottom), 24px)'}}>
        {/* Quick actions */}
        <div className="flex gap-2 mb-3 flex-wrap">
          {quickActions.map((a,i)=>(
            <button key={i} disabled={mode!=='idle'}
              onClick={()=>{ setConversation(prev=>[...prev,{role:'user',text:a.t,ts:new Date().toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'})}]); askHarvey(a.t) }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-syne text-[8.5px] font-black tracking-wide transition-all hover:opacity-80 disabled:opacity-25"
              style={{background:'rgba(255,255,255,0.04)',border:`1px solid ${BORDER}`,color:'rgba(255,255,255,0.45)'}}>
              <LucideIcon name={a.icon} size={10} color={a.c}/>
              {a.t}
            </button>
          ))}
        </div>

        {/* Orb + text input */}
        <div className="flex items-center gap-3">
          {/* Orb */}
          <button onClick={handleOrb}
            className="relative flex-shrink-0 w-[52px] h-[52px] rounded-full flex items-center justify-center transition-all duration-300 active:scale-90 disabled:cursor-wait"
            style={{
              background: mode==='recording'?'rgba(229,29,42,0.15)':mode==='speaking'?'rgba(27,95,250,0.15)':'rgba(27,95,250,0.08)',
              border: `1.5px solid ${MC[mode]}`,
              boxShadow: `0 0 20px ${MC[mode]}40, 0 0 40px ${MC[mode]}15`,
            }}>
            {/* Pulse rings for recording */}
            {mode==='recording' && [80,100].map((sz,ri)=>(
              <div key={ri} className="absolute rounded-full pointer-events-none" style={{
                width:sz+'px', height:sz+'px',
                border:`1px solid ${RED}`,
                opacity:0.25/(ri+1),
                animation:`ping ${0.9+ri*0.4}s cubic-bezier(0,0,0.2,1) infinite`,
              }}/>
            ))}
            {mode==='idle' && <LucideIcon name="mic" size={20} color="rgba(255,255,255,0.7)"/>}
            {mode==='recording' && <LucideIcon name="square" size={18} color={RED}/>}
            {mode==='thinking' && <LucideIcon name="cpu" size={20} color="rgba(139,92,246,0.9)"/>}
            {mode==='speaking' && <LucideIcon name="volume-2" size={20} color="rgba(255,255,255,0.85)"/>}
          </button>

          {/* Waveform — visible during recording */}
          {mode==='recording' && (
            <div className="flex items-center gap-[3px] h-8 px-1 flex-shrink-0">
              {['animate-wave1','animate-wave2','animate-wave3','animate-wave4','animate-wave5'].map((cls,i)=>(
                <div key={i} className={`w-[3px] rounded-full ${cls}`} style={{background:RED,opacity:0.85,minHeight:'4px'}}/>
              ))}
            </div>
          )}

          {/* Text input */}
          <form onSubmit={e=>{
            e.preventDefault()
            const txt = textInput.trim()
            if (!txt || mode !== 'idle') return
            setTextInput('')
            setConversation(prev=>[...prev,{role:'user',text:txt,ts:new Date().toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'})}])
            askHarvey(txt)
          }} className="flex-1 flex items-center gap-2.5 px-4 py-3 rounded-2xl" style={{background:'rgba(255,255,255,0.04)',border:`1px solid ${mode!=='idle'?'rgba(27,95,250,0.25)':BORDER}`,transition:'border-color 0.2s'}}>
            <input
              value={textInput}
              onChange={e=>setTextInput(e.target.value)}
              disabled={mode!=='idle'}
              placeholder={mode==='recording'?`Grabando… ${recSeconds}s`:mode==='thinking'?'Harvey está pensando…':mode==='speaking'?'Harvey está hablando…':'Escribe o pulsa el micrófono…'}
              className="flex-1 bg-transparent text-[13px] outline-none disabled:opacity-40"
              style={{color:'rgba(255,255,255,0.8)',caretColor:BLU}}
            />
            {textInput.trim() && mode==='idle' && (
              <button type="submit" className={`${isMobile?'w-9 h-9':'w-7 h-7'} rounded-xl flex items-center justify-center flex-shrink-0 transition-all`} style={{background:`${BLU}20`,border:`1px solid ${BLU}40`}} aria-label="Enviar"><LucideIcon name="send" size={11} color={BLU}/></button>
            )}
          </form>
        </div>

        {/* Status bar */}
        <div className="flex items-center justify-center mt-2.5">
          <span className="font-syne text-[7.5px] font-black tracking-[0.25em]" style={{color:mode==='idle'?'rgba(255,255,255,0.12)':mode==='recording'?RED:mode==='thinking'?'rgba(139,92,246,0.7)':BLU}}>{orbLabel[mode]}</span>
        </div>
      </div>

      {/* Mobile: fixed bottom-sheet action card */}
      {isMobile && pendingAction && mode==='idle' && (
        <>
          <div className="fixed inset-0 z-[90] bg-black/60" onClick={()=>setPendingAction(null)}/>
          <div ref={harveyActionCardRef} className="fixed bottom-0 left-0 right-0 z-[91] rounded-t-3xl animate-fadeUp" style={{background:SURFACE,border:'1px solid rgba(27,95,250,0.3)',borderBottom:'none',paddingBottom:'env(safe-area-inset-bottom,0px)'}}>
            <div className="w-10 h-1 rounded-full mx-auto mt-2.5 mb-1" style={{background:'rgba(255,255,255,0.12)'}}/>
            <div className="px-5 py-2.5 flex items-center gap-2" style={{borderBottom:'1px solid rgba(27,95,250,0.15)'}}>
              <LucideIcon name={pendingAction.type==='tarea'?'check-square':pendingAction.type==='evento'?'calendar':pendingAction.type==='proyecto'?'folder':pendingAction.type==='pieza'?'film':'user'} size={12} color={BLU}/>
              <span className="font-syne text-[8px] font-black tracking-widest" style={{color:'rgba(27,95,250,0.7)'}}>HARVEY PROPONE — {pendingAction.type==='pieza'?'PIPELINE':pendingAction.type.toUpperCase()}</span>
            </div>
            <div className="px-5 py-4">
              <p className="font-figtree text-[14px] font-semibold mb-2" style={{color:'rgba(255,255,255,0.9)'}}>{pendingAction.text}</p>
              <div className="flex items-center gap-1.5 mb-3 flex-wrap">
                {pendingAction.level && <span className="font-syne text-[7px] font-black px-2 py-0.5 rounded-full" style={{background:pendingAction.level==='urgent'?`${RED}15`:pendingAction.level==='high'?'rgba(255,176,32,0.12)':`${BLU}15`,color:pendingAction.level==='urgent'?RED:pendingAction.level==='high'?AMBAR:BLU}}>{pendingAction.level.toUpperCase()}</span>}
                {pendingAction.platform && <span className="font-syne text-[7px] font-black px-2 py-0.5 rounded-full" style={{background:'rgba(193,53,132,0.12)',color:'rgba(193,53,132,0.9)'}}>{pendingAction.platform}</span>}
                {pendingAction.contentType && <span className="font-syne text-[7px] px-2 py-0.5 rounded-full" style={{background:'rgba(255,255,255,0.06)',color:'rgba(255,255,255,0.4)'}}>{pendingAction.contentType}</span>}
                {pendingAction.clientName && <span className="font-syne text-[7px] px-2 py-0.5 rounded-full" style={{background:'rgba(255,255,255,0.06)',color:'rgba(255,255,255,0.4)'}}>Cliente: {pendingAction.clientName}</span>}
                {pendingAction.industry && pendingAction.type==='cliente' && <span className="font-syne text-[7px] px-2 py-0.5 rounded-full" style={{background:'rgba(255,255,255,0.06)',color:'rgba(255,255,255,0.4)'}}>{pendingAction.industry}</span>}
                {pendingAction.date && <span className="font-syne text-[7px] px-2 py-0.5 rounded-full" style={{background:'rgba(255,255,255,0.06)',color:'rgba(255,255,255,0.4)'}}>{pendingAction.date}</span>}{pendingAction.assigneeName && <span className="font-syne text-[7px] font-black px-2 py-0.5 rounded-full" style={{background:'rgba(34,197,94,0.12)',color:'rgba(34,197,94,0.9)'}}>→ {pendingAction.assigneeName.toUpperCase()}</span>}{pendingAction.invitees && <span className="font-syne text-[7px] font-black px-2 py-0.5 rounded-full" style={{background:'rgba(167,139,250,0.12)',color:'rgba(167,139,250,0.9)'}}>INVITA: {pendingAction.invitees.toUpperCase()}</span>}
              </div>
              <div className="flex gap-2">
                <button onClick={confirmHarveyAction} disabled={confirmingAction} className="flex-1 py-3 rounded-xl font-syne text-[9px] font-black tracking-widest transition-all disabled:opacity-40 text-white" style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>
                  {confirmingAction?'CREANDO…':'CONFIRMAR'}
                </button>
                <button onClick={()=>setPendingAction(null)} className="flex-1 py-3 rounded-xl font-syne text-[9px] font-black tracking-widest transition-all" style={{border:`1px solid rgba(255,255,255,0.12)`,color:'rgba(255,255,255,0.35)'}}>CANCELAR</button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default HarveySection
