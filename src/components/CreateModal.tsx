'use client'
import { useEffect, useRef } from 'react'
import type { Profile, Client } from '@/types'
import { marcarModalAbierto, marcarModalCerrado } from '@/components/shared/modalAbierto'
import { PLATAFORMA_COLOR, BLU, RED, GRN, SURF2, BORDER, LucideIcon, useIsMobile, AMBAR} from '@/components/shared'
import { PlatformLogo } from '@/components/PlatformLogo'

const meta: Record<string, { eyebrow: string; title: string; saveLabel: string }> = {
  cliente:   { eyebrow:'GESTIÓN · CLIENTES',   title:'Nuevo Cliente',   saveLabel:'CREAR CLIENTE' },
  proyecto:  { eyebrow:'GESTIÓN · PROYECTOS',  title:'Nuevo Proyecto',  saveLabel:'CREAR PROYECTO' },
  tarea:     { eyebrow:'GESTIÓN · TAREAS',      title:'Nueva Tarea',     saveLabel:'CREAR TAREA' },
  memoria:   { eyebrow:'BRUTAL.IA · MEMORIA',  title:'Nueva Entrada',   saveLabel:'GUARDAR' },
  regla:     { eyebrow:'AUTOMATIZACIONES',      title:'Nueva Regla',     saveLabel:'CREAR REGLA' },
  contenido: { eyebrow:'CONTENIDO',             title:'Nueva Pieza',     saveLabel:'AÑADIR PIEZA' },
}

function fields(type: string, team: Profile[]) {
  const f = (label: string, key: string, placeholder: string, extra?: object) => ({ label, key, placeholder, ...extra })
  const maps: Record<string, object[]> = {
    cliente: [
      f('Nombre del cliente', 'name', 'Ej: Nike España'),
      f('Industria', 'industria', 'Ej: Fashion · Lifestyle'),
      f('Facturación mensual', 'facturacion', 'Ej: €12.000/mes'),
    ],
    proyecto: [
      f('Nombre del proyecto', 'nombre', 'Ej: Campaign Summer 2026'),
      f('Cliente', 'cliente', 'Ej: Nike España'),
      { label:'Estado inicial', key:'estado', type:'proj-status', placeholder:'' },
      { label:'Deadline', key:'deadline', type:'date-input', placeholder:'' },
    ],
    tarea: [
      f('Descripción de la tarea', 'text', 'Ej: Preparar deck propuesta Q3 para Nike'),
      { label:'Prioridad', key:'priority', type:'priority' },
      { label:'Asignar a', key:'asignado', type:'assignee' },
      f('Cliente (opcional)', 'cliente', 'Ej: Nike España'),
      f('Proyecto (opcional)', 'proyecto', 'Ej: Campaign Summer 2026'),
      { label:'Fecha límite', key:'due_date', type:'date-input', placeholder:'' },
    ],
    memoria: [
      f('Título', 'titulo', 'Ej: Nike — Guía de tono de voz 2026'),
      { label:'Categoría', key:'categoria', type:'category', placeholder:'' },
      { label:'Contenido', key:'contenido', type:'textarea', placeholder:'Escribe el contenido de esta entrada…' },
    ],
    regla: [
      f('Nombre de la regla', 'nombre', 'Ej: Alerta propuestas sin respuesta'),
      f('Condición', 'condicion', 'Ej: Email urgente de cliente sin tarea'),
      f('Acción automática', 'accion', 'Ej: Crear tarea de seguimiento urgente'),
    ],
    contenido: [
      f('Título de la pieza', 'titulo', 'Ej: Stories lanzamiento verano Nike'),
      f('Cliente', 'cliente', 'Ej: Nike España'),
      { label:'Plataforma', key:'plataforma', type:'platform' },
      { label:'Cuenta / Perfil', key:'cuenta', type:'account', placeholder:'' },
      { label:'Fecha de publicación', key:'fecha', type:'date-input', placeholder:'' },
      { label:'Estado', key:'estado', type:'status' },
    ],
  }
  return (maps[type] || []) as Array<{ label: string; key: string; placeholder: string; type?: string }>
}

interface CreateModalProps {
  modal: string
  /** Cancelar y la X: descartan a proposito. */
  onClose: () => void
  /** Clic en el fondo: puede ser sin querer, asi que avisa si hay algo escrito. */
  onDismiss?: () => void
  mf: Record<string, string>
  setMf: React.Dispatch<React.SetStateAction<Record<string, string>>>
  saving: boolean
  onSave: () => void
  team: Profile[]
  clients?: Client[]
}

