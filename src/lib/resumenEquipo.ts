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
  // Se amplía con lo que se pregunta de verdad sobre una jornada. Faltaban las
  // palabras del CIERRE, y ese hueco tenía la peor consecuencia posible: a «¿he
  // cerrado el día?» —con el día cerrado a las 11:22— las dos IAs contestaban «no,
  // todavía no», porque el diario no les llegaba y respondían de memoria.
  //
  // Siguen fuera las palabras corrientes («hoy», «tarea») que dispararían en la
  // mayoría de preguntas y se pagan en tokens cada vez.
  const porTrabajo = /\b(hizo|hicieron|hicimos|hecho|hiciste|avanz|complet|equipo|semana|ayer|diario|fich|anda|liad|parte|trabaj|progres|rendimiento|objetiv|cerr|jornada|horas|cuanto tiempo|cuánto tiempo|balance)/.test(p)
  // Y si la pregunta nombra un PERIODO —«el mes pasado»— también, aunque no case
  // ninguna palabra de trabajo. Va atado a la misma función que elige la ventana
  // en vez de repetir aquí sus palabras: con dos listas separadas, «¿y el mes
  // pasado?» elegía bien la ventana y luego no traía el diario, o sea la ventana
  // correcta de un bloque que no se envía. Un gemelo esperando.
  return nombraAAlguien || porTrabajo || ventanaPreguntada(p).explicita
}

/**
 * TU JORNADA DE HOY, en una línea, SIEMPRE.
 *
 * El bloque grande del diario solo se trae cuando la pregunta casa con una lista de
 * palabras — y esa lista siempre tendrá huecos. El agujero se vio con «¿he cerrado
 * el día?»: la palabra «cerrado» no estaba, el diario no llegaba, y las dos IAs
 * contestaban «no, todavía no» con el día cerrado a las 13:22.
 *
 * Se amplió la lista, pero eso solo tapa el caso conocido. Esto lo cierra de raíz:
 * el estado de la jornada de QUIEN PREGUNTA cabe en una línea, es lo que más se
 * pregunta, y va en todas las respuestas. Veinte tokens.
 *
 * Y va literal —«CERRADA», «ABIERTA»— y no en prosa: con la frase «hizo (cierre del
 * día): ... · cerró a las 13:22» delante, Harvey seguía diciendo «tu día sigue
 * abierto». Era un dato más en una lista de cuatro separados por puntos.
 */
