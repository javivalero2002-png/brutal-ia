'use client'
import { useEffect, useState } from 'react'

/**
 * EL CRONÓMETRO DE LA JORNADA.
 *
 * Javi lo pidió así: «un contador de cuánto tiempo llevo trabajando: un minuto,
 * dos minutos, tres minutos, que se vaya actualizando».
 *
 * Vive en su propio componente y no dentro de `DiarioSection` por un motivo que no
 * es higiene: cada tick repinta la sección entera —2.000 líneas, con
 * `misTareasDelDia`, `objetivosDeHoy`, `otrasDelDia`, la semana y un bucle de 400
 * iteraciones para la racha—. A 30 segundos se tolera; a 1 segundo, no. Sin aislar,
 * el segundero no se puede sostener.
 *
 * NADA SE GUARDA, y es deliberado. El tiempo se deriva siempre de `entrada_at`, así
 * que recargar, cambiar de aparato, dormir el portátil o que iOS congele la PWA no
 * pueden desincronizar nada. Un contador guardado miente con mucha precisión.
 */
/**
 * Las horas, minutos y segundos de una jornada, a partir de su duración en ms.
 *
 * Función aparte para poder probarla sin navegador: el componente pinta, esto
 * calcula. `Math.max(0, …)` porque el único origen de un negativo es el desfase
 * entre el reloj de este portátil y el `now()` del servidor, que es quien sella
 * `entrada_at` — y un cero es un dato, mientras que una raya es un error.
 */
export function partesJornada(ms: number): { h: number; m: number; s: number } {
  const total = Math.floor(Math.max(0, ms) / 1000)
  return { h: Math.floor(total / 3600), m: Math.floor((total % 3600) / 60), s: total % 60 }
}

export default function RelojJornada({
  entradaAt, cierreAt, isMobile,
}: {
  entradaAt: string
  cierreAt?: string | null
  isMobile?: boolean
}) {
  const [ahora, setAhora] = useState(() => Date.now())

  useEffect(() => {
    // Cerrado: dos instantes fijos. Ni un timer.
    if (cierreAt) return
    const tick = () => setAhora(Date.now())
    // ESTA LÍNEA MATA LA RAYA DEL ARRANQUE.
    //
    // Antes el «ahora» se sembraba al MONTAR la sección, y como los objetivos se
    // escriben durante minutos antes de pulsar, ese instante era ANTERIOR a
    // `entrada_at`: la resta salía negativa, el código devolvía null y el número
    // grande ponía «—» hasta el primer tick, 30 segundos después. El reloj no
    // empezaba en 00:00: empezaba en una raya, que es la pantalla de «esto está
    // roto» justo en el segundo en que acabas de fichar.
    tick()
    const id = setInterval(tick, 1000)
    // Los navegadores estrangulan `setInterval` a ~1/min con la pestaña oculta, y
    // la PWA de iOS lo congela del todo. No se acumula error —siempre se recalcula
    // desde `entrada_at`— pero al volver enseñaría un número caducado justo en el
    // instante en que lo miras.
    const alVolver = () => { if (document.visibilityState === 'visible') tick() }
    document.addEventListener('visibilitychange', alVolver)
    window.addEventListener('focus', tick)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', alVolver)
      window.removeEventListener('focus', tick)
    }
  }, [entradaAt, cierreAt])

  // `Math.max(0, …)` y no `return null`. El único origen de un negativo es el
  // desfase entre el reloj de este portátil y el `now()` del servidor, que es quien
  // sella `entrada_at`. Un cero es un dato; una raya es un error.
  const { h, m, s } = partesJornada(
    (cierreAt ? new Date(cierreAt).getTime() : ahora) - new Date(entradaAt).getTime())
  const dd = (n: number) => String(n).padStart(2, '0')

  const grande = { fontSize: isMobile ? '34px' : '30px', letterSpacing: '-0.02em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' as const }
  // Los segundos se atenúan con `opacity` del elemento, NUNCA con un rgba() de
  // base: esta UI concatena opacidad (`color + '18'`) y una base rgba() hace que el
  // navegador tire la declaración entera, sin error y sin nada en consola.
  const chico = { fontSize: isMobile ? '21px' : '19px', opacity: 0.55 }

  return (
    <span className="font-figtree font-black text-white" style={grande}>
      {h > 0 ? (
        <>{h}:{dd(m)}<span style={chico}>:{dd(s)}</span></>
      ) : (
        <>{dd(m)}:{dd(s)}</>
      )}
    </span>
  )
}
