'use client'
import { useState, useEffect, useCallback } from 'react'
import { BLU, GRN, VIO, SURFACE, BORDER } from '@/components/shared/design-tokens'
import LucideIcon from '@/components/shared/LucideIcon'
import { todayKey, localDayKey } from '@/components/shared/helpers'

// ─────────────────────────────────────────────────────────────────────────────
// El calendario del Diario. No es el de Google: este solo sabe de fichajes.
//
// Para qué sirve, que es lo que decide su forma: mirar un mes y ver de un vistazo
// quién estuvo cada día. Por eso cada celda lleva los avatares de quien fichó —no
// un número— y por eso el día se distingue entre «nadie fichó» y «fichó gente y
// además cerró el día».
//
// Un número («3 personas») obligaría a entrar a mirar quiénes. Tres iniciales de
// colores se leen sin pensar, y a siete personas caben.
// ─────────────────────────────────────────────────────────────────────────────

interface Persona { id: string; name?: string; initials?: string; avatar_color?: string }
interface DiaResumen { personas: Persona[]; objetivos: number; cerrados: number }

const DIAS_SEMANA = ['L', 'M', 'X', 'J', 'V', 'S', 'D']

/** El lunes de la semana en que cae el día 1. La app trabaja de lunes a viernes. */
function celdasDelMes(mes: string): (string | null)[] {
  const [a, m] = mes.split('-').map(Number)
  const primero = new Date(Date.UTC(a, m - 1, 1, 12))
  // getUTCDay: 0=domingo. Se convierte a 0=lunes, que es como se lee un mes aquí.
  const hueco = (primero.getUTCDay() + 6) % 7
  const ultimo = new Date(Date.UTC(a, m, 0, 12)).getUTCDate()
  const celdas: (string | null)[] = Array(hueco).fill(null)
  for (let d = 1; d <= ultimo; d++) {
    celdas.push(localDayKey(new Date(Date.UTC(a, m - 1, d, 12))))
  }
  return celdas
}

const NOMBRE_MES = (mes: string) =>
  new Date(`${mes}-01T12:00:00Z`).toLocaleDateString('es-ES', { month: 'long', year: 'numeric', timeZone: 'Europe/Madrid' })

