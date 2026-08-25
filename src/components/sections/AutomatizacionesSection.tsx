'use client'
import { useState, useEffect, useRef } from 'react'
import { hayModalAbierto } from '@/components/shared/modalAbierto'
import type { Regla, NexusData} from '@/types'
import { BLU, RED, GRN, SURFACE, BORDER, LucideIcon, useIsMobile, buscaEnTexto } from '@/components/shared'

const isStructured = (r: Regla) => (r.condition_text || '').trim().startsWith('{')

function relTime(iso: string | undefined): string | null {
  if (!iso) return null
  const diff = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60)   return 'hace un momento'
  if (diff < 3600) return `hace ${Math.floor(diff/60)}min`
  if (diff < 86400) return `hace ${Math.floor(diff/3600)}h`
  if (diff < 86400*2) return 'ayer'
  if (diff < 86400*7) return `hace ${Math.floor(diff/86400)}d`
  return new Date(iso).toLocaleDateString('es-ES',{day:'numeric',month:'short'})
}

interface PropsAutomatizaciones {
  data: NexusData
  onOpenModal: any
  showToast: any
  isOwner: any
}


/** El catálogo de lo que la app SABE vigilar.
 *
 *  Vive fuera del componente y se pinta SIEMPRE. Antes estaba dentro de un
 *  `{data.reglas.length===0 && …}`, o sea que al añadir la primera regla
 *  desaparecían las once. Javi: «cuando seleccionas una y le das a usar, ya no te
 *  aparecen como ejemplo para poder añadirlas; quiero que sigan apareciendo».
 *
 *  Y tiene más sentido del que parece: esconderlas justo al usar la primera deja
 *  al equipo sin saber qué más se puede hacer, en el momento en que acaba de
 *  descubrir que la sección sirve para algo. */
const PLANTILLAS = [
// ── DE CONTROL, primero ─────────────────────────────────────
// Javi: «el jefe puede ponerse un aviso de que alguien lleva dos
// días sin fichar». Las de abajo miran COSAS —correos, tareas,
// proyectos—; estas miran PERSONAS, que es lo que un jefe necesita
// y no había. Van arriba porque son las que él pidió y las que
// responden a la pregunta que se hace todos los días.
{name:'Alguien lleva 2 días sin fichar', cond:'2 días laborables sin fichar', act:'Avisarme a mí',
 config:{v:1,trigger:{type:'sin_fichar',threshold:2},action:{type:'notify_owner',message:'{persona} lleva {dias} días sin fichar'}}},
{name:'Alguien se ha marcado bloqueado', cond:'Se marca BLOQUEADO al cerrar el día', act:'Avisarme a mí',
 config:{v:1,trigger:{type:'bloqueado'},action:{type:'notify_owner',message:'{persona} se marcó bloqueado el {dia}'}}},
{name:'Día fichado y sin cerrar', cond:'Fichó y no cerró el día', act:'Avisarme a mí',
 config:{v:1,trigger:{type:'dia_sin_cerrar'},action:{type:'notify_owner',message:'{persona} no cerró el día {dia}'}}},

// ── DE ALTA ─────────────────────────────────────────────────
{name:'Nuevo proyecto añadido', cond:'Se crea un proyecto', act:'Notificar al equipo',
 config:{v:1,trigger:{type:'proyecto_nuevo'},action:{type:'notify_team',message:'Nuevo proyecto: {proyecto}'}}},
{name:'Nueva pieza de contenido', cond:'Se añade una pieza', act:'Notificar al equipo',
 config:{v:1,trigger:{type:'pieza_nueva'},action:{type:'notify_team',message:'Nueva pieza: {pieza}'}}},

{name:'Seguimiento de emails urgentes', cond:'Email urgente sin leer', act:'Crear tarea (alta)',
 config:{v:1,trigger:{type:'email_urgent'},action:{type:'create_task',taskText:'Responder a {remitente} sobre {asunto}',level:'high'}}},
{name:'Alerta de deadline próximo', cond:'Deadline en < 7 días', act:'Notificar al equipo',
 config:{v:1,trigger:{type:'project_deadline',days:7},action:{type:'notify_team',message:'Deadline cercano en {proyecto} ({dias} días)'}}},
{name:'Inbox saturado', cond:'15+ emails sin leer', act:'Avisarme a mí',
 config:{v:1,trigger:{type:'unread_pileup',threshold:15},action:{type:'notify_owner',message:'Tienes {total} emails sin leer'}}},
{name:'Muchas tareas vencidas', cond:'5+ tareas vencidas', act:'Avisarme a mí',
 config:{v:1,trigger:{type:'many_overdue',threshold:5},action:{type:'notify_owner',message:'Tienes {total} tareas vencidas pendientes'}}},
{name:'Tareas urgentes sin asignar', cond:'Tareas urgentes sin responsable', act:'Notificar al equipo',
 config:{v:1,trigger:{type:'high_priority_unassigned'},action:{type:'notify_team',message:'Tarea urgente sin asignar: {tarea}'}}},
]

