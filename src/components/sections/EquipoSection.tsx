'use client'
import { useState, useEffect, useRef } from 'react'
import type { Profile, Task } from '@/types'
import { useIsMobile, useBackClosable, BLU, RED, GRN, SURFACE, BORDER, LucideIcon, ProgressRing, relTime, todayKey } from '@/components/shared'
import { fetchWithTimeout } from '@/lib/fetch-timeout'

// Una tarea es de alguien si es su responsable O su co-responsable. Equipo
// ignoraba por completo co_assigned_to: quien solo estaba co-asignado salia con
// CERO tareas, con el anillo de progreso a cero y sin nada en su ficha — mientras
// el resto de la app (Tareas, Hoy) esas mismas tareas si se las contaba.
//
// Y se comparaba por NOMBRE, no por id. Dos perfiles con el mismo nombre —que los
// hay— se fusionaban en uno.
const esTareaDe = (t: Task, miembro: { id?: string }) =>
  !!miembro?.id && (t.assignee?.id === miembro.id || t.co_assignee?.id === miembro.id || t.co_assigned_to === miembro.id)

/** Tiene responsable, sea principal o co-responsable. */
const tieneResponsable = (t: Task) => !!t.assignee || !!t.co_assignee || !!t.co_assigned_to


function EquipoSection({data, profile, showToast}: any) {
  const isMobile = useIsMobile()
  const [selected, setSelected] = useState<Profile|null>(null)
  useBackClosable(!!selected, () => setSelected(null))
  const [thread, setThread] = useState<any[]>([])
  const [loadingThread, setLoadingThread] = useState(false)
  const [msgBody, setMsgBody] = useState('')
  const [sending, setSending] = useState(false)
  const allActiveRef = useRef<Profile[]>([])
  const msgInputRef = useRef<HTMLTextAreaElement>(null)
  // Add member
  const [addingMember, setAddingMember] = useState(false)
  const [newMemberName, setNewMemberName] = useState('')
  const [newMemberEmail, setNewMemberEmail] = useState('')
  const [newMemberRole, setNewMemberRole] = useState<'member'|'owner'>('member')
  const [addingLoading, setAddingLoading] = useState(false)
  const [inviteResult, setInviteResult] = useState<{email:string;inviteLink:string|null}|null>(null)
  const [copiedInvite, setCopiedInvite] = useState(false)
  const isOwner = profile?.role === 'owner'
  // Member management (owner only)
  const [invitePanel, setInvitePanel] = useState<{email:string;name:string;link:string|null;loading:boolean}|null>(null)
  const [copiedMemberLink, setCopiedMemberLink] = useState(false)
  const [confirmDeleteEmail, setConfirmDeleteEmail] = useState<string|null>(null)
  const [deletingEmail, setDeletingEmail] = useState<string|null>(null)

  useEffect(()=>{
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selected) { setSelected(null); return }
      if (['INPUT','TEXTAREA'].includes((e.target as HTMLElement).tagName) || e.metaKey||e.ctrlKey||e.altKey) return
      if (e.key === 'm' && selected) { e.preventDefault(); msgInputRef.current?.focus(); return }
      if (e.key === 'j' || e.key === 'k') {
        e.preventDefault()
        const members = allActiveRef.current.filter((m: Profile)=>m.id!==profile?.id)
        const idx = selected ? members.findIndex((m: Profile)=>m.id===selected.id) : -1
        const next = e.key==='j' ? Math.min(idx+1, members.length-1) : Math.max(idx-1, 0)
        const member = members[next]
        if (member) openThread(member)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])

  const allActive: Profile[] = data.team.some((m: Profile) => m.id === profile?.id)
    ? data.team
    : (profile ? [profile, ...data.team] : data.team)
  allActiveRef.current = allActive

  // no hardcoded pending members — team is fully dynamic

  const openThread = async (member: Profile) => {
    if (member.id === profile?.id) return
    // El panel de la derecha es una cadena: invitePanel ? … : addingMember ? … :
    // selected ? … — así que con cualquiera de los dos primeros abiertos, hacer
    // clic en un compañero cambiaba `selected` pero seguía viéndose el formulario.
    // Desde fuera la app parecía no responder al clic.
    setInvitePanel(null)
    setAddingMember(false)
    setInviteResult(null)
    setSelected(member)
    // El hilo del compañero ANTERIOR seguía en pantalla mientras cargaba el nuevo,
    // y con una respuesta lenta se quedaba pegado: parecía la conversación de
    // quien acabas de abrir.
    setThread([])
    setMsgBody('')
    setLoadingThread(true)
    try {
      const r = await fetchWithTimeout(`/api/inbox/thread?withUserId=${member.id}&withName=${encodeURIComponent(member.name)}`)
      // Un fallo de carga se pintaba igual que un hilo vacío: "Sin mensajes aún".
      // Decir que no hay conversación cuando en realidad no se ha podido leer es
      // peor que no decir nada — se escribe otra vez algo ya enviado.
      if (!r.ok) { showToast('No se pudo cargar la conversación'); setThread([]); return }
      const msgs = await r.json()
      setThread(Array.isArray(msgs) ? msgs : [])
    } catch { showToast('Error al cargar conversación'); setThread([]) }
    finally { setLoadingThread(false) }
  }

  const sendMessage = async () => {
    // ⌘↵ se salta el `disabled` del boton: pulsarlo dos veces mandaba el mensaje
    // dos veces, y el interno le llega a la otra persona duplicado.
    if (sending) return
    if (!selected || !msgBody.trim()) return
    setSending(true)
    try {
      await data.sendInternalMessage(selected.id, 'Mensaje directo', msgBody, profile?.name||'Equipo')
      const optimistic = {id:Date.now()+'',_dir:'sent',subject:'Mensaje directo',body_preview:msgBody,received_at:new Date().toISOString(),from_name:profile?.name}
      setThread(prev=>[...prev, optimistic])
      setMsgBody('')
      showToast(`Enviado a ${selected.name.split(' ')[0]}`)
    } catch { showToast('Error enviando') }
    finally { setSending(false) }
  }

  const addMember = async () => {
    // Enter en el campo de email lanza esto saltandose el boton. Un segundo Enter
    // mientras la primera alta esta en vuelo borraba de pantalla el enlace de
    // invitacion recien generado, que es lo unico que se le puede mandar a la
    // persona nueva.
    if (addingLoading) return
    if (!newMemberName.trim() || !newMemberEmail.trim()) return
    setAddingLoading(true)
    try {
      const res = await fetchWithTimeout('/api/admin/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newMemberName.trim(), email: newMemberEmail.trim().toLowerCase(), role: newMemberRole }),
        timeoutMs: 15_000,
      })
      const json = await res.json()
      if (!res.ok) { showToast(json.error || 'Error al crear cuenta'); return }
      setInviteResult({ email: newMemberEmail.trim().toLowerCase(), inviteLink: json.inviteLink || null })
      setNewMemberName(''); setNewMemberEmail(''); setNewMemberRole('member')
      showToast(`Cuenta creada para ${newMemberEmail.trim().split('@')[0]}`)
    } catch { showToast('Error de red') }
    finally { setAddingLoading(false) }
  }

  const openInvitePanel = async (email: string, name: string) => {
    setInvitePanel({ email, name, link: null, loading: true })
    setAddingMember(false); setSelected(null)
    try {
      const res = await fetch('/api/admin/team', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, action: 'regenerate_invite' }),
      })
      const json = await res.json()
      // Sin comprobar r.ok el panel se quedaba sin enlace y sin decir por que, y
      // ese enlace es lo unico que le puedes mandar a la persona nueva.
      if (!res.ok) { setInvitePanel(prev => prev ? { ...prev, loading: false } : null); showToast(json?.error || 'No se pudo generar el enlace'); return }
      setInvitePanel(prev => prev ? { ...prev, link: json.inviteLink || null, loading: false } : null)
    } catch {
      setInvitePanel(prev => prev ? { ...prev, loading: false } : null)
      showToast('Error al generar enlace')
    }
  }

  const deleteMember = async (email: string) => {
    setDeletingEmail(email)
    try {
      const res = await fetch(`/api/admin/team?email=${encodeURIComponent(email)}`, { method: 'DELETE' })
      if (res.ok) {
        showToast('Miembro eliminado'); setConfirmDeleteEmail(null); setInvitePanel(null); setSelected(null)
        window.location.reload()
      } else {
        const j = await res.json(); showToast(j.error || 'Error al eliminar')
      }
    } catch { showToast('Error de red') }
    finally { setDeletingEmail(null) }
  }

  const isMe = (m: Profile) => m.id === profile?.id

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: team list */}
      <div className="flex flex-col overflow-hidden" style={isMobile
        ? {width:'100%',flexShrink:0,display:(invitePanel||addingMember||selected)?'none':'flex'}
        : {width:'360px',flexShrink:0,borderRight:`1px solid ${BORDER}`}}>
        <div className={`${isMobile?'px-4':'px-6'} pt-6 pb-4 flex-shrink-0`} style={{borderBottom:`1px solid ${BORDER}`}}>
          <div className="flex items-center justify-between mb-1">
            <div className="font-syne text-[9px] font-black tracking-[0.25em]" style={{color:'rgba(255,255,255,0.18)'}}>BRUTAL STUDIOS</div>
            {isOwner && (
              <button onClick={()=>{setAddingMember(true);setSelected(null);setInviteResult(null)}}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl font-syne text-[8px] font-black tracking-widest transition-all hover:opacity-80"
                style={{background:addingMember?`rgba(27,95,250,0.15)`:'rgba(255,255,255,0.04)',border:`1px solid ${addingMember?`rgba(27,95,250,0.3)`:BORDER}`,color:addingMember?BLU:'rgba(255,255,255,0.4)'}}>
                <LucideIcon name="user-plus" size={10} color={addingMember?BLU:'rgba(255,255,255,0.4)'}/>
                AÑADIR
              </button>
            )}
          </div>
          <h1 className="font-figtree text-[22px] font-black text-white leading-none mb-1" style={{letterSpacing:'-0.03em'}}>Equipo</h1>
          <div className="nx-kbd-hints flex items-center gap-2 mb-3">
            {(['J/K NAVEGAR','M MENSAJE','ESC CERRAR'] as const).map((hint,i,arr)=>(
              <span key={hint} className="flex items-center gap-2">
                <span className="font-syne text-[7px] font-bold tracking-widest" style={{color:'rgba(255,255,255,0.1)'}}>{hint}</span>
                {i<arr.length-1&&<span className="font-syne text-[7px]" style={{color:'rgba(255,255,255,0.07)'}}>·</span>}
              </span>
            ))}
          </div>
          {(()=>{
            const teamPending = data.tasks.filter((t: Task)=>!t.done&&tieneResponsable(t)).length
            const teamOverdue = data.tasks.filter((t: Task)=>!t.done&&tieneResponsable(t)&&!!t.due_date&&new Date(t.due_date+'T23:59:59')<new Date()).length
            const teamUrgent = data.tasks.filter((t: Task)=>!t.done&&tieneResponsable(t)&&t.level==='urgent').length
            const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate()-7); weekAgo.setHours(0,0,0,0)
            const teamCompletedWeek = data.tasks.filter((t: Task)=>t.done&&tieneResponsable(t)&&new Date(t.updated_at||t.created_at)>=weekAgo).length
            if (teamPending === 0 && teamCompletedWeek === 0) return null
            return (
              <div className="flex items-center gap-3">
                {teamPending > 0 && <div className="text-center">
                  <div className="font-figtree text-[22px] font-black leading-none" style={{color:'rgba(255,255,255,0.75)',letterSpacing:'-0.03em'}}>{teamPending}</div>
                  <div className="font-syne text-[7px] font-black tracking-widest mt-0.5" style={{color:'rgba(255,255,255,0.2)'}}>PENDIENTES</div>
                </div>}
                {teamUrgent > 0 && (
                  <div className="text-center">
                    <div className="font-figtree text-[22px] font-black leading-none" style={{color:RED,letterSpacing:'-0.03em'}}>{teamUrgent}</div>
                    <div className="font-syne text-[7px] font-black tracking-widest mt-0.5" style={{color:'rgba(255,255,255,0.2)'}}>URGENTES</div>
                  </div>
                )}
                {teamOverdue > 0 && (
                  <div className="text-center">
                    <div className="font-figtree text-[22px] font-black leading-none" style={{color:'rgba(255,176,32,0.9)',letterSpacing:'-0.03em'}}>{teamOverdue}</div>
                    <div className="font-syne text-[7px] font-black tracking-widest mt-0.5" style={{color:'rgba(255,255,255,0.2)'}}>ATRASADAS</div>
                  </div>
                )}
                {teamCompletedWeek > 0 && (
                  <div className="text-center">
                    <div className="font-figtree text-[22px] font-black leading-none" style={{color:GRN,letterSpacing:'-0.03em'}}>{teamCompletedWeek}</div>
                    <div className="font-syne text-[7px] font-black tracking-widest mt-0.5" style={{color:'rgba(255,255,255,0.2)'}}>ESTA SEMANA</div>
                  </div>
                )}
              </div>
            )
          })()}
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {allActive.map((member: Profile) => {
            const memberTasks = data.tasks.filter((t: Task) => esTareaDe(t, member))
            const pending = memberTasks.filter((t: Task) => !t.done)
            const done = memberTasks.filter((t: Task) => t.done)
            const completePct = memberTasks.length > 0 ? Math.round((done.length/memberTasks.length)*100) : 0
            const urgent = pending.filter((t: Task) => t.level === 'urgent')
            const high = pending.filter((t: Task) => t.level === 'high')
            const mOverdue = pending.filter((t: Task) => t.due_date && new Date(t.due_date+'T23:59:59') < new Date())
            const mDueToday = pending.filter((t: Task) => t.due_date && t.due_date.slice(0,10) === todayKey())
            const workload = urgent.length*3 + high.length*2 + (pending.length-urgent.length-high.length)
            const sel = selected?.id === member.id
            const gmailOk = !!(member as any).gmail_connected
            const isConfirmDelete = confirmDeleteEmail === member.email
            return (
              <div key={member.id} className="rounded-2xl overflow-hidden" style={{border:`1px solid ${isConfirmDelete?RED+'40':sel?member.avatar_color+'30':BORDER}`}}>
                <div role="button" tabIndex={0} onClick={()=>{ if(!isConfirmDelete) openThread(member) }} onKeyDown={e=>{ if(e.key==='Enter'&&!isConfirmDelete) openThread(member) }}
                  className="w-full text-left p-4 transition-all duration-150 group/mc"
                  style={{background:isConfirmDelete?`rgba(229,29,42,0.06)`:sel?`linear-gradient(135deg,${member.avatar_color}0F,rgba(255,255,255,0.02))`:'rgba(255,255,255,0.02)',cursor:isMe(member)?'default':'pointer'}}>
                  <div className="flex items-center gap-3">
                    <div className="relative flex-shrink-0">
                      <ProgressRing pct={completePct} size={44} stroke={2.5} color={member.avatar_color}/>
                      <div className="absolute inset-0 flex items-center justify-center font-syne text-[10px] font-black" style={{color:member.avatar_color}}>{member.initials}</div>
                      {/* Gmail dot */}
                      <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full" style={{background:gmailOk?GRN:'rgba(255,255,255,0.12)',border:`1.5px solid #0A0A14`,boxShadow:gmailOk?`0 0 5px ${GRN}88`:undefined}}/>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-figtree text-[14px] font-semibold text-white truncate">{member.name}</span>
                        {isMe(member) && <span className="font-syne text-[7px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0" style={{background:'rgba(27,95,250,0.1)',color:BLU}}>TU</span>}
                        {urgent.length > 0 && <span className="font-syne text-[7px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0" style={{background:'rgba(229,29,42,0.1)',color:RED}}>{urgent.length} URG</span>}
                      </div>
                      <div className="text-[11px] mt-0.5 truncate" style={{color:'rgba(255,255,255,0.3)'}}>
                        {member.role==='owner'?'Propietario':'Equipo'} · {pending.length} tareas
                        {mOverdue.length>0?<span style={{color:RED+'aa'}}> · {mOverdue.length} atrasada{mOverdue.length>1?'s':''}</span>:null}
                        {mDueToday.length>0&&mOverdue.length===0?<span style={{color:'rgba(255,176,32,0.75)'}}> · {mDueToday.length} hoy</span>:null}
                        {' · '}
                        <span style={{color:gmailOk?GRN+'88':'rgba(255,255,255,0.2)'}}>{gmailOk?'Gmail ✓':'Sin Gmail'}</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                      {/* Normal state: message icon + workload */}
                      {!isOwner && !isMe(member) && <LucideIcon name="message-square" size={13} color={sel?member.avatar_color:'rgba(255,255,255,0.15)'}/>}
                      {/* Owner actions — visible on hover */}
                      {isOwner && !isMe(member) && !isConfirmDelete && (
                        <div className={`flex items-center gap-1.5 transition-opacity ${isMobile?'opacity-50':'opacity-0 group-hover/mc:opacity-100'}`}>
                          <button onClick={e=>{ e.stopPropagation(); openInvitePanel(member.email||'', member.name) }}
                            className={`${isMobile?'w-9 h-9':'w-6 h-6'} rounded-lg flex items-center justify-center transition-all hover:opacity-70`} title="Generar enlace de acceso"
                            style={{background:`rgba(27,95,250,0.12)`,border:`1px solid rgba(27,95,250,0.25)`}}>
                            <LucideIcon name="link-2" size={10} color={BLU}/>
                          </button>
                          <button onClick={e=>{ e.stopPropagation(); setConfirmDeleteEmail(member.email||'') }}
                            className={`${isMobile?'w-9 h-9':'w-6 h-6'} rounded-lg flex items-center justify-center transition-all hover:opacity-70`} title="Eliminar miembro"
                            style={{background:`rgba(229,29,42,0.08)`,border:`1px solid rgba(229,29,42,0.2)`}}>
                            <LucideIcon name="trash-2" size={10} color={RED}/>
                          </button>
                        </div>
                      )}
                      {workload > 0 && (
                        <div className="flex items-center gap-1" title={`Carga: ${workload}`}>
                          <div className="font-figtree text-[11px] font-black leading-none" style={{color:workload>8?RED:workload>4?'rgba(255,176,32,0.85)':'rgba(255,255,255,0.3)'}}>{workload}</div>
                          <div className="font-syne text-[6.5px] font-black tracking-wide" style={{color:'rgba(255,255,255,0.15)'}}>CARGA</div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                {/* Inline delete confirmation */}
                {isConfirmDelete && (
                  <div className="px-4 py-3 flex items-center gap-3" style={{borderTop:`1px solid rgba(229,29,42,0.15)`}}>
                    <LucideIcon name="alert-triangle" size={12} color={RED}/>
                    <span className="flex-1 font-syne text-[8.5px] font-black" style={{color:'rgba(229,29,42,0.8)'}}>¿Eliminar a {member.name} del equipo?</span>
                    <button onClick={()=>setConfirmDeleteEmail(null)} className="px-3 py-1.5 rounded-xl font-syne text-[8px] font-black tracking-wide transition-all hover:opacity-70" style={{background:'rgba(255,255,255,0.04)',color:'rgba(255,255,255,0.4)',border:`1px solid ${BORDER}`}}>CANCELAR</button>
                    <button onClick={()=>deleteMember(member.email||'')} disabled={deletingEmail===member.email}
                      className="px-3 py-1.5 rounded-xl font-syne text-[8px] font-black tracking-wide transition-all hover:opacity-80 disabled:opacity-40"
                      style={{background:RED,color:'white'}}>
                      {deletingEmail===member.email?'BORRANDO…':'ELIMINAR'}
                    </button>
                  </div>
                )}
              </div>
            )
          })}
          {/* No hardcoded pending — use AÑADIR button to create accounts */}
        </div>
      </div>

      {/* Right: Invite panel / Add member / DM panel / empty */}
      {invitePanel ? (
        <div className="flex-1 flex flex-col overflow-hidden" style={{background:'#050510'}}>
          <div className={`flex items-center gap-4 ${isMobile?'px-4':'px-6'} py-5 flex-shrink-0`} style={{borderBottom:`1px solid ${BORDER}`,background:`linear-gradient(135deg,rgba(27,95,250,0.06),transparent)`}}>
            <div className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0" style={{background:'rgba(27,95,250,0.12)',border:`1px solid rgba(27,95,250,0.25)`}}>
              <LucideIcon name="key" size={16} color={BLU}/>
            </div>
            <div className="flex-1">
              <div className="font-figtree text-[17px] font-semibold text-white">Enlace de acceso</div>
              <div className="text-[11px]" style={{color:'rgba(255,255,255,0.3)'}}>Para {invitePanel.name} · {invitePanel.email}</div>
            </div>
            <button onClick={()=>setInvitePanel(null)} className="w-8 h-8 rounded-xl flex items-center justify-center" style={{background:'rgba(255,255,255,0.05)'}}><LucideIcon name="x" size={13} color="rgba(240,240,248,0.4)"/></button>
          </div>
          <div className={`flex-1 flex flex-col justify-center ${isMobile?'p-4':'p-8'} max-w-[520px]`}>
            {invitePanel.loading ? (
              <div className="flex items-center gap-3" style={{color:'rgba(255,255,255,0.3)'}}>
                <div className="w-4 h-4 rounded-full animate-pulse" style={{background:`${BLU}50`}}/>
                <span className="font-syne text-[11px] font-black tracking-widest">GENERANDO ENLACE…</span>
              </div>
            ) : invitePanel.link ? (
              <div>
                <div className="font-syne text-[8.5px] font-black tracking-widest mb-3" style={{color:'rgba(255,255,255,0.2)'}}>ENLACE DE ACCESO</div>
                <div className="p-4 rounded-2xl mb-3" style={{background:'rgba(255,255,255,0.03)',border:`1px solid ${BORDER}`}}>
                  <div className="text-[10.5px] break-all leading-relaxed" style={{color:'rgba(255,255,255,0.4)'}}>{invitePanel.link}</div>
                </div>
                <div className="text-[11px] mb-5" style={{color:'rgba(255,255,255,0.28)'}}>
                  Comparte este enlace con <strong style={{color:'rgba(255,255,255,0.6)'}}>{invitePanel.name}</strong>. Al hacer clic podra establecer su contrasena y acceder directamente. El enlace caduca en 24 horas.
                </div>
                <div className="flex gap-2">
                  <button onClick={()=>{ navigator.clipboard.writeText(invitePanel.link!).catch(()=>{}); setCopiedMemberLink(true); setTimeout(()=>setCopiedMemberLink(false),2000) }}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-syne text-[9px] font-black tracking-widest transition-all hover:opacity-80"
                    style={{background:copiedMemberLink?'rgba(34,197,94,0.1)':`linear-gradient(135deg,${BLU},#1440CC)`,border:copiedMemberLink?`1px solid rgba(34,197,94,0.3)`:'none',color:'white'}}>
                    <LucideIcon name={copiedMemberLink?'check':'copy'} size={11} color="white"/>
                    {copiedMemberLink?'COPIADO':'COPIAR ENLACE'}
                  </button>
                  <button onClick={()=>openInvitePanel(invitePanel.email, invitePanel.name)}
                    className="px-4 py-2.5 rounded-xl font-syne text-[9px] font-black tracking-widest transition-all hover:opacity-80"
                    style={{background:'rgba(255,255,255,0.04)',border:`1px solid ${BORDER}`,color:'rgba(255,255,255,0.35)'}}>
                    REGENERAR
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div className="text-[13px] text-white mb-2">No se pudo generar el enlace</div>
                <div className="text-[12px] mb-4" style={{color:'rgba(255,255,255,0.3)'}}>
                  El miembro puede acceder en <strong>brutalstudios-ia.vercel.app</strong> con su email y usando "¿Olvidaste tu contrasena?" para recuperar el acceso.
                </div>
                <button onClick={()=>openInvitePanel(invitePanel.email, invitePanel.name)}
                  className="px-4 py-2.5 rounded-xl font-syne text-[9px] font-black tracking-widest transition-all hover:opacity-80"
                  style={{background:`linear-gradient(135deg,${BLU},#1440CC)`,color:'white'}}>
                  REINTENTAR
                </button>
              </div>
            )}
          </div>
        </div>
      ) : addingMember ? (
        <div className="flex-1 flex flex-col overflow-hidden" style={{background:'#050510'}}>
          <div className={`flex items-center gap-4 ${isMobile?'px-4':'px-6'} py-5 flex-shrink-0`} style={{borderBottom:`1px solid ${BORDER}`,background:`linear-gradient(135deg,rgba(27,95,250,0.06),transparent)`}}>
            <div className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0" style={{background:'rgba(27,95,250,0.12)',border:`1px solid rgba(27,95,250,0.25)`}}>
              <LucideIcon name="user-plus" size={16} color={BLU}/>
            </div>
            <div className="flex-1">
              <div className="font-figtree text-[17px] font-semibold text-white">Añadir miembro</div>
              <div className="text-[11px]" style={{color:'rgba(255,255,255,0.3)'}}>Se creara la cuenta y obtendras un enlace de acceso para compartir</div>
            </div>
            <button onClick={()=>{setAddingMember(false);setInviteResult(null)}} className="w-8 h-8 rounded-xl flex items-center justify-center" style={{background:'rgba(255,255,255,0.05)'}}><LucideIcon name="x" size={13} color="rgba(240,240,248,0.4)"/></button>
          </div>

          <div className={`flex-1 overflow-y-auto ${isMobile?'p-4':'p-6'}`}>
            {inviteResult ? (
              <div className="max-w-[480px]">
                {/* Success state */}
                <div className="flex items-center gap-3 p-4 rounded-2xl mb-6" style={{background:'rgba(34,197,94,0.06)',border:`1px solid rgba(34,197,94,0.2)`}}>
                  <LucideIcon name="check-circle" size={18} color={GRN}/>
                  <div>
                    <div className="font-figtree text-[14px] font-semibold text-white">Cuenta creada</div>
                    <div className="text-[11px] mt-0.5" style={{color:'rgba(255,255,255,0.4)'}}>{inviteResult.email}</div>
                  </div>
                </div>

                {inviteResult.inviteLink ? (
                  <div>
                    <div className="font-syne text-[8.5px] font-black tracking-widest mb-3" style={{color:'rgba(255,255,255,0.2)'}}>ENLACE DE ACCESO</div>
                    <div className="p-4 rounded-2xl mb-3" style={{background:'rgba(255,255,255,0.03)',border:`1px solid ${BORDER}`}}>
                      <div className="text-[11px] break-all leading-relaxed" style={{color:'rgba(255,255,255,0.4)'}}>{inviteResult.inviteLink}</div>
                    </div>
                    <div className="text-[11px] mb-4" style={{color:'rgba(255,255,255,0.3)'}}>Comparte este enlace con el nuevo miembro. Al hacer clic podran establecer su contrasena y acceder directamente. El enlace caduca en 24h.</div>
                    <div className="flex gap-2">
                      <button onClick={()=>{ navigator.clipboard.writeText(inviteResult.inviteLink!).catch(()=>{}); setCopiedInvite(true); setTimeout(()=>setCopiedInvite(false),2000) }}
                        className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-syne text-[9px] font-black tracking-widest transition-all hover:opacity-80"
                        style={{background:copiedInvite?'rgba(34,197,94,0.1)':`linear-gradient(135deg,${BLU},#1440CC)`,border:copiedInvite?`1px solid rgba(34,197,94,0.3)`:'none',color:'white'}}>
                        <LucideIcon name={copiedInvite?'check':'copy'} size={11} color="white"/>
                        {copiedInvite?'COPIADO':'COPIAR ENLACE'}
                      </button>
                      <button onClick={()=>{setInviteResult(null)}}
                        className="px-4 py-2.5 rounded-xl font-syne text-[9px] font-black tracking-widest transition-all hover:opacity-80"
                        style={{background:'rgba(255,255,255,0.04)',border:`1px solid ${BORDER}`,color:'rgba(255,255,255,0.4)'}}>
                        AÑADIR OTRO
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="text-[13px] text-white mb-2">Cuenta creada correctamente</div>
                    <div className="text-[12px]" style={{color:'rgba(255,255,255,0.35)'}}>El miembro puede iniciar sesion en brutalstudios-ia.vercel.app con el email <strong>{inviteResult.email}</strong>. Si no recuerda la contrasena, puede usar "¿Olvidaste tu contrasena?" en el login.</div>
                    <button onClick={()=>{setInviteResult(null)}} className="mt-4 px-4 py-2.5 rounded-xl font-syne text-[9px] font-black tracking-widest transition-all hover:opacity-80" style={{background:'rgba(255,255,255,0.04)',border:`1px solid ${BORDER}`,color:'rgba(255,255,255,0.4)'}}>AÑADIR OTRO</button>
                  </div>
                )}
              </div>
            ) : (
              <div className="max-w-[480px] space-y-4">
                <div>
                  <div className="font-syne text-[8.5px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.25)'}}>NOMBRE COMPLETO</div>
                  <input value={newMemberName} onChange={e=>setNewMemberName(e.target.value)}
                    placeholder="Ej: Maria Garcia"
                    className="w-full px-4 py-3 rounded-xl text-[13px] text-white outline-none"
                    style={{background:'rgba(255,255,255,0.04)',border:`1.5px solid ${BORDER}`,caretColor:BLU}}
                    onFocus={e=>(e.target.style.borderColor='rgba(27,95,250,0.4)')}
                    onBlur={e=>(e.target.style.borderColor=BORDER)}/>
                </div>
                <div>
                  <div className="font-syne text-[8.5px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.25)'}}>EMAIL</div>
                  <input value={newMemberEmail} onChange={e=>setNewMemberEmail(e.target.value)}
                    type="email" placeholder="maria@empresa.com"
                    className="w-full px-4 py-3 rounded-xl text-[13px] text-white outline-none"
                    style={{background:'rgba(255,255,255,0.04)',border:`1.5px solid ${BORDER}`,caretColor:BLU}}
                    onFocus={e=>(e.target.style.borderColor='rgba(27,95,250,0.4)')}
                    onBlur={e=>(e.target.style.borderColor=BORDER)}
                    onKeyDown={e=>{if(e.key==='Enter')addMember()}}/>
                </div>
                <div>
                  <div className="font-syne text-[8.5px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.25)'}}>ROL</div>
                  <div className="flex gap-2">
                    {(['member','owner'] as const).map(r=>(
                      <button key={r} onClick={()=>setNewMemberRole(r)}
                        className="flex-1 py-2.5 rounded-xl font-syne text-[9px] font-black tracking-widest transition-all"
                        style={{background:newMemberRole===r?`rgba(27,95,250,0.12)`:'rgba(255,255,255,0.03)',border:`1.5px solid ${newMemberRole===r?`rgba(27,95,250,0.35)`:BORDER}`,color:newMemberRole===r?BLU:'rgba(255,255,255,0.3)'}}>
                        {r==='member'?'MIEMBRO':'PROPIETARIO'}
                      </button>
                    ))}
                  </div>
                </div>
                <button onClick={addMember} disabled={addingLoading||!newMemberName.trim()||!newMemberEmail.trim()}
                  className="w-full py-3 rounded-xl font-syne text-[9.5px] font-black tracking-widest text-white disabled:opacity-30 transition-all hover:opacity-80"
                  style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>
                  {addingLoading?'CREANDO CUENTA…':'CREAR CUENTA Y GENERAR ENLACE'}
                </button>
                <div className="text-[11px] pt-1" style={{color:'rgba(255,255,255,0.2)'}}>Recibiras un enlace de acceso para compartir con el nuevo miembro. Solo el email registrado podra acceder a la app.</div>
              </div>
            )}
          </div>
        </div>
      ) : selected ? (
        <div className="flex-1 flex flex-col overflow-hidden" style={{background:'#050510'}}>
          {/* Header */}
          <div className={`flex items-center gap-4 ${isMobile?'px-4':'px-6'} py-5 flex-shrink-0`} style={{borderBottom:`1px solid ${BORDER}`,background:`linear-gradient(135deg,${selected.avatar_color}0C,transparent)`}}>
            <div className="relative flex-shrink-0">
              <ProgressRing pct={Math.round((data.tasks.filter((t:Task)=>esTareaDe(t,selected)&&t.done).length/Math.max(1,data.tasks.filter((t:Task)=>esTareaDe(t,selected)).length))*100)} size={40} stroke={2} color={selected.avatar_color}/>
              <div className="absolute inset-0 flex items-center justify-center font-syne text-[9px] font-black" style={{color:selected.avatar_color}}>{selected.initials}</div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-figtree text-[17px] font-semibold text-white truncate">{selected.name}</div>
              <div className="text-[11px] truncate" style={{color:'rgba(255,255,255,0.3)'}}>{selected.email} · {selected.role==='owner'?'Propietario':'Equipo'}</div>
            </div>
            <div className="flex items-center gap-3">
              {(() => {
                const mt = data.tasks.filter((t:Task)=>esTareaDe(t,selected))
                const pend = mt.filter((t:Task)=>!t.done)
                const urg = pend.filter((t:Task)=>t.level==='urgent')
                return (
                  <div className="flex gap-3">
                    {urg.length>0 && <div className="text-center"><div className="font-figtree text-[18px] font-black" style={{color:RED}}>{urg.length}</div><div className="font-syne text-[7.5px]" style={{color:'rgba(255,255,255,0.25)'}}>URG</div></div>}
                    <div className="text-center"><div className="font-figtree text-[18px] font-black" style={{color:BLU}}>{pend.length}</div><div className="font-syne text-[7.5px]" style={{color:'rgba(255,255,255,0.25)'}}>PENDIENTES</div></div>
                  </div>
                )
              })()}
              <button onClick={()=>{setSelected(null);setThread([])}} className="w-8 h-8 rounded-xl flex items-center justify-center" style={{background:'rgba(255,255,255,0.05)'}}><LucideIcon name="x" size={13} color="rgba(240,240,248,0.4)"/></button>
            </div>
          </div>

          {/* Tasks */}
          <div className={`flex-shrink-0 ${isMobile?'px-4':'px-6'} py-4`} style={{borderBottom:`1px solid ${BORDER}`}}>
            <div className="font-syne text-[8.5px] font-black tracking-widest mb-3" style={{color:'rgba(255,255,255,0.2)'}}>TAREAS ASIGNADAS</div>
            <div className="flex gap-2 flex-wrap">
              {data.tasks.filter((t:Task)=>esTareaDe(t,selected)&&!t.done).slice(0,4).map((t:Task)=>(
                <div key={t.id} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl" style={{background:'rgba(255,255,255,0.03)',border:`1px solid ${t.level==='urgent'?RED+'25':t.level==='high'?'rgba(255,176,32,0.15)':BORDER}`}}>
                  <div className="w-1 h-1 rounded-full flex-shrink-0" style={{background:t.level==='urgent'?RED:t.level==='high'?'rgba(255,176,32,0.8)':BLU}}/>
                  <span className="text-[11px] truncate max-w-[180px]" style={{color:'rgba(255,255,255,0.5)'}}>{t.text}</span>
                  {t.due_date && (()=>{
                    const todayStr = todayKey()
                    const isToday = t.due_date.slice(0,10)===todayStr
                    const over = !isToday && new Date(t.due_date+'T23:59:59')<new Date()
                    return <span className="font-syne text-[7px] font-black px-1 py-0.5 rounded flex-shrink-0" style={{background:isToday?'rgba(255,176,32,0.15)':over?`${RED}15`:'rgba(255,255,255,0.04)',color:isToday?'rgba(255,176,32,0.9)':over?RED:'rgba(255,255,255,0.2)'}}>{isToday?'HOY':new Date(t.due_date+'T12:00:00').toLocaleDateString('es-ES',{day:'numeric',month:'short'})}</span>
                  })()}
                </div>
              ))}
              {data.tasks.filter((t:Task)=>esTareaDe(t,selected)&&!t.done).length===0 && (
                <span className="text-[11px]" style={{color:'rgba(255,255,255,0.2)'}}>Sin tareas pendientes</span>
              )}
            </div>
          </div>

          {/* Thread */}
          <div className={`flex-1 overflow-y-auto ${isMobile?'px-4':'px-6'} py-4 space-y-3`}>
            <div className="font-syne text-[8.5px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.18)'}}>CONVERSACION</div>
            {loadingThread && <div className="text-center py-8 text-[12px]" style={{color:'rgba(255,255,255,0.2)'}}>Cargando mensajes…</div>}
            {!loadingThread && thread.length===0 && (
              <div className="flex flex-col items-center py-12 text-center">
                <div className="w-10 h-10 rounded-2xl flex items-center justify-center mb-3" style={{background:'rgba(255,255,255,0.04)',border:`1px solid ${BORDER}`}}><LucideIcon name="message-square" size={16} color="rgba(255,255,255,0.2)"/></div>
                <div className="text-[13px] text-white mb-1">Sin mensajes aun</div>
                <div className="text-[11px]" style={{color:'rgba(255,255,255,0.25)'}}>Empieza la conversacion abajo</div>
              </div>
            )}
            {thread.map((msg: any) => {
              const isSent = msg._dir === 'sent'
              return (
                <div key={msg.id} className={`flex ${isSent?'justify-end':'justify-start'}`}>
                  <div className="max-w-[75%]">
                    <div className="px-4 py-3 rounded-2xl" style={{background:isSent?`linear-gradient(135deg,${BLU},#1440CC)`:'rgba(255,255,255,0.06)',borderBottomRightRadius:isSent?'4px':'16px',borderBottomLeftRadius:isSent?'16px':'4px'}}>
                      <p className="text-[13px] leading-relaxed" style={{color:isSent?'white':'rgba(255,255,255,0.8)'}}>{msg.body_preview}</p>
                    </div>
                    <div className={`text-[10px] mt-1 px-1 ${isSent?'text-right':''}`} style={{color:'rgba(255,255,255,0.2)'}}>
                      {relTime(msg.received_at)}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Compose */}
          <div className="flex-shrink-0 p-4" style={{borderTop:`1px solid ${BORDER}`}}>
            <div className="flex gap-2 items-end">
              <textarea
                ref={msgInputRef}
                value={msgBody}
                onChange={e=>setMsgBody(e.target.value)}
                onKeyDown={e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){sendMessage()}}}
                placeholder={`Mensaje a ${selected.name.split(' ')[0]}…`}
                rows={1}
                className="flex-1 px-4 py-3 rounded-2xl text-[13px] text-white outline-none resize-none"
                style={{background:'rgba(255,255,255,0.05)',border:`1.5px solid ${BORDER}`,caretColor:BLU,maxHeight:'120px',lineHeight:'1.5'}}
                onFocus={e=>(e.target.style.borderColor='rgba(27,95,250,0.35)')}
                onBlur={e=>(e.target.style.borderColor=BORDER)}
              />
              <button onClick={sendMessage} disabled={sending||!msgBody.trim()}
                className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 disabled:opacity-30 transition-all"
                style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}} aria-label="Enviar"><LucideIcon name="send" size={14} color="white"/></button>
            </div>
            <div className="text-center text-[9px] mt-2" style={{color:'rgba(255,255,255,0.15)'}}>⌘↵ para enviar</div>
          </div>
        </div>
      ) : (
        // En móvil la lista ocupa el 100% del ancho; este panel se colocaba AL
        // LADO dentro del mismo flex y empujaba 103px fuera de pantalla. Sobra
        // en móvil: la lista ya ES la pantalla.
        //
        // Se oculta con `hidden md:flex` y no con isMobile a propósito. El ancho
        // de la ventana es CSS, y resolverlo con estado de React lo hace depender
        // de que un efecto se ejecute y de que el elemento se vuelva a pintar
        // después — con `isMobile` el atributo style se quedaba con el valor del
        // servidor y el panel seguía desbordando. La media query se aplica en el
        // primer píxel pintado, sin hidratación de por medio.
        <div className="flex-1 hidden md:flex items-center justify-center" style={{background:'#050510'}}>
          <div className="text-center">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{background:'rgba(255,255,255,0.03)',border:`1px solid ${BORDER}`}}><LucideIcon name="message-square" size={22} color="rgba(255,255,255,0.15)"/></div>
            <div className="font-figtree text-[16px] font-semibold text-white mb-1">Selecciona un compañero</div>
            <div className="text-[12px] mb-5" style={{color:'rgba(255,255,255,0.3)'}}>Haz clic en su nombre para ver la conversacion</div>
            {isOwner && (
              <button onClick={()=>setAddingMember(true)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-syne text-[9px] font-black tracking-widest mx-auto transition-all hover:opacity-80"
                style={{background:'rgba(27,95,250,0.08)',border:`1px solid rgba(27,95,250,0.2)`,color:BLU}}>
                <LucideIcon name="user-plus" size={11} color={BLU}/>
                AÑADIR MIEMBRO
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default EquipoSection
