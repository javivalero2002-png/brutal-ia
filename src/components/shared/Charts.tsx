'use client'
import { useId } from 'react'

// Gráficas SVG hechas a mano — solo paths/círculos/gradientes (Safari-safe,
// nada de feTurbulence). Los colores se pasan por props para respetar el tema.

export interface Segment { label: string; count: number; color: string }

// ── Donut ────────────────────────────────────────────────────────────────────
export function Donut({ segments, size = 132, thickness = 16, centerLabel, centerSub }: {
  segments: Segment[]
  size?: number
  thickness?: number
  centerLabel?: string
  centerSub?: string
}) {
  const total = segments.reduce((s, x) => s + x.count, 0)
  const r = (size - thickness) / 2
  const C = 2 * Math.PI * r
  const cx = size / 2
  let offset = 0
  const gap = total > 1 ? 1.5 : 0 // pequeño hueco entre segmentos (en px de arco)

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'block' }}>
      <circle cx={cx} cy={cx} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={thickness} />
      {total > 0 && segments.filter(s => s.count > 0).map((s, i) => {
        const frac = s.count / total
        const len = Math.max(frac * C - gap, 0)
        const dash = `${len} ${C - len}`
        const el = (
          <circle key={i} cx={cx} cy={cx} r={r} fill="none" stroke={s.color} strokeWidth={thickness}
            strokeDasharray={dash} strokeDashoffset={-offset} strokeLinecap="round"
            transform={`rotate(-90 ${cx} ${cx})`} style={{ transition: 'stroke-dasharray 0.6s ease' }} />
        )
        offset += frac * C
        return el
      })}
      {(centerLabel || centerSub) && (
        <>
          <text x={cx} y={cx - (centerSub ? 2 : -5)} textAnchor="middle" fontFamily="system-ui, sans-serif"
            fontWeight="900" fontSize={size * 0.26} fill="#fff" letterSpacing="-0.03em">{centerLabel}</text>
          {centerSub && (
            <text x={cx} y={cx + size * 0.14} textAnchor="middle" fontFamily="sans-serif"
              fontWeight="800" fontSize={size * 0.075} fill="rgba(255,255,255,0.32)" letterSpacing="0.15em">{centerSub}</text>
          )}
        </>
      )}
    </svg>
  )
}

// ── Radial gauge (un solo valor 0-100) ───────────────────────────────────────
export function Gauge({ value, size = 140, thickness = 14, color = '#22c55e', label, sub }: {
  value: number
  size?: number
  thickness?: number
  color?: string
  label?: string
  sub?: string
}) {
  const gid = useId().replace(/:/g, '')
  const v = Math.max(0, Math.min(100, value))
  const r = (size - thickness) / 2
  const C = 2 * Math.PI * r
  const cx = size / 2
  const len = (v / 100) * C

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'block' }}>
      <defs>
        <linearGradient id={`g-${gid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.55" />
          <stop offset="100%" stopColor={color} />
        </linearGradient>
      </defs>
      <circle cx={cx} cy={cx} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={thickness} />
      <circle cx={cx} cy={cx} r={r} fill="none" stroke={`url(#g-${gid})`} strokeWidth={thickness}
        strokeDasharray={`${len} ${C - len}`} strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cx})`} style={{ transition: 'stroke-dasharray 0.7s ease' }} />
      <text x={cx} y={cx + 2} textAnchor="middle" fontFamily="system-ui, sans-serif" fontWeight="900"
        fontSize={size * 0.26} fill="#fff" letterSpacing="-0.04em">{label ?? `${Math.round(v)}%`}</text>
      {sub && (
        <text x={cx} y={cx + size * 0.16} textAnchor="middle" fontFamily="sans-serif" fontWeight="800"
          fontSize={size * 0.07} fill="rgba(255,255,255,0.3)" letterSpacing="0.15em">{sub}</text>
      )}
    </svg>
  )
}

// ── Area sparkline (serie temporal) ──────────────────────────────────────────
export function AreaChart({ values, color = '#1B5FFA', width = 320, height = 64, highlightLast = true }: {
  values: number[]
  color?: string
  width?: number
  height?: number
  highlightLast?: boolean
}) {
  const gid = useId().replace(/:/g, '')
  const n = values.length
  const max = Math.max(...values, 1)
  const pad = 6
  const w = width, h = height
  const x = (i: number) => n <= 1 ? w / 2 : pad + (i * (w - pad * 2)) / (n - 1)
  const y = (val: number) => h - pad - (val / max) * (h - pad * 2)
  const pts = values.map((v, i) => [x(i), y(v)] as const)
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
  const area = `${line} L${x(n - 1).toFixed(1)},${h - pad} L${x(0).toFixed(1)},${h - pad} Z`

  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: 'block' }}>
      <defs>
        <linearGradient id={`a-${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#a-${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {highlightLast && n > 0 && (
        <circle cx={x(n - 1)} cy={y(values[n - 1])} r={3.5} fill={color} stroke="#0C0C15" strokeWidth={2} />
      )}
    </svg>
  )
}