// ── Builder de reglas: triggers y acciones disponibles ───────────────────────
const TRIGGERS = [
  { v:'email_urgent',             icon:'zap',           label:'Email urgente',        desc:'Llega un email urgente sin leer' },
  { v:'email_from_client',        icon:'users',         label:'Email de cliente',     desc:'Email sin leer de un cliente concreto' },
  { v:'project_deadline',         icon:'folder-open',   label:'Deadline cerca',       desc:'Un proyecto vence en pocos días' },
  { v:'task_overdue',             icon:'alert-triangle',label:'Tarea vencida',        desc:'Una tarea pasa su fecha límite' },
  { v:'unread_pileup',            icon:'inbox',         label:'Inbox saturado',       desc:'Se acumulan emails sin leer' },
  { v:'many_overdue',             icon:'clock',         label:'Muchas tareas vencidas',desc:'Hay N o más tareas vencidas sin completar' },
  { v:'high_priority_unassigned', icon:'alert-circle',  label:'Urgentes sin asignar', desc:'Tareas urgentes o altas sin responsable' },
  { v:'client_followup',          icon:'user-plus',     label:'Seguimiento cliente',  desc:'Sin emails de un cliente en N días' },
] as const

const ACTIONS = [
  { v:'create_task',  icon:'check-square', label:'Crear tarea',       desc:'Genera una tarea automáticamente' },
  { v:'notify_team',  icon:'bell',         label:'Avisar al equipo',  desc:'Notificación push a todo el equipo' },
  { v:'notify_owner', icon:'user',         label:'Avisarme a mí',     desc:'Notificación push solo para ti' },
] as const


// Las variables que RELLENA cada disparador, sacadas de `evaluateTrigger`.
//
// Antes la ayuda era fija —«{cliente} {asunto} {remitente} {proyecto}»— para los
// ocho, y no es verdad de ninguno: `{remitente}` existe en 2 de 8 y `{proyecto}`
// en 1 de 8. Con «Inbox saturado» o «Muchas tareas vencidas» no funciona NINGUNA
// de las cuatro, y la unica que sirve —`{total}`— no aparecia escrita en ningun
// sitio de la app. Resultado: la tarea se creaba literalmente como «Revisar  de».
const VARS_POR_DISPARADOR: Record<string, string[]> = {
  email_urgent:            ['asunto', 'remitente', 'cliente'],
  email_from_client:       ['asunto', 'remitente', 'cliente'],
  project_deadline:        ['proyecto', 'cliente', 'dias'],
  task_overdue:            ['tarea', 'asunto'],
  unread_pileup:           ['total'],
  many_overdue:            ['total'],
  high_priority_unassigned:['tarea', 'asunto'],
  client_followup:         ['cliente', 'dias'],
}

/** Las que valen para el disparador elegido, en el formato de la ayuda. */
const varsDe = (trigger?: string): string =>
  (VARS_POR_DISPARADOR[trigger || ''] || []).map(v => `{${v}}`).join(' ')

