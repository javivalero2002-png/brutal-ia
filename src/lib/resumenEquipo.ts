import { todayKey, localDayKey, ventanaDelDia, esTareaDe, diarioTieneAlgo } from '@/components/shared/helpers'
import { logQueryErrors } from '@/lib/queryLog'

/**
 * QUIÉN HIZO QUÉ ESTA SEMANA — el bloque de diario que va al prompt.
 *
 * Vivía suelto dentro de `/api/harvey/chat`, así que Harvey podía contestar
 * «¿qué hizo Pablo ayer?» y Brutal.IA no: la misma pregunta, en la misma app,
 * con dos respuestas distintas según a cuál de las dos le hablases. Desde fuera
 * no son dos herramientas —son «la IA»—, y eso no se lee como una limitación,
 * se lee como que la IA a veces se inventa que no sabe.
 *
 * Copiarlo a la otra ruta habría creado el gemelo de siempre: el mismo código
 * dos veces, arreglado en una copia. Vive aquí una vez.
 *
 * NO lleva comprobación de rol, y es deliberado: el diario del día y el del mes
 * ya los devuelve `/api/diario` a cualquiera que tenga sesión —es un tablón de
 * equipo, no un expediente—. Lo que sí está restringido a propietario es la
 * VALORACIÓN que escribe la IA sobre una persona (`/api/equipo/resumen`), que es
 * otra cosa: un juicio, no el dato.
 */

type Perfil = { id: string; name?: string | null }

/**
 * ¿Merece la pena traerlo? Son ~7 personas × 7 días: metido en cada mensaje
 * serían cientos de tokens pagados en las preguntas que no van de esto, que son
 * la mayoría. El disparador es tosco y se equivoca por defecto hacia NO incluirlo:
 * si la IA no lo trae, dice que no lo sabe, que es mejor que inventárselo.
 */
export function preguntaPorElEquipo(pregunta: string, plantilla: Perfil[]): boolean {
  const p = String(pregunta || '').toLowerCase()
  const nombraAAlguien = (plantilla ?? []).some(x =>
    x.name && x.name.trim().length > 2 && p.includes(x.name.toLowerCase().split(' ')[0]))
  // Nombrar a alguien ya basta, así que «¿en qué anda Paula?» entra por ahí. Esto
  // cubre las de equipo SIN nombre. Se amplía con lo que un jefe dice de verdad
  // —«cómo anda el equipo», «dame el parte», «quién está liado»— y no con palabras
  // corrientes como «hoy» o «tarea», que dispararían en la mayoría de preguntas.
  const porTrabajo = /\b(hizo|hicieron|hecho|hiciste|avanz|complet|equipo|semana|ayer|diario|fich|anda|liad|parte|trabaj|progres|rendimiento|objetiv)/.test(p)
  return nombraAAlguien || porTrabajo
}

