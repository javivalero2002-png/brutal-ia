// La API de Anthropic exige que el primer mensaje de `messages` sea `user`. Si no,
// devuelve 400 y la llamada entera se pierde.
//
// Esto ya mordió dos veces en este repo, en sitios distintos:
//
//   · /api/chat lo evita por un INVARIANTE: los turnos se guardan siempre en
//     pareja (user + ai), así que el historial leído de la base de datos tiene
//     longitud par y un slice del final siempre empieza en `user`. Funciona, pero
//     depende de que otro fichero mantenga esa pareja — nada lo comprueba.
//
//   · /api/harvey/chat NO tenía ese invariante y ahí sí fallaba a diario: la
//     conversación arranca con el saludo de Harvey, que vive solo en el cliente,
//     así que el historial empezaba en un mensaje suyo. La llamada devolvía 400,
//     se caía a una respuesta enlatada y se leía en voz alta como si fuera de
//     Harvey. Ningún error visible: solo Harvey diciendo algo genérico.
//
// Esta función es la red que faltaba. Es barata cuando el invariante se cumple
// (no toca nada) y salva el caso en que no.

export type TurnoIA = { role: 'user' | 'assistant'; content: string }

/**
 * Deja un historial que la API acepta: sin mensajes vacíos y empezando por `user`.
 *
 * Los mensajes del asistente que hay al principio se DESCARTAN en vez de moverse:
 * un saludo suyo no aporta contexto que merezca reordenar la conversación, y
 * cualquier otra maniobra (inventar un `user` vacío por delante, por ejemplo) da
 * un historial que no corresponde a lo que se dijo.
 */
export function sanearHistorial(turnos: TurnoIA[]): TurnoIA[] {
  const limpios = turnos.filter(t => typeof t?.content === 'string' && t.content.trim().length > 0)
  let i = 0
  while (i < limpios.length && limpios[i].role === 'assistant') i++
  return limpios.slice(i)
}
