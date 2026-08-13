import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { nivelTarea, NIVELES_TAREA } from '@/components/shared/helpers'

// ─────────────────────────────────────────────────────────────────────────────
// El contrato entre el hook de datos y las secciones.
//
// Durante meses las 16 secciones recibieron sus props como `any`. Con eso,
// cuando useNexusData y una sección divergían, `tsc` no veía NADA: te enterabas
// cuando reventaba en pantalla. Así se colaron ocho métodos sin implementar en
// /preview, y así vivió cada pareja de bugs idénticos que se arreglaba en una
// copia y seguía viva en la otra.
//
// Este test no comprueba qué pinta cada sección: fija la REGLA. Una sección
// nueva que reciba `data` sin tiparlo pone el build en rojo, sin que nadie
// tenga que acordarse de mirarlo en la revisión.
// ─────────────────────────────────────────────────────────────────────────────

const DIR = 'src/components/sections'
const secciones = readdirSync(DIR).filter(f => f.endsWith('.tsx'))
const leer = (f: string) => readFileSync(join(DIR, f), 'utf8')

describe('contrato de datos de las secciones', () => {
  it('hay secciones que revisar (el test no se ha quedado sin objetivo)', () => {
    expect(secciones.length).toBeGreaterThan(10)
  })

  it('ninguna sección declara sus props como `any`', () => {
    const culpables = secciones.filter(f => /\)\s*:\s*any\s*\)\s*\{/.test(leer(f)) || /\}:\s*any\)/.test(leer(f)))
    expect(culpables, `Declaran props como any: ${culpables.join(', ')}`).toEqual([])
  })

  it('toda sección que recibe `data` lo tipa con NexusData', () => {
    const fallan = secciones.filter(f => {
      const src = leer(f)
      // ¿Desestructura `data` en la firma del componente?
      const firma = src.match(/^(?:export default )?function \w+\(\{([^}]*)\}/m)
      if (!firma) return false
      const props = firma[1].split(',').map(p => p.trim())
      if (!props.includes('data')) return false
      return !/\bdata:\s*NexusData\b/.test(src)
    })
    expect(fallan, `Reciben \`data\` sin tiparlo: ${fallan.join(', ')}`).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// El nivel de una tarea creada por Harvey.
//
// Harvey emite [ACCION:tarea|texto|nivel|persona] y ese `nivel` es literalmente
// lo que haya escrito el modelo. El prompt le pide «urgent, high, normal» en
// inglés dentro de una conversación entera en español, y `tasks.level` tiene
// CHECK (level in ('urgent','high','normal')): cualquier otra cosa hace que el
// INSERT rebote y la tarea NO se cree — después de que Harvey haya dicho en voz
// alta que la creaba.
//
// Estaba sin validar en las dos secciones que confirman la acción, y en HoySection
// el error de tipo estaba tapado con `as any`.
// ─────────────────────────────────────────────────────────────────────────────

describe('nivelTarea — lo que escribe el modelo nunca llega crudo a la base', () => {
  it('deja pasar los tres válidos', () => {
    for (const n of NIVELES_TAREA) expect(nivelTarea(n)).toBe(n)
  })

  it('traduce lo que el modelo escribe en español', () => {
    expect(nivelTarea('urgente')).toBe('urgent')
    expect(nivelTarea('crítica')).toBe('urgent')
    expect(nivelTarea('alta')).toBe('high')
    expect(nivelTarea('importante')).toBe('high')
    expect(nivelTarea('media')).toBe('normal')
    expect(nivelTarea('baja')).toBe('normal')
  })

  it('no le importan mayúsculas ni espacios de más', () => {
    expect(nivelTarea('  URGENTE ')).toBe('urgent')
    expect(nivelTarea('Normal')).toBe('normal')
  })

  it('cae en «high» con lo vacío o lo irreconocible, nunca en algo que rompa el CHECK', () => {
    for (const raro of ['', '   ', null, undefined, 'muy importante ya', '3', 'P1', '🔥']) {
      expect(NIVELES_TAREA).toContain(nivelTarea(raro as string))
    }
    expect(nivelTarea(undefined)).toBe('high')
  })
})