const moverMes = (mes: string, n: number) => {
  const [a, m] = mes.split('-').map(Number)
  const d = new Date(Date.UTC(a, m - 1 + n, 1, 12))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export default function CalendarioDiario({
  diaSeleccionado, onElegirDia, demo,
}: {
  diaSeleccionado: string
  onElegirDia: (dia: string) => void
  /**
   * En /preview no hay sesión. Se pasan días de muestra en vez de llamar a la red:
   * un calendario vacío no enseñaría lo único que lo hace útil, que son los
   * avatares de quién estuvo cada día.
   */
  demo?: Record<string, DiaResumen>
}) {
  const [mes, setMes] = useState(() => diaSeleccionado.slice(0, 7))
  const [dias, setDias] = useState<Record<string, DiaResumen>>({})
  const [cargando, setCargando] = useState(false)
  const hoy = todayKey()

  const cargar = useCallback(async (m: string) => {
    if (demo) { setDias(demo); return }
    setCargando(true)
    try {
      const res = await fetch(`/api/diario/mes?mes=${m}`)
      if (!res.ok) return
      const j = await res.json()
      setDias(j.dias || {})
    } catch { /* el calendario sin datos sigue sirviendo para navegar */ }
    finally { setCargando(false) }
  }, [demo])

  useEffect(() => { cargar(mes) }, [mes, cargar])

  return (
    <div className="rounded-3xl overflow-hidden" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
      <div className="flex items-center gap-2 px-4 pt-3.5 pb-3">
        <LucideIcon name="calendar" size={13} color={VIO} />
        <div className="font-syne text-[9px] font-black tracking-widest flex-1" style={{ color: VIO }}>
          {NOMBRE_MES(mes).toUpperCase()}
        </div>
        {cargando && <span className="font-syne text-[7px] font-black tracking-widest" style={{ color: 'rgba(255,255,255,0.25)' }}>…</span>}
        <button onClick={() => setMes(m => moverMes(m, -1))} aria-label="Mes anterior"
          className="w-7 h-7 rounded-lg flex items-center justify-center transition-opacity hover:opacity-70"
          style={{ background: 'rgba(255,255,255,0.04)' }}>
          <LucideIcon name="chevron-left" size={12} color="rgba(255,255,255,0.45)" />
        </button>
        <button onClick={() => setMes(m => moverMes(m, 1))} aria-label="Mes siguiente"
          disabled={mes >= hoy.slice(0, 7)}
          className="w-7 h-7 rounded-lg flex items-center justify-center transition-opacity hover:opacity-70 disabled:opacity-20"
          style={{ background: 'rgba(255,255,255,0.04)' }}>
          <LucideIcon name="chevron-right" size={12} color="rgba(255,255,255,0.45)" />
        </button>
      </div>

      <div className="grid px-3 pb-1" style={{ gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px' }}>
        {DIAS_SEMANA.map(d => (
          <div key={d} className="text-center font-syne text-[7.5px] font-black tracking-widest py-1"
            style={{ color: 'rgba(255,255,255,0.22)' }}>{d}</div>
        ))}
      </div>

      <div className="grid px-3 pb-3" style={{ gridTemplateColumns: 'repeat(7, 1fr)', gap: '3px' }}>
        {celdasDelMes(mes).map((clave, i) => {
          if (!clave) return <div key={`h${i}`} />
          const resumen = dias[clave]
          const gente = resumen?.personas ?? []
          const esHoy = clave === hoy
          const elegido = clave === diaSeleccionado
          const futuro = clave > hoy
          const todosCerraron = !!resumen && resumen.cerrados === gente.length && gente.length > 0

          return (
            <button key={clave} onClick={() => !futuro && onElegirDia(clave)} disabled={futuro}
              aria-label={`${clave}${gente.length ? ` · ${gente.length} fichajes` : ''}`}
              aria-current={elegido ? 'date' : undefined}
              className="rounded-xl flex flex-col items-center justify-center gap-1 py-1.5 transition-all active:scale-95 disabled:active:scale-100"
              style={{
                minHeight: '2.9rem',
                background: elegido ? `${VIO}24` : gente.length ? 'rgba(255,255,255,0.035)' : 'transparent',
                border: `1px solid ${elegido ? VIO + '55' : esHoy ? BLU + '40' : 'transparent'}`,
                opacity: futuro ? 0.25 : 1,
              }}>
              <span className="font-figtree text-[11px] leading-none"
                style={{ color: elegido ? '#E6DEFF' : esHoy ? BLU : 'rgba(255,255,255,0.55)', fontWeight: esHoy || elegido ? 700 : 400 }}>
                {Number(clave.slice(8))}
              </span>
              {/* Quién estuvo. Tres avatares y un «+N»: más no se leen a este tamaño. */}
              {gente.length > 0 && (
                <span className="flex items-center" style={{ marginLeft: '2px' }}>
                  {gente.slice(0, 3).map((p, k) => (
                    <span key={p?.id || k} title={p?.name}
                      className="rounded-full flex items-center justify-center font-syne font-black"
                      style={{
                        width: '13px', height: '13px', fontSize: '6px', marginLeft: '-2px',
                        background: `${p?.avatar_color || BLU}`, color: '#05050C',
                        border: `1px solid ${todosCerraron ? GRN : 'rgba(5,5,12,0.9)'}`,
                      }}>
                      {(p?.initials || p?.name || '?').slice(0, 1).toUpperCase()}
                    </span>
                  ))}
                  {gente.length > 3 && (
                    <span className="font-syne text-[6px] font-black ml-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                      +{gente.length - 3}
                    </span>
                  )}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div className="flex items-center gap-3 px-4 pb-3 flex-wrap">
        <span className="flex items-center gap-1.5 font-figtree text-[9.5px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
          <span className="w-2.5 h-2.5 rounded-full" style={{ border: `1px solid ${BLU}80` }} /> hoy
        </span>
        <span className="flex items-center gap-1.5 font-figtree text-[9.5px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: `${GRN}66` }} /> día cerrado
        </span>
      </div>
    </div>
  )
}
