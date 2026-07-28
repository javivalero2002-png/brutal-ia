'use client'
import { useState, useEffect, useRef } from 'react'
import type { Regla } from '@/types'
import { BLU, RED, SURFACE, BORDER, LucideIcon } from '@/components/shared'

function AutomatizacionesSection({data,onOpenModal,showToast,isOwner}: any) {
  const activeCount = data.reglas.filter((r: Regla)=>r.active).length
  const totalFired = data.reglas.reduce((s: number, r: Regla)=>s+(r.trigger_count||0),0)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string|null>(null)
  const [reglaSearch, setReglaSearch] = useState('')
  const [focusedReglaId, setFocusedReglaId] = useState<string|null>(null)
  const visibleReglasRef = useRef<Regla[]>([])
  const visibleReglas = data.reglas.filter((r: Regla)=>!reglaSearch.trim()||r.name.toLowerCase().includes(reglaSearch.toLowerCase())||(r.condition_text||'').toLowerCase().includes(reglaSearch.toLowerCase())||(r.action_text||'').toLowerCase().includes(reglaSearch.toLowerCase()))
  visibleReglasRef.current = visibleReglas

  useEffect(()=>{
    const handler = (e: KeyboardEvent) => {
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
        if (rule) data.updateRegla(rule.id, {active:!rule.active}).then(()=>showToast(rule.active?'Regla pausada':'Regla activada')).catch(()=>{})
      }
      if (e.key === 'n' && isOwner) { e.preventDefault(); onOpenModal('regla') }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedReglaId, isOwner])

  return (
    <div className="p-8 max-w-[900px] mx-auto">
      <div className="flex items-end justify-between mb-8 flex-wrap gap-4">
        <div className="min-w-0">
          <div className="font-syne text-[9px] font-black tracking-[0.25em] mb-2" style={{color:'rgba(255,255,255,0.18)'}}>SISTEMA</div>
          <h1 className="font-figtree text-[28px] font-black text-white leading-none" style={{letterSpacing:'-0.03em'}}>Automatizaciones</h1>
          <div className="nx-kbd-hints flex items-center gap-2 mt-1.5">
            {(['J/K NAVEGAR','E ACTIVAR','N NUEVA'] as const).map((hint,i,arr)=>(
              <span key={hint} className="flex items-center gap-2">
                <span className="font-syne text-[7.5px] font-bold tracking-widest" style={{color:'rgba(255,255,255,0.1)'}}>{hint}</span>
                {i<arr.length-1&&<span className="font-syne text-[7px]" style={{color:'rgba(255,255,255,0.07)'}}>·</span>}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-6">
          {totalFired > 0 && (
            <div className="text-right">
              <div className="font-figtree text-[28px] font-black leading-none" style={{color:'rgba(167,139,250,0.8)',letterSpacing:'-0.04em'}}>{totalFired}</div>
              <div className="font-syne text-[8px] font-bold tracking-widest" style={{color:'rgba(255,255,255,0.2)'}}>EJECUCIONES</div>
            </div>
          )}
          <div className="text-right">
            <div className="font-figtree text-[28px] font-black leading-none" style={{color:activeCount>0?BLU:'rgba(255,255,255,0.25)',letterSpacing:'-0.04em'}}>{activeCount}</div>
            <div className="font-syne text-[8px] font-bold tracking-widest" style={{color:'rgba(255,255,255,0.2)'}}>DE {data.reglas.length} ACTIVAS</div>
          </div>
          {isOwner && <button onClick={()=>onOpenModal('regla')} className="flex items-center gap-2 px-5 py-3 rounded-2xl font-syne text-[10px] font-black tracking-widest text-white" style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>+ REGLA</button>}
        </div>
      </div>
      {data.reglas.length > 4 && (
        <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-2xl mb-5" style={{background:SURFACE,border:`1px solid ${BORDER}`,maxWidth:'320px'}}>
          <LucideIcon name="search" size={12} color="rgba(255,255,255,0.2)"/>
          <input value={reglaSearch} onChange={e=>setReglaSearch(e.target.value)} placeholder="Busca regla…" className="flex-1 bg-transparent text-[12px] outline-none" style={{caretColor:BLU,color:'rgba(255,255,255,0.75)'}}/>
          {reglaSearch && <button onClick={()=>setReglaSearch('')}><LucideIcon name="x" size={11} color="rgba(255,255,255,0.2)"/></button>}
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
                <span className="font-figtree text-[14px] font-semibold" style={{color:r.active?'rgba(240,240,248,0.9)':'rgba(240,240,248,0.4)'}}>{r.name}</span>
                {r.trigger_count > 0 && <span className="font-syne text-[7.5px] font-black px-2 py-0.5 rounded-full" style={{background:'rgba(27,95,250,0.08)',color:'rgba(100,140,255,0.6)'}}>{r.trigger_count}× ejecutada</span>}
              </div>
              {(r.condition_text||r.action_text) && (
                <div className="flex items-center gap-1.5 text-[11px]" style={{color:'rgba(255,255,255,0.28)'}}>
                  {r.condition_text && <span>{r.condition_text}</span>}
                  {r.condition_text && r.action_text && <span style={{color:'rgba(255,255,255,0.15)'}}>›</span>}
                  {r.action_text && <span>{r.action_text}</span>}
                </div>
              )}
            </div>
            {isOwner && (
              <button onClick={()=>data.updateRegla(r.id, {active:!r.active}).then(()=>showToast(r.active?'Regla pausada':'Regla activada')).catch(()=>showToast('Error'))}
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
                : <button onClick={()=>setConfirmDeleteId(r.id)} className="opacity-60 md:opacity-0 md:group-hover:opacity-60 transition-opacity flex-shrink-0"><LucideIcon name="trash" size={13} color={RED}/></button>
            )}
          </div>
        ))}
        {reglaSearch && visibleReglas.length===0&&<div className="py-10 text-center text-[12px]" style={{color:'rgba(255,255,255,0.2)'}}>Sin resultados para "{reglaSearch}"</div>}
        {data.reglas.length===0&&(
          <div className="py-10 px-6">
            <div className="text-center text-[12px] mb-6" style={{color:'rgba(255,255,255,0.2)'}}>Sin reglas · empieza con una plantilla</div>
            <div className="space-y-2">
              {[
                {name:'Seguimiento de propuesta',condicion:'Email de cliente sin respuesta en 48h',accion:'Crear tarea urgente de seguimiento al cliente'},
                {name:'Alerta deadline próximo',condicion:'Proyecto con deadline en menos de 7 días',accion:'Notificar al equipo y crear tarea de revisión final'},
                {name:'Cliente inactivo',condicion:'Sin contacto con cliente en más de 30 días',accion:'Programar llamada de check-in con el cliente'},
              ].map((tpl,i)=>(
                <div key={i} className="flex items-center gap-4 px-5 py-4 rounded-2xl transition-all" style={{background:'rgba(27,95,250,0.03)',border:'1px solid rgba(27,95,250,0.1)'}}>
                  <div className="flex-1 min-w-0">
                    <div className="font-figtree text-[13px] font-semibold text-white mb-1">{tpl.name}</div>
                    <div className="flex items-center gap-1.5 text-[11px]" style={{color:'rgba(255,255,255,0.28)'}}>
                      <span>{tpl.condicion}</span>
                      <span style={{color:'rgba(255,255,255,0.12)'}}>›</span>
                      <span>{tpl.accion}</span>
                    </div>
                  </div>
                  {isOwner && <button onClick={async()=>{try{await data.createRegla({name:tpl.name,condition_text:tpl.condicion,action_text:tpl.accion,active:true});showToast('Regla creada')}catch{showToast('Error')}}} className="flex-shrink-0 px-3 py-1.5 rounded-xl font-syne text-[8px] font-black tracking-wide transition-all hover:opacity-80" style={{background:'rgba(27,95,250,0.12)',color:BLU,border:'1px solid rgba(27,95,250,0.2)'}}>+ USAR</button>}
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
