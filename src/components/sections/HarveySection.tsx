'use client'
import { useState, useEffect, useRef } from 'react'
import { memoriaRelevante as elegirMemoria } from '@/lib/memoriaRelevante'
import { hayModalAbierto } from '@/components/shared/modalAbierto'
import { ejecutarAccionHarvey } from '@/lib/harveyEjecutar'
import { parsearAccionHarvey, type AccionHarvey } from '@/lib/harveyAccion'
import { nivelTarea } from '@/components/shared/helpers'
import type { NexusData } from '@/types'
import { Esperando, BLU, RED, GRN, SURFACE, BORDER, useIsMobile, dlDate, LucideIcon, getSharedAudio, splitForTTS, stopAllVoices, playAck, isIOSDevice, isSRBroken, markSRBroken, matchTeamMember, todayKey, localDayKey, madridDateLabel, AMBAR, mensajeErrorTranscripcion } from '@/components/shared'
import { VIO } from '@/components/shared/design-tokens'
import type { IrASeccion } from '@/components/shared/secciones'

interface PropsHarvey {
  data: NexusData
  profile: any
  showToast: any
  onNavigate: IrASeccion
  preloadMessage: any
  onClearPreload: any
}

// La hora de las burbujas, en un solo sitio y en Madrid. Los turnos de Harvey ya
// la forzaban y los del usuario no: dos burbujas seguidas podían enseñar relojes
// distintos para quien estuviera fuera de España.
const horaMadrid = () =>
  new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' })

