'use client'
import { useState } from 'react'
import { BLU, SURFACE, SURF2, BORDER } from './design-tokens'
import LucideIcon from './LucideIcon'

export function AjGroup({ label, color='rgba(255,255,255,0.3)', defaultOpen=true, extra, children }: { label:string; color?:string; defaultOpen?:boolean; extra?:React.ReactNode; children:React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <div className="flex items-center gap-3 mb-4 cursor-pointer select-none" onClick={()=>setOpen(o=>!o)}>
        <span className="font-syne text-[8.5px] font-black tracking-[0.25em]" style={{color}}>{label}</span>
        <div className="flex-1 h-px" style={{background:BORDER}}/>
        {extra && <span onClick={e=>e.stopPropagation()}>{extra}</span>}
        <LucideIcon name={open?'chevron-up':'chevron-down'} size={12} color="rgba(255,255,255,0.25)"/>
      </div>
      {open && <div>{children}</div>}
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
