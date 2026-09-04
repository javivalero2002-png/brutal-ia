import { todayKey } from '@/components/shared/helpers'

// ─────────────────────────────────────────────────────────────────────────────
// LA PARRILLA DE UNA CAMPAÑA
//
// Javi: «el apartado de campañas no aporta valor real. Quiero que aporte un valor
// distintivo, algo que lo haga diferente y único».
//
// Tenía razón: Campañas era Proyectos con otro nombre — misma ficha, mismo
// tablero, y una barra de progreso que alguien arrastra a mano. En una entrega eso
// significa algo; en una campaña no significa nada.
//
// Lo que la hace distinta de un tablero, de Later o de Trello es esto: EL HUECO
// EXISTE ANTES QUE LA PIEZA. Se escribe una vez lo que se promete —«3 salidas por
// semana durante 6 semanas»— y a partir de ahí «van 11 de 18, y en las semanas que
// ya pasaron faltaron 4» es un hecho, no una impresión. Ninguna herramienta del
// estudio sabe hoy decir eso, porque ninguna sabe qué se prometió.
//
// Todo lo de aquí es PURO y se calcula: no hay tabla de huecos, ni estado que
// mantener. Una parrilla guardada serían doce filas basura por campaña que hay que
// sincronizar cada vez que alguien mueve una fecha — el mismo criterio que ya se
// tomó con `carpeta`: una carpeta vacía simplemente no existe.
// ─────────────────────────────────────────────────────────────────────────────

/** Lo que se prometió. Las tres cosas o ninguna: media promesa no se puede medir. */
export type Compromiso = { empieza: string; semanas: number; salidasSemana: number }

type ConCompromiso = {
  empieza_el?: string | null
  semanas?: number | null
  salidas_semana?: number | null
}

/**
 * El compromiso de una campaña, o `null` si no lo tiene.
 *
 * `null` y no un objeto con ceros: una campaña sin compromiso NO es una campaña
 * que prometió cero: es una campaña que todavía no ha prometido nada, y la
 * pantalla las pinta distinto. Sin la migración aplicada las tres columnas llegan
 * como `undefined` y esto devuelve `null`, así que la campaña se comporta
 * exactamente como hoy.
 */
export function compromisoDe(p: ConCompromiso | null | undefined): Compromiso | null {
  const empieza = p?.empieza_el
  const semanas = Number(p?.semanas)
  const salidas = Number(p?.salidas_semana)
  if (!empieza || !/^\d{4}-\d{2}-\d{2}$/.test(empieza)) return null
  if (!Number.isInteger(semanas) || semanas < 1) return null
  if (!Number.isInteger(salidas) || salidas < 1) return null
  return { empieza, semanas, salidasSemana: salidas }
}

/** Suma días a una clave `YYYY-MM-DD` sin salirse del calendario. */
export const masDias = (clave: string, dias: number): string => {
  // Mediodía UTC: sumar días sobre medianoche cruza el cambio de hora dos veces al
  // año y devuelve el día de antes. Es el mismo cuidado que el resto del repo.
  const d = new Date(`${clave}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

export type Pieza = { id: string; title?: string; status?: string; publish_date?: string | null }

export type Semana = {
  n: number
  desde: string
  hasta: string
  /** Ya terminó: su último día es anterior a hoy. */
  cerrada: boolean
  enCurso: boolean
  piezas: Pieza[]
  emitidas: number
  /**
   * Lo que FALTÓ en una semana cerrada, contando solo lo que salió de verdad.
   *
   * Esto es lo que hace honesto el marcador. Contando «piezas» a secas, una semana
   * con tres borradores que no se publicaron daría cero huecos: la pantalla diría
   * que la semana está llena de trabajo que nadie ha visto. Solo tiene sentido en
   * semanas cerradas — en la de esta semana todavía se puede publicar.
   */
  huecos: number
  /** Lo que queda por cubrir en una semana en curso o futura. No es un fallo. */
  porCubrir: number
}

export type Parrilla = {
  compromiso: Compromiso
  termina: string
  semanas: Semana[]
  prometidas: number
  emitidas: number
  huecos: number
  porCubrir: number
}

/**
 * La parrilla completa: qué se prometió, qué salió y qué falta.
 *
 * `piezas` son las de ESTA campaña (las que tienen su `project_id`). Las que caen
 * fuera de la ventana no se cuentan en ninguna semana pero tampoco se pierden: se
 * devuelven en `fuera` para poder decirlo, porque una pieza de la campaña con
 * fecha fuera del plazo es justo lo que alguien quiere ver.
 */
export function parrilla(c: Compromiso, piezas: Pieza[], hoy: string = todayKey()): Parrilla & { fuera: Pieza[] } {
  const semanas: Semana[] = []
  const usadas = new Set<string>()

  for (let n = 0; n < c.semanas; n++) {
    const desde = masDias(c.empieza, n * 7)
    const hasta = masDias(c.empieza, n * 7 + 6)
    const dentro = piezas.filter(p => {
      const f = (p.publish_date || '').slice(0, 10)
      return f >= desde && f <= hasta
    })
    for (const p of dentro) usadas.add(p.id)
    const emitidas = dentro.filter(p => p.status === 'publicado').length
    // LAS PUBLICADAS PRIMERO dentro de la semana.
    //
    // No es cosmético: la rejilla pinta una casilla por salida prometida y colorea
    // en rojo lo que no salió, así que el número de casillas rojas TIENE que ser
    // `huecos`. Sin ordenar, una semana con [listo, —, —] pintaba dos rojas y el
    // contador decía tres, y ahí es donde el marcador deja de ser verificable. Se
    // vio en el navegador con datos reales, no leyendo el código.
    dentro.sort((a, b) => Number(b.status === 'publicado') - Number(a.status === 'publicado'))
    // Una semana está CERRADA cuando su último día ya pasó. El propio día `hasta`
    // no cuenta como cerrado: todavía se puede publicar. Comparación por DÍA, que
    // es lo que este repo lleva arreglado tres veces (ver CLAUDE.md).
    const cerrada = hasta < hoy
    const enCurso = desde <= hoy && hoy <= hasta
    semanas.push({
      n: n + 1, desde, hasta, cerrada, enCurso, piezas: dentro, emitidas,
      huecos: cerrada ? Math.max(0, c.salidasSemana - emitidas) : 0,
      porCubrir: cerrada ? 0 : Math.max(0, c.salidasSemana - dentro.length),
    })
  }

  return {
    compromiso: c,
    termina: masDias(c.empieza, c.semanas * 7 - 1),
    semanas,
    prometidas: c.semanas * c.salidasSemana,
    emitidas: semanas.reduce((n, s) => n + s.emitidas, 0),
    huecos: semanas.reduce((n, s) => n + s.huecos, 0),
    porCubrir: semanas.reduce((n, s) => n + s.porCubrir, 0),
    fuera: piezas.filter(p => !usadas.has(p.id)),
  }
}

/** «Van 11 de 18 · faltaron 4» — el titular, en un solo sitio. */
export function marcador(p: Parrilla): string {
  const base = `${p.emitidas} de ${p.prometidas}`
  if (p.huecos > 0) return `${base} · faltaron ${p.huecos}`
  if (p.porCubrir > 0) return `${base} · ${p.porCubrir} por cubrir`
  return base
}