function HarveySection({data, profile, showToast, onNavigate, preloadMessage, onClearPreload}: PropsHarvey) {
  const isMobile = useIsMobile()
  type HarveyMode = 'idle'|'recording'|'thinking'|'speaking'
  const [mode, setMode] = useState<HarveyMode>('idle')
  const [lastAudioUrl, setLastAudioUrl] = useState<string|null>(null)
  const lastAudioUrlRef = useRef<string|null>(null)
  const [conversation, setConversation] = useState<Array<{role:'user'|'harvey',text:string,searched?:boolean,ts?:string,fuentes?:{id?:string,title?:string,category?:string}[]}>>([])
  // El estado de React todavía no se ha actualizado cuando el manejador que
  // acaba de cambiarlo sigue corriendo. Este espejo sí, porque se escribe a mano
  // y en el momento. Es lo que garantiza que el historial que recibe Harvey sea
  // el de AHORA y no el del turno anterior.
  const fuentesRef = useRef<{id?:string,title?:string,category?:string}[]>([])
  const [fuentesAbiertas, setFuentesAbiertas] = useState<number|null>(null)
  const conversationRef = useRef<Array<{role:'user'|'harvey',text:string,searched?:boolean,ts?:string,fuentes?:{id?:string,title?:string,category?:string}[]}>>([])
  const [textInput, setTextInput] = useState('')
  const [copiedHarveyIdx, setCopiedHarveyIdx] = useState<number|null>(null)
  // El tipo lo fija el modulo del parser: declararlo a mano aqui era la tercera
  // copia de la misma forma, y la que tenia `level?: string` sin normalizar.
  const [pendingAction, setPendingAction] = useState<AccionHarvey|null>(null)
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
  const convScrollRef = useRef<HTMLDivElement>(null)
  const harveyActionCardRef = useRef<HTMLDivElement>(null)
  // `mode` no pasa a 'recording' hasta que getUserMedia resuelve —con su diálogo
  // de permiso de por medio—, así que en esa ventana el orbe sigue en 'idle' y un
  // segundo toque abría OTRO micrófono. La referencia al primer MediaRecorder se
  // perdía, su stream no se cerraba nunca y el indicador rojo de grabación se
  // quedaba encendido hasta recargar la página. Un estado de React no sirve aquí:
  // no se actualiza a tiempo para el segundo toque. Una ref sí, es síncrona.
  const arrancandoRef = useRef(false)
  const abriendoMicRef = useRef(false)

  useEffect(() => {
    const c = convScrollRef.current
    if (!c) return
    // SIN requestAnimationFrame a propósito. El navegador lo SUSPENDE cuando la
    // pestaña no está visible, así que si alguien se va a otra pestaña mientras
    // Harvey responde, al volver el hilo se queda clavado arriba con la respuesta
    // sin leer. Medido: el callback del rAF no llegaba a ejecutarse nunca.
    //
    // El primer intento cubre el caso normal; el timeout cubre el momento en que
    // el hilo EMPIEZA a desbordar, cuando `mt-auto` deja de empujar y el layout
    // cambia justo después del commit.
    //
    // Salto instantáneo y no 'smooth': la animación la cancela el siguiente
    // render, y durante el streaming hay muchos.
    const irAlFinal = () => { c.scrollTop = c.scrollHeight }
    irAlFinal()
    const t = setTimeout(irAlFinal, 60)
    return () => clearTimeout(t)
  }, [conversation])
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
    preguntar(msg)
  }, [preloadMessage]) // eslint-disable-line react-hooks/exhaustive-deps

  // Spacebar shortcut: toggle recording (only when not typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Con un modal abierto el foco esta en BODY, asi que la guarda por tagName
      // de mas abajo no protege: escribir en el formulario ejecutaba estos atajos.
      if (hayModalAbierto()) return
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

  useEffect(() => { conversationRef.current = conversation }, [conversation])

  /**
   * El ÚNICO camino para mandarle algo a Harvey.
   *
   * Antes cada sitio lo hacía a su manera y convivían dos semánticas: los de
   * texto pasaban el historial a mano —incluyendo el mensaje actual, que el
   * servidor vuelve a añadir por su cuenta— y los de VOZ y el precargado no
   * pasaban nada, así que caían al `conversation` de la clausura.
   *
   * Eso es lo que hacía que hablando se perdiera el hilo: le pedías una tarea,
   * Harvey preguntaba de qué iba, respondías «urgente, editar vídeos» y le
   * llegaba esa frase suelta, sin la pregunta que la había provocado. Medido
   * contra el modelo real: sin historial crea la tarea 1 de cada 3 veces; con
   * historial, 3 de 3. Las otras dos vuelve a preguntar lo mismo.
   */
  const preguntar = (texto: string) => {
    const previos = conversationRef.current
    const nuevo = [...previos, { role: 'user' as const, text: texto, ts: horaMadrid() }]
    conversationRef.current = nuevo          // a mano: askHarvey corre antes del re-render
    setConversation(nuevo)
    // `previos` y no `nuevo`: el servidor añade el mensaje actual desde `message`,
    // así que mandarlo también en el historial lo duplicaba.
    // Se apuntan las notas que se le van a enseñar para ESTA pregunta. No para
    // que las recite —Javi lo pidió expresamente— sino para poder ofrecer un
    // botón: quien dude de una respuesta puede ver de dónde salió.
    fuentesRef.current = memoriaRelevante(texto).map(m => ({ id: (m as { id?: string }).id, title: m.title, category: m.category }))
    return askHarvey(texto, previos)
  }

  /**
   * La memoria que se le enseña a Harvey, elegida por lo que se le PREGUNTA.
   *
   * Antes eran «las 12 más recientes», y eso tenía un efecto perverso: en cuanto
   * los documentos empezaran a entrar solos —que es lo que hace falta para que la
   * IA sepa de la empresa— irían echando fuera las decisiones y aprendizajes
   * escritos a mano, que son pocos y son justo lo que dice CÓMO se trabaja aquí.
   * Meter más habría hecho que supiera menos.
   *
   * Ahora se separan dos cosas que no compiten:
   *
   *  · Lo CURADO (decisiones, procesos, aprendizajes, clientes) entra siempre.
   *    Es la identidad del estudio, se escribe poco y no caduca.
   *  · Los DOCUMENTOS entran los que tengan que ver con lo que se pregunta, y si
   *    no hay pregunta —el saludo del principio— los más recientes.
   *
   * Así se puede guardar todo sin que guardar más valga menos.
   */
  // La función vive en `src/lib/memoriaRelevante.ts` con sus tests: aquí estaba
  // la versión buena y en HoySection la rota, que es cómo nacen los gemelos.
  const memoriaRelevante = (pregunta?: string) => elegirMemoria(data.memoria as any, pregunta)

  const buildContext = (pregunta?: string) => {
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
    // El recuento REAL, aparte de la lista que se le ensena a Harvey.
    //
    // `unreadEmails` de abajo NO es "los sin leer": lleva .slice(0,8) e incluye a
    // proposito urgentes de hoy ya leidos. Etiquetar su .length como «sin leer»
    // hacia que Harvey dijera SIEMPRE exactamente 8 en cuanto hubiera mas de 8 —
    // y ese es el estado normal, porque gmail/sync copia el estado de Gmail y la
    // retencion del cron solo borra leidos. El numero correcto esta en la MISMA
    // pantalla, en el badge de INBOX. El gemelo de HoySection ya usaba el real.
    const nSinLeer = inbox.filter((m:any)=>!m.is_read).length
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

    const memLines2 = memoriaRelevante(pregunta).map((m:any)=>`  - ${m.title}${m.category?` [${m.category}]`:''}: ${(m.content||'').replace(/\s+/g,' ').slice(0,400)}`).join('\n')

    return `BRUTAL STUDIOS — ${madridDateLabel()}

TAREAS: ${tasks.filter(t=>!t.done).length} pendientes | ${completedToday} completadas hoy
URGENTES (${urgentTasks.length}): ${urgentTasks.slice(0,5).map((t:any)=>t.text).join(' · ')||'ninguna'}
ALTA PRIORIDAD (${highTasks.length}): ${highTasks.slice(0,3).map((t:any)=>t.text).join(' · ')||'ninguna'}
${todayTasks.length>0?`VENCEN HOY (${todayTasks.length}): ${todayTasks.map((t:any)=>t.text).join(' · ')}\n`:''}
PROYECTOS ACTIVOS (${activeProjects.length}): ${activeProjects.slice(0,6).map((p:any)=>`${p.name} ${p.progress}%${overdueProjects.find((op:any)=>op.id===p.id)?' [ATRASADO]':''}`).join(' | ')||'ninguno'}
CLIENTES ACTIVOS (${activeClients.length}): ${activeClients.map((c:any)=>c.name).join(', ')||'ninguno'}
EQUIPO: ${((data.team||[]) as any[]).map((m:any)=>m.name).filter(Boolean).join(', ')||'sin datos'}
PIPELINE CONTENIDO: ${pipeline.length} piezas pendientes

INBOX — ${nSinLeer} sin leer (${unreadEmails.length} mostrados):
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
  // Deja el audio de ESTA respuesta listo para el botón ESCUCHAR. Se llama por
  // las dos salidas de speak() —la normal y la del autoplay bloqueado— porque si
  // solo lo hace una, la otra deja el botón apuntando a la respuesta anterior.
  const guardarAudioCompleto = (blobs: Blob[]) => {
    if (!blobs.length) return
    const full = URL.createObjectURL(new Blob(blobs, { type: 'audio/mpeg' }))
    setLastAudioUrl(prev => { if (prev) URL.revokeObjectURL(prev); return full })
    lastAudioUrlRef.current = full
  }

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
        if (!played) {
          URL.revokeObjectURL(url)
          // Antes se salía aquí SIN guardar el audio, así que ESCUCHAR seguía
          // apuntando a `lastAudioUrl` — la respuesta ANTERIOR. Pulsabas el botón
          // esperando lo que Harvey acaba de decir y oías lo de antes, que es peor
          // que no oír nada. Y en iOS el bloqueo de autoplay es lo normal hasta
          // que el usuario ha interactuado con audio, o sea que este camino se
          // recorre a diario.
          //
          // Los trozos que faltan ya están pedidos (van en paralelo): se recogen
          // para que ESCUCHAR reproduzca la respuesta ENTERA, no solo la primera
          // frase.
          for (let j = i + 1; j < requests.length; j++) {
            const r = await requests[j].catch(() => null)
            if (!aliveRef.current || run !== voiceRunRef.current) break
            if (!r?.ok) break
            const b = await r.blob()
            if (!b.size) break
            blobs.push(b)
          }
          guardarAudioCompleto(blobs)
          setMode('idle')
          return
        }
        await done
        audio.onpause = null
        URL.revokeObjectURL(url)
        if (!aliveRef.current || run !== voiceRunRef.current) return
      }
      // Audio completo para el botón ESCUCHAR
      guardarAudioCompleto(blobs)
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

  // NO se llama desde fuera: el único camino es `preguntar()`, que es quien
  // garantiza que `historial` sea el de ahora. Aquí queda el respaldo por si
  // alguna vez llega sin él — el espejo, nunca el estado de la clausura, que es
  // lo que estaba atrasado y hacía que Harvey perdiera el hilo hablando.
  const askHarvey = async (userText: string, historial?: Array<{role:'user'|'harvey',text:string,searched?:boolean,ts?:string,fuentes?:{id?:string,title?:string,category?:string}[]}>) => {
    const run = ++voiceRunRef.current
    setMode('thinking')
    // Una pregunta nueva invalida la propuesta anterior. La tarjeta se pinta con
    // `pendingAction && mode==='idle'`, así que sin esta línea desaparecía al
    // pasar a 'thinking' y REAPARECÍA al volver a idle, ya obsoleta: confirmabas
    // la tarea de la pregunta de antes creyendo que era la de la respuesta que
    // acabas de leer. Mismo invariante que HoySection.askHarvey.
    setPendingAction(null)
    setFollowUps([])
    const searchTriggers = /busca|encuentra|consigue|influencer|instagram|tiktok|youtube|precio|tendencia|trend|noticias|actualidad|últim|listado|lista de|quién es|qué es|estadística|hashtag|seguidores|marca|agencia|competencia|referente|ejemplo de|casos de|cómo se hace|qué plataforma|cuánto cuesta|cuánto cobra/i
    if (searchTriggers.test(userText)) setIsSearching(true)
    try {
      const res = await fetch('/api/harvey/chat', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ message:userText, context:buildContext(userText), history:(historial ?? conversationRef.current).slice(-10), stream:true }),
        signal: AbortSignal.timeout(60000),
      })
      if (!aliveRef.current || run !== voiceRunRef.current) { setIsSearching(false); return }
      if (!res.ok) { const j = await res.json().catch(()=>({})); throw new Error(j.error||'Error') }

      let reply = ''
      let searched = false
      let degradado = false
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
        // El servidor marca `fallback: true` cuando NO ha hablado con Claude y
        // devuelve una frase enlatada. Ese campo se ignoraba: la frase se pintaba
        // —y se leia en voz alta— como si la hubiera pensado Harvey, que es la
        // peor forma de fallar que tiene esta seccion. Ahora se dice.
        degradado = !!json.fallback
      }
      if (!aliveRef.current || run !== voiceRunRef.current) { setIsSearching(false); return }
      reply = reply.trim()
      if (!reply) {
        // Respuesta vacia: antes se rendia sin decir absolutamente nada.
        setIsSearching(false); setMode('idle')
        setConversation(prev=>[...prev,{role:'harvey',text:'Me he quedado en blanco con eso. Prueba a preguntármelo de otra forma.',ts:new Date().toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Madrid'})}])
        return
      }

      // Parse action command
      // Un solo sitio para las dos secciones: esto estaba escrito linea por linea
      // aqui y en la otra, y cada bug de la pareja habia que arreglarlo dos veces.
      const { texto: limpio, accion } = parsearAccionHarvey(reply)
      reply = limpio
      if (accion) setPendingAction(accion)

      setIsSearching(false)
      // Si la respuesta viene del fallback local, se dice. Callarlo era hacer pasar
      // por Harvey una frase enlatada, y encima leerla en voz alta con su voz.
      const texto = degradado
        ? `${reply}\n\n(No he podido conectar con mi cerebro ahora mismo — esto es lo que tengo guardado. Vuelve a preguntarme en un momento.)`
        : reply
      setConversation(prev=>[...prev,{role:'harvey',text:texto,searched,fuentes:fuentesRef.current,ts:horaMadrid()}])
      setFollowUps(generateFollowUps(userText, reply))
      await speak(reply, prefetch)
    } catch (err: any) {
      setIsSearching(false); setMode('idle')
      // El aviso flotante se va en tres segundos; el mensaje se queda. Asi, tras
      // varios intentos, se ve QUE fallo y CUANTAS veces, en vez de una columna
      // de preguntas sin respuesta.
      const motivo = /timeout|abort/i.test(err?.message||'') ? 'He tardado demasiado en responder.' : 'No he podido conectar.'
      setConversation(prev=>[...prev,{role:'harvey',text:`${motivo} Vuelve a intentarlo en un momento — tu pregunta sigue aquí arriba.`,ts:new Date().toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Madrid'})}])
      showToast('Error conectando con Harvey')
    }
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
        // "No te escuche" es un diagnostico FALSO si lo que fallo fue el servicio
        // de transcripcion: el usuario repite la grabacion una y otra vez creyendo
        // que habla mal. Un fallo del servidor tiene que decirse como lo que es.
        if (!res.ok) { setMode('idle'); showToast(mensajeErrorTranscripcion(res.status, json?.error)); return }
        text = (json.text||'').trim()
      }

      if (!text) { setMode('idle'); showToast('No te escuché — vuelve a intentarlo'); return }
      await preguntar(text)
    } catch { setMode('idle'); showToast('Error al procesar audio') }
  }

  const startRecording = async () => {
    if (arrancandoRef.current) return
    arrancandoRef.current = true
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
      try { r.start(); arrancandoRef.current = false; return } catch { recognitionRef.current = null }
    }
    // 2) Fallback: grabar + transcribir en servidor (Groq → OpenAI Whisper)
    await startMediaRecording()
    arrancandoRef.current = false
  }

  const startMediaRecording = async () => {
    // getUserMedia tarda —y en el primer uso muestra el diálogo de permiso—, así
    // que aquí es donde de verdad se puede colar un segundo toque y abrir dos
    // streams. El primero se perdería y su micrófono seguiría abierto.
    if (abriendoMicRef.current) return
    abriendoMicRef.current = true
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
    } finally {
      abriendoMicRef.current = false
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
    // Solo se descarta la propuesta si de verdad se ha escrito algo. Antes el
    // setPendingAction(null) del final se ejecutaba pasara lo que pasara, y la
    // rama de 'evento' NO relanza: si Google Calendar contesta mal —o si Harvey
    // no dio fecha y ni se intentó— solo sale un toast. Ese toast pide reconectar
    // Gmail y volver a intentarlo, pero la tarjeta ya había desaparecido y había
    // que dictarle el evento entero otra vez. Mismo tratamiento en HoySection.
    // La ejecución vive en src/lib/harveyEjecutar.ts: estaba escrita byte por byte
    // aquí y en la otra sección, y los dos bugs que encontró la auditoría hubo que
    // arreglarlos por duplicado. Devuelve si se escribió algo de verdad — y solo
    // entonces se descarta la propuesta, que era justo el fallo.
    try {
      const creado = await ejecutarAccionHarvey(pendingAction, { data, perfil: profile, showToast })
      if (creado) setPendingAction(null)
    } finally { setConfirmingAction(false) }
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
    // El saludo YA NO se inyecta como mensaje de conversación.
    //
    // Lo hacía, y eso tenía una consecuencia que nadie decidió: el estado vacío
    // bonito —el orbe grande con «Pregúntame lo que sea»— era casi inalcanzable,
    // porque la condición para verlo es `conversation.length === 0` y el saludo
    // la rompía nada más entrar, una vez al día, justo la primera impresión.
    //
    // Ahora el saludo ES el héroe: se calcula al pintar (abajo) y se enseña bajo
    // el orbe grande. La persistencia del historial no se toca.
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Los cuatro colores salen de los tokens compartidos, incluido el morado (VIO).
  // Estaba escrito a mano como rgba(139,92,246,0.9) y el boxShadow del botón de
  // voz lo concatena (`${MC[mode]}40`): con rgba el navegador descarta la
  // declaración ENTERA —los dos resplandores van en una sola— y el orbe se
  // quedaba apagado justo en 'thinking', que es cuando hace falta ver que Harvey
  // está trabajando. Este objeto es el mismo que el `orbColor` de HoySection,
  // escrito dos veces: construido sobre los tokens no puede volver a divergir.
  const MC: Record<HarveyMode,string> = { idle:BLU, recording:RED, thinking:VIO, speaking:BLU }
  const orbLabel: Record<HarveyMode,string> = { idle:'ESPACIO / CLIC · HABLA', recording:`GRABANDO ${recSeconds}s · SUELTA`, thinking: isSearching ? 'BUSCANDO EN INTERNET…' : 'PROCESANDO…', speaking:'REPRODUCIENDO · CLIC PARA PARAR' }

  const urgentTasks = (data.tasks||[]).filter((t:any)=>!t.done&&t.level==='urgent')
  const activeProjects = (data.projects||[]).filter((p:any)=>p.status!=='completado')
  const unreadEmails = (data.inbox||[]).filter((m:any)=>!m.is_read)

  const pipeline = (data.agenda||[]).filter((a:any)=>a.status!=='publicado')
  const todayStrH = todayKey()
  const overdueProjectsH = (data.projects||[]).filter((p:any)=>p.deadline&&p.deadline!=='TBD'&&p.status!=='completado'&&dlDate(p.deadline)<new Date())
  const todayCalEvtsH = ((data.calendarEvents||[]) as any[]).filter((e:any)=>e.start?.slice(0,10)===todayStrH)
  const urgentUnread = unreadEmails.filter((m:any)=>m.ai_urgency==='urgent')
  // HEX, no rgba(), aunque hoy nadie les concatene opacidad.
  //
  // Eran `rgba(234,67,53,0.8)` y `rgba(193,53,132,0.9)`. En cuanto alguien escriba
  // `a.c + '12'` para teñir un fondo —que es el patrón de toda la app— el navegador
  // DESCARTA la declaración entera, sin error y sin nada en consola: el elemento se
  // pinta sin fondo. Ha pasado nueve veces en este repo (ver CLAUDE.md).
  //
  // Los valores son los mismos colores mezclados sobre el fondo (#0B0B12), así que
  // se ven idénticos a antes; lo único que cambia es que ahora se les puede pegar
  // un alfa detrás sin romper nada.

  const quickActions = [
    ...(urgentTasks.length>0 ? [{t:`Prioriza mis ${urgentTasks.length} tareas urgentes`, icon:'zap', c:RED}] : []),
    ...(urgentUnread.length>0 ? [{t:`Tengo ${urgentUnread.length} email${urgentUnread.length>1?'s':''} urgente${urgentUnread.length>1?'s':''}, ¿qué hago?`, icon:'mail', c:RED}] : unreadEmails.length>0 ? [{t:`Resume los ${unreadEmails.length} emails sin leer`, icon:'mail', c:'#BD382E'}] : []),
    ...(overdueProjectsH.length>0 ? [{t:`¿Cómo recuperamos "${overdueProjectsH[0]?.name}"?`, icon:'alert-circle', c:AMBAR}] : []),
    ...(todayCalEvtsH.length>0 ? [{t:`Prepárame para "${todayCalEvtsH[0]?.title}"`, icon:'calendar', c:'#A78BFA'}] : []),
    ...(urgentTasks.length===0&&urgentUnread.length===0 ? [{t:'¿Cómo está Brutal Studios hoy?', icon:'bar-chart-2', c:GRN}] : []),
    ...(pipeline.length>0 ? [{t:`Crea una pieza para Instagram`, icon:'film', c:'#AF3179'}] : []),
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
      <div ref={convScrollRef} className={`flex-1 overflow-y-auto ${isMobile?'px-4':'px-7'} py-4 relative z-10 flex flex-col`}>
        {/* Sin conversación, esta zona era un hueco muerto: en móvil, el 47% de la
            pantalla en negro entre la cabecera y las sugerencias. Es justo el sitio
            donde Harvey tiene que invitar a hablarle, así que aquí va el orbe
            grande —con espacio de sobra para su halo, que abajo no lo tiene— y una
            sola frase que diga qué hacer. */}
        {conversation.length === 0 && mode === 'idle' && (
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-5 py-6">
            <button
              onClick={handleOrb}
              title={orbLabel.idle} aria-label="Hablar con Harvey"
              className="relative w-[92px] h-[92px] rounded-full flex items-center justify-center transition-transform active:scale-95"
              style={{
                background:'rgba(27,95,250,0.08)',
                border:`1.5px solid ${BLU}`,
                boxShadow:`0 0 28px ${BLU}40, 0 0 64px ${BLU}18`,
              }}>
              {/* Latido lento: la pantalla quieta no invita a nada. */}
              <span className="absolute inset-0 rounded-full animate-ping" style={{border:`1px solid ${BLU}30`, animationDuration:'2.8s'}}/>
              <LucideIcon name="mic" size={30} color={BLU}/>
            </button>
            <div>
              {/* El saludo personalizado, aquí y no como mensaje inyectado: así el
                  héroe se ve CADA vez que no hay conversación, no solo si nunca
                  hubo saludo. Es la primera impresión de la sección estrella. */}
              <div className="font-figtree font-black text-white mb-2" style={{fontSize:'22px',letterSpacing:'-0.02em'}}>
                {(() => { const h = new Date().getHours(); const sal = h<13?'Buenos días':h<20?'Buenas tardes':'Buenas noches'; return `${sal}, ${profile?.name?.split(' ')?.[0]||'jefe'}` })()}
              </div>
              <div className="font-figtree text-[13px] leading-relaxed max-w-[280px] mx-auto" style={{color:'rgba(255,255,255,0.45)'}}>
                {(() => {
                  const nU = (data.tasks||[]).filter((t:any)=>!t.done&&t.level==='urgent').length
                  const nO = (data.projects||[]).filter((p:any)=>p.deadline&&p.deadline!=='TBD'&&p.status!=='completado'&&dlDate(p.deadline)<new Date()).length
                  const nM = (data.inbox||[]).filter((m:any)=>!m.is_read).length
                  const partes = []
                  if (nU) partes.push(`${nU} urgente${nU>1?'s':''}`)
                  if (nO) partes.push(`${nO} proyecto${nO>1?'s':''} atrasado${nO>1?'s':''}`)
                  if (nM) partes.push(`${nM} sin leer`)
                  return partes.length ? `Tienes ${partes.join(', ')}. Habla o escribe abajo.` : 'Todo bajo control. Habla o escribe abajo.'
                })()}
              </div>
            </div>
          </div>
        )}
       <div className="mt-auto space-y-3">
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
                {/* Las fuentes NO se dicen: se ofrecen. Harvey citando notas en voz
                    alta convertiría cada respuesta en una bibliografía —y esto se
                    reproduce en audio—. Un botón deja comprobar de dónde salió a
                    quien dude, sin estorbar a quien no. */}
                {msg.role==='harvey' && !!msg.fuentes?.length && (
                  <div className="mt-2">
                    <button onClick={()=>setFuentesAbiertas(a=>a===i?null:i)}
                      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg font-syne text-[7px] font-black tracking-widest transition-opacity hover:opacity-80"
                      style={{background:'rgba(255,255,255,0.04)',border:`1px solid ${BORDER}`,color:'rgba(255,255,255,0.35)'}}>
                      <LucideIcon name="database" size={9} color="rgba(255,255,255,0.35)"/>
                      {fuentesAbiertas===i ? 'OCULTAR FUENTES' : `REVISAR FUENTES · ${msg.fuentes.length}`}
                    </button>
                    {fuentesAbiertas===i && (
                      <div className="flex flex-col gap-1 mt-2 pl-1">
                        {msg.fuentes.map((f,k)=>(
                          <button key={k} onClick={()=>onNavigate('memoria')}
                            className="flex items-baseline gap-2 text-left transition-opacity hover:opacity-70">
                            <span className="font-syne text-[6.5px] font-black tracking-widest flex-shrink-0" style={{color:'rgba(255,255,255,0.2)'}}>{(f.category||'').toUpperCase()}</span>
                            <span className="font-figtree text-[11px] truncate" style={{color:'rgba(255,255,255,0.5)'}}>{f.title}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
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
              <button key={i} onClick={()=>{ setFollowUps([]); preguntar(f) }}
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
              {pendingAction.date && <span className="font-syne text-[7px] px-2 py-0.5 rounded-full" style={{background:'rgba(255,255,255,0.06)',color:'rgba(255,255,255,0.4)'}}>{pendingAction.date}{pendingAction.time?' '+pendingAction.time:''}</span>}{pendingAction.assigneeName && <span className="font-syne text-[7px] font-black px-2 py-0.5 rounded-full" style={{background:'rgba(34,197,94,0.12)',color:'rgba(34,197,94,0.9)'}}>→ {pendingAction.assigneeName.toUpperCase()}</span>}{pendingAction.invitees && <span className="font-syne text-[7px] font-black px-2 py-0.5 rounded-full" style={{background:'rgba(167,139,250,0.12)',color:'rgba(167,139,250,0.9)'}}>INVITA: {pendingAction.invitees.toUpperCase()}</span>}
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
              onClick={()=>{ preguntar(a.t) }}
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
            // El texto de estado va debajo del orbe, no dentro del botón, así que
            // el control en sí no decía qué hace. `orbLabel` ya describe cada modo.
            title={orbLabel[mode]} aria-label={orbLabel[mode]}
            className="relative flex-shrink-0 w-[52px] h-[52px] rounded-full flex items-center justify-center transition-all duration-300 active:scale-90 disabled:cursor-wait"
            style={{
              background: mode==='recording'?'rgba(229,29,42,0.15)':mode==='speaking'?'rgba(27,95,250,0.15)':'rgba(27,95,250,0.08)',
              border: `1.5px solid ${MC[mode]}`,
              boxShadow: isMobile ? `0 0 14px ${MC[mode]}40, 0 0 22px ${MC[mode]}12` : `0 0 20px ${MC[mode]}40, 0 0 40px ${MC[mode]}15`,
            }}>
            {/* CADA ESTADO CON SU MOVIMIENTO, no solo su color.
                Antes `idle` y `speaking` compartían anillo azul y quietud, y
                `thinking` no se movía NADA — que es justo cuando hace falta ver
                que Harvey está trabajando. Grabar late en rojo (ya estaba),
                pensar respira en violeta, hablar emite ondas azules. Se
                distinguen con el rabillo del ojo, sin leer la etiqueta. */}
            {mode==='recording' && [80,100].map((sz,ri)=>(
              <div key={ri} className="absolute rounded-full pointer-events-none" style={{
                width:sz+'px', height:sz+'px',
                border:`1px solid ${RED}`,
                opacity:0.25/(ri+1),
                animation:`ping ${0.9+ri*0.4}s cubic-bezier(0,0,0.2,1) infinite`,
              }}/>
            ))}
            {mode==='thinking' && (
              <div className="absolute inset-0 rounded-full pointer-events-none"
                style={{border:`1.5px solid ${VIO}`, animation:'pls 1.6s ease-in-out infinite'}}/>
            )}
            {mode==='speaking' && [72,92].map((sz,ri)=>(
              <div key={ri} className="absolute rounded-full pointer-events-none" style={{
                width:sz+'px', height:sz+'px',
                border:`1px solid ${BLU}`,
                opacity:0.3/(ri+1),
                animation:`ping ${1.6+ri*0.5}s cubic-bezier(0,0,0.2,1) infinite`,
              }}/>
            ))}
            {mode==='idle' && <LucideIcon name="mic" size={20} color="rgba(255,255,255,0.7)"/>}
            {mode==='recording' && (
              <span className="flex items-center gap-[2.5px]" aria-hidden>
                {['animate-wave1','animate-wave2','animate-wave3','animate-wave4','animate-wave5'].map((cls,i)=>(
                  <span key={i} className={`w-[2.5px] rounded-full ${cls}`} style={{background:RED,opacity:0.9,minHeight:'4px'}}/>
                ))}
              </span>
            )}
            {mode==='thinking' && <LucideIcon name="cpu" size={20} color="rgba(139,92,246,0.9)"/>}
            {mode==='speaking' && <LucideIcon name="volume-2" size={20} color="rgba(255,255,255,0.85)"/>}
          </button>

          {/* La waveform ya NO va aquí. Se insertaba en la fila flex al empezar a
              grabar y el campo de texto se encogía ~200px de golpe — un salto de
              layout en el momento exacto en que estás hablando. Ahora vive DENTRO
              del orbe, que ya cambia de estado de todas formas. */}

          {/* Text input */}
          <form onSubmit={e=>{
            e.preventDefault()
            const txt = textInput.trim()
            if (!txt || mode !== 'idle') return
            setTextInput('')
            preguntar(txt)
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
          {/* LEGIBLE. Estaba a 7,5px con opacidad 0,12 en idle — contraste ~1,3:1,
              o sea invisible justo donde se explica cómo usar la sección. Y en
              `thinking` ahora es la espera contada, la misma pieza que el chat:
              las tres pantallas de IA esperan igual. */}
          {mode==='thinking' ? (
            <Esperando color={VIO} fases={isSearching ? ['Buscando en internet', 'Leyendo lo encontrado', 'Redactando'] : ['Escuchándote', 'Pensando', 'Redactando']}/>
          ) : (
            <span className="font-syne text-[8.5px] font-black tracking-[0.2em]" style={{color:mode==='idle'?'rgba(255,255,255,0.35)':mode==='recording'?RED:BLU}}>{orbLabel[mode]}</span>
          )}
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
                {pendingAction.date && <span className="font-syne text-[7px] px-2 py-0.5 rounded-full" style={{background:'rgba(255,255,255,0.06)',color:'rgba(255,255,255,0.4)'}}>{pendingAction.date}{pendingAction.time?' '+pendingAction.time:''}</span>}{pendingAction.assigneeName && <span className="font-syne text-[7px] font-black px-2 py-0.5 rounded-full" style={{background:'rgba(34,197,94,0.12)',color:'rgba(34,197,94,0.9)'}}>→ {pendingAction.assigneeName.toUpperCase()}</span>}{pendingAction.invitees && <span className="font-syne text-[7px] font-black px-2 py-0.5 rounded-full" style={{background:'rgba(167,139,250,0.12)',color:'rgba(167,139,250,0.9)'}}>INVITA: {pendingAction.invitees.toUpperCase()}</span>}
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