export async function miJornadaHoy(admin: any, userId: string): Promise<string> {
  const dia = todayKey()
  const { data, error } = await admin
    .from('diario').select('entrada_at, cierre_at').eq('user_id', userId).eq('dia', dia).maybeSingle()
  if (error) {
    console.error('[jornada] no se pudo leer:', error.message)
    // Ni se afirma ni se niega: es el mismo criterio que el resto del contexto.
    return '\nTU JORNADA DE HOY: no se ha podido leer. No digas ni que has fichado ni que no.'
  }
  if (!data?.entrada_at) return '\nTU JORNADA DE HOY: SIN FICHAR. Todavía no has fichado hoy.'
  const reloj = new Intl.DateTimeFormat('es-ES', {
    timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hour12: false,
  })
  const entro = reloj.format(new Date(data.entrada_at))
  const ms = (data.cierre_at ? new Date(data.cierre_at).getTime() : Date.now()) - new Date(data.entrada_at).getTime()
  const min = Math.max(0, Math.round(ms / 60000))
  const dur = min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`
  return data.cierre_at
    ? `\nTU JORNADA DE HOY: CERRADA. Fichaste a las ${entro} y cerraste a las ${reloj.format(new Date(data.cierre_at))} (${dur}).`
    : `\nTU JORNADA DE HOY: ABIERTA, sin cerrar. Fichaste a las ${entro} y llevas ${dur}.`
}

/**
 * QUÉ PERIODO ESTÁ PREGUNTANDO.
 *
 * Javi: «que no puedas preguntar por la semana pasada a Harvey, me gustaría que
 * así fuese». No es que contestara mal: es que el bloque de diario que se le
 * enseña SIEMPRE era esta semana, así que a «¿qué hicimos la semana pasada?»
 * respondía con los datos de esta. Y eso no se nota — la respuesta tiene la forma
 * correcta, las personas correctas y las horas correctas. Solo son otros días.
 *
 * Esto no es entender lenguaje natural, y no pretende serlo: son tres periodos
 * que se piden de verdad, y el resto cae en «esta semana», que es lo que había.
 * El sesgo es hacia NO cambiar de ventana, porque equivocarse aquí devuelve datos
 * verdaderos de un momento que nadie preguntó.
 *
 * El TÍTULO viaja con la ventana a propósito. Si el bloque llega encabezado «esta
 * semana» con dentro los días de la anterior, el modelo dice «esta semana» — y
 * entonces el fallo pasa de «no sabe» a «afirma con seguridad algo falso».
 */
export function ventanaPreguntada(
  pregunta: string,
  hoyClave: string = todayKey(),
): { desde: string; hasta: string; titulo: string; explicita: boolean } {
  const p = String(pregunta || '').toLowerCase()
  const dia = (base: string, delta: number) => {
    const d = new Date(`${base}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() + delta)
    return localDayKey(d)
  }
  // El lunes DE ESTA SEMANA, con el mismo desplazamiento que usa el panel de
  // equipo y el briefing. Si esto cambia, la IA cita días que en la pantalla ya no
  // están — pasó con un sábado 22 y hay una regla que lo vigila.
  const l = new Date(`${hoyClave}T12:00:00Z`)
  l.setUTCDate(l.getUTCDate() - ((l.getUTCDay() + 6) % 7))
  const lunes = localDayKey(l)

  // «la semana pasada» es la semana natural anterior, de lunes a domingo, y se
  // acaba donde empieza esta. No es «los últimos 7 días»: eso incluiría hoy, y
  // preguntar por la semana pasada es justo preguntar por lo que ya cerró.
  if (/\b(semana pasada|semana anterior|la pasada semana)\b/.test(p)) {
    return {
      desde: dia(lunes, -7), hasta: dia(lunes, -1), explicita: true,
      titulo: `la SEMANA PASADA, del lunes ${dia(lunes, -7)} al domingo ${dia(lunes, -1)}`,
    }
  }
  // El mes natural anterior. `día 1 menos un día` da el último del mes de antes
  // sin tener que saber cuántos tiene ni si es bisiesto.
  if (/\b(mes pasado|mes anterior|el pasado mes)\b/.test(p)) {
    const finMesPasado = dia(`${hoyClave.slice(0, 7)}-01`, -1)
    return {
      desde: `${finMesPasado.slice(0, 7)}-01`, hasta: finMesPasado, explicita: true,
      titulo: `el MES PASADO, del ${finMesPasado.slice(0, 7)}-01 al ${finMesPasado}`,
    }
  }
  // Por defecto, la de siempre: esta semana natural, con suelo en AYER. El lunes,
  // la semana natural es un solo día y «¿qué hizo ayer?» —domingo— se quedaría sin
  // respuesta. El día de más solo existe los lunes, y va etiquetado (AYER).
  const ayer = dia(hoyClave, -1)
  // El lunes, el titulo decia «esta semana, desde el lunes 2026-08-30» — y el 30
  // era DOMINGO. Se enseña una fecha con el nombre del día equivocado a un modelo
  // que luego lo repite en voz alta.
  return lunes <= ayer
    ? { desde: lunes, hasta: hoyClave, explicita: false, titulo: `esta semana, desde el lunes ${lunes}` }
    : { desde: ayer, hasta: hoyClave, explicita: false, titulo: `esta semana (empieza hoy, lunes ${lunes}) más AYER ${ayer}` }
}

/** El bloque listo para pegar en el prompt, o cadena vacía si no hay nada que contar. */
/**
 * Lo que se pone en el prompt cuando el diario NO se ha traido.
 *
 * Devolver cadena vacia dejaba al modelo sin nada Y SIN SABERLO, y entonces
 * rellena el hueco con lo que le parece. Medido, con el dia cerrado a las 11:22:
 * a «¿he cerrado el dia?» las dos IAs contestaron «no, todavia no» —Harvey ademas
 * se contradijo en la misma frase: «no tengo registrado un cierre... el ultimo que
 * veo es del 26, donde estuviste 46 minutos»—.
 *
 * Negar con seguridad algo que no has mirado es peor que decir que no lo sabes. Es
 * el mismo arreglo que ya se hizo con el calendario, y por el mismo motivo.
 */
