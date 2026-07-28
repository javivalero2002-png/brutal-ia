'use client'

import { useState } from 'react'
import { BLU, RED, SURFACE, SURF2, BORDER, LucideIcon, AjCard } from '@/components/shared'
import SincronizacionSection from './SincronizacionSection'
import EquipoSection from './EquipoSection'
import MemoriaSection from './MemoriaSection'
import AutomatizacionesSection from './AutomatizacionesSection'
import ReportesSection from './ReportesSection'
import NotificacionesTab from './NotificacionesTab'

function AjustesSection({profile,data,showToast,memFilter,setMemFilter,onOpenModal,isOwner}: any) {
  const [ajTab, setAjTab] = useState<'perfil'|'notificaciones'|'sincronizacion'|'equipo'|'memoria'|'automatizaciones'|'reportes'>('perfil')
  const [editName, setEditName] = useState(profile?.name||'')
  const [editInitials, setEditInitials] = useState(profile?.initials||'')
  const [editAvatarColor, setEditAvatarColor] = useState(profile?.avatar_color||BLU)
  const [savingProfile, setSavingProfile] = useState(false)
  // Password change
  const [currentPwd, setCurrentPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [changingPwd, setChangingPwd] = useState(false)
  const changePwd = async () => {
    if (!currentPwd) { showToast('Introduce tu contraseña actual'); return }
    if (newPwd.length < 8) { showToast('Mínimo 8 caracteres'); return }
    if (newPwd !== confirmPwd) { showToast('Las contraseñas no coinciden'); return }
    setChangingPwd(true)
    try {
      const res = await fetch('/api/auth/change-password', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ currentPassword: currentPwd, newPassword: newPwd }) })
      if (res.ok) { showToast('Contraseña actualizada'); setCurrentPwd(''); setNewPwd(''); setConfirmPwd('') }
      else { const j = await res.json(); showToast(j.error || 'Error al cambiar contraseña') }
    } catch { showToast('Error de red') }
    finally { setChangingPwd(false) }
  }

  const saveOwnProfile = async () => {
    if (!editName.trim()) return
    setSavingProfile(true)
    try {
      const res = await fetch('/api/admin/team', {
        method:'PATCH',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ email: profile.email, name: editName.trim(), initials: editInitials.trim().toUpperCase().slice(0,2)||editName.trim().split(' ').map((n:string)=>n[0]).join('').toUpperCase().slice(0,2), avatar_color: editAvatarColor })
      })
      if (res.ok) { showToast('Perfil actualizado — recarga para ver los cambios'); }
      else { showToast('Error actualizando perfil') }
    } catch { showToast('Error') }
    finally { setSavingProfile(false) }
  }

  const cardStyle = {background:SURFACE,border:`1px solid ${BORDER}`,borderRadius:'16px'}

  const ajTabs = [
    {id:'perfil',label:'Perfil',icon:'settings'},
    {id:'notificaciones',label:'Notificaciones',icon:'bell'},
    {id:'sincronizacion',label:'Sincronización',icon:'link-2'},
    {id:'equipo',label:'Equipo',icon:'users-2'},
    {id:'memoria',label:'Memoria',icon:'database'},
    {id:'automatizaciones',label:'Automatizaciones',icon:'zap'},
    ...(isOwner ? [{id:'reportes',label:'Reportes',icon:'printer'}] as const : []),
  ] as const

  return (
    <div className="h-full flex flex-col">
      {/* Header + tabs */}
      <div className="px-8 pt-7 pb-0 flex-shrink-0">
        <div className="font-syne text-[9px] font-black tracking-[0.25em] mb-1" style={{color:'rgba(255,255,255,0.18)'}}>CONFIGURACIÓN</div>
        <h1 className="font-figtree text-[26px] font-black text-white leading-none mb-5" style={{letterSpacing:'-0.03em'}}>Operativa</h1>
        <div className="flex items-center gap-1.5 overflow-x-auto" style={{borderBottom:`1px solid ${BORDER}`,paddingBottom:'0',scrollbarWidth:'none',touchAction:'pan-x',overscrollBehavior:'contain'}}>
          {ajTabs.map(t=>{
            const act = ajTab === t.id
            return (
              <button key={t.id} onClick={()=>setAjTab(t.id)}
                className="flex items-center gap-1.5 px-3 py-2.5 font-syne text-[9.5px] font-black tracking-wide transition-all rounded-t-xl flex-shrink-0 whitespace-nowrap"
                style={{
                  background: act ? SURF2 : 'transparent',
                  color: act ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.22)',
                  borderBottom: act ? `2px solid ${BLU}` : '2px solid transparent',
                  marginBottom:'-1px',
                }}>
                <LucideIcon name={t.icon} size={12} color={act?BLU:'rgba(255,255,255,0.2)'}/>
                {t.label.toUpperCase()}
              </button>
            )
          })}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {ajTab === 'notificaciones' && <NotificacionesTab showToast={showToast} />}
        {ajTab === 'sincronizacion' && <SincronizacionSection data={data} profile={profile} showToast={showToast} />}
        {ajTab === 'equipo' && <EquipoSection data={data} profile={profile} showToast={showToast} />}
        {ajTab === 'memoria' && <MemoriaSection data={data} memFilter={memFilter||'Todos'} setMemFilter={setMemFilter||(() => {})} onOpenModal={onOpenModal||(() => {})} showToast={showToast} />}
        {ajTab === 'automatizaciones' && <AutomatizacionesSection data={data} onOpenModal={onOpenModal||(() => {})} showToast={showToast} isOwner={isOwner} />}
        {ajTab === 'reportes' && isOwner && <ReportesSection data={data} onNavigate={()=>{}} />}

        {ajTab === 'perfil' && (
        <div className="p-8 max-w-[680px] mx-auto">
      <div className="space-y-4">

        {/* Mi perfil */}
        <AjCard title="MI PERFIL">
          <div className="flex items-center gap-4 mb-5">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center font-syne text-base font-black flex-shrink-0" style={{background:(profile?.avatar_color||BLU)+'22',border:`1.5px solid ${(profile?.avatar_color||BLU)}40`,color:profile?.avatar_color||BLU}}>{profile?.initials||'--'}</div>
            <div>
              <div className="font-figtree text-[16px] font-semibold text-white">{profile?.name||''}</div>
              <div className="text-[12px] mt-0.5" style={{color:'rgba(255,255,255,0.3)'}}>{profile?.email||''}</div>
              <span className="font-syne text-[7.5px] font-black mt-1.5 px-2 py-0.5 rounded-full inline-block" style={{background:profile?.role==='owner'?'rgba(27,95,250,0.1)':'rgba(255,255,255,0.05)',color:profile?.role==='owner'?BLU:'rgba(240,240,248,0.3)'}}>{profile?.role==='owner'?'PROPIETARIO':'MIEMBRO'}</span>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <div className="font-syne text-[8.5px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.25)'}}>NOMBRE PARA MOSTRAR</div>
              <input value={editName} onChange={e=>setEditName(e.target.value)} className="w-full px-4 py-2.5 rounded-xl text-[13px] text-white outline-none" style={{background:SURF2,border:`1.5px solid ${BORDER}`,caretColor:BLU}} onFocus={e=>(e.target.style.borderColor='rgba(27,95,250,0.4)')} onBlur={e=>(e.target.style.borderColor=BORDER)}/>
            </div>
            <div className="w-24">
              <div className="font-syne text-[8.5px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.25)'}}>INICIALES</div>
              <input value={editInitials} onChange={e=>setEditInitials(e.target.value.toUpperCase().slice(0,2))} maxLength={2} className="w-full px-4 py-2.5 rounded-xl text-[13px] text-white outline-none text-center tracking-widest" style={{background:SURF2,border:`1.5px solid ${BORDER}`,caretColor:BLU}} onFocus={e=>(e.target.style.borderColor='rgba(27,95,250,0.4)')} onBlur={e=>(e.target.style.borderColor=BORDER)}/>
            </div>
          </div>
          <div className="mt-4 pt-4 flex items-start gap-4" style={{borderTop:`1px solid ${BORDER}`}}>
            <div className="flex-1">
              <div className="font-syne text-[8.5px] font-black tracking-widest mb-2.5" style={{color:'rgba(255,255,255,0.25)'}}>COLOR DE AVATAR</div>
              <div className="flex items-center gap-2 flex-wrap">
                {['#1B5FFA','#E51D2A','#22c55e','#F97316','#A78BFA','#06B6D4','#EC4899','#84CC16','#F59E0B','#10B981'].map(c=>(
                  <button key={c} onClick={()=>setEditAvatarColor(c)} title={c} className="w-7 h-7 rounded-full transition-all" style={{background:c,outline:editAvatarColor===c?`2px solid white`:'none',outlineOffset:'2px',opacity:editAvatarColor===c?1:0.5}}/>
                ))}
              </div>
            </div>
          </div>
          <button onClick={saveOwnProfile} disabled={savingProfile} className="mt-4 px-5 py-2.5 rounded-xl font-syne text-[9px] font-black tracking-widest text-white disabled:opacity-40" style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>{savingProfile?'GUARDANDO…':'GUARDAR PERFIL'}</button>
        </AjCard>

        {/* Seguridad */}
        <AjCard title="SEGURIDAD" defaultOpen={false}>
          <div className="space-y-3">
            <div>
              <div className="font-syne text-[8.5px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.25)'}}>CONTRASEÑA ACTUAL</div>
              <input type="password" value={currentPwd} onChange={e=>setCurrentPwd(e.target.value)}
                placeholder="Tu contraseña actual"
                className="w-full px-4 py-2.5 rounded-xl text-[13px] text-white outline-none"
                style={{background:SURF2,border:`1.5px solid ${BORDER}`,caretColor:BLU}}
                onFocus={e=>(e.target.style.borderColor='rgba(27,95,250,0.4)')}
                onBlur={e=>(e.target.style.borderColor=BORDER)}/>
            </div>
            <div>
              <div className="font-syne text-[8.5px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.25)'}}>NUEVA CONTRASEÑA</div>
              <input type="password" value={newPwd} onChange={e=>setNewPwd(e.target.value)}
                placeholder="Mínimo 8 caracteres"
                className="w-full px-4 py-2.5 rounded-xl text-[13px] text-white outline-none"
                style={{background:SURF2,border:`1.5px solid ${BORDER}`,caretColor:BLU}}
                onFocus={e=>(e.target.style.borderColor='rgba(27,95,250,0.4)')}
                onBlur={e=>(e.target.style.borderColor=BORDER)}/>
            </div>
            <div>
              <div className="font-syne text-[8.5px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.25)'}}>CONFIRMAR CONTRASEÑA</div>
              <input type="password" value={confirmPwd} onChange={e=>setConfirmPwd(e.target.value)}
                placeholder="Repite la contraseña"
                className="w-full px-4 py-2.5 rounded-xl text-[13px] text-white outline-none"
                style={{background:SURF2,border:`1.5px solid ${confirmPwd&&newPwd&&confirmPwd!==newPwd?RED+'60':BORDER}`,caretColor:BLU}}
                onFocus={e=>(e.target.style.borderColor=confirmPwd&&newPwd&&confirmPwd!==newPwd?RED:'rgba(27,95,250,0.4)')}
                onBlur={e=>(e.target.style.borderColor=confirmPwd&&newPwd&&confirmPwd!==newPwd?RED+'60':BORDER)}
                onKeyDown={e=>{if(e.key==='Enter')changePwd()}}/>
            </div>
            <button onClick={changePwd} disabled={changingPwd||!currentPwd||newPwd.length<8||newPwd!==confirmPwd}
              className="px-5 py-2.5 rounded-xl font-syne text-[9px] font-black tracking-widest text-white disabled:opacity-30 transition-all hover:opacity-80"
              style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>
              {changingPwd?'GUARDANDO…':'CAMBIAR CONTRASEÑA'}
            </button>
          </div>
        </AjCard>

        {/* Integraciones */}
        <AjCard title="INTEGRACIONES" defaultOpen={false}>
          <div className="flex items-center justify-between py-3" style={{borderBottom:`1px solid ${BORDER}`}}>
            <div className="flex items-center gap-3"><LucideIcon name="mail" size={15} color={BLU}/><span className="text-[13px]" style={{color:'rgba(255,255,255,0.7)'}}>Gmail</span></div>
            {profile.gmail_connected ? (
              <span className="font-syne text-[8px] font-black px-3 py-1 rounded-full" style={{background:'rgba(27,95,250,0.1)',color:BLU}}>CONECTADO</span>
            ) : (
              <a href="/api/gmail/connect" className="font-syne text-[9px] font-black px-3 py-1.5 rounded-xl text-white" style={{background:BLU}}>CONECTAR</a>
            )}
          </div>
          <div className="flex items-center justify-between py-3">
            <div className="flex items-center gap-3">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="#25D366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
              <span className="text-[13px]" style={{color:'rgba(255,255,255,0.7)'}}>WhatsApp Bot</span>
            </div>
            <span className="text-[11px]" style={{color:'rgba(255,255,255,0.2)'}}>Ver documentación</span>
          </div>
        </AjCard>

        {/* Atajos de teclado */}
        <AjCard title="ATAJOS DE TECLADO" defaultOpen={false}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              {key:'⌘+K', label:'Búsqueda global'},
              {key:'G·H', label:'Hoy'},
              {key:'G·T', label:'Tareas'},
              {key:'G·I', label:'Inbox'},
              {key:'G·C', label:'Clientes'},
              {key:'G·P', label:'Proyectos'},
              {key:'G·K', label:'Contenido'},
              {key:'G·A', label:'Calendario'},
              {key:'G·M', label:'Memoria'},
              {key:'G·E', label:'Equipo'},
              {key:'G·R', label:'Reportes'},
              {key:'G·V', label:'Automatizaciones'},
              {key:'G·S', label:'Ajustes'},
              {key:'G·N', label:'Chat IA'},
              {key:'N', label:'Nueva entrada (Memoria)'},
              {key:'J / K', label:'Navegar lista (Tareas, Inbox)'},
              {key:'Esc', label:'Cerrar modal / panel'},
              {key:'Enter', label:'Enviar en Chat'},
            ].map((s,i)=>(
              <div key={i} className="flex items-center gap-3">
                <kbd className="font-syne text-[9px] font-black px-2.5 py-1.5 rounded-lg flex-shrink-0" style={{background:SURF2,color:BLU,border:`1px solid rgba(27,95,250,0.2)`,minWidth:'52px',textAlign:'center'}}>{s.key}</kbd>
                <span className="text-[12px]" style={{color:'rgba(255,255,255,0.45)'}}>{s.label}</span>
              </div>
            ))}
          </div>
        </AjCard>

        {/* Team shortcut for owners */}
        {profile.role === 'owner' && (
          <div className="flex items-center gap-3 p-4 rounded-2xl cursor-pointer transition-all hover:opacity-80" style={{background:SURFACE,border:`1px solid ${BORDER}`}} onClick={()=>setAjTab('equipo')}>
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{background:'rgba(255,255,255,0.04)'}}><LucideIcon name="users-2" size={15} color="rgba(255,255,255,0.3)"/></div>
            <div className="flex-1">
              <div className="text-[13px] font-medium" style={{color:'rgba(255,255,255,0.7)'}}>Gestión de equipo</div>
              <div className="text-[11px]" style={{color:'rgba(255,255,255,0.25)'}}>Ver en la pestaña Equipo</div>
            </div>
            <LucideIcon name="chevron-right" size={13} color="rgba(255,255,255,0.15)"/>
          </div>
        )}
      </div>
    </div>
        )}
      </div>
    </div>
  )
}

export default AjustesSection
