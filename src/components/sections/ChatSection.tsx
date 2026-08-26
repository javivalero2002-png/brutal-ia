'use client'
import React, { useState, useEffect, useRef } from 'react'
import { estadoDeadline, Esperando } from '@/components/shared'
import { hayModalAbierto } from '@/components/shared/modalAbierto'
import type { Task, Project, NexusData} from '@/types'
import { BLU, RED, GRN, SURFACE, SURF2, BORDER, useIsMobile, dlDate, LucideIcon, todayKey } from '@/components/shared'
import type { IrASeccion } from '@/components/shared/secciones'

// ── Markdown renderer (inline) ───────────────────────────────
function MarkdownMsg({ text }: { text: string }) {
  const lines = text.split('\n')
  const result: React.ReactNode[] = []
  let listItems: string[] = []
  let numberedItems: string[] = []
  let codeLines: string[] = []
  let codeLang = ''
  let inCode = false

  const formatInline = (s: string): React.ReactNode[] => {
    const parts: React.ReactNode[] = []
    const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g
    let last = 0, m: RegExpExecArray|null
    while ((m = regex.exec(s)) !== null) {
      if (m.index > last) parts.push(s.slice(last, m.index))
      const raw = m[0]
      if (raw.startsWith('**')) parts.push(<strong key={m.index} style={{color:'rgba(255,255,255,0.95)',fontWeight:700}}>{raw.slice(2,-2)}</strong>)
      else if (raw.startsWith('*')) parts.push(<em key={m.index} style={{color:'rgba(240,240,248,0.85)'}}>{raw.slice(1,-1)}</em>)
      else parts.push(<code key={m.index} className="px-1.5 py-0.5 rounded-md text-[11px] font-mono" style={{background:'rgba(27,95,250,0.14)',color:'rgba(120,160,255,0.95)',border:'1px solid rgba(27,95,250,0.2)'}}>{raw.slice(1,-1)}</code>)
      last = m.index + raw.length
    }
    if (last < s.length) parts.push(s.slice(last))
    return parts
  }

  const flushList = (key: string) => {
    if (listItems.length === 0) return
    result.push(
      <ul key={key} className="my-1.5 space-y-1 list-none pl-3">
        {listItems.map((item, i) => (
          <li key={i} className="flex gap-2.5 items-start text-[12.5px] leading-relaxed" style={{color:'rgba(240,240,248,0.78)'}}>
            <span className="mt-[7px] w-1 h-1 rounded-full flex-shrink-0" style={{background:`${BLU}80`}}/>
            <span>{formatInline(item)}</span>
          </li>
        ))}
      </ul>
    )
    listItems = []
  }

  const flushNumbered = (key: string) => {
    if (numberedItems.length === 0) return
    result.push(
      <ol key={key} className="my-1.5 space-y-1 list-none pl-3">
        {numberedItems.map((item, i) => (
          <li key={i} className="flex gap-2.5 items-start text-[12.5px] leading-relaxed" style={{color:'rgba(240,240,248,0.78)'}}>
            <span className="mt-0.5 font-syne text-[9px] font-black flex-shrink-0 w-4 text-right" style={{color:`${BLU}90`}}>{i+1}.</span>
            <span>{formatInline(item)}</span>
          </li>
        ))}
      </ol>
    )
    numberedItems = []
  }

  const flushCode = (key: string) => {
    if (codeLines.length === 0) return
    const codeText = codeLines.join('\n')
    result.push(
      <div key={key} className="my-2 rounded-xl overflow-hidden" style={{background:'rgba(0,0,0,0.4)',border:'1px solid rgba(27,95,250,0.15)'}}>
        {codeLang && (
          <div className="flex items-center gap-2 px-3 py-1.5" style={{borderBottom:'1px solid rgba(27,95,250,0.1)',background:'rgba(27,95,250,0.06)'}}>
            <span className="font-syne text-[7px] font-black tracking-widest" style={{color:`${BLU}80`}}>{codeLang.toUpperCase()}</span>
          </div>
        )}
        <pre className="px-4 py-3 text-[11px] leading-relaxed overflow-x-auto font-mono" style={{color:'rgba(180,210,255,0.9)',whiteSpace:'pre'}}>{codeText}</pre>
      </div>
    )
    codeLines = []
    codeLang = ''
  }

  lines.forEach((line, i) => {
    // Code fence detection
    if (line.trimStart().startsWith('```')) {
      if (!inCode) {
        flushList(`list-${i}`)
        flushNumbered(`num-${i}`)
        inCode = true
        codeLang = line.trimStart().slice(3).trim()
      } else {
        inCode = false
        flushCode(`code-${i}`)
      }
      return
    }
    if (inCode) { codeLines.push(line); return }

    const trimmed = line.trimStart()
    const isBullet = trimmed.startsWith('- ') || trimmed.startsWith('• ') || trimmed.startsWith('* ')
    const numberedMatch = trimmed.match(/^\d+\.\s(.+)/)

    if (isBullet) {
      flushNumbered(`num-${i}`)
      listItems.push(trimmed.slice(2))
    } else if (numberedMatch) {
      flushList(`list-${i}`)
      numberedItems.push(numberedMatch[1])
    } else {
      // Una línea en blanco DENTRO de una lista no la termina. Claude separa los
      // puntos con línea en blanco casi siempre, y al cerrar la lista ahí cada
      // punto acababa en su propio <ol>: los tres salían numerados «1.», «1.»,
      // «1.». Solo se cierra si lo que viene después ya no es un punto de lista.
      const siguienteSigueLista = trimmed === '' && (() => {
        for (let j = i + 1; j < lines.length; j++) {
          const t = lines[j].trimStart()
          if (t === '') continue
          return /^\d+\.\s/.test(t) || t.startsWith('- ') || t.startsWith('• ') || t.startsWith('* ')
        }
        return false
      })()
      if (siguienteSigueLista && (listItems.length > 0 || numberedItems.length > 0)) return

      flushList(`list-${i}`)
      flushNumbered(`num-${i}`)
      if (trimmed === '' || trimmed === '---') {
        if (trimmed === '---') result.push(<div key={`hr-${i}`} className="my-2 h-px" style={{background:'rgba(255,255,255,0.06)'}}/>)
        else if (i < lines.length - 1) result.push(<div key={`br-${i}`} className="h-2"/>)
      } else if (trimmed.startsWith('> ')) {
        result.push(<div key={i} className="pl-3 py-0.5 my-1 text-[12.5px] leading-relaxed" style={{borderLeft:`2px solid ${BLU}40`,color:'rgba(200,210,255,0.6)'}}>{formatInline(trimmed.slice(2))}</div>)
      } else if (trimmed.startsWith('# ')) {
        result.push(<div key={i} className="font-figtree font-black mt-5 mb-2 leading-tight" data-nivel="1" style={{fontSize:'19px',letterSpacing:'-0.025em',color:'rgba(255,255,255,0.97)'}}>{trimmed.slice(2)}</div>)
      } else if (trimmed.startsWith('## ')) {
        result.push(<div key={i} className="font-figtree font-black mt-4 mb-1.5" data-nivel="2" style={{fontSize:'16.5px',letterSpacing:'-0.02em',color:'rgba(255,255,255,0.95)'}}>{trimmed.slice(3)}</div>)
      } else if (trimmed.startsWith('### ')) {
        // 13,5px en Figtree, no 9px en versalitas: el `###` se pintaba MÁS PEQUEÑO
        // que el párrafo que encabeza (13px), así que cada vez que Claude
        // estructuraba con `###` —constantemente— la respuesta PERDÍA jerarquía en
        // vez de ganarla, y quedaba un bloque gris imposible de escanear.
        result.push(<div key={i} className="font-figtree font-bold mt-4 mb-1.5" style={{fontSize:'15px',color:'rgba(255,255,255,0.95)',letterSpacing:'-0.015em'}}>{trimmed.slice(4)}</div>)
      } else {
        // 14px / 0,88 y no 13px / 0,78. Lo que la gente viene a leer —la respuesta—
        // era el texto MÁS pequeño y MÁS apagado de la pantalla, mientras los
        // adornos del estado vacío iban a 20px. En HoySection el contenido va a
        // 13,5-16px con opacidad 0,82-0,9; al lado, esto se leía como una nota al pie.
        result.push(<p key={i} className="leading-relaxed" style={{fontSize:'14px',color:'rgba(240,240,248,0.88)'}}>{formatInline(trimmed)}</p>)
      }
    }
  })
  flushList('list-end')
  flushNumbered('num-end')
  if (inCode) flushCode('code-end')
  return <div className="space-y-0.5">{result}</div>
}