/** El bloque listo para pegar en el prompt, o cadena vacía si no hay nada que contar. */
export async function resumenDelEquipo(
  admin: any,
  plantilla: Perfil[],
  pregunta: string,
): Promise<string> {
  if (!preguntaPorElEquipo(pregunta, plantilla)) return ''

  const desde = new Date(`${todayKey()}T12:00:00Z`)
  desde.setUTCDate(desde.getUTCDate() - 6)
  const desdeClave = localDayKey(desde)

  const q = await Promise.all([
    // `.lte` con hoy: el calendario del Diario deja PLANIFICAR días futuros a
    // propósito, y sin tope por arriba la IA leía esos planes y los contaba como
    // trabajo terminado delante de quien preguntara.
    admin.from('diario').select('dia,user_id,entrada,cierre,entrada_at,cierre_at,animo')
      .gte('dia', desdeClave).lte('dia', todayKey()),
    admin.from('tasks').select('text,assigned_to,co_assigned_to,completed_at').eq('done', true)
      .gte('completed_at', ventanaDelDia(desdeClave).desde),
  ])
  // supabase-js NO lanza. Al extraer esto se vio que las dos consultas
  // desestructuraban solo `data`: un fallo de lectura del diario llegaba al modelo
  // como «esta persona no ha hecho nada», que no es un hueco, es una acusación.
  logQueryErrors('resumenEquipo', q)
  const [{ data: diarios }, { data: hechas }] = q

  const lineasEquipo = (plantilla ?? []).map(p => {
    // Solo las filas que SON algo. Una fila vacía —abrir Fichar y borrar lo
    // escrito— se colaba como un día y salía aquí con su línea «no escribió
    // objetivos · no cerró el día», que el modelo lee como un día trabajado sin
    // resultados. Es peor que no decir nada: acusa.
    const mios = (diarios ?? []).filter((d: any) => d.user_id === p.id && diarioTieneAlgo(d))
    const tareas = (hechas ?? []).filter((t: any) =>
      esTareaDe(t, p as any) && t.completed_at && localDayKey(t.completed_at) >= desdeClave)
    if (!mios.length && !tareas.length) return null
    // Las dos mitades van ETIQUETADAS y son cosas opuestas: `entrada` es lo que
    // alguien SE PROPUSO (el esquema lo dice: «lo que voy a hacer hoy») y `cierre`
    // lo que HIZO. Iban las dos seguidas bajo una cabecera que decía «DIARIO DEL
    // EQUIPO», así que el modelo leía los planes como resultados. Y un día sin
    // cerrar se dice, en vez de dejar que parezca un cero.
    const porDia = mios.map((d: any) => {
      const objetivos = (d.entrada || '').split('\n').filter(Boolean).join(' / ')
      // HORAS Y ÁNIMO, que es lo que Fichar guarda. Sin esto se contesta QUÉ
      // escribió alguien pero no CUÁNTO estuvo ni CÓMO le fue, que es media
      // respuesta: «se propuso tres cosas y cerró con una» significa algo muy
      // distinto si estuvo dos horas o si estuvo nueve.
      const horas = (() => {
        if (!d.entrada_at) return null
        // Sin cierre se dice «lleva», no «estuvo»: el día no ha terminado y dar un
        // total cerrado sobre algo en curso es afirmar de más.
        const fin = d.cierre_at ? new Date(d.cierre_at).getTime() : Date.now()
        const ms = fin - new Date(d.entrada_at).getTime()
        if (ms <= 0) return null
        const h = Math.floor(ms / 3_600_000)
        const m = Math.round((ms % 3_600_000) / 60_000)
        const dur = h > 0 ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`
        return d.cierre_at ? `estuvo ${dur}` : `lleva ${dur} (sin cerrar)`
      })()
      const ANIMO: Record<string, string> = {
        productivo: 'lo calificó de día productivo',
        normal: 'lo calificó de día normal',
        bloqueado: 'se marcó BLOQUEADO',
      }
      const partes = [
        objetivos ? `se propuso: ${objetivos}` : 'no escribió objetivos',
        d.cierre ? `hizo (cierre del día): ${d.cierre}` : (d.cierre_at ? 'cerró el día sin escribir balance' : 'no cerró el día'),
        ...(horas ? [horas] : []),
        ...(d.animo && ANIMO[d.animo as string] ? [ANIMO[d.animo as string]] : []),
      ]
      return `    ${d.dia} — ${partes.join(' · ')}`
    })
    // Se recorta a 5 y se dice el TOTAL aparte: lo que se pide cuando alguien
    // pregunta «qué ha hecho X» es un juicio, no un inventario. Con la lista
    // entera delante, el modelo tiende a recitarla — y una respuesta que se lee en
    // voz alta con veinte títulos de tarea no la escucha nadie.
    const lista = tareas.slice(0, 5).map((t: any) => t.text).join(' · ')
    const mas = tareas.length > 5 ? ` y ${tareas.length - 5} más` : ''
    return `  ${p.name}: ${tareas.length} tarea(s) completada(s) en 7 días${lista ? ` (ejemplos: ${lista}${mas})` : ''}\n${porDia.join('\n')}`
  }).filter(Boolean)

  if (!lineasEquipo.length) return ''
  return `\n\nDIARIO DEL EQUIPO (últimos 7 días, desde ${desdeClave}):\n${lineasEquipo.join('\n')}`
}

/**
 * Las instrucciones de LECTURA de ese bloque. Van pegadas al dato a propósito:
 * separarlas es cómo se acaba mandando el diario sin decirle al modelo que lo de
 * «se propuso» es un plan y no un hecho.
 */
export const COMO_LEER_EL_DIARIO = `
Lo que va tras «se propuso» es un PLAN, no un hecho: no lo cuentes como trabajo
terminado. Lo hecho es lo que va tras «hizo (cierre del día)» y las tareas completadas.

CÓMO SE CUENTA LO QUE HA HECHO ALGUIEN. El bloque de arriba son datos en bruto para
que TÚ los interpretes, no un guion que leer. Nunca los recites.
- Di el TITULAR primero: cuánto ha cerrado y en qué ha estado centrado. Dos frases.
- Agrupa por tema o cliente («casi todo Mango»), no enumeres tarea por tarea.
- Nombra como mucho dos ejemplos concretos, y solo si aportan algo.
- Señala lo que llama la atención: un día sin cerrar, algo que se repite sin
  terminarse, una diferencia grande entre lo que se propuso y lo que hizo.
- Si te preguntan por VARIAS personas, una frase por persona y nada más.
- Los ejemplos que te doy son una MUESTRA, no la lista completa: no digas «solo ha
  hecho estas» ni des a entender que es todo lo que hay.
Si te preguntan qué ha hecho alguien y NO aparece en el diario de arriba, dilo:
«no tengo su diario de esos días». No lo deduzcas de las tareas ni te lo inventes.`
