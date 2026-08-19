'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { BLU, GRN, AMBAR, SURFACE, BORDER } from '@/components/shared/design-tokens'
import LucideIcon from '@/components/shared/LucideIcon'
import { todayKey, localDayKey } from '@/components/shared/helpers'

// ─────────────────────────────────────────────────────────────────────────────
// LA SEMANA, en grande y siempre delante.
//
// El calendario del Diario vivía dentro de un modal, así que para ver cómo venía
// la semana había que abrirlo, mirar y cerrarlo. Y eso es justo lo contrario de
// para lo que sirve: el valor de planificar está en tener el plano DELANTE
// mientras escribes, no en consultarlo.
//
// Se enseña de lunes a domingo entera —incluidos los días que aún no han
// llegado—, porque el objetivo es ver lo que VIENE. Cada día dice de un vistazo
// si alguien escribió algo, cuántos objetivos hay y quién estuvo.
// ─────────────────────────────────────────────────────────────────────────────

interface Persona { id: string; name?: string; initials?: string; avatar_color?: string }
interface DiaResumen { personas: Persona[]; objetivos: number; cerrados: number }

const DIAS = ['L', 'M', 'X', 'J', 'V', 'S', 'D']
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/**
 * El LUNES de la semana a la que pertenece una clave de día.
 *
 * Ancla a mediodía UTC antes de mover, como el resto de la app: a esa hora Madrid
 * va por la tarde, así que ni el cambio de hora ni el desfase de zona pueden
 * hacer que se salte o repita un día.
 */
function lunesDe(clave: string): string {
  const d = new Date(`${clave}T12:00:00Z`)
  // getUTCDay(): 0 es domingo. Se convierte a «cuántos días han pasado desde el
  // lunes», que con domingo son 6 y no 0 — el fallo clásico de esta cuenta.
  const desdeLunes = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - desdeLunes)
  return localDayKey(d)
}

