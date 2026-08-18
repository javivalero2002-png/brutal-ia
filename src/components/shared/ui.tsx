'use client'
import { useState } from 'react'
import { BLU, SURFACE, SURF2, BORDER } from './design-tokens'
import LucideIcon from './LucideIcon'

export function AjGroup({ label, defaultOpen=true, extra, children }: { label:string; defaultOpen?:boolean; extra?:React.ReactNode; children:React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    // Misma forma que AjCard, que es lo que usa Ajustes: una tarjeta, no una
    // etiqueta con una raya. Eran dos maneras de decir «sección plegable» en la
    // misma pantalla, y la de aquí parecía inacabada al lado de la otra.
    // AjGroup se conserva —y no se sustituye por AjCard— porque admite `extra`,
    // que es donde va el «33 % CONECTADO».
    <div style={{background:SURFACE,border:`1px solid ${BORDER}`,borderRadius:'16px',overflow:'hidden'}}>
      <button onClick={()=>setOpen(o=>!o)} className="w-full flex items-center gap-3 px-6 py-4 transition-colors hover:bg-white/2">
        <span className="font-syne text-[9px] font-black tracking-[0.2em] flex-1 text-left" style={{color:open?'rgba(255,255,255,0.4)':'rgba(255,255,255,0.22)'}}>{label}</span>
        {extra && <span onClick={e=>e.stopPropagation()}>{extra}</span>}
        <LucideIcon name={open?'chevron-up':'chevron-down'} size={13} color="rgba(255,255,255,0.25)"/>
      </button>
      {open && <div className="px-6 pb-6">{children}</div>}
    </div>
  )
}

export function AjCard({ title, defaultOpen=true, children }: { title:string; defaultOpen?:boolean; children:React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{background:SURFACE,border:`1px solid ${BORDER}`,borderRadius:'16px',overflow:'hidden'}}>
      <button onClick={()=>setOpen(o=>!o)} className="w-full flex items-center justify-between px-6 py-4 transition-colors hover:bg-white/2">
        <span className="font-syne text-[9px] font-black tracking-[0.2em]" style={{color:open?'rgba(255,255,255,0.4)':'rgba(255,255,255,0.22)'}}>{title}</span>
        <LucideIcon name={open?'chevron-up':'chevron-down'} size={13} color="rgba(255,255,255,0.25)"/>
      </button>
      {open && <div className="px-6 pb-6">{children}</div>}
    </div>
  )
}

// Imagen que se auto-oculta si la URL está rota (p.ej. cover_url corrupto apuntando a un PDF).
// Evita el icono de "imagen rota" del navegador. Lazy-load por defecto.
export function SafeImg({ src, alt='', className, style, onErrorHide }: { src?:string|null; alt?:string; className?:string; style?:React.CSSProperties; onErrorHide?:()=>void }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) return null
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} className={className} style={style} loading="lazy" decoding="async"
      onError={()=>{ setFailed(true); onErrorHide?.() }}/>
  )
}

export function ProgressRing({ pct, size=52, stroke=3, color=BLU }: { pct:number, size?:number, stroke?:number, color?:string }) {
  const r = (size - stroke * 2) / 2
  const c = 2 * Math.PI * r
  const dash = Math.max(0, Math.min(1, pct / 100)) * c
  return (
    <svg width={size} height={size} style={{transform:'rotate(-90deg)',flexShrink:0}}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={stroke}/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={`${dash} ${c}`} strokeLinecap="round"/>
    </svg>
  )
}