const SIN_DIARIO = `

DIARIO DEL EQUIPO: no lo he traído en esta respuesta.
Si te preguntan si alguien fichó, si cerró su día, cuánto estuvo o qué escribió:
NO lo niegues y NO lo afirmes. Di que no tienes el diario delante ahora mismo y
pide que te lo pregunten de otra forma (por ejemplo «¿qué he hecho hoy?»).`

export async function resumenDelEquipo(
  admin: any,
  plantilla: Perfil[],
  pregunta: string,
): Promise<string> {
  if (!preguntaPorElEquipo(pregunta, plantilla)) return SIN_DIARIO

  const { desde: desdeClave, hasta: hastaClave, titulo } = ventanaPreguntada(pregunta)

  const q = await Promise.all([
    // `.lte` con el final de la ventana: el calendario del Diario deja PLANIFICAR
    // días futuros a propósito, y sin tope por arriba la IA leía esos planes y los
    // contaba como trabajo terminado delante de quien preguntara.
    admin.from('diario').select('dia,user_id,entrada,cierre,entrada_at,cierre_at,animo')
      .gte('dia', desdeClave).lte('dia', hastaClave),
    // Con tope por arriba TAMBIÉN. No lo tenía, y preguntando por la semana pasada
    // habría traído las tareas de esta encima de aquel diario: el peor resultado
    // posible, porque la respuesta parece completa.
    admin.from('tasks').select('text,assigned_to,co_assigned_to,completed_at').eq('done', true)
      .gte('completed_at', ventanaDelDia(desdeClave).desde)
      .lte('completed_at', ventanaDelDia(hastaClave).hasta),
  ])
  // supabase-js NO lanza. Al extraer esto se vio que las dos consultas
  // desestructuraban solo `data`: un fallo de lectura del diario llegaba al modelo
  // como «esta persona no ha hecho nada», que no es un hueco, es una acusación.
  logQueryErrors('resumenEquipo', q)
  const [{ data: diarios }, { data: hechas }] = q

  const hoy = todayKey()
  const ayerD = new Date(`${hoy}T12:00:00Z`)
  ayerD.setUTCDate(ayerD.getUTCDate() - 1)
  const ayer = localDayKey(ayerD)

  const lineasEquipo = (plantilla ?? []).map(p => {
    // Solo las filas que SON algo. Una fila vacía —abrir Fichar y borrar lo
    // escrito— se colaba como un día y salía aquí con su línea «no escribió
    // objetivos · no cerró el día», que el modelo lee como un día trabajado sin
    // resultados. Es peor que no decir nada: acusa.
    // EN ORDEN. Salían como los devolviera la consulta —jueves, miércoles,
    // viernes, sábado— y a un modelo al que le pides «cuenta la semana» eso le
    // hace narrar los días en ese mismo orden. Se ve leyendo la respuesta, no el
    // código: por eso apareció al mirar el bloque de verdad y no antes.
    const mios = (diarios ?? []).filter((d: any) => d.user_id === p.id && diarioTieneAlgo(d))
      .sort((a: any, b: any) => String(a.dia).localeCompare(String(b.dia)))
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
        // CON LAS HORAS, no solo la duración. Preguntado a las dos: «¿a qué hora he
        // fichado hoy y a qué hora he salido?» — ninguna sabía contestar, y Harvey
        // llegó a decir que «el diario no está sincronizado con los datos de fichar
        // entrada y salida», que es falso y además le quita a la app una capacidad
        // que tiene. El dato estaba a mano: es el mismo `entrada_at` del que sale la
        // duración.
        //
        // En hora de MADRID, como todo lo que se le enseña a un modelo: cortar el
        // ISO daría UTC, que de 00:00 a 02:00 ni siquiera es el mismo día.
        const reloj = new Intl.DateTimeFormat('es-ES', {
          timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hour12: false,
        })
        const entro = reloj.format(new Date(d.entrada_at))
        return d.cierre_at
          ? `fichó a las ${entro} y cerró a las ${reloj.format(new Date(d.cierre_at))} (${dur})`
          : `fichó a las ${entro} y lleva ${dur} sin cerrar`
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
      // CUÁL ES HOY, dicho. Sin esto el modelo lee «2026-08-26» como una fecha
      // cualquiera: con el día cerrado a las 13:22, Harvey contestó «no, no lo has
      // cerrado; tu último cierre fue el 26 de agosto» — negando y afirmando lo
      // mismo en dos frases seguidas, porque no sabía que el 26 era hoy.
      // El día de la semana YA CALCULADO. Pidiéndole la fecha a secas, el modelo lo
    // deduce mal: con el bloque de hoy (miércoles 26) contestó «no tengo datos del
    // lunes, martes, jueves». Un jueves que aún no ha pasado.
    const diaSem = new Intl.DateTimeFormat('es-ES', { weekday: 'long', timeZone: 'Europe/Madrid' })
      .format(new Date(`${d.dia}T12:00:00Z`))
    const cuando = d.dia === hoy ? `${diaSem} ${d.dia} (HOY)` : d.dia === ayer ? `${diaSem} ${d.dia} (AYER)` : `${diaSem} ${d.dia}`
      // EL ESTADO COMO ETIQUETA, no como prosa dentro de una lista.
      //
      // Con la frase «hizo (cierre del día): ... · fichó a las 12:36 y cerró a las
      // 13:22» delante, Harvey seguía contestando «no, todavía no lo has cerrado,
      // pero no está registrado el cierre formal». Lo tenía escrito y no lo veía:
      // era un dato más en una lista de cuatro, separados por puntos.
      //
      // Tres palabras en mayúsculas al principio de la línea no se pueden leer de
      // dos maneras.
      const estado = d.cierre_at ? '[DÍA CERRADO]' : d.entrada_at ? '[DÍA ABIERTO, sin cerrar]' : '[SIN FICHAR]'
      return `    ${cuando} ${estado} — ${partes.join(' · ')}`
    })
    // Se recorta a 5 y se dice el TOTAL aparte: lo que se pide cuando alguien
    // pregunta «qué ha hecho X» es un juicio, no un inventario. Con la lista
    // entera delante, el modelo tiende a recitarla — y una respuesta que se lee en
    // voz alta con veinte títulos de tarea no la escucha nadie.
    const lista = tareas.slice(0, 5).map((t: any) => t.text).join(' · ')
    const mas = tareas.length > 5 ? ` y ${tareas.length - 5} más` : ''
    return `  ${p.name}: ${tareas.length} tarea(s) completada(s) en ese periodo${lista ? ` (ejemplos: ${lista}${mas})` : ''}\n${porDia.join('\n')}`
  }).filter(Boolean)

  // Traido y vacio NO es lo mismo que no traido: aqui si se ha mirado, y que no
  // haya nada es una respuesta legitima que el modelo puede dar con seguridad.
  if (!lineasEquipo.length) {
    return `\n\nDIARIO DEL EQUIPO (${titulo}): no hay nada escrito. Se ha mirado y está vacío.`
  }
  return `\n\nDIARIO DEL EQUIPO (${titulo}):\n${lineasEquipo.join('\n')}`
}

/**
 * Las instrucciones de LECTURA de ese bloque. Van pegadas al dato a propósito:
 * separarlas es cómo se acaba mandando el diario sin decirle al modelo que lo de
 * «se propuso» es un plan y no un hecho.
 */
export const COMO_LEER_EL_DIARIO = `
El PERIODO que cubre el bloque está escrito en su cabecera, entre paréntesis. Si
dice «la SEMANA PASADA», habla de la semana pasada y dilo así: no lo llames «esta
semana» ni des a entender que son los días de ahora. Y si te preguntan por unos
días que el bloque no cubre, dilo en vez de contestar con los que sí trae.

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