export default function CreateModal({ modal, onClose, onDismiss, mf, setMf, saving, onSave, team, clients = [] }: CreateModalProps) {
  const isMobile = useIsMobile()
  const m = meta[modal]
  if (!m) return null

  const platC = PLATAFORMA_COLOR
  // HEX de 6 dígitos, obligatorio: abajo se les concatena la opacidad (cc+'18',
  // cc+'55'). Con rgba() salía `rgba(255,176,32,0.9)18`, que el navegador DESCARTA
  // entero, sin error y sin nada en consola. Resultado: cuatro de las cinco
  // categorías se pintaban sin fondo ni borde al seleccionarlas y no se distinguía
  // cuál estaba elegida. Solo funcionaba «Clientes», que ya usaba un hex.
  // Es la trampa que documenta CLAUDE.md; el script de prebuild no la caza aquí
  // porque prioriza precisión y se calla lo que no puede resolver.
  const catC: Record<string, string> = { Clientes:BLU, Procesos:AMBAR, Decisiones:RED, Aprendizajes:GRN, General:'#A78BFA' }
  // Enfocar el primer campo al abrir. Sin esto el foco se queda en BODY, y las
  // guardas por tagName de los atajos de seccion —que miran INPUT/TEXTAREA— dejan
  // pasar TODAS las teclas: escribir el titulo ejecutaba atajos de la pantalla de
  // detras, algunos de los cuales ESCRIBEN en la base.
  const primerCampoRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    marcarModalAbierto()
    const t = setTimeout(() => {
      const campo = primerCampoRef.current?.querySelector<HTMLElement>('input:not([type="hidden"]), textarea')
      campo?.focus()
    }, 60)
    return () => { clearTimeout(t); marcarModalCerrado() }
  }, [])


  return (
    <div onClick={onDismiss ?? onClose} className="fixed inset-0 z-[100] flex items-center justify-center" style={{background:'rgba(2,2,10,0.8)',backdropFilter:'blur(8px)',touchAction:'none'}}>
      <div
        ref={primerCampoRef}
        role="dialog"
        aria-modal="true"
        onClick={e => e.stopPropagation()}
        onKeyDown={e => {
          // Los BUTTON quedan fuera del atajo. Con el foco en CANCELAR, pulsar
          // Enter activaba este manejador antes que el boton: se GUARDABA el
          // registro en vez de descartarlo. Quien navega con el teclado —o quien
          // llega a CANCELAR con Tab— acababa creando justo lo que queria anular.
          const tag = (e.target as HTMLElement).tagName
          if (e.key==='Enter' && tag!=='TEXTAREA' && tag!=='BUTTON' && !saving) { e.preventDefault(); onSave() } }}
        className={isMobile ? 'relative w-full flex flex-col' : 'relative w-[480px] max-w-[94vw] rounded-3xl'}
        style={isMobile
          ? { background:'linear-gradient(180deg,#0D0D1E 0%,#080810 100%)', height:'100dvh', paddingTop:'env(safe-area-inset-top)', paddingBottom:'env(safe-area-inset-bottom)', touchAction:'pan-y' }
          : { background:'linear-gradient(180deg,#0D0D1E 0%,#080810 100%)', border:`1px solid rgba(27,95,250,0.25)`, boxShadow:'0 40px 100px rgba(0,0,0,0.8),0 0 0 1px rgba(27,95,250,0.05)', maxHeight:'94dvh', overflowY:'auto' }}
      >
        <div className="h-[2px] rounded-t-3xl" style={{background:`linear-gradient(90deg,transparent,${BLU},transparent)`}}/>

        {/* Header */}
        <div className={isMobile ? 'flex items-center justify-between px-5 py-4 flex-shrink-0' : 'flex items-center justify-between px-7 py-6'} style={{borderBottom:`1px solid ${BORDER}`}}>
          <div>
            <div className="font-syne text-[9px] font-black tracking-widest mb-1.5" style={{color:'rgba(100,140,255,0.6)'}}>{m.eyebrow}</div>
            <h2 className="font-syne text-[22px] font-black text-white leading-none">{m.title}</h2>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-xl flex items-center justify-center transition-colors hover:bg-white/5" style={{background:SURF2}} aria-label="Cerrar"><LucideIcon name="x" size={16} color="rgba(240,240,248,0.45)"/></button>
        </div>

        {/* Fields */}
        <div className={isMobile ? 'px-5 py-4 space-y-3.5 flex-1 overflow-y-auto' : 'px-7 py-6 space-y-5'} style={isMobile ? {overscrollBehavior:'contain'} : undefined}>
          {modal === 'regla' ? (
            <RuleBuilder mf={mf} setMf={setMf} team={team} clients={clients} />
          ) : fields(modal, team).map(f => (
            <div key={f.key}>
              <label className={isMobile ? 'block font-syne text-[9px] font-black tracking-widest mb-2' : 'block font-syne text-[9px] font-black tracking-widest mb-3'} style={{color:'rgba(255,255,255,0.28)'}}>{f.label.toUpperCase()}</label>

              {f.type === 'priority' ? (
                <div className="flex gap-2">
                  {[{v:'urgente',l:'Urgente',c:RED},{v:'high',l:'Alta',c:AMBAR},{v:'normal',l:'Normal',c:BLU}].map(p=>(
                    <button key={p.v} onClick={()=>setMf(m=>({...m,[f.key]:p.v}))} className="flex-1 py-3 rounded-2xl font-syne text-[10px] font-black tracking-wide transition-all" style={{background:mf[f.key]===p.v?p.c+'18':SURF2,border:`1.5px solid ${mf[f.key]===p.v?p.c+'70':BORDER}`,color:mf[f.key]===p.v?p.c:'#FFFFFF'}}>
                      {p.l.toUpperCase()}
                    </button>
                  ))}
                </div>
              ) : f.type === 'assignee' ? (
                <div className="flex flex-wrap gap-2">
                  {team.map(tm=>(
                    <button key={tm.id} onClick={()=>setMf(x=>({...x,[f.key]:x[f.key]===tm.name?'':tm.name}))} className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl transition-all" style={{background:mf[f.key]===tm.name?tm.avatar_color+'18':SURF2,border:`1.5px solid ${mf[f.key]===tm.name?tm.avatar_color+'55':BORDER}`}}>
                      <div className="w-7 h-7 rounded-full flex items-center justify-center font-syne text-[10px] font-black flex-shrink-0" style={{background:tm.avatar_color+'25',color:tm.avatar_color}}>{tm.initials}</div>
                      <span className="text-[13px]" style={{color:mf[f.key]===tm.name?'rgba(255,255,255,0.9)':'rgba(255,255,255,0.45)'}}>{tm.name.split(' ')[0]}</span>
                    </button>
                  ))}
                </div>
              ) : f.type === 'status' ? (
                <div className="grid grid-cols-2 gap-2">
                  {[{v:'borrador',l:'En bruto',c:'#FFFFFF'},{v:'pendiente',l:'En producción',c:AMBAR},{v:'listo',l:'Listo',c:'#22c55e'},{v:'publicado',l:'Publicado',c:BLU}].map(s=>(
                    <button key={s.v} onClick={()=>setMf(m=>({...m,[f.key]:s.v}))} className="flex items-center gap-2.5 px-4 py-3 rounded-2xl font-syne text-[10px] font-black tracking-wide transition-all" style={{background:(mf[f.key]||'borrador')===s.v?s.c+'18':SURF2,border:`1.5px solid ${(mf[f.key]||'borrador')===s.v?s.c+'60':BORDER}`,color:(mf[f.key]||'borrador')===s.v?s.c:'#FFFFFF'}}>
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{background:(mf[f.key]||'borrador')===s.v?s.c:'rgba(255,255,255,0.15)'}}/>
                      <span>{s.l.toUpperCase()}</span>
                    </button>
                  ))}
                </div>
              ) : f.type === 'platform' ? (
                <div className="flex gap-1.5 flex-wrap">
                  {(['Instagram','TikTok','YouTube','LinkedIn','Twitter','Pinterest'] as const).map(p=>{
                    const pc = platC[p]; const isActive = (mf[f.key]||'Instagram')===p
                    return <button key={p} onClick={()=>setMf(m=>({...m,[f.key]:p}))} className="flex items-center gap-2 px-3.5 py-2.5 rounded-2xl font-syne text-[9px] font-black tracking-wide transition-all" style={{background:isActive?pc+'18':SURF2,border:`1.5px solid ${isActive?pc+'50':BORDER}`,color:isActive?pc:'rgba(255,255,255,0.3)'}}><PlatformLogo platform={p} size={14}/>{p}</button>
                  })}
                </div>
              ) : f.type === 'category' ? (
                <div className="flex flex-wrap gap-2">
                  {(['Clientes','Procesos','Decisiones','Aprendizajes','General'] as const).map(cat=>{
                    const cc = catC[cat]; const isActive = (mf[f.key]||'General')===cat
                    return <button key={cat} onClick={()=>setMf(m=>({...m,[f.key]:cat}))} className="flex items-center gap-2 px-4 py-2.5 rounded-2xl font-syne text-[10px] font-black tracking-wide transition-all" style={{background:isActive?cc+'18':SURF2,border:`1.5px solid ${isActive?cc+'55':BORDER}`,color:isActive?cc:'rgba(255,255,255,0.35)'}}><div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{background:isActive?cc:'rgba(255,255,255,0.15)'}}/>{cat}</button>
                  })}
                </div>
              ) : f.type === 'proj-status' ? (
                <div className="flex gap-2">
                  {[{v:'plan.',l:'Plan.',c:'#A78BFA'},{v:'activo',l:'Activo',c:BLU},{v:'urgente',l:'Urgente',c:RED},{v:'revisión',l:'Revisión',c:AMBAR}].map(s=>(
                    <button key={s.v} onClick={()=>setMf(m=>({...m,[f.key]:s.v}))} className="flex-1 py-3 rounded-2xl font-syne text-[9px] font-black tracking-wide transition-all" style={{background:(mf[f.key]||'activo')===s.v?s.c+'18':SURF2,border:`1.5px solid ${(mf[f.key]||'activo')===s.v?s.c+'60':BORDER}`,color:(mf[f.key]||'activo')===s.v?s.c:'#FFFFFF'}}>
                      {s.l.toUpperCase()}
                    </button>
                  ))}
                </div>
              ) : f.type === 'account' ? (
                <div className="flex gap-2 flex-wrap">
                  {['Brutal Studios','Julio','Pablo'].map(acc=>{
                    const isActive = mf[f.key]===acc
                    return <button key={acc} onClick={()=>setMf(m=>({...m,[f.key]:acc}))} className="flex-1 py-3 px-3.5 rounded-2xl font-syne text-[9px] font-black tracking-wide transition-all" style={{background:isActive?BLU+'18':SURF2,border:`1.5px solid ${isActive?BLU+'55':BORDER}`,color:isActive?BLU:'rgba(255,255,255,0.3)'}}>{acc}</button>
                  })}
                </div>
              ) : f.type === 'date-input' ? (
                <input type="date" value={mf[f.key]||''} onChange={e=>setMf(m=>({...m,[f.key]:e.target.value}))} className="w-full px-5 py-3.5 rounded-2xl text-[14px] text-white outline-none transition-all" style={{background:SURF2,border:`1.5px solid ${BORDER}`,caretColor:BLU,colorScheme:'dark'}} onFocus={e=>(e.target.style.borderColor='rgba(27,95,250,0.45)')} onBlur={e=>(e.target.style.borderColor=BORDER)}/>
              ) : f.type === 'textarea' ? (
                <textarea value={mf[f.key]||''} onChange={e=>setMf(m=>({...m,[f.key]:e.target.value}))} placeholder={f.placeholder} rows={4} className="w-full px-5 py-3.5 rounded-2xl text-[14px] text-white placeholder-white/20 outline-none resize-none transition-all" style={{background:SURF2,border:`1.5px solid ${BORDER}`,caretColor:BLU,lineHeight:'1.6'}} onFocus={e=>(e.target.style.borderColor='rgba(27,95,250,0.45)')} onBlur={e=>(e.target.style.borderColor=BORDER)}/>
              ) : (
                <input value={mf[f.key]||''} onChange={e=>setMf(m=>({...m,[f.key]:e.target.value}))} placeholder={f.placeholder} className="w-full px-5 py-3.5 rounded-2xl text-[14px] text-white placeholder-white/20 outline-none transition-all" style={{background:SURF2,border:`1.5px solid ${BORDER}`,caretColor:BLU}} onFocus={e=>(e.target.style.borderColor='rgba(27,95,250,0.45)')} onBlur={e=>(e.target.style.borderColor=BORDER)}/>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className={isMobile ? 'flex gap-3 px-5 py-4 flex-shrink-0' : 'flex justify-end gap-3 px-7 py-5'} style={{borderTop:`1px solid ${BORDER}`}}>
          <button onClick={onClose} className="px-5 py-3 rounded-2xl text-[13px] transition-colors hover:text-white/70" style={{color:'rgba(255,255,255,0.4)',border:`1px solid ${BORDER}`}}>Cancelar</button>
          <button onClick={onSave} disabled={saving} className={isMobile ? 'flex-1 px-6 py-3 rounded-2xl font-syne text-[10px] font-black tracking-widest text-white disabled:opacity-50 transition-all' : 'px-6 py-3 rounded-2xl font-syne text-[10px] font-black tracking-widest text-white disabled:opacity-50 transition-all'} style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>
            {saving ? 'GUARDANDO…' : m.saveLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Constructor visual de reglas (trigger → acción) ──────────────────────────
function RuleBuilder({ mf, setMf, team, clients }: {
  mf: Record<string, string>
  setMf: React.Dispatch<React.SetStateAction<Record<string, string>>>
  team: Profile[]
  clients: Client[]
}) {
  const set = (k: string, v: string) => setMf(x => ({ ...x, [k]: v }))
  const trigger = mf.trigger || 'email_urgent'
  const action = mf.action || 'create_task'
  const inputCls = 'w-full px-4 py-3 rounded-2xl text-[14px] text-white placeholder-white/20 outline-none'
  const inputStyle = { background:SURF2, border:`1.5px solid ${BORDER}`, caretColor:BLU } as const
  const numStyle = { background:SURF2, border:`1.5px solid ${BORDER}`, caretColor:BLU, colorScheme:'dark' as const }

  const Eyebrow = ({ children }: { children: React.ReactNode }) => (
    <label className="block font-syne text-[9px] font-black tracking-widest mb-3" style={{color:'rgba(255,255,255,0.28)'}}>{children}</label>
  )

  return (
    <div className="space-y-6">
      {/* Nombre */}
      <div>
        <Eyebrow>NOMBRE DE LA REGLA</Eyebrow>
        <input value={mf.nombre||''} onChange={e=>set('nombre', e.target.value)} placeholder="Ej: Seguimiento de propuestas" className={inputCls} style={inputStyle}/>
      </div>

      {/* CUÁNDO */}
      <div>
        <Eyebrow><span style={{color:'rgba(100,140,255,0.7)'}}>CUÁNDO</span> · disparador</Eyebrow>
        <div className="grid grid-cols-1 gap-2">
          {TRIGGERS.map(t => {
            const on = trigger === t.v
            return (
              <button key={t.v} onClick={()=>set('trigger', t.v)} className="flex items-center gap-3 px-4 py-3 rounded-2xl text-left transition-all" style={{background:on?'rgba(27,95,250,0.1)':SURF2, border:`1.5px solid ${on?'rgba(27,95,250,0.55)':BORDER}`}}>
                <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{background:on?'rgba(27,95,250,0.14)':'rgba(255,255,255,0.03)'}}>
                  <LucideIcon name={t.icon} size={14} color={on?BLU:'rgba(255,255,255,0.3)'}/>
                </div>
                <div className="min-w-0">
                  <div className="font-figtree text-[13px] font-semibold" style={{color:on?'#fff':'rgba(255,255,255,0.55)'}}>{t.label}</div>
                  <div className="text-[11px]" style={{color:'rgba(255,255,255,0.28)'}}>{t.desc}</div>
                </div>
              </button>
            )
          })}
        </div>
        {/* Parámetros del trigger */}
        {(trigger === 'email_from_client' || trigger === 'client_followup') && (
          <div className="mt-3">
            <Eyebrow>CLIENTE</Eyebrow>
            {clients.length === 0
              ? <div className="text-[12px] px-4 py-3 rounded-2xl" style={{background:SURF2, border:`1px solid ${BORDER}`, color:'rgba(255,255,255,0.3)'}}>No hay clientes todavía.</div>
              : <div className="flex flex-wrap gap-2">
                  {clients.map(c => {
                    const on = mf.trg_client === c.id
                    return <button key={c.id} onClick={()=>set('trg_client', c.id)} className="px-3.5 py-2 rounded-2xl text-[12px] transition-all" style={{background:on?BLU+'18':SURF2, border:`1.5px solid ${on?BLU+'55':BORDER}`, color:on?'#fff':'rgba(255,255,255,0.45)'}}>{c.name}</button>
                  })}
                </div>}
          </div>
        )}
        {trigger === 'client_followup' && (
          <div className="mt-3">
            <Eyebrow>DÍAS SIN EMAILS (UMBRAL)</Eyebrow>
            <input type="number" min={1} max={90} value={mf.trg_days ?? '14'} onChange={e=>set('trg_days', e.target.value)} className={inputCls} style={numStyle}/>
          </div>
        )}
        {(trigger === 'project_deadline' || trigger === 'task_overdue') && (
          <div className="mt-3">
            <Eyebrow>{trigger === 'project_deadline' ? 'DÍAS DE ANTELACIÓN' : 'DÍAS DE GRACIA TRAS VENCER'}</Eyebrow>
            <input type="number" min={0} max={90} value={mf.trg_days ?? (trigger === 'project_deadline' ? '7' : '0')} onChange={e=>set('trg_days', e.target.value)} className={inputCls} style={numStyle}/>
          </div>
        )}
        {(trigger === 'unread_pileup' || trigger === 'many_overdue') && (
          <div className="mt-3">
            <Eyebrow>{trigger === 'unread_pileup' ? 'UMBRAL DE EMAILS SIN LEER' : 'UMBRAL DE TAREAS VENCIDAS'}</Eyebrow>
            <input type="number" min={1} max={500} value={mf.trg_threshold ?? (trigger === 'many_overdue' ? '5' : '10')} onChange={e=>set('trg_threshold', e.target.value)} className={inputCls} style={numStyle}/>
          </div>
        )}
      </div>

      {/* ENTONCES */}
      <div>
        <Eyebrow><span style={{color:'rgba(52,211,153,0.8)'}}>ENTONCES</span> · acción</Eyebrow>
        <div className="grid grid-cols-1 gap-2">
          {ACTIONS.map(a => {
            const on = action === a.v
            return (
              <button key={a.v} onClick={()=>set('action', a.v)} className="flex items-center gap-3 px-4 py-3 rounded-2xl text-left transition-all" style={{background:on?'rgba(34,197,94,0.08)':SURF2, border:`1.5px solid ${on?'rgba(34,197,94,0.45)':BORDER}`}}>
                <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{background:on?'rgba(34,197,94,0.12)':'rgba(255,255,255,0.03)'}}>
                  <LucideIcon name={a.icon} size={14} color={on?GRN:'rgba(255,255,255,0.3)'}/>
                </div>
                <div className="min-w-0">
                  <div className="font-figtree text-[13px] font-semibold" style={{color:on?'#fff':'rgba(255,255,255,0.55)'}}>{a.label}</div>
                  <div className="text-[11px]" style={{color:'rgba(255,255,255,0.28)'}}>{a.desc}</div>
                </div>
              </button>
            )
          })}
        </div>
        {/* Parámetros de la acción */}
        {action === 'create_task' ? (
          <div className="mt-3 space-y-3">
            <div>
              <Eyebrow>TEXTO DE LA TAREA</Eyebrow>
              <input value={mf.act_task||''} onChange={e=>set('act_task', e.target.value)} placeholder={varsDe(trigger) ? `Ej: Revisar ${varsDe(trigger).split(' ')[0]}` : 'Ej: Revisar esto'} className={inputCls} style={inputStyle}/>
              <div className="text-[10px] mt-2" style={{color:'rgba(255,255,255,0.25)'}}>
                {varsDe(trigger)
                  ? <>Variables: <span style={{color:'rgba(100,140,255,0.6)'}}>{varsDe(trigger)}</span></>
                  : 'Elige antes el disparador para ver qué variables puedes usar.'}
              </div>
            </div>
            <div>
              <Eyebrow>PRIORIDAD</Eyebrow>
              <div className="flex gap-2">
                {[{v:'urgent',l:'Urgente',c:RED},{v:'high',l:'Alta',c:AMBAR},{v:'normal',l:'Normal',c:BLU}].map(p=>{
                  const on = (mf.act_level||'normal')===p.v
                  return <button key={p.v} onClick={()=>set('act_level', p.v)} className="flex-1 py-2.5 rounded-2xl font-syne text-[10px] font-black tracking-wide transition-all" style={{background:on?p.c+'18':SURF2, border:`1.5px solid ${on?p.c+'70':BORDER}`, color:on?p.c:'#FFFFFF'}}>{p.l.toUpperCase()}</button>
                })}
              </div>
            </div>
            <div>
              <Eyebrow>ASIGNAR A (OPCIONAL)</Eyebrow>
              <div className="flex flex-wrap gap-2">
                {team.map(tm=>{
                  const on = mf.act_assignee === tm.id
                  return <button key={tm.id} onClick={()=>set('act_assignee', on?'':tm.id)} className="flex items-center gap-2 px-3 py-2 rounded-2xl transition-all" style={{background:on?tm.avatar_color+'18':SURF2, border:`1.5px solid ${on?tm.avatar_color+'55':BORDER}`}}>
                    <div className="w-6 h-6 rounded-full flex items-center justify-center font-syne text-[9px] font-black" style={{background:tm.avatar_color+'25', color:tm.avatar_color}}>{tm.initials}</div>
                    <span className="text-[12px]" style={{color:on?'#fff':'rgba(255,255,255,0.45)'}}>{tm.name.split(' ')[0]}</span>
                  </button>
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-3">
            <Eyebrow>MENSAJE DE LA NOTIFICACIÓN</Eyebrow>
            <input value={mf.act_message||''} onChange={e=>set('act_message', e.target.value)} placeholder="Ej: Revisa el email de {remitente}" className={inputCls} style={inputStyle}/>
          </div>
        )}
      </div>
    </div>
  )
}
