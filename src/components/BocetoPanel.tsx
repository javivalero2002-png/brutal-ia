'use client'
import { BLU, useIsMobile } from '@/components/shared'
import type { ContentItem } from '@/types'

interface BocetoPanelProps {
  activeItem: ContentItem
  editCoverUrl: string
  editAccountName: string
  accountLogoUrl: string
  bocetoCaption: string | null
  setBocetoCaption: (v: string | null) => void
  bocetoPlatform: 'instagram' | 'linkedin' | null
  setBocetoPlatform: (v: 'instagram' | 'linkedin') => void
  editContentType: 'publicacion' | 'reel' | 'story'
  setEditContentType: (v: 'publicacion' | 'reel' | 'story') => void
  onSaveCopy: (caption: string) => Promise<void>
}

export default function BocetoPanel({
  activeItem, editCoverUrl, editAccountName, accountLogoUrl,
  bocetoCaption, setBocetoCaption, bocetoPlatform, setBocetoPlatform,
  editContentType, setEditContentType, onSaveCopy,
}: BocetoPanelProps) {
  const isMobile = useIsMobile()
  const plat = String(activeItem.platform || '').toLowerCase()
  const isLinkedin = bocetoPlatform ? bocetoPlatform === 'linkedin' : plat.includes('linkedin')
  const account = editAccountName || activeItem.account_name || 'Brutal Studios'
  const initial = (account.trim().charAt(0) || 'B').toUpperCase()
  const media = editCoverUrl || activeItem.cover_url || ''
  const caption = bocetoCaption ?? (activeItem.title || '')
  const dirty = bocetoCaption !== null && bocetoCaption.trim() && bocetoCaption.trim() !== (activeItem.title || '')

  const igIcon = (d: string) => (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d={d}/>
    </svg>
  )

  return (
    <div className={`${isMobile ? 'px-4' : 'px-7'} pt-7 pb-5 flex-shrink-0`} style={{borderBottom:'1px solid rgba(255,255,255,0.05)'}}>
      {/* Platform toggle */}
      <div className="flex items-center justify-between mb-3">
        <div className="font-syne text-[8.5px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.2)'}}>BOCETO EN VIVO</div>
        <div className="flex items-center gap-1 p-0.5 rounded-lg" style={{background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.06)'}}>
          {(['instagram','linkedin'] as const).map(p => {
            const on = isLinkedin ? p === 'linkedin' : p === 'instagram'
            return (
              <button key={p} onClick={() => setBocetoPlatform(p)} className="px-2.5 py-1 rounded-md font-syne text-[7.5px] font-black tracking-wide transition-all"
                style={{background:on?(p==='linkedin'?'#0a66c2':'#dc2743')+'22':'transparent',color:on?(p==='linkedin'?'#4a9fe0':'#ff6ba0'):'rgba(255,255,255,0.3)'}}>
                {p === 'linkedin' ? 'LINKEDIN' : 'INSTAGRAM'}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex justify-center">
        {isLinkedin ? (
          <div className="w-full rounded-xl overflow-hidden" style={{maxWidth:'360px',background:'#1c1c1e',border:'1px solid rgba(255,255,255,0.1)'}}>
            <div className="flex items-start gap-2.5 px-3.5 pt-3.5 pb-2.5">
              <div className="w-11 h-11 rounded-full flex items-center justify-center font-figtree text-[15px] font-bold text-white flex-shrink-0" style={{background:'linear-gradient(135deg,#0a66c2,#0950a0)',border:'2px solid rgba(10,102,194,0.35)'}}>{initial}</div>
              <div className="flex-1 min-w-0 pt-0.5">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-white text-[13px] font-semibold leading-tight">{account}</span>
                  <span className="text-[11px]" style={{color:'rgba(10,102,194,0.9)'}}>✓</span>
                  <span className="font-figtree text-[10px] px-1.5 py-0.5 rounded-full border border-current" style={{color:'rgba(255,255,255,0.35)'}}>1er</span>
                </div>
                <div className="text-[10.5px] mt-0.5 leading-tight" style={{color:'rgba(255,255,255,0.45)'}}>Co-fundador · Brutal Studios</div>
                <div className="flex items-center gap-1 mt-0.5">
                  <span className="text-[10px]" style={{color:'rgba(255,255,255,0.3)'}}>2 días</span>
                  <span className="text-[10px]" style={{color:'rgba(255,255,255,0.2)'}}>·</span>
                  <span className="text-[10px]">🌐</span>
                </div>
              </div>
              <span className="text-[18px] leading-none flex-shrink-0 cursor-pointer" style={{color:'rgba(255,255,255,0.35)'}}>···</span>
            </div>
            <div className="px-3.5 pb-3 text-[13px] leading-relaxed whitespace-pre-wrap break-words" style={{color:'rgba(255,255,255,0.88)'}}>
              {caption || <span style={{color:'rgba(255,255,255,0.25)'}}>El texto del post aparecerá aquí…</span>}
            </div>
            {media && <img src={media} alt="" className="w-full" style={{maxHeight:'200px',objectFit:'cover'}}/>}
            <div className="flex items-center px-3.5 py-2" style={{borderTop:'1px solid rgba(255,255,255,0.07)'}}>
              <span className="text-[14px]">👍</span><span className="text-[14px] -ml-1">❤️</span>
              <span className="text-[11px] ml-1.5" style={{color:'rgba(255,255,255,0.35)'}}>35</span>
              <div className="flex-1"/>
              <span className="font-figtree text-[10px]" style={{color:'rgba(255,255,255,0.25)'}}>3 comentarios</span>
            </div>
            <div className="flex items-center px-1 py-1" style={{borderTop:'1px solid rgba(255,255,255,0.07)'}}>
              {[{icon:'👍',label:'Recomendar'},{icon:'💬',label:'Comentar'},{icon:'↗️',label:'Compartir'},{icon:'✉️',label:'Enviar'}].map(a => (
                <button key={a.label} className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg transition-colors hover:bg-white/5">
                  <span className="text-[11px]">{a.icon}</span>
                  <span className="font-figtree text-[9.5px] hidden sm:block" style={{color:'rgba(255,255,255,0.4)'}}>{a.label}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="w-full flex flex-col items-center gap-3" style={{maxWidth:'320px'}}>
            {/* Format selector */}
            <div className="flex items-center gap-1 p-0.5 rounded-xl self-stretch" style={{background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.07)'}}>
              {([['publicacion','📷','PUBLICACIÓN'],['reel','🎬','REEL'],['story','⭕','STORY']] as const).map(([t,icon,label]) => {
                const on = editContentType === t
                return (
                  <button key={t} onClick={() => setEditContentType(t)} className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg font-syne text-[7.5px] font-black tracking-wide transition-all"
                    style={{background:on?'rgba(195,53,132,0.22)':'transparent',color:on?'#ff6ba0':'rgba(255,255,255,0.3)'}}>
                    <span>{icon}</span><span>{label}</span>
                  </button>
                )
              })}
            </div>

            {/* Publicación */}
            {editContentType === 'publicacion' && (
              <div className="w-full rounded-xl overflow-hidden" style={{background:'#000',border:'1px solid rgba(255,255,255,0.12)'}}>
                <div className="flex items-center gap-2.5 px-3 py-2.5">
                  <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0 flex items-center justify-center" style={{background:'linear-gradient(45deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)',padding:'2px'}}>
                    <div className="w-full h-full rounded-full overflow-hidden flex items-center justify-center" style={{background:'#111'}}>
                      {accountLogoUrl ? <img src={accountLogoUrl} alt={initial} className="w-full h-full object-cover"/> : <span className="font-figtree font-black text-white text-[11px]">{initial}</span>}
                    </div>
                  </div>
                  <span className="flex-1 text-white text-[12px] font-semibold truncate">{account}</span>
                  <button className="font-syne text-[9px] font-black px-2.5 py-1 rounded-full" style={{background:'rgba(27,95,250,0.18)',color:BLU,border:`1px solid ${BLU}33`}}>Seguir</button>
                  <span className="text-white text-[15px] leading-none ml-1">···</span>
                </div>
                {media
                  ? <img src={media} alt="" style={{aspectRatio:'1/1',width:'100%',objectFit:'cover'}}/>
                  : <div style={{aspectRatio:'1/1',background:'linear-gradient(135deg,#1a1a2e,#0f1230)'}} className="flex flex-col items-center justify-center gap-3 p-5">
                      {accountLogoUrl ? <img src={accountLogoUrl} alt={initial} className="w-14 h-14 rounded-2xl object-cover"/> : <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{background:'rgba(255,255,255,0.08)'}}><span className="font-figtree font-black text-white text-[28px]">{initial}</span></div>}
                      <span className="text-center font-figtree text-[13px] font-semibold leading-snug" style={{color:'rgba(255,255,255,0.55)'}}>{caption}</span>
                    </div>}
                <div className="flex items-center gap-3.5 px-3 pt-2.5">
                  {igIcon('M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1L12 21l7.7-7.6 1.1-1a5.5 5.5 0 0 0 0-7.8z')}
                  {igIcon('M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z')}
                  {igIcon('M22 2 11 13M22 2 15 22 11 13 2 9l20-7z')}
                  <div className="flex-1"/>
                  {igIcon('M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z')}
                </div>
                <div className="px-3 pt-1.5 pb-3">
                  <div className="text-white text-[11px] font-semibold">128 Me gusta</div>
                  <div className="text-white text-[12px] leading-snug mt-0.5"><span className="font-semibold">{account}</span> {caption}</div>
                </div>
              </div>
            )}

            {/* Reel */}
            {editContentType === 'reel' && (
              <div className="relative rounded-2xl overflow-hidden mx-auto" style={{width:'200px',aspectRatio:'9/16',background:media?'#000':'linear-gradient(180deg,#1a0030,#000)',border:'1px solid rgba(255,255,255,0.15)'}}>
                {media && <img src={media} alt="" className="absolute inset-0 w-full h-full object-cover" style={{opacity:0.82}}/>}
                <div className="absolute top-3 left-3 right-3 flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full overflow-hidden flex-shrink-0 flex items-center justify-center" style={{background:'linear-gradient(45deg,#f09433,#dc2743,#bc1888)',padding:'1.5px'}}>
                    <div className="w-full h-full rounded-full overflow-hidden flex items-center justify-center" style={{background:'#111'}}>
                      {accountLogoUrl ? <img src={accountLogoUrl} alt={initial} className="w-full h-full object-cover"/> : <span className="font-figtree font-black text-white text-[9px]">{initial}</span>}
                    </div>
                  </div>
                  <span className="font-figtree text-[10px] font-bold text-white flex-1 truncate">{account}</span>
                  <button className="font-syne text-[8px] font-black px-2.5 py-1 rounded-full" style={{border:'1px solid rgba(255,255,255,0.6)',color:'white'}}>Seguir</button>
                  <span className="text-white text-[16px] leading-none">···</span>
                </div>
                {!media && <div className="absolute inset-0 flex items-center justify-center p-6">
                  {accountLogoUrl ? <img src={accountLogoUrl} alt={initial} className="w-16 h-16 rounded-2xl object-cover opacity-80"/> : <div className="w-16 h-16 rounded-2xl flex items-center justify-center opacity-50" style={{background:'rgba(255,255,255,0.08)'}}><span className="font-figtree font-black text-white text-[32px]">{initial}</span></div>}
                </div>}
                <div className="absolute right-3 bottom-20 flex flex-col items-center gap-4">
                  <div className="flex flex-col items-center gap-0.5">{igIcon('M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1L12 21l7.7-7.6 1.1-1a5.5 5.5 0 0 0 0-7.8z')}<span className="font-figtree text-white text-[10px]">1.2K</span></div>
                  <div className="flex flex-col items-center gap-0.5">{igIcon('M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z')}<span className="font-figtree text-white text-[10px]">58</span></div>
                  {igIcon('M22 2 11 13M22 2 15 22 11 13 2 9l20-7z')}
                  <div className="w-7 h-7 rounded-md border-2 border-white/60 overflow-hidden flex items-center justify-center" style={{background:'#111'}}>
                    {accountLogoUrl ? <img src={accountLogoUrl} alt="" className="w-full h-full object-cover"/> : <span className="font-figtree font-black text-white text-[8px]">{initial}</span>}
                  </div>
                </div>
                <div className="absolute bottom-0 left-0 right-14 px-3 pb-4" style={{background:'linear-gradient(to top,rgba(0,0,0,0.8) 0%,transparent 100%)'}}>
                  <p className="font-figtree text-white text-[12px] font-bold truncate">@{account}</p>
                  <p className="font-figtree text-white/80 text-[11px] leading-snug mt-0.5 line-clamp-2">{caption || 'Caption del reel…'}</p>
                  <div className="flex items-center gap-1 mt-1.5">
                    <span className="text-[12px]">🎵</span>
                    <span className="font-figtree text-white/60 text-[10px] truncate">Audio original · {account}</span>
                  </div>
                </div>
                <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{background:'rgba(255,255,255,0.15)'}}>
                  <div className="h-full w-1/3" style={{background:'white'}}/>
                </div>
              </div>
            )}

            {/* Story */}
            {editContentType === 'story' && (
              <div className="relative rounded-2xl overflow-hidden mx-auto" style={{width:'200px',aspectRatio:'9/16',background:media?'#000':'linear-gradient(160deg,#833AB4,#FD1D1D,#FCAF45)',border:'1px solid rgba(255,255,255,0.15)'}}>
                {media && <img src={media} alt="" className="absolute inset-0 w-full h-full object-cover" style={{opacity:0.88}}/>}
                <div className="absolute top-2.5 left-2.5 right-2.5 flex gap-1">
                  {[1,2,3,4,5].map((b,i) => (
                    <div key={b} className="flex-1 h-0.5 rounded-full overflow-hidden" style={{background:'rgba(255,255,255,0.35)'}}>
                      {i === 0 && <div className="h-full w-2/3" style={{background:'white'}}/>}
                    </div>
                  ))}
                </div>
                <div className="absolute top-6 left-2.5 right-2.5 flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0 flex items-center justify-center" style={{background:'linear-gradient(45deg,#f09433,#dc2743,#bc1888)',padding:'1.5px'}}>
                    <div className="w-full h-full rounded-full overflow-hidden flex items-center justify-center" style={{background:'#111'}}>
                      {accountLogoUrl ? <img src={accountLogoUrl} alt={initial} className="w-full h-full object-cover"/> : <span className="font-figtree font-black text-white text-[11px]">{initial}</span>}
                    </div>
                  </div>
                  <span className="font-figtree text-white text-[11px] font-semibold flex-1 truncate">{account}</span>
                  <span className="text-white/70 text-[11px]">2h</span>
                  <span className="text-white text-[18px] leading-none">✕</span>
                </div>
                {!media && <div className="absolute inset-0 flex items-center justify-center p-8">
                  <p className="font-figtree text-white text-[14px] font-semibold text-center leading-relaxed">{caption || 'Texto de la story…'}</p>
                </div>}
                <div className="absolute bottom-4 left-3 right-3 flex items-center gap-2">
                  <div className="flex-1 flex items-center px-3 py-2 rounded-full" style={{background:'rgba(255,255,255,0.15)',border:'1px solid rgba(255,255,255,0.3)'}}>
                    <span className="font-figtree text-white/60 text-[11px] flex-1">Envía un mensaje</span>
                  </div>
                  <span className="text-[20px]">❤️</span>
                  {igIcon('M22 2 11 13M22 2 15 22 11 13 2 9l20-7z')}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Live copy editor */}
      <div className="mt-3">
        <textarea
          value={caption}
          onChange={e => setBocetoCaption(e.target.value)}
          rows={2}
          placeholder="Escribe el copy del post — se actualiza en el boceto…"
          className="w-full px-3 py-2.5 rounded-xl text-[12px] text-white placeholder-white/20 outline-none resize-none"
          style={{background:'rgba(255,255,255,0.03)',border:'1.5px solid rgba(255,255,255,0.07)',caretColor:BLU,lineHeight:'1.5'}}
          onFocus={e => (e.target.style.borderColor = 'rgba(27,95,250,0.3)')}
          onBlur={e => (e.target.style.borderColor = 'rgba(255,255,255,0.07)')}
        />
        <div className="flex items-center justify-between mt-1.5">
          <span className="font-syne text-[7px]" style={{color:'rgba(255,255,255,0.15)'}}>{caption.length} caracteres · edita para ver cómo queda</span>
          {dirty && (
            <button
              onClick={() => onSaveCopy(caption)}
              className="font-syne text-[7.5px] font-black tracking-widest px-2.5 py-1 rounded-lg transition-all hover:opacity-80"
              style={{background:`${BLU}14`,color:BLU,border:`1px solid ${BLU}28`}}
            >
              GUARDAR COPY
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
