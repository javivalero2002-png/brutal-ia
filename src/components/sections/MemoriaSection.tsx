'use client'
import { useState, useEffect, useRef } from 'react'
import { useIsMobile, BLU, RED, GRN, SURFACE, SURF2, BORDER, todayKey, localDayKey } from '@/components/shared'
import { plural } from '@/components/shared/helpers'
import LucideIcon from '@/components/shared/LucideIcon'
import type { Client, NexusData} from '@/types'

interface PropsMemoria {
  data: NexusData
  memFilter: any
  setMemFilter: any
  onOpenModal: any
  showToast: any
}

export default function MemoriaSection({data,memFilter,setMemFilter,onOpenModal,showToast}: PropsMemoria) {
  const isMobile = useIsMobile()
  const [memSearch, setMemSearch] = useState('')
  const [expanded, setExpanded] = useState<string|null>(null)
  const [editing, setEditing] = useState<string|null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editContent, setEditContent] = useState('')
  const [editCategory, setEditCategory] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [confirmDeleteMemId, setConfirmDeleteMemId] = useState<string|null>(null)
  const [copiedId, setCopiedId] = useState<string|null>(null)
  const [memSort, setMemSort] = useState<'reciente'|'az'>('reciente')
  const [memClientFilter, setMemClientFilter] = useState<string>('Todos')
  const [uploadingDoc, setUploadingDoc] = useState(false)
  const docInputRef = useRef<HTMLInputElement>(null)
  const uploadDoc = async (file: File) => {
    if (file.type !== 'application/pdf') { showToast('Solo se admiten PDF'); return }
    if (file.size > 50 * 1024 * 1024) { showToast('PDF muy grande (máx. 50 MB)'); return }
    setUploadingDoc(true)
    try {
      // 1. Obtener URL firmada para subir directamente a Supabase
      const urlRes = await fetch('/api/pdf-upload-url', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ filename: file.name, size: file.size, prefix: 'docs' }) })
      const urlJ = await urlRes.json().catch(()=>({}))
      if (!urlRes.ok) { showToast(urlJ.error || 'Error preparando subida'); return }
      // 2. Subir directo a Supabase — FormData matching Supabase SDK protocol
      const fd = new FormData()
      fd.append('cacheControl', '3600')
      fd.append('', file)
      const upRes = await fetch(urlJ.signedUrl, { method: 'PUT', body: fd })
      if (!upRes.ok) { showToast('Error subiendo el PDF'); return }
      // 3. Analizar en el servidor con la URL pública (sin base64 por la API)
      const res = await fetch('/api/documents', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ url: urlJ.publicUrl, name: file.name }) })
      const j = await res.json().catch(()=>({}))
      if (!res.ok) { showToast(j.error || 'Error al analizar'); return }
      await data.createMemoria({ title: (j.name||file.name).replace(/\.pdf$/i,''), category: 'Documento', content: `${j.summary||''}\n\n📎 Documento: ${j.url||urlJ.publicUrl}` })
      showToast('Documento guardado en la memoria')
    } catch { showToast('Error al subir el documento') }
    finally { setUploadingDoc(false) }
  }
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(()=>{
    try { return new Set(JSON.parse(localStorage.getItem('pinned_memoria')||'[]')) } catch { return new Set() }
  })

  const memoriaRef = useRef<any[]>([])
  memoriaRef.current = data.memoria
  const memSearchInputRef = useRef<HTMLInputElement>(null)

  const togglePin = (id: string) => {
    setPinnedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      try { localStorage.setItem('pinned_memoria', JSON.stringify([...next])) } catch {}
      return next
    })
  }

  useEffect(()=>{
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && editing) { setEditing(null); return }
      if (['INPUT','TEXTAREA'].includes((e.target as HTMLElement).tagName) || e.metaKey||e.ctrlKey||e.altKey) return
      if (e.key === 'n' && !editing) { e.preventDefault(); onOpenModal('memoria') }
      if (e.key === 'f' && !editing) { e.preventDefault(); memSearchInputRef.current?.focus() }
      if (e.key === 'e' && expanded && !editing) {
        e.preventDefault()
        const entry = memoriaRef.current.find((m: any) => m.id === expanded)
        if (entry) { setEditing(expanded); setEditTitle(entry.title||''); setEditContent(entry.content||''); setEditCategory(entry.category||'') }
      }
      if (e.key === 'p' && expanded && !editing) {
        e.preventDefault()
        const isPinned = pinnedIds.has(expanded)
        togglePin(expanded)
        showToast(isPinned ? 'Entrada desanclada' : 'Entrada anclada')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [editing, onOpenModal, expanded, pinnedIds])
  const cats = ['Todos','Clientes','Procesos','Decisiones','Aprendizajes','General']
  // 'Documento' no aparece en `cats`, pero existe: `uploadDoc` crea con esa
  // categoria la entrada de CADA PDF que se sube. Sin color propio caia en el
  // fallback, que era rgba(255,255,255,0.3) y abajo se le concatena la opacidad
  // ('18'/'99'): con rgba el navegador tira la declaracion entera en silencio, asi
  // que la etiqueta de todos los documentos salia sin fondo y sin color de texto.
  // Por eso todo lo de aqui es hex de 6 digitos.
  const catColor: Record<string,string> = { Clientes:BLU, Procesos:'#FFB020', Decisiones:RED, Aprendizajes:GRN, General:'#A78BFA', Documento:'#06B6D4' }
  const memoryClients = data.clients.filter((c: Client)=>data.memoria.some((m: any)=>m.client?.id===c.id))
  const byFilter = memFilter==='Todos' ? data.memoria : data.memoria.filter((m: any)=>m.category===memFilter)
  const byClientFilter = memClientFilter==='Todos' ? byFilter : byFilter.filter((m: any)=>m.client?.id===memClientFilter)
  // La copia importa: con los dos filtros en "Todos" y sin busqueda,
  // byClientFilter ES data.memoria — el array de estado. .sort() ordena EN SITIO,
  // asi que anclar una entrada reordenaba el array compartido y cambiaba en
  // silencio cuales son las 12 que Harvey mete en su contexto (buildContext hace
  // slice(0,12)) y las que ve Hoy.
  const filtered = [...(memSearch.trim()
    ? byClientFilter.filter((m: any)=>(m.title+' '+m.content).toLowerCase().includes(memSearch.toLowerCase()))
    : byClientFilter)].sort((a: any, b: any) => {
      const pinDiff = (pinnedIds.has(b.id)?1:0) - (pinnedIds.has(a.id)?1:0)
      if (pinDiff !== 0) return pinDiff
      if (memSort === 'az') return (a.title||'').localeCompare(b.title||'', 'es', {sensitivity:'base'})
      return new Date(b.created_at||0).getTime() - new Date(a.created_at||0).getTime()
    })
  return (
    <div className={`${isMobile?'p-4':'p-8'} max-w-[900px] mx-auto`}>
      <div className="flex items-end justify-between mb-6 flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <div className="font-syne text-[9px] font-black tracking-[0.25em]" style={{color:'rgba(255,255,255,0.18)'}}>CEREBRO</div>
            {data.memoria.length > 0 && <span className="font-syne text-[7px] font-black px-1.5 py-0.5 rounded-full" style={{background:'rgba(255,255,255,0.05)',color:'rgba(255,255,255,0.2)'}}>{data.memoria.length}</span>}
          </div>
          <h1 className="font-figtree text-[28px] font-black text-white leading-none" style={{letterSpacing:'-0.03em'}}>Memoria</h1>
          {data.memoria.length > 0 && (()=>{
            const wordCount = data.memoria.reduce((s: number, m: any)=>s+(m.content||'').split(/\s+/).filter(Boolean).length,0)
            return <div className="font-syne text-[8px] font-black tracking-widest mt-1" style={{color:'rgba(255,255,255,0.15)'}}>{wordCount.toLocaleString('es-ES')} PALABRAS</div>
          })()}
          <div className="nx-kbd-hints flex items-center gap-2 mt-1.5">
            {(['N NUEVA','E EDITAR','P ANCLAR','F BUSCAR'] as const).map((hint,i,arr)=>(
              <span key={hint} className="flex items-center gap-2">
                <span className="font-syne text-[7.5px] font-bold tracking-widest" style={{color:'rgba(255,255,255,0.1)'}}>{hint}</span>
                {i<arr.length-1&&<span className="font-syne text-[7px]" style={{color:'rgba(255,255,255,0.07)'}}>·</span>}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex p-1 rounded-xl" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
            {([{id:'reciente',label:'↓',title:'Más recientes primero'},{id:'az',label:'A·Z',title:'Orden alfabético'}] as const).map(s=>(
              <button key={s.id} onClick={()=>setMemSort(s.id)} title={s.title} className="px-3 py-2 rounded-lg font-syne text-[9px] font-black tracking-wide transition-all" style={{background:memSort===s.id?SURF2:'transparent',color:memSort===s.id?'rgba(255,255,255,0.8)':'rgba(255,255,255,0.25)'}}>
                {s.label}
              </button>
            ))}
          </div>
          {!isMobile && <button onClick={()=>{
            const md = data.memoria.map((m: any)=>`# ${m.title}\n**Categoría:** ${m.category}\n**Fecha:** ${m.created_at?localDayKey(m.created_at):''}\n\n${m.content}`).join('\n\n---\n\n')
            const blob = new Blob([md], {type:'text/markdown'})
            const a = document.createElement('a')
            a.href = URL.createObjectURL(blob)
            a.download = `memoria-${todayKey()}.md`
            a.click()
            URL.revokeObjectURL(a.href)
            // El participio concuerda con el sustantivo, asi que se le pasa el
            // plural entero: con una sola entrada el aviso decia "1 entradas
            // exportadas".
            showToast(plural(data.memoria.length,'entrada exportada','entradas exportadas'))
          }} className="flex items-center gap-2 px-4 py-3 rounded-2xl font-syne text-[10px] font-black tracking-widest" style={{background:'rgba(255,255,255,0.04)',border:`1px solid ${BORDER}`,color:'rgba(255,255,255,0.35)'}} title="Exportar como Markdown">
            <LucideIcon name="download" size={13} color="rgba(255,255,255,0.35)"/>
            <span>MD</span>
          </button>}
          <input ref={docInputRef} type="file" accept="application/pdf" className="hidden" onChange={e=>{const f=e.target.files?.[0]; if(f) uploadDoc(f); e.target.value=''}}/>
          <button onClick={()=>docInputRef.current?.click()} disabled={uploadingDoc} className="flex items-center gap-2 px-4 py-3 rounded-2xl font-syne text-[10px] font-black tracking-widest disabled:opacity-50" style={{background:'rgba(27,95,250,0.08)',border:`1px solid rgba(27,95,250,0.2)`,color:BLU}} title="Sube un PDF: la IA lo resume y lo guarda en la memoria">
            {uploadingDoc ? <><div className="w-3.5 h-3.5 border-2 rounded-full animate-spin" style={{borderColor:'rgba(27,95,250,0.3)',borderTopColor:BLU}}/>{!isMobile && <span>SUBIENDO…</span>}</> : <><LucideIcon name="upload" size={13} color={BLU}/>{!isMobile && <span>+ DOCUMENTO</span>}</>}
          </button>
          <button onClick={()=>onOpenModal('memoria')} className="flex items-center gap-2 px-5 py-3 rounded-2xl font-syne text-[10px] font-black tracking-widest text-white" style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>+ ENTRADA</button>
        </div>
      </div>
      <div className="flex items-center gap-3 px-4 py-2.5 rounded-2xl mb-5" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
        <LucideIcon name="search" size={13} color="rgba(255,255,255,0.2)"/>
        <input ref={memSearchInputRef} value={memSearch} onChange={e=>setMemSearch(e.target.value)} placeholder="Busca en la memoria…" className="flex-1 bg-transparent text-[13px] outline-none" style={{caretColor:BLU,color:'rgba(255,255,255,0.8)'}}/>
        {memSearch && <button onClick={()=>setMemSearch('')} className="flex-shrink-0"><LucideIcon name="x" size={12} color="rgba(255,255,255,0.2)"/></button>}
      </div>
      <div className="nx-tabs-scroll flex gap-1 mb-3 p-1 rounded-2xl" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
        {cats.map(c=>{
          const cnt = c==='Todos' ? data.memoria.length : data.memoria.filter((m:any)=>m.category===c).length
          return (
            <button key={c} onClick={()=>setMemFilter(c)} className="flex items-center gap-1.5 px-4 py-2 rounded-xl font-syne text-[9px] font-black tracking-wide transition-all" style={{background:memFilter===c?(c==='Todos'?SURF2:(catColor[c]||'#A78BFA')+'14'):'transparent',color:memFilter===c?(c==='Todos'?'#F0F0F8':(catColor[c]||'rgba(240,240,248,0.7)')):'rgba(240,240,248,0.3)'}}>
              {c}
              {cnt > 0 && <span className="text-[7px] font-black px-1 rounded-sm" style={{background:memFilter===c?'rgba(255,255,255,0.1)':'transparent',color:memFilter===c?'rgba(255,255,255,0.5)':'rgba(255,255,255,0.2)'}}>{cnt}</span>}
            </button>
          )
        })}
      </div>
      {memoryClients.length > 0 && (
        <div className="flex items-center gap-1 mb-5 flex-wrap">
          <button onClick={()=>setMemClientFilter('Todos')} className="flex items-center gap-1 px-3 py-1.5 rounded-xl font-syne text-[8px] font-black tracking-wide transition-all" style={{background:memClientFilter==='Todos'?SURF2:'transparent',border:`1px solid ${memClientFilter==='Todos'?'rgba(255,255,255,0.12)':BORDER}`,color:memClientFilter==='Todos'?'rgba(255,255,255,0.7)':'rgba(255,255,255,0.25)'}}>Todos</button>
          {memoryClients.map((c: Client)=>{
            const cnt = byFilter.filter((m: any)=>m.client?.id===c.id).length
            return (
              <button key={c.id} onClick={()=>setMemClientFilter(memClientFilter===c.id?'Todos':c.id)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-syne text-[8px] font-black tracking-wide transition-all" style={{background:memClientFilter===c.id?c.color+'14':'transparent',border:`1px solid ${memClientFilter===c.id?c.color+'40':BORDER}`,color:memClientFilter===c.id?c.color+'cc':'rgba(255,255,255,0.25)'}}>
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{background:memClientFilter===c.id?c.color:c.color+'60'}}/>
                {c.name}
                <span className="text-[6.5px]" style={{opacity:0.6}}>{cnt}</span>
              </button>
            )
          })}
        </div>
      )}
      <div className="space-y-2">
        {filtered.map((m: any)=>{
          const isExp = expanded===m.id
          const isLong = (m.content||'').length > 120
          return (
          <div key={m.id} className="rounded-2xl transition-all group" style={{background:pinnedIds.has(m.id)?'rgba(255,176,32,0.015)':SURFACE,border:`1px solid ${isExp?'rgba(27,95,250,0.2)':pinnedIds.has(m.id)?'rgba(255,176,32,0.14)':BORDER}`,borderLeft:`3px solid ${pinnedIds.has(m.id)?'rgba(255,176,32,0.38)':'transparent'}`}}>
            <div className="flex items-start gap-4 p-5 cursor-pointer" onClick={()=>setExpanded(isExp?null:m.id)}>
              {(()=>{ const cc=catColor[m.category]||'#A78BFA'; const ci:Record<string,string>={Clientes:'users-2',Procesos:'layers',Decisiones:'flag',Aprendizajes:'lightbulb',General:'brain'}; const ic=ci[m.category]||'brain'; return (<div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5" style={{background:cc+'14',border:`1px solid ${cc}25`}}><LucideIcon name={ic} size={15} color={cc+'bb'}/></div>) })()}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  <span className="font-figtree text-[14px] font-semibold text-white">{m.title}</span>
                  {/* El fallback es hex, como el de la linea del icono: aqui se le
                      concatena opacidad y con rgba() no se pinta nada. */}
                  <span className="font-syne text-[7.5px] font-black px-2 py-0.5 rounded-lg" style={{background:(catColor[m.category]||'#A78BFA')+'18',color:(catColor[m.category]||'#A78BFA')+'99'}}>{m.category}</span>
                  {m.created_at && <span className="font-syne text-[7.5px]" style={{color:'rgba(255,255,255,0.18)'}}>{new Date(m.created_at).toLocaleDateString('es-ES',{day:'numeric',month:'short',year:'numeric'})}</span>}
                  {m.created_at && Date.now()-new Date(m.created_at).getTime() < 7*24*60*60*1000 && <span className="font-syne text-[6.5px] font-black px-1.5 py-0.5 rounded-full" style={{background:'rgba(34,197,94,0.12)',color:'rgba(34,197,94,0.65)'}}>NUEVO</span>}
                  {pinnedIds.has(m.id) && <span className="font-syne text-[6.5px] font-black px-1.5 py-0.5 rounded-full" style={{background:'rgba(255,176,32,0.1)',color:'rgba(255,176,32,0.7)'}}>FIJADA</span>}
                  {m.client?.name && <span className="font-syne text-[7px] font-black px-2 py-0.5 rounded-full flex-shrink-0" style={{background:(m.client.color||BLU)+'14',color:(m.client.color||BLU)+'bb'}}>{m.client.name}</span>}
                </div>
                <div className={`text-[12px] leading-relaxed ${isExp?'':'line-clamp-2'}`} style={{color:'rgba(255,255,255,0.45)'}}>{m.content}</div>
                {!isExp && isLong && <div className="font-syne text-[8px] font-black mt-1.5 transition-colors" style={{color:'rgba(27,95,250,0.5)'}}>VER MÁS</div>}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {isLong && <LucideIcon name={isExp?'chevron-up':'chevron-down'} size={13} color="rgba(255,255,255,0.2)"/>}
                <button onClick={e=>{e.stopPropagation();togglePin(m.id)}} aria-label={pinnedIds.has(m.id)?'Quitar de fijados':'Fijar arriba'} className={`p-2 -m-2 transition-opacity ${pinnedIds.has(m.id)?'opacity-60':isMobile?'opacity-25 hover:!opacity-60':'opacity-0 group-hover:opacity-30 hover:!opacity-60'}`} title={pinnedIds.has(m.id)?'Desfijar':'Fijar arriba'}><LucideIcon name="pin" size={12} color={pinnedIds.has(m.id)?'rgba(255,176,32,0.9)':'rgba(255,255,255,0.6)'}/></button>
                <button onClick={e=>{e.stopPropagation();navigator.clipboard.writeText(`# ${m.title}\n\n${m.content||''}`).then(()=>{setCopiedId(m.id);setTimeout(()=>setCopiedId(null),2000)}).catch(()=>{})}} aria-label="Copiar entrada" className={`transition-opacity ${isMobile?'opacity-25 hover:!opacity-60':'opacity-0 group-hover:opacity-30 hover:!opacity-60'}`}><LucideIcon name={copiedId===m.id?'check':'copy'} size={12} color={copiedId===m.id?GRN:BLU}/></button>
                <button onClick={e=>{e.stopPropagation();if(editing===m.id){setEditing(null)}else{setEditing(m.id);setEditTitle(m.title);setEditContent(m.content||'');setEditCategory(m.category||'General');setExpanded(m.id)}}} aria-label={editing===m.id?'Cerrar edición':'Editar entrada'} className={`p-2 -m-2 transition-opacity ${isMobile?'opacity-25 hover:!opacity-60':'opacity-0 group-hover:opacity-30 hover:!opacity-60'}`}><LucideIcon name="pencil" size={13} color={BLU}/></button>
                {confirmDeleteMemId === m.id
                  ? <div className="flex items-center gap-1" onClick={e=>e.stopPropagation()}>
                      <button onClick={e=>{e.stopPropagation();data.deleteMemoria(m.id).then(()=>showToast('Eliminado')).catch(()=>showToast('Error al eliminar'));setConfirmDeleteMemId(null)}} className="px-2 py-1 rounded-lg font-syne text-[7.5px] font-black transition-all" style={{background:'rgba(229,29,42,0.15)',color:RED,border:`1px solid rgba(229,29,42,0.25)`}}>¿BORRAR?</button>
                      <button onClick={e=>{e.stopPropagation();setConfirmDeleteMemId(null)}} aria-label="Cancelar" className="w-6 h-6 rounded-lg flex items-center justify-center transition-colors hover:bg-white/5" style={{color:'rgba(255,255,255,0.3)'}}><LucideIcon name="x" size={10} color="rgba(255,255,255,0.3)"/></button>
                    </div>
                  : <button onClick={e=>{e.stopPropagation();setConfirmDeleteMemId(m.id)}} aria-label="Eliminar entrada" className={`p-2 -m-2 transition-opacity ${isMobile?'opacity-25 hover:!opacity-60':'opacity-0 group-hover:opacity-30 hover:!opacity-60'}`}><LucideIcon name="trash" size={14} color={RED}/></button>
                }
              </div>
            </div>
            {isExp && editing===m.id && (
              <div className="px-5 pb-5 pt-0 space-y-3" onClick={e=>e.stopPropagation()}>
                <input value={editTitle} onChange={e=>setEditTitle(e.target.value)} className="w-full px-3 py-2 rounded-xl text-[13px] text-white placeholder-white/20 outline-none" style={{background:SURF2,border:`1.5px solid rgba(27,95,250,0.25)`,caretColor:BLU}}/>
                <div className="flex flex-wrap gap-1.5">
                  {(['Clientes','Procesos','Decisiones','Aprendizajes','General'] as const).map(cat=>{
                    const cc = catColor[cat]||'#FFFFFF'
                    const isAct = editCategory===cat
                    return <button key={cat} onClick={()=>setEditCategory(cat)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-syne text-[8.5px] font-black tracking-wide transition-all" style={{background:isAct?cc+'18':SURF2,border:`1.5px solid ${isAct?cc+'55':BORDER}`,color:isAct?cc:'rgba(255,255,255,0.3)'}}>
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{background:isAct?cc:'rgba(255,255,255,0.15)'}}/>
                      {cat}
                    </button>
                  })}
                </div>
                <div>
                  <textarea value={editContent} onChange={e=>setEditContent(e.target.value)} rows={4} className="w-full px-3 py-2.5 rounded-xl text-[12px] text-white placeholder-white/20 outline-none resize-none" style={{background:SURF2,border:`1.5px solid ${BORDER}`,caretColor:BLU,lineHeight:'1.65'}}/>
                  <div className="flex justify-end mt-1">
                    <span className="font-syne text-[8px] font-black" style={{color:'rgba(255,255,255,0.15)'}}>{editContent.length} car · {editContent.split(/\s+/).filter(Boolean).length} pal.</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={async()=>{setSavingEdit(true);try{await data.updateMemoria(m.id,{title:editTitle.trim(),content:editContent.trim(),category:editCategory});showToast('Actualizado');setEditing(null)}catch{showToast('Error')}finally{setSavingEdit(false)}}} disabled={savingEdit||!editTitle.trim()} className="px-4 py-2 rounded-xl font-syne text-[8.5px] font-black tracking-widest text-white disabled:opacity-40" style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>{savingEdit?'GUARDANDO…':'GUARDAR'}</button>
                  <button onClick={()=>setEditing(null)} className="px-4 py-2 rounded-xl font-syne text-[8.5px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.3)',background:SURF2}}>CANCELAR</button>
                </div>
              </div>
            )}
          </div>
        )})}
        {filtered.length===0 && (
          <div className="py-20 text-center">
            <div className="font-syne text-[11px] font-black tracking-widest mb-3" style={{color:'rgba(255,255,255,0.12)'}}>
              {memSearch ? 'SIN RESULTADOS' : 'SIN ENTRADAS'}
            </div>
            {!memSearch && <button onClick={()=>onOpenModal('memoria')} className="font-syne text-[9px] font-black px-4 py-2 rounded-xl" style={{background:'rgba(27,95,250,0.08)',color:BLU}}>CREAR PRIMERA ENTRADA</button>}
          </div>
        )}
      </div>
    </div>
  )
}