function sumar(clave: string, n: number): string {
  const d = new Date(`${clave}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return localDayKey(d)
}

export default function SemanaDiario({
  diaSeleccionado, onElegirDia, onAbrirMes, demo, isMobile, miId,
}: {
  diaSeleccionado: string
  onElegirDia: (dia: string) => void
  /** Para la racha: es MÍA, no un ranking. Ver `racha`. */
  miId?: string
  /** Abre el calendario mensual, para cuando hace falta ir más lejos. */
  onAbrirMes?: () => void
  /** En /preview no hay sesión: días de muestra en vez de llamar a la red. */
  demo?: Record<string, DiaResumen>
  isMobile?: boolean
}) {
  const hoy = todayKey()
  const [lunes, setLunes] = useState(() => lunesDe(diaSeleccionado))
  const [dias, setDias] = useState<Record<string, DiaResumen>>({})

  // Si eligen un día de otra semana (por el calendario mensual o las flechas), la
  // tira se mueve con él: si no, quedaría enseñando una semana que no es la del
  // día que estás editando.
  useEffect(() => { setLunes(lunesDe(diaSeleccionado)) }, [diaSeleccionado])

  const fechas = useMemo(() => Array.from({ length: 7 }, (_, i) => sumar(lunes, i)), [lunes])

  const cargar = useCallback(async () => {
    if (demo) { setDias(demo); return }
    // Una semana puede tocar DOS meses (la del 28 de agosto al 3 de septiembre),
    // y la ruta devuelve un mes. Se piden los dos y se juntan; cuando la semana
    // cae dentro de uno solo, el Set deja una sola petición.
    const meses = [...new Set(fechas.map(f => f.slice(0, 7)))]
    try {
      const partes = await Promise.all(meses.map(m => fetch(`/api/diario/mes?mes=${m}`).then(r => (r.ok ? r.json() : null))))
      const junto: Record<string, DiaResumen> = {}
      // `.dias`, no `p`: la ruta responde { mes, dias }, así que fusionar el objeto
      // entero dejaba `junto` con las claves «mes» y «dias» y NINGUNA clave de día.
      // La tira salía muda —sin iniciales, sin contador, con la racha clavada en 0—
      // y solo en producción: en /preview la rama demo se salta este fetch. El
      // gemelo bueno estaba a diez ficheros (CalendarioDiario: `setDias(j.dias || {})`).
      for (const p of partes) if (p && typeof p === 'object') Object.assign(junto, p.dias || {})
      setDias(junto)
    } catch { /* silencioso: la tira sigue navegable sin los resúmenes */ }
  }, [fechas, demo])

  useEffect(() => { cargar() }, [cargar])

  /**
   * Mi racha: días LABORABLES seguidos escribiendo el diario.
   *
   * Es personal y solo mía, no una tabla comparativa en Equipo. En un estudio de
   * siete personas que se conocen, un contador público de rachas convierte una
   * herramienta de hábito en un marcador, y romperla pasa a ser un pequeño
   * fracaso delante de los demás. La señal que necesita un jefe —quién no lo está
   * usando— ya existe en Reportes, y ahí sí tiene sentido.
   *
   * Los fines de semana se SALTAN, no se cuentan ni la rompen: aquí se trabaja de
   * lunes a viernes, y una racha que muere cada sábado no mide nada.
   *
   * Se cuenta hacia atrás desde hoy; si hoy aún no has escrito, se empieza en
   * ayer — para que la racha de ayer no desaparezca a las nueve de la mañana.
   */
  const racha = useMemo(() => {
    if (!miId) return 0
    const estuve = (f: string) => (dias[f]?.personas || []).some(p => p.id === miId)
    let cursor = estuve(hoy) ? hoy : sumar(hoy, -1)
    let n = 0
    // 60 vueltas: la lista solo cubre el mes o dos que se han pedido, así que la
    // racha se corta sola al salirse de los datos. El tope es por seguridad.
    for (let i = 0; i < 60; i++) {
      const d = new Date(`${cursor}T12:00:00Z`).getUTCDay()
      if (d === 0 || d === 6) { cursor = sumar(cursor, -1); continue }
      if (!estuve(cursor)) break
      n++
      cursor = sumar(cursor, -1)
    }
    return n
  }, [dias, miId, hoy])

  const etiqueta = (() => {
    const a = new Date(`${fechas[0]}T12:00:00Z`), b = new Date(`${fechas[6]}T12:00:00Z`)
    const mismoMes = a.getUTCMonth() === b.getUTCMonth()
    return mismoMes
      ? `${a.getUTCDate()}–${b.getUTCDate()} de ${MESES[a.getUTCMonth()]}`
      : `${a.getUTCDate()} ${MESES[a.getUTCMonth()].slice(0, 3)} – ${b.getUTCDate()} ${MESES[b.getUTCMonth()].slice(0, 3)}`
  })()

  const estaSemana = lunes === lunesDe(hoy)

  return (
    <div className="rounded-3xl mb-4 overflow-hidden" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
      <div className="flex items-center gap-2 px-4 pt-3.5 pb-3 flex-wrap">
        <LucideIcon name="calendar" size={14} color={BLU} />
        <div className="font-syne text-[9px] font-black tracking-widest" style={{ color: BLU }}>LA SEMANA</div>
        <div className="font-figtree text-[12.5px] flex-1 min-w-0" style={{ color: 'rgba(255,255,255,0.45)' }}>{etiqueta}</div>
        {/* Solo a partir de DOS: «1 día seguido» no es una racha, es un día. */}
        {racha >= 2 && (
          <span className="flex items-center gap-1 px-2.5 py-1 rounded-full font-syne text-[7.5px] font-black tracking-widest flex-shrink-0"
            style={{ background: `${AMBAR}16`, border: `1px solid ${AMBAR}33`, color: AMBAR }}
            title="Días laborables seguidos escribiendo tu diario">
            <LucideIcon name="flame" size={10} color={AMBAR} />
            {racha} SEGUIDOS
          </span>
        )}

        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={() => setLunes(sumar(lunes, -7))} aria-label="Semana anterior"
            className="w-7 h-7 flex items-center justify-center rounded-lg transition-opacity hover:opacity-70">
            <LucideIcon name="chevron-left" size={13} color="rgba(255,255,255,0.45)" />
          </button>
          {!estaSemana && (
            <button onClick={() => { setLunes(lunesDe(hoy)); onElegirDia(hoy) }}
              className="px-2.5 py-1 rounded-lg font-syne text-[8px] font-black tracking-widest"
              style={{ background: `${BLU}18`, color: BLU }}>ESTA SEMANA</button>
          )}
          {/* Hacia adelante SIN tope: la tira existe para ver lo que viene. */}
          <button onClick={() => setLunes(sumar(lunes, 7))} aria-label="Semana siguiente"
            className="w-7 h-7 flex items-center justify-center rounded-lg transition-opacity hover:opacity-70">
            <LucideIcon name="chevron-right" size={13} color="rgba(255,255,255,0.45)" />
          </button>
          {onAbrirMes && (
            <button onClick={onAbrirMes} aria-label="Ver el mes"
              className="w-7 h-7 flex items-center justify-center rounded-lg transition-opacity hover:opacity-70"
              style={{ background: 'rgba(255,255,255,0.04)' }}>
              <LucideIcon name="layout-grid" size={12} color="rgba(255,255,255,0.4)" />
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-1.5 px-3 pb-3.5" style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}>
        {fechas.map((f, i) => {
          const r = dias[f]
          const gente = r?.personas ?? []
          const esHoy = f === hoy
          const elegido = f === diaSeleccionado
          const pasado = f < hoy
          const futuro = f > hoy
          const todosCerraron = !!r && r.cerrados === gente.length && gente.length > 0

          return (
            <button key={f} onClick={() => onElegirDia(f)}
              aria-label={`${DIAS[i]} ${f.slice(8)}`}
              aria-current={elegido ? 'date' : undefined}
              className="flex flex-col items-center gap-1 rounded-2xl transition-all active:scale-[0.97]"
              style={{
                padding: isMobile ? '7px 2px 8px' : '9px 4px 10px',
                // El día ELEGIDO se marca con borde, HOY con fondo. Son dos cosas
                // distintas y suelen no coincidir: si se marcaran igual, mirar el
                // jueves haría creer que hoy es jueves.
                background: elegido ? `${BLU}1E` : esHoy ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.02)',
                border: `1px solid ${elegido ? `${BLU}66` : esHoy ? 'rgba(255,255,255,0.14)' : BORDER}`,
                // Los futuros NO se apagan: son el motivo de que esto exista.
                opacity: pasado && !elegido ? 0.55 : 1,
              }}>
              <span className="font-syne text-[7.5px] font-black tracking-widest"
                style={{ color: elegido ? BLU : esHoy ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.28)' }}>
                {DIAS[i]}
              </span>
              <span className="font-figtree font-black leading-none"
                style={{ fontSize: isMobile ? '14px' : '17px', color: elegido || esHoy ? 'white' : 'rgba(255,255,255,0.6)' }}>
                {Number(f.slice(8))}
              </span>

              {/* Quién estuvo. Iniciales y no un número: «3 personas» obliga a
                  entrar a mirar quiénes, tres iniciales se leen sin pensar. */}
              <div className="flex items-center justify-center" style={{ height: '14px' }}>
                {gente.length > 0 ? (
                  <div className="flex" style={{ marginLeft: gente.length > 1 ? '3px' : 0 }}>
                    {gente.slice(0, 3).map((p, k) => (
                      <span key={p.id ?? k}
                        className="flex items-center justify-center rounded-full font-figtree font-black"
                        style={{
                          width: '13px', height: '13px', fontSize: '6.5px', color: '#06060E',
                          background: p.avatar_color || BLU, marginLeft: k ? '-3px' : 0,
                          border: '1px solid #0A0A14',
                        }}>{(p.initials || p.name?.[0] || '·').slice(0, 2)}</span>
                    ))}
                    {gente.length > 3 && (
                      <span className="font-figtree text-[7px] self-center ml-0.5" style={{ color: 'rgba(255,255,255,0.35)' }}>+{gente.length - 3}</span>
                    )}
                  </div>
                ) : (
                  // Un punto tenue en vez de un hueco: sin él, los días vacíos
                  // parecen rotos en lugar de vacíos.
                  <span className="rounded-full" style={{ width: '3px', height: '3px', background: futuro ? `${BLU}55` : 'rgba(255,255,255,0.1)' }} />
                )}
              </div>

              {r && r.objetivos > 0 && (
                <span className="font-syne text-[7px] font-black tracking-wide"
                  style={{ color: todosCerraron ? GRN : futuro ? BLU : AMBAR }}>
                  {r.objetivos}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
