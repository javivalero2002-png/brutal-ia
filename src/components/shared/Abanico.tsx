'use client'
import { SafeImg } from './ui'
import { BORDER } from './design-tokens'

/**
 * Una carpeta pintada como un ABANICO de lo que lleva dentro.
 *
 * El problema que resuelve: la columna «Completado» y la de «Publicado» crecen sin
 * parar, y cada pieza ocupa una tarjeta entera con su portada grande. A las cien
 * piezas es un muro por el que hay que bajar — y justo eso es lo que más se
 * consulta después, para reutilizar o para enseñárselo a alguien.
 *
 * Por qué un abanico y no un icono de carpeta: un icono genérico esconde el
 * contenido y obliga a abrir para saber si es la carpeta que buscas. Tres portadas
 * asomando lo dicen de un vistazo, en el sitio de una línea de texto. Y el orden
 * es el de la lista —lo más reciente delante—, así que el abanico también cuenta
 * qué se hizo lo último.
 *
 * Las que no tienen portada NO se saltan: se pintan con su color, porque un hueco
 * en el abanico mentiría sobre cuántas cosas hay. El número de al lado es la
 * cuenta de verdad, no la de las que se ven.
 */
export function Abanico({ portadas, tam = 34, alRoto }: {
  portadas: { url?: string | null; color?: string }[]
  tam?: number
  alRoto?: (url: string) => void
}) {
  // Tres, y las de más se cuentan pero no se pintan: a partir de ahí el abanico
  // deja de leerse y se convierte en una mancha.
  const visibles = portadas.slice(0, 3)
  if (!visibles.length) return null
  const giro = [-10, 0, 10]
  const desvio = [-tam * 0.3, 0, tam * 0.3]
  return (
    <div className="relative flex-shrink-0" style={{ width: tam * 1.55, height: tam }} aria-hidden>
      {visibles.map((p, i) => {
        // La primera va DELANTE: el z-index se invierte respecto al orden de
        // pintado para que lo más reciente quede encima.
        const z = visibles.length - i
        return (
          <div key={i} className="absolute top-0 left-1/2 rounded-[3px] overflow-hidden"
            style={{
              width: tam * 0.72, height: tam,
              transform: `translateX(calc(-50% + ${desvio[i]}px)) rotate(${giro[i]}deg)`,
              zIndex: z,
              background: p.color || '#1B5FFA',
              border: `1px solid ${BORDER}`,
              boxShadow: '0 1px 4px rgba(0,0,0,0.45)',
            }}>
            {p.url && (
              <SafeImg src={p.url} className="w-full h-full object-cover object-top"
                onErrorHide={() => p.url && alRoto?.(p.url)} />
            )}
          </div>
        )
      })}
    </div>
  )
}