interface PropsChat {
  profile: any
  data: NexusData
  chatInput: any
  setChatInput: any
  chatLoading: any
  setChatLoading: any
  showToast: any
  onNavigate: IrASeccion
}

function ChatSection({profile,data,chatInput,setChatInput,chatLoading,setChatLoading,showToast,onNavigate}: PropsChat) {
  const isMobile = useIsMobile()
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [copiedId, setCopiedId] = useState<string|null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const sendTextRef = useRef<(txt: string)=>void>(()=>{})
  const chatLoadingRef = useRef(false)
  const promptsRef = useRef<{text:string,cat:string}[]>([])

  // La memoria, fresca, al abrir la IA.
  //
  // Harvey y Brutal.IA no leen `memoria` del servidor: la leen del estado de
  // useNexusData, que se llena UNA vez al arrancar la app. Subes un documento en
  // el movil, preguntas en el portatil con la pestaña abierta desde por la
  // mañana, y te dice que no lo tiene — con seguridad, porque tiene una lista de
  // notas: solo que vieja.
  //
  // Aqui y no en el arranque porque es el momento exacto en que importa, y porque
  // asi vale tambien para lo que suba OTRA persona del equipo.
  useEffect(() => { data.refrescarMemoria?.() }, [data.refrescarMemoria])

  useEffect(() => {
    const c = scrollRef.current
    if (!c) return
    const irAlFinal = () => { c.scrollTop = c.scrollHeight }
    irAlFinal()
    const t = setTimeout(irAlFinal, 60)
    return () => clearTimeout(t)
  }, [data.chatMessages])

  useEffect(()=>{
    const handler = (e: KeyboardEvent) => {
      // Con un modal abierto el foco esta en BODY, asi que la guarda por tagName
      // de mas abajo no protege: escribir en el formulario ejecutaba estos atajos.
      if (hayModalAbierto()) return
      if (['INPUT','TEXTAREA'].includes((e.target as HTMLElement).tagName) || e.metaKey||e.ctrlKey||e.altKey) return
      if (e.key === 'n') { e.preventDefault(); inputRef.current?.focus(); return }
      if (!chatLoadingRef.current) {
        const n = parseInt(e.key)
        if (n >= 1 && n <= promptsRef.current.length) { e.preventDefault(); sendTextRef.current(promptsRef.current[n-1].text) }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const copyMsg = (id: string, text: string) => {
    navigator.clipboard.writeText(text).then(()=>{
      setCopiedId(id)
      setTimeout(()=>setCopiedId(null), 1800)
    }).catch(()=>{})
  }

  const sendText = async (txt: string) => {
    if (!txt || chatLoading) return
    setChatInput('')
    if (inputRef.current) { inputRef.current.style.height = 'auto' }
    setChatLoading(true)
    try { await data.sendChatMessage(txt) }
    catch {
      // El input se vacia ANTES de enviar, para que la UI responda al instante.
      // Si el envio falla habia que devolver el texto: se avisaba del error pero
      // lo escrito ya no estaba en ningun sitio, y un mensaje largo se perdia
      // entero.
      showToast('Error enviando mensaje')
      setChatInput((prev: string) => prev || txt)
    }
    finally { setChatLoading(false) }
  }

  const send = () => sendText(chatInput.trim())

  const urgentN = data.tasks.filter((t: Task)=>!t.done&&t.level==='urgent').length
  const overdueN = data.projects.filter((p: Project)=>p.status!=='completado'&&estadoDeadline(p.deadline)?.vencido).length
  const unreadN = data.inbox.filter((m: any)=>!m.is_read).length
  const PROMPTS = [
    urgentN > 0
      ? {text:`Tengo ${urgentN} tarea${urgentN>1?'s':''} urgente${urgentN>1?'s':''}, ¿cuál priorizo primero?`, cat:'URGENTE'}
      : {text:'¿Qué proyectos urgentes tengo?', cat:'URGENTE'},
    {text:'¿Cuántas tareas pendientes hay?', cat:'TAREAS'},
    {text:'Resume el estado del equipo', cat:'EQUIPO'},
    overdueN > 0
      ? {text:`${overdueN} proyecto${overdueN>1?'s':''} atrasado${overdueN>1?'s':''}, ¿cómo lo${overdueN>1?'s':''} gestiono?`, cat:'PROYECTOS'}
      : {text:'¿Qué contenido hay que publicar esta semana?', cat:'CONTENIDO'},
    unreadN > 0
      ? {text:`Tengo ${unreadN} mensaje${unreadN>1?'s':''} sin leer, ¿cuáles necesitan respuesta?`, cat:'INBOX'}
      : {text:'¿Qué clientes no tienen proyectos activos?', cat:'CLIENTES'},
    {text:'Dame prioridades para hoy', cat:'HOY'},
  ]

  sendTextRef.current = sendText
  chatLoadingRef.current = chatLoading
  promptsRef.current = PROMPTS
  const isEmpty = data.chatMessages.length === 0

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      {/* CABECERA CANÓNICA — la misma que las otras once secciones.
          Antes era logotipo + nombre + tres micro-etiquetas de 7px a opacidad 0,07
          (que no se leían: eran textura gris) + una fila de cinco chips de recuento.
          Eso hacía que al saltar desde Proyectos o Tareas la sección pareciera un
          widget incrustado y no parte de Nexus — y es buena parte de lo que Javi
          llama «anticuada».
          Los recuentos se van enteros: son los mismos que acabas de ver en Hoy, y
          abrir el asistente para encontrarte otra vez los mismos contadores no
          invita a preguntar nada. */}
      <div className={`flex-shrink-0 ${isMobile?'px-5':'px-8'} pt-7 pb-5`} style={{borderBottom:`1px solid ${BORDER}`}}>
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="font-syne text-[9px] font-black tracking-[0.25em] mb-2" style={{color:'rgba(255,255,255,0.18)'}}>IA</div>
            <h1 className="font-figtree font-black text-white leading-none" style={{fontSize:isMobile?'22px':'26px',letterSpacing:'-0.03em'}}>
              Brutal.IA
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {!isEmpty && (
            confirmClear
              ? <div className="flex items-center gap-1">
                  {/* Deshabilitado mientras Claude responde: el DELETE se ejecutaba
                      antes de que /api/chat persistiera los dos turnos (que inserta
                      DESPUÉS de la respuesta), así que sobrevivían al borrado y la
                      conversación reaparecía al recargar. */}
                  <button disabled={chatLoading} onClick={async()=>{ setConfirmClear(false); const ok = await data.clearChat?.(); if (ok === false) showToast("No se pudo borrar la conversación") }} className="font-syne text-[8px] font-black px-3 py-1.5 rounded-xl transition-all" style={{background:'rgba(229,29,42,0.12)',color:RED,border:`1px solid rgba(229,29,42,0.25)`,opacity:chatLoading?0.4:1,cursor:chatLoading?"not-allowed":"pointer"}}>¿BORRAR?</button>
                  <button onClick={()=>setConfirmClear(false)} className="w-6 h-6 rounded-lg flex items-center justify-center" style={{color:'rgba(255,255,255,0.3)'}}><LucideIcon name="x" size={10} color="rgba(255,255,255,0.3)"/></button>
                </div>
              : <button onClick={()=>setConfirmClear(true)} className="font-syne text-[8px] font-black tracking-widest px-3 py-1.5 rounded-xl transition-all hover:bg-white/5" style={{color:'rgba(255,255,255,0.2)',border:`1px solid ${BORDER}`}}>LIMPIAR</button>
          )}
          </div>
        </div>
      </div>

      {/* Messages / Empty state */}
      {/* El ref va AQUI, en el contenedor que scrollea de verdad y que existe en
          las dos ramas. Estaba puesto en el div del estado vacio: en cuanto habia
          un mensaje esa rama se desmontaba, scrollRef.current quedaba a null para
          siempre y el efecto de autoscroll salia por su early-return. El chat no
          bajaba al ultimo mensaje NUNCA — habia que arrastrar a mano cada
          respuesta, y en el movil peor, porque el teclado se come media pantalla y
          la vista se queda anclada arriba. */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {isEmpty ? (
          <div className="flex flex-col h-full px-5 py-6 gap-4">
            {/* Hero */}
            <div className="flex items-center gap-3 mb-1">
              <div className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 overflow-hidden p-2" style={{background:'rgba(27,95,250,0.1)',border:'1px solid rgba(27,95,250,0.2)'}}>
                <img src="/brutal-logo.svg" className="w-full opacity-85" alt=""/>
              </div>
              <div>
                <div className="font-figtree text-[16px] font-black text-white leading-none" style={{letterSpacing:'-0.025em'}}>Hola, {profile?.name?.split(' ')[0]||'equipo'}</div>
                <div className="font-syne text-[7.5px] font-bold tracking-widest mt-0.5" style={{color:'rgba(255,255,255,0.2)'}}>TENGO ACCESO COMPLETO AL ESTUDIO</div>
              </div>
            </div>

            {/* Context snapshot */}
            {(()=>{
              const urgentTasks = (data.tasks||[]).filter((t:any)=>!t.done&&t.level==='urgent')
              const activeProjects = (data.projects||[]).filter((p:any)=>p.status==='activo')
              const unreadEmails = (data.inbox||[]).filter((m:any)=>!m.is_read)
              const todayStr = todayKey()
              const todayEvts = (data.calendarEvents||[]).filter((e:any)=>e.start?.slice(0,10)===todayStr)
              return (
                <div className="grid grid-cols-2 gap-2">
                  {/* Urgent tasks widget */}
                  <div className="rounded-2xl p-3.5" style={{background:urgentTasks.length>0?`${RED}08`:`${SURF2}`,border:`1px solid ${urgentTasks.length>0?`${RED}20`:BORDER}`}}>
                    <div className="flex items-center gap-1.5 mb-2">
                      <LucideIcon name="zap" size={10} color={urgentTasks.length>0?RED:'rgba(255,255,255,0.2)'}/>
                      <span className="font-syne text-[7px] font-black tracking-widest" style={{color:urgentTasks.length>0?RED:'rgba(255,255,255,0.2)'}}>URGENTE</span>
                    </div>
                    {urgentTasks.length>0 ? (
                      <div>
                        <div className="font-figtree text-[20px] font-black leading-none mb-1" style={{color:RED}}>{urgentTasks.length}</div>
                        <div className="font-syne text-[9px] leading-tight" style={{color:'rgba(255,255,255,0.4)'}} title={urgentTasks.map((t:any)=>t.text).join(', ')}>{urgentTasks[0]?.text?.slice(0,40)}{urgentTasks.length>1?` +${urgentTasks.length-1}`:''}</div>
                      </div>
                    ) : <div className="font-syne text-[9px]" style={{color:'rgba(255,255,255,0.2)'}}>Sin urgencias</div>}
                  </div>

                  {/* Unread emails widget */}
                  <div className="rounded-2xl p-3.5" style={{background:unreadEmails.length>0?'rgba(234,67,53,0.06)':SURF2,border:`1px solid ${unreadEmails.length>0?'rgba(234,67,53,0.18)':BORDER}`}}>
                    <div className="flex items-center gap-1.5 mb-2">
                      <LucideIcon name="mail" size={10} color={unreadEmails.length>0?'rgba(234,67,53,0.8)':'rgba(255,255,255,0.2)'}/>
                      <span className="font-syne text-[7px] font-black tracking-widest" style={{color:unreadEmails.length>0?'rgba(234,67,53,0.8)':'rgba(255,255,255,0.2)'}}>INBOX</span>
                    </div>
                    {unreadEmails.length>0 ? (
                      <div>
                        <div className="font-figtree text-[20px] font-black leading-none mb-1" style={{color:'rgba(234,67,53,0.85)'}}>{unreadEmails.length}</div>
                        <div className="font-syne text-[9px] leading-tight break-words" style={{color:'rgba(255,255,255,0.4)'}}>{unreadEmails[0]?.from_name||'?'}: {(unreadEmails[0]?.subject||'sin asunto').slice(0,30)}</div>
                      </div>
                    ) : <div className="font-syne text-[9px]" style={{color:'rgba(255,255,255,0.2)'}}>Inbox al día</div>}
                  </div>

                  {/* Projects widget */}
                  <div className="rounded-2xl p-3.5" style={{background:SURF2,border:`1px solid ${BORDER}`}}>
                    <div className="flex items-center gap-1.5 mb-2">
                      <LucideIcon name="folder" size={10} color={BLU}/>
                      <span className="font-syne text-[7px] font-black tracking-widest" style={{color:`${BLU}80`}}>PROYECTOS</span>
                    </div>
                    <div className="font-figtree text-[20px] font-black leading-none mb-1" style={{color:BLU}}>{activeProjects.length}</div>
                    <div className="font-syne text-[9px] leading-tight" style={{color:'rgba(255,255,255,0.3)'}}>{activeProjects.slice(0,2).map((p:any)=>p.name).join(', ')||'sin activos'}</div>
                  </div>

                  {/* Calendar today widget */}
                  <div className="rounded-2xl p-3.5" style={{background:SURF2,border:`1px solid ${BORDER}`}}>
                    <div className="flex items-center gap-1.5 mb-2">
                      <LucideIcon name="calendar" size={10} color='rgba(167,139,250,0.8)'/>
                      <span className="font-syne text-[7px] font-black tracking-widest" style={{color:'rgba(167,139,250,0.5)'}}>HOY</span>
                    </div>
                    {todayEvts.length>0 ? (
                      <div>
                        <div className="font-figtree text-[20px] font-black leading-none mb-1" style={{color:'rgba(167,139,250,0.9)'}}>{todayEvts.length}</div>
                        <div className="font-syne text-[9px] leading-tight" style={{color:'rgba(255,255,255,0.3)'}}>{todayEvts[0]?.title?.slice(0,35)}</div>
                      </div>
                    ) : <div className="font-syne text-[9px]" style={{color:'rgba(255,255,255,0.2)'}}>Sin eventos hoy</div>}
                  </div>
                </div>
              )
            })()}

            {/* Recent emails preview */}
            {(()=>{
              const recent = (data.inbox||[]).filter((m:any)=>!m.is_read).slice(0,3)
              if (recent.length === 0) return null
              return (
                <div className="rounded-2xl overflow-hidden" style={{border:`1px solid ${BORDER}`}}>
                  <div className="px-3.5 py-2.5 flex items-center gap-2" style={{borderBottom:`1px solid ${BORDER}`,background:SURF2}}>
                    <LucideIcon name="inbox" size={9} color='rgba(255,255,255,0.25)'/>
                    <span className="font-syne text-[7px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.2)'}}>EMAILS SIN LEER</span>
                  </div>
                  {recent.map((m:any,i:number)=>(
                    <div key={m.id} className="flex items-start gap-2.5 px-3.5 py-2.5" style={{borderBottom:i<recent.length-1?`1px solid ${BORDER}`:'none'}}>
                      <div className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{background:m.ai_urgency==='urgent'?RED:BLU}}/>
                      <div className="min-w-0">
                        <div className="font-figtree text-[11px] font-semibold truncate" style={{color:'rgba(255,255,255,0.7)'}}>{m.from_name||'?'} <span className="font-normal" style={{color:'rgba(255,255,255,0.3)'}}>— {(m.subject||'').slice(0,45)}</span></div>
                        {m.ai_summary && <div className="font-syne text-[8.5px] truncate mt-0.5" style={{color:'rgba(255,255,255,0.28)'}}>{m.ai_summary.slice(0,70)}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )
            })()}

            {/* Prompts */}
            <div>
              <div className="font-syne text-[7px] font-black tracking-widest mb-2 px-0.5" style={{color:'rgba(255,255,255,0.28)'}}>SUGERENCIAS RÁPIDAS</div>
              <div className="grid grid-cols-2 gap-2">
                {PROMPTS.map((p,pi)=>(
                  <button key={p.text} onClick={()=>sendText(p.text)} className="text-left p-3.5 rounded-2xl transition-all relative" style={{background:SURF2,border:`1px solid ${BORDER}`}}
                    onMouseEnter={e=>(e.currentTarget.style.borderColor='rgba(27,95,250,0.3)')}
                    onMouseLeave={e=>(e.currentTarget.style.borderColor=BORDER)}>
                    <span className="absolute top-2 right-2.5 font-syne text-[7px] font-black" style={{color:'rgba(255,255,255,0.07)'}}>{pi+1}</span>
                    <div className="font-syne text-[7px] font-black tracking-widest mb-1.5" style={{color:'rgba(27,95,250,0.65)'}}>{p.cat}</div>
                    <div className="text-[11px] leading-snug" style={{color:'rgba(255,255,255,0.45)'}}>{p.text}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="px-5 py-5 space-y-4">
            {data.chatMessages.map((m: any, mi: number)=>{
              const prev = data.chatMessages[mi-1]
              const mDay = m.created_at ? new Date(m.created_at).toDateString() : null
              const prevDay = prev?.created_at ? new Date(prev.created_at).toDateString() : null
              const showDateSep = mDay && mDay !== prevDay
              const todayD = new Date().toDateString()
              const yesterD = new Date(Date.now()-86400000).toDateString()
              const dayLabel = !mDay ? null : mDay===todayD ? 'HOY' : mDay===yesterD ? 'AYER' : new Date(m.created_at).toLocaleDateString('es-ES',{day:'numeric',month:'short'})
              return (
              <div key={m.id}>
                {showDateSep && dayLabel && (
                  <div className="flex items-center gap-3 py-2 mb-2">
                    <div className="flex-1 h-px" style={{background:BORDER}}/>
                    <span className="font-syne text-[7.5px] font-black tracking-widest px-2" style={{color:'rgba(255,255,255,0.18)'}}>{dayLabel}</span>
                    <div className="flex-1 h-px" style={{background:BORDER}}/>
                  </div>
                )}
              <div className={`flex gap-2.5 group/msg ${m.role==='user'?'justify-end':'items-start'}`} style={{flexDirection:m.role==='user'?'row-reverse':'row'}}>
                {m.role==='ai' && (
                  <div className="w-7 h-7 rounded-xl flex-shrink-0 flex items-center justify-center overflow-hidden mt-0.5 p-1" style={{background:'rgba(27,95,250,0.12)',border:'1px solid rgba(27,95,250,0.2)'}}>
                    <img src="/brutal-logo.svg" className="w-full opacity-80" alt=""/>
                  </div>
                )}
                {/* Ancho de LECTURA, no porcentaje. En un monitor ancho el 76%
                    son ~1000px de línea, muy por encima de las 65-75 letras que se
                    siguen sin perder el renglón — y hacía que la sección se viera
                    distinta en cada pantalla, que es lo contrario de «diseñado». */}
                <div className="relative" style={{maxWidth:'min(76%, 680px)',display:'flex',flexDirection:'column',alignItems:m.role==='user'?'flex-end':'flex-start'}}>
                  <div className="px-4 py-3" style={{
                    // El degradado azul de esquina a esquina era el gesto que más
                    // databa la pantalla —mensajería de 2015— y además se rompía en
                    // modo claro: el contrafiltro de globals.css solo cancela
                    // declaraciones `color:`, no fondos, así que el body invertía el
                    // degradado y la burbuja salía naranja con texto negro.
                    // Un tinte plano del azul de marca dice lo mismo —«esto lo has
                    // escrito tú»— sin gritar, y con hex para que el alfa concatene.
                    background:m.role==='user'?`${BLU}1A`:'rgba(12,12,22,0.95)',
                    border:m.role==='user'?`1px solid ${BLU}38`:`1px solid ${BORDER}`,
                    borderRadius:'16px',
                    borderTopLeftRadius:m.role==='ai'?'5px':'16px',
                    borderTopRightRadius:m.role==='user'?'5px':'16px',
                  }}>
                    {m.role==='user'
                      ? <span className="text-[13px] leading-relaxed text-white whitespace-pre-wrap break-words">{m.content}</span>
                      : <MarkdownMsg text={m.content}/>
                    }
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    {m.created_at && <span className={`transition-opacity font-syne text-[7px] ${isMobile?'opacity-30':'opacity-0 group-hover/msg:opacity-100'}`} style={{color:'rgba(255,255,255,0.18)'}}>{new Date(m.created_at).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'})}</span>}
                    {m.role==='ai' && m.searched && (
                      <span className="flex items-center gap-1 px-2 py-0.5 rounded-full font-syne text-[7px] font-black tracking-wide" style={{background:'rgba(34,197,94,0.1)',border:'1px solid rgba(34,197,94,0.2)',color:GRN}}>
                        <LucideIcon name="globe" size={8} color={GRN}/>WEB
                      </span>
                    )}
                    {m.role==='ai' && (
                      <button onClick={()=>copyMsg(m.id, m.content)} className={`transition-opacity flex items-center gap-1 px-2 py-1 rounded-lg ${isMobile?'opacity-50':'opacity-0 group-hover/msg:opacity-100'}`} style={{color:copiedId===m.id?GRN:'rgba(255,255,255,0.25)',background:'transparent'}}>
                        <LucideIcon name={copiedId===m.id?'check':'copy'} size={10} color={copiedId===m.id?GRN:'rgba(255,255,255,0.25)'}/>
                        <span className="font-syne text-[7px] font-black tracking-wide">{copiedId===m.id?'COPIADO':'COPIAR'}</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
              </div>
            )})}
            {chatLoading && (
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-xl flex items-center justify-center overflow-hidden p-1" style={{background:'rgba(27,95,250,0.12)',border:'1px solid rgba(27,95,250,0.2)'}}>
                  <img src="/brutal-logo.svg" className="w-full opacity-80" alt=""/>
                </div>
                {/* LA ESPERA, CONTADA.
                    Eran tres puntos de 6px durante una espera que puede acercarse
                    al minuto —la búsqueda web ocurre ANTES de llamar al modelo—.
                    Una pantalla que no dice nada durante cuarenta segundos se lee
                    como rota, y es lo primero que envejece un chat. Harvey ya
                    distinguía «BUSCANDO EN WEB…» con el mismo motor detrás.
                    Las fases van por tiempo, no por progreso real. Es honesto
                    mientras digan cosas que de verdad pasan y no prometan un
                    porcentaje — la lección de la barra del PDF. */}
                <div className="px-4 py-3.5 rounded-2xl" style={{background:'rgba(12,12,22,0.95)',border:`1px solid ${BORDER}`}}>
                  <Esperando fases={['Leyendo tu contexto', 'Buscando lo que haga falta', 'Redactando']} color={BLU}/>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Context-aware quick prompts (when chat has messages) */}
      {!isEmpty && !chatLoading && (()=>{
        const urgentTasks = data.tasks?.filter((t:any)=>!t.done&&t.level==='urgent').length||0
        const unread = data.inbox?.filter((m:any)=>!m.is_read).length||0
        const overdueProjs = data.projects?.filter((p:any)=>p.status!=='completado'&&estadoDeadline(p.deadline)?.vencido).length||0
        const suggestions: {text:string; hint:string}[] = []
        if (urgentTasks > 0) suggestions.push({text:`¿Cómo resolver mis ${urgentTasks} tarea${urgentTasks>1?'s':''} urgente${urgentTasks>1?'s':''}?`, hint:'URGENTE'})
        if (unread > 0) suggestions.push({text:`Resume los ${unread} mensajes sin leer`, hint:'INBOX'})
        if (overdueProjs > 0) suggestions.push({text:`¿Qué hago con los ${overdueProjs} proyecto${overdueProjs>1?'s':''} atrasado${overdueProjs>1?'s':''}?`, hint:'PROYECTOS'})
        suggestions.push({text:'¿Qué debería priorizar ahora mismo?', hint:'FOCUS'})
        suggestions.push({text:'Dame un resumen del estado general', hint:'RESUMEN'})
        const shown = suggestions.slice(0, 3)
        return shown.length > 0 ? (
          <div className="px-5 pb-2 flex gap-2 overflow-x-auto" style={{scrollbarWidth:'none'}}>
            {shown.map((s,i)=>(
              <button key={i} onClick={()=>sendText(s.text)} className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-syne text-[7.5px] font-black tracking-wide transition-all hover:opacity-80" style={{background:SURF2,border:`1px solid ${BORDER}`,color:'rgba(255,255,255,0.4)'}}>
                <span style={{color:BLU}}>{s.hint}</span>
                <span className="truncate max-w-[200px]">{s.text}</span>
              </button>
            ))}
          </div>
        ) : null
      })()}

      {/* Input */}
      <div className="flex-shrink-0 px-5 py-4" style={{borderTop:`1px solid ${BORDER}`}}>
        <div className="flex items-end gap-2.5 px-4 py-3 rounded-2xl" style={{background:SURF2,border:`1.5px solid rgba(27,95,250,0.12)`}}>
          <textarea
            ref={inputRef}
            value={chatInput}
            onChange={e=>setChatInput(e.target.value)}
            onInput={e=>{e.currentTarget.style.height='auto';e.currentTarget.style.height=Math.min(e.currentTarget.scrollHeight,120)+'px'}}
            onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}}}
            onFocus={e=>(e.currentTarget.parentElement!.style.borderColor='rgba(27,95,250,0.35)')}
            onBlur={e=>(e.currentTarget.parentElement!.style.borderColor='rgba(27,95,250,0.12)')}
            placeholder="Pregunta a Brutal.IA…"
            rows={1}
            className="flex-1 bg-transparent text-[13px] outline-none resize-none leading-relaxed"
            style={{caretColor:BLU,color:'rgba(255,255,255,0.88)',maxHeight:'120px'}}
          />
          <button onClick={send} disabled={!chatInput.trim()||chatLoading} className={`${isMobile?'w-10 h-10':'w-8 h-8'} rounded-xl flex items-center justify-center flex-shrink-0 disabled:opacity-25 transition-all`} style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}} aria-label="Enviar"><LucideIcon name="send" size={13} color="white"/></button>
        </div>
        <div className="flex items-center justify-between mt-2 px-0.5">
          <div className="font-syne text-[7.5px] font-bold tracking-widest" style={{color:'rgba(255,255,255,0.1)'}}>{isMobile ? '' : 'ENTER enviar · SHIFT+ENTER nueva línea'}</div>
          {onNavigate && (
            <button onClick={()=>onNavigate('harvey')} className="flex items-center gap-1 font-syne text-[7.5px] font-black tracking-widest transition-all hover:opacity-80" style={{color:`${BLU}60`}}>
              <LucideIcon name="cpu" size={9} color={`${BLU}60`}/>
              HARVEY
              <LucideIcon name="arrow-right" size={8} color={`${BLU}60`}/>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default ChatSection