function AutomatizacionesSection({data,onOpenModal,showToast,isOwner}: PropsAutomatizaciones) {
  const isMobile = useIsMobile()
  // Las plantillas que ya se han usado, por nombre. Es la clave con la que se
  // crean, asi que es la unica comparacion honesta que se puede hacer.
  const enUso = new Set(data.reglas.map((r: Regla) => r.name))

  const activeCount = data.reglas.filter((r: Regla)=>r.active).length
  const totalFired = data.reglas.reduce((s: number, r: Regla)=>s+(r.trigger_count||0),0)
  const autoCount = data.reglas.filter((r: Regla)=>r.active && isStructured(r)).length
  const [confirmDeleteId, setConfirmDeleteId] = useState<string|null>(null)
  const [reglaSearch, setReglaSearch] = useState('')
  const [running, setRunning] = useState(false)
  const [focusedReglaId, setFocusedReglaId] = useState<string|null>(null)
  const [renamingId, setRenamingId] = useState<string|null>(null)
  const [renameText, setRenameText] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)
  const [lastRun, setLastRun] = useState<{ at: number; results: Array<{ruleName:string;action:string;detail:string}> }|null>(null)

  const handleRun = async () => {
    if (running) return
    setRunning(true)
    try {
      const res = await data.runAutomations()
      // `skipped` = otra ejecución tenía el cerrojo (el cron, u otra persona).
      // Decir «sin acciones pendientes» ahí sería mentir: no se llegó a mirar.
      if (res.skipped) { showToast('El motor ya se estaba ejecutando · espera unos segundos') ; return }
      setLastRun({ at: Date.now(), results: res.results || [] })
      showToast(res.ran > 0 ? `⚡ ${res.ran} ${res.ran===1?'acción ejecutada':'acciones ejecutadas'}` : 'Motor ejecutado · sin acciones pendientes')
    } catch { showToast('Error al ejecutar el motor') }
    finally { setRunning(false) }
  }

  const ACTION_META: Record<string,{icon:string;color:string;label:string}> = {
    create_task:  { icon:'check-square', color:BLU, label:'Tarea creada' },
    notify_team:  { icon:'users',        color:'#A78BFA', label:'Equipo avisado' },
    notify_owner: { icon:'bell',         color:GRN, label:'Notificación' },
  }

  // Una sola vía para pausar/activar: el atajo `e` y el botón de la tarjeta hacían
  // la misma llamada, pero el atajo se tragaba el error con un catch vacío.
  // updateRegla no es optimista (escribe el estado solo si el PATCH va bien), así que
  // ahí el fallo era invisible: la regla seguía pintada igual y nadie avisaba.
  const alternarRegla = (r: Regla) =>
    data.updateRegla(r.id, {active:!r.active})
      .then(()=>showToast(r.active?'Regla pausada':'Regla activada'))
      .catch(()=>showToast('No se pudo cambiar el estado de la regla'))

  const startRename = (r: Regla) => {
    setRenamingId(r.id)
    setRenameText(r.name)
    setTimeout(()=>renameInputRef.current?.select(), 30)
  }

  const commitRename = async (id: string) => {
    const name = renameText.trim()
    if (name) {
      try {
        await data.updateRegla(id, { name })
        showToast('Nombre actualizado')
      } catch { showToast('Error al renombrar') }
    }
    setRenamingId(null)
  }
  const visibleReglasRef = useRef<Regla[]>([])
  const visibleReglas = data.reglas.filter((r: Regla)=>buscaEnTexto(`${r.name} ${r.condition_text||''} ${r.action_text||''}`, reglaSearch))
  visibleReglasRef.current = visibleReglas

  useEffect(()=>{
    const handler = (e: KeyboardEvent) => {
      // Con un modal abierto el foco esta en BODY, asi que la guarda por tagName
      // de mas abajo no protege: escribir en el formulario ejecutaba estos atajos.
      if (hayModalAbierto()) return
      if (['INPUT','TEXTAREA'].includes((e.target as HTMLElement).tagName) || e.metaKey||e.ctrlKey||e.altKey) return
      if (e.key === 'j' || e.key === 'k') {
        e.preventDefault()
        const rules = visibleReglasRef.current
        const idx = focusedReglaId ? rules.findIndex((r: Regla)=>r.id===focusedReglaId) : -1
        const next = e.key==='j' ? Math.min(idx+1, rules.length-1) : Math.max(idx-1, 0)
        if (rules[next]) setFocusedReglaId(rules[next].id)
      }
      if (e.key === 'e' && focusedReglaId && isOwner) {
        e.preventDefault()
        const rule = visibleReglasRef.current.find((r: Regla)=>r.id===focusedReglaId)
        if (rule) alternarRegla(rule)
      }
      if (e.key === 'n' && isOwner) { e.preventDefault(); onOpenModal('regla') }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedReglaId, isOwner])

  return (
    <div className={`${isMobile?'p-4':'p-8'} max-w-[900px] mx-auto`}>
      <div className="flex items-end justify-between mb-8 flex-wrap gap-4">
        <div className="min-w-0">
          <div className="font-syne text-[9px] font-black tracking-[0.25em] mb-2" style={{color:'rgba(255,255,255,0.18)'}}>SISTEMA</div>
          <h1 className="font-figtree text-[26px] font-black text-white leading-none" style={{letterSpacing:'-0.03em'}}>Automatizaciones</h1>
          <div className="nx-kbd-hints flex items-center gap-2 mt-1.5">
            {(['J/K NAVEGAR','E ACTIVAR','N NUEVA'] as const).map((hint,i,arr)=>(
              <span key={hint} className="flex items-center gap-2">
                <span className="font-syne text-[7.5px] font-bold tracking-widest" style={{color:'rgba(255,255,255,0.1)'}}>{hint}</span>
                {i<arr.length-1&&<span className="font-syne text-[7px]" style={{color:'rgba(255,255,255,0.07)'}}>·</span>}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center flex-wrap gap-3">
          {totalFired > 0 && (
            <div className="text-right flex-shrink-0">
              <div className="font-figtree text-[26px] font-black leading-none" style={{color:'rgba(167,139,250,0.8)',letterSpacing:'-0.04em'}}>{totalFired}</div>
              <div className="font-syne text-[8px] font-bold tracking-widest" style={{color:'rgba(255,255,255,0.2)'}}>EJECUCIONES</div>
            </div>
          )}
          <div className="text-right flex-shrink-0">
            <div className="font-figtree text-[26px] font-black leading-none" style={{color:activeCount>0?BLU:'rgba(255,255,255,0.25)',letterSpacing:'-0.04em'}}>{activeCount}</div>
            <div className="font-syne text-[8px] font-bold tracking-widest" style={{color:'rgba(255,255,255,0.2)'}}>DE {data.reglas.length} ACTIVAS</div>
          </div>
          {isOwner && autoCount > 0 && (
            <button onClick={handleRun} disabled={running} className="flex items-center gap-2 px-4 py-2.5 rounded-2xl font-syne text-[9px] font-black tracking-widest transition-all disabled:opacity-60 flex-shrink-0" style={{background:'rgba(52,211,153,0.1)',border:'1px solid rgba(52,211,153,0.28)',color:GRN}}>
              <LucideIcon name={running?'clock':'zap'} size={12} color={GRN}/>
              {running?'EJECUTANDO…':'EJECUTAR AHORA'}
            </button>
          )}
          {isOwner && (
            <button onClick={()=>onOpenModal('regla')} className="flex items-center gap-2 px-5 py-2.5 rounded-2xl font-syne text-[10px] font-black tracking-widest text-white flex-shrink-0 transition-opacity hover:opacity-85" style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>
              <LucideIcon name="plus" size={12} color="white"/> REGLA
            </button>
          )}
        </div>
      </div>
      {data.reglas.length > 4 && (
        <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-2xl mb-5" style={{background:SURFACE,border:`1px solid ${BORDER}`,maxWidth:'320px'}}>
          <LucideIcon name="search" size={12} color="rgba(255,255,255,0.2)"/>
          <input value={reglaSearch} onChange={e=>setReglaSearch(e.target.value)} placeholder="Busca regla…" className="flex-1 bg-transparent text-[12px] outline-none" style={{caretColor:BLU,color:'rgba(255,255,255,0.75)'}}/>
          {reglaSearch && <button onClick={()=>setReglaSearch('')}><LucideIcon name="x" size={11} color="rgba(255,255,255,0.2)"/></button>}
        </div>
      )}
      {/* Estado del motor: activo, se ejecuta cada hora + al pulsar "Ejecutar ahora" */}
      <div className="flex items-start gap-3 px-4 py-3 rounded-2xl mb-5" style={{background:'rgba(52,211,153,0.05)',border:'1px solid rgba(52,211,153,0.16)'}}>
        <div className="relative flex-shrink-0 mt-0.5">
          <div className="w-2 h-2 rounded-full" style={{background:GRN}}/>
          <div className="absolute inset-0 w-2 h-2 rounded-full animate-ping" style={{background:GRN,opacity:0.5}}/>
        </div>
        <div className="min-w-0">
          <div className="font-syne text-[8.5px] font-black tracking-widest mb-0.5" style={{color:GRN}}>MOTOR ACTIVO</div>
          <div className="font-figtree text-[12px] leading-relaxed" style={{color:'rgba(255,255,255,0.4)'}}>
            {autoCount > 0
              ? <>Evalúa <b style={{color:'rgba(255,255,255,0.7)'}}>{autoCount}</b> {autoCount===1?'regla automática':'reglas automáticas'} cada hora y al sincronizar emails. Puedes forzarlo con <b style={{color:GRN}}>Ejecutar ahora</b>.</>
              : <>El motor está en marcha. Crea una regla con <b style={{color:'rgba(255,255,255,0.7)'}}>+ REGLA</b> y se ejecutará automáticamente.</>}
          </div>
        </div>
      </div>

      {/* Resultado de la última ejecución manual del motor */}
      {lastRun && (
        <div className="rounded-2xl overflow-hidden mb-5" style={{background:SURFACE,border:`1px solid ${lastRun.results.length?'rgba(52,211,153,0.22)':BORDER}`}}>
          <div className="flex items-center gap-2.5 px-5 py-3" style={{borderBottom:`1px solid ${BORDER}`,background:lastRun.results.length?'rgba(52,211,153,0.04)':'transparent'}}>
            <LucideIcon name="zap" size={13} color={lastRun.results.length?GRN:'rgba(255,255,255,0.3)'}/>
            <span className="font-syne text-[9px] font-black tracking-widest flex-1" style={{color:lastRun.results.length?GRN:'rgba(255,255,255,0.4)'}}>
              ÚLTIMA EJECUCIÓN · {relTime(new Date(lastRun.at).toISOString())}
            </span>
            <span className="font-figtree text-[11px] font-semibold" style={{color:'rgba(255,255,255,0.4)'}}>{lastRun.results.length} {lastRun.results.length===1?'acción':'acciones'}</span>
            <button onClick={()=>setLastRun(null)} className="w-6 h-6 rounded-lg flex items-center justify-center transition-colors hover:bg-white/5"><LucideIcon name="x" size={11} color="rgba(255,255,255,0.3)"/></button>
          </div>
          {lastRun.results.length===0
            ? <div className="px-5 py-4 text-[12px]" style={{color:'rgba(255,255,255,0.3)'}}>El motor se ejecutó pero no había nada pendiente que disparar. Todo en orden.</div>
            : lastRun.results.map((r,i)=>{
                const meta = ACTION_META[r.action] || {icon:'zap',color:BLU,label:r.action}
                return (
                  <div key={i} className="flex items-center gap-3 px-5 py-3" style={{borderBottom:i<lastRun.results.length-1?`1px solid ${BORDER}`:'none'}}>
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{background:meta.color+'14',border:`1px solid ${meta.color}22`}}>
                      <LucideIcon name={meta.icon} size={13} color={meta.color}/>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-figtree text-[12.5px] font-semibold truncate" style={{color:'rgba(240,240,248,0.85)'}}>{r.ruleName}</span>
                        <span className="font-syne text-[6.5px] font-black px-1.5 py-0.5 rounded tracking-widest flex-shrink-0" style={{background:meta.color+'14',color:meta.color}}>{meta.label.toUpperCase()}</span>
                      </div>
                      {r.detail && <div className="text-[11px] truncate" style={{color:'rgba(255,255,255,0.32)'}}>{r.detail}</div>}
                    </div>
                  </div>
                )
              })}
        </div>
      )}

      <div className="rounded-2xl overflow-hidden" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
        {visibleReglas.map((r: Regla, i: number)=>(
          <div key={r.id} onClick={()=>setFocusedReglaId(r.id)} className="group flex items-center gap-4 px-5 py-4 transition-all cursor-pointer" style={{borderBottom:i<visibleReglas.length-1?`1px solid ${BORDER}`:'none',borderLeft:`3px solid ${r.active?BLU+'60':'transparent'}`,opacity:r.active?1:0.45,background:focusedReglaId===r.id?'rgba(255,255,255,0.025)':'transparent'}}>
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{background:r.active?'rgba(27,95,250,0.08)':'rgba(255,255,255,0.03)',border:`1px solid ${r.active?'rgba(27,95,250,0.18)':BORDER}`}}>
              <LucideIcon name="zap" size={14} color={r.active?BLU:'rgba(255,255,255,0.2)'}/>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                {renamingId === r.id ? (
                  <input
                    ref={renameInputRef}
                    value={renameText}
                    onChange={e=>setRenameText(e.target.value)}
                    onBlur={()=>commitRename(r.id)}
                    onKeyDown={e=>{ if(e.key==='Enter') commitRename(r.id); if(e.key==='Escape'){setRenamingId(null)} }}
                    onClick={e=>e.stopPropagation()}
                    className="font-figtree text-[14px] font-semibold bg-transparent outline-none border-b"
                    style={{color:'rgba(240,240,248,0.9)',borderColor:BLU+'60',minWidth:'120px',maxWidth:'240px',caretColor:BLU}}
                  />
                ) : (
                  <span
                    className="font-figtree text-[14px] font-semibold cursor-text"
                    title={isOwner ? 'Doble click para renombrar' : undefined}
                    onDoubleClick={e=>{ if(!isOwner) return; e.stopPropagation(); startRename(r) }}
                    style={{color:r.active?'rgba(240,240,248,0.9)':'rgba(240,240,248,0.4)'}}>
                    {r.name}
                  </span>
                )}
                {isStructured(r)
                  ? <span className="font-syne text-[7px] font-black px-2 py-0.5 rounded-full tracking-widest" style={{background:'rgba(52,211,153,0.1)',color:GRN,border:'1px solid rgba(52,211,153,0.2)'}}>AUTO</span>
                  : <span className="font-syne text-[7px] font-black px-2 py-0.5 rounded-full tracking-widest" style={{background:'rgba(255,176,32,0.08)',color:'rgba(255,176,32,0.7)',border:'1px solid rgba(255,176,32,0.18)'}}>MANUAL</span>}
                {r.trigger_count > 0 && <span className="font-syne text-[7.5px] font-black px-2 py-0.5 rounded-full" style={{background:'rgba(27,95,250,0.08)',color:'rgba(100,140,255,0.6)'}}>{r.trigger_count}× ejecutada</span>}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {isStructured(r)
                  ? (r.action_text && <div className="text-[11px]" style={{color:'rgba(255,255,255,0.28)'}}>{r.action_text}</div>)
                  : (r.condition_text||r.action_text) && (
                    <div className="flex items-center gap-1.5 text-[11px]" style={{color:'rgba(255,255,255,0.28)'}}>
                      {r.condition_text && <span>{r.condition_text}</span>}
                      {r.condition_text && r.action_text && <span style={{color:'rgba(255,255,255,0.15)'}}>›</span>}
                      {r.action_text && <span>{r.action_text}</span>}
                    </div>
                  )}
                {r.last_triggered_at && (
                  <span className="flex items-center gap-1 text-[10px]" style={{color:'rgba(255,255,255,0.2)'}}>
                    <LucideIcon name="clock" size={9} color="rgba(255,255,255,0.2)"/>
                    {relTime(r.last_triggered_at)}
                  </span>
                )}
              </div>
            </div>
            {isOwner && (
              <button onClick={()=>alternarRegla(r)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-syne text-[7.5px] font-black transition-all flex-shrink-0"
                style={{background:r.active?'rgba(27,95,250,0.1)':'rgba(255,255,255,0.04)',color:r.active?BLU:'rgba(240,240,248,0.2)',border:`1px solid ${r.active?'rgba(27,95,250,0.2)':'transparent'}`}}>
                <div className="w-1.5 h-1.5 rounded-full" style={{background:r.active?BLU:'rgba(255,255,255,0.2)'}}/>
                {r.active?'ACTIVO':'PAUSADO'}
              </button>
            )}
            {!isOwner && <span className="font-syne text-[7.5px] font-black px-2.5 py-1 rounded-full flex-shrink-0" style={{background:r.active?'rgba(27,95,250,0.1)':'rgba(255,255,255,0.04)',color:r.active?BLU:'rgba(240,240,248,0.2)',border:`1px solid ${r.active?'rgba(27,95,250,0.2)':'transparent'}`}}>{r.active?'ACTIVO':'PAUSADO'}</span>}
            {isOwner && (
              confirmDeleteId === r.id
                ? <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={()=>{ data.deleteRegla(r.id).then(()=>showToast('Regla eliminada')).catch(()=>showToast('Error al eliminar')); setConfirmDeleteId(null) }} className="px-2.5 py-1.5 rounded-lg font-syne text-[8px] font-black transition-all" style={{background:'rgba(229,29,42,0.15)',color:RED,border:`1px solid rgba(229,29,42,0.25)`}}>¿BORRAR?</button>
                    <button onClick={()=>setConfirmDeleteId(null)} className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors hover:bg-white/5 flex-shrink-0" style={{color:'rgba(255,255,255,0.3)'}}><LucideIcon name="x" size={11} color="rgba(255,255,255,0.3)"/></button>
                  </div>
                : <button onClick={()=>setConfirmDeleteId(r.id)} title="Eliminar regla" aria-label={`Eliminar la regla ${r.name}`} className="opacity-60 md:opacity-0 md:group-hover:opacity-60 transition-opacity flex-shrink-0"><LucideIcon name="trash" size={13} color={RED}/></button>
            )}
          </div>
        ))}
        {reglaSearch && visibleReglas.length===0&&<div className="py-10 text-center text-[12px]" style={{color:'rgba(255,255,255,0.2)'}}>Sin resultados para "{reglaSearch}"</div>}
        {(
          <div className="py-10 px-6">
            <div className="text-center text-[12px] mb-6" style={{color:'rgba(255,255,255,0.2)'}}>
              {data.reglas.length===0 ? 'Sin reglas · empieza con una plantilla' : 'Plantillas · lo que la app sabe vigilar'}
            </div>
            <div className="space-y-2">
              {PLANTILLAS.map((tpl,i)=>(
                <div key={i} className="flex items-center gap-4 px-5 py-4 rounded-2xl transition-all" style={{background:'rgba(27,95,250,0.03)',border:'1px solid rgba(27,95,250,0.1)'}}>
                  <div className="flex-1 min-w-0">
                    <div className="font-figtree text-[13px] font-semibold text-white mb-1">{tpl.name}</div>
                    <div className="flex items-center gap-1.5 text-[11px]" style={{color:'rgba(255,255,255,0.28)'}}>
                      <span>{tpl.cond}</span>
                      <span style={{color:'rgba(255,255,255,0.12)'}}>›</span>
                      <span>{tpl.act}</span>
                    </div>
                  </div>
                    {/* La que ya tienes se queda A LA VISTA, pero sin poder añadirse
                        otra vez: dos reglas iguales avisan dos veces, y a la tercera
                        nadie lee los avisos. Se recupera sola si borras la regla. */}
                    {isOwner && (enUso.has(tpl.name)
                      ? <span className="flex-shrink-0 px-3 py-1.5 rounded-xl font-syne text-[8px] font-black tracking-wide"
                          style={{background:'rgba(46,212,122,0.1)',color:GRN,border:'1px solid rgba(46,212,122,0.22)'}}>YA LA TIENES</span>
                      : <button onClick={async()=>{try{await data.createRegla({name:tpl.name,condition_text:JSON.stringify(tpl.config),action_text:`${tpl.cond} › ${tpl.act}`,active:true});showToast('Regla creada · el motor la ejecutará')}catch{showToast('Error')}}} className="flex-shrink-0 px-3 py-1.5 rounded-xl font-syne text-[8px] font-black tracking-wide transition-all hover:opacity-80" style={{background:'rgba(27,95,250,0.12)',color:BLU,border:'1px solid rgba(27,95,250,0.2)'}}>+ USAR</button>)}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default AutomatizacionesSection
