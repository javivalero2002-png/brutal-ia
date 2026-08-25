import type { AccionHarvey } from '@/lib/harveyAccion'
import { plataformaContenido, tipoContenido, fechaOTBD } from '@/components/shared/helpers'
import type { NexusData } from '@/types'
import { matchTeamMember } from '@/components/shared/audio'
import { ACCENT_COLORS } from '@/components/shared/design-tokens'
import { plural } from '@/components/shared/helpers'

// Ejecuta la acción que Harvey propone, en UN solo sitio.
//
// Estaba escrita dos veces —`confirmHarveyAction` en HoySection y en
// HarveySection—, byte por byte salvo la paleta de colores aleatorios y el texto
// del catch. Es la función donde la auditoría de agosto encontró DOS bugs, y los
// dos hubo que arreglarlos por duplicado:
//
//   · la tarjeta «HARVEY PROPONE» se descartaba aunque la creación fallara, así
//     que había que volver a dictarle el evento entero — justo cuando el aviso te
//     pide reconectar Gmail y reintentar;
//   · el nivel de la tarea llegaba crudo desde el modelo (ahora se normaliza al
//     parsear, en harveyAccion.ts).
//
// Devuelve si se ESCRIBIÓ algo de verdad. Quien llama usa ese booleano para
// decidir si descarta la propuesta: descartarla sin haber escrito es el bug.

export interface DepsAccionHarvey {
  data: NexusData
  /** Quien habla. `id` y `name` hacen falta para «créame una tarea a mí». */
  perfil: { id?: string | null; name?: string | null; email?: string | null } | null | undefined
  showToast: (mensaje: string) => void
}

/** @returns true solo si la acción llegó a escribir algo. */
export async function ejecutarAccionHarvey(
  accion: AccionHarvey,
  { data, perfil, showToast }: DepsAccionHarvey,
): Promise<boolean> {
  // Color de respaldo para proyectos y clientes sin uno propio. Sale de la paleta
  // compartida: antes cada sección llevaba su lista a mano, y eran distintas.
  const color = ACCENT_COLORS[Math.floor(Math.random() * ACCENT_COLORS.length)]
  const equipo = (data.team || []) as { email?: string; name?: string; id?: string }[]

  // Los clientes se buscan por coincidencia parcial del nombre, que es lo que dice
  // el usuario en voz alta («ponlo en el de Nocilla»).
  const buscarCliente = (nombre?: string) =>
    nombre ? (data.clients as { id: string; name: string; color?: string }[])
      .find(c => c.name.toLowerCase().includes(nombre.toLowerCase())) : undefined

  try {
    switch (accion.type) {
      case 'tarea': {
        // Sin persona = PARA QUIEN HABLA, no «sin asignar».
        //
        // Es lo que el prompt lleva prometiendo desde siempre —«persona = …, o
        // vacío si es para quien habla» (api/harvey/chat/route.ts)— y lo que el
        // código no cumplía: dejaba `null` y la tarea nacía huérfana. Le pedías a
        // Harvey «créame una tarea», él la creaba, decía que la creaba, y no
        // aparecía en las de nadie. El contrato entre el prompt y el código estaba
        // roto por el lado del código.
        //
        // Y hay un caso peor que este arregla de paso: si Harvey se INVENTA un
        // nombre que no existe en el equipo, antes también caía en «sin asignar».
        // Ahora solo cae ahí si dijo un nombre Y no era nadie — que es cuando de
        // verdad hay que avisar, porque es lo único que el usuario puede corregir.
        const miembro = accion.assigneeName
          ? matchTeamMember(equipo, accion.assigneeName)
          : (matchTeamMember(equipo, perfil?.name || '') || (perfil?.id ? { id: perfil.id, name: perfil.name } : null))
        await data.createTask({
          text: accion.text,
          level: accion.level,          // ya normalizado en el parser
          source: 'ai',
          ...(miembro ? { assigned_to: miembro.id } : {}),
        })
        showToast(
          miembro ? `Tarea creada y asignada a ${miembro.name}`
          : accion.assigneeName ? `Tarea creada (sin asignar: no encontré a "${accion.assigneeName}")`
          : 'Tarea creada por Harvey',
        )
        return true
      }

      case 'proyecto': {
        const cliente = buscarCliente(accion.clientName)
        await data.createProject({
          name: accion.text,
          client_id: cliente?.id,
          status: 'activo',
          progress: 0,
          // `fechaOTBD` y no el texto crudo: «proximo viernes» crea un proyecto que no
          // vence NUNCA, porque `estadoDeadline` solo entiende YYYY-MM-DD. 'TBD' es
          // lo que la app ya usa para «sin fecha», y al menos es cierto.
          deadline: fechaOTBD(accion.date),
          color: cliente?.color || color,
        })
        showToast('Proyecto creado por Harvey')
        return true
      }

      case 'cliente': {
        await data.createClient({
          name: accion.text,
          industry: accion.industry || '—',
          revenue: '—',
          color,
          status: 'Activo',
        })
        showToast('Cliente creado por Harvey')
        return true
      }

      case 'pieza': {
        // SIN cliente y SIN fecha, y no es un olvido: el contrato del prompt son
        // tres campos a proposito —«NO preguntes por el cliente, la fecha ni mas
        // detalles: con el tema y la plataforma basta»—, porque esto se dicta en
        // voz alta y un interrogatorio de cuatro preguntas para apuntar un reel no
        // lo usa nadie. El resto se edita luego en el pipeline.
        //
        // Aqui se leian ademas el cliente y la fecha de la accion. El parser no
        // rellena ninguno de los dos para una pieza, asi que eran siempre
        // `undefined`: no fallaban, PARECIAN una funcion. Quien leyera el ejecutor
        // daba por hecho que una pieza dictada se enlaza con su cliente, y no pasa.
        // Codigo muerto que miente es peor que codigo muerto.
        await data.createAgenda({
          title: accion.text,
          // Normalizadas: una plataforma que no esta en la lista no casa ningun color
          // y la pieza sale en gris, sin que nadie sepa por que.
          platform: plataformaContenido(accion.platform),
          content_type: tipoContenido(accion.contentType),
          status: 'borrador',
        })
        showToast('Pieza añadida al pipeline de contenido')
        return true
      }
      case 'nota': {
        // Harvey YA la ofrecía en voz alta y no existía: su prompt dice «ofrece
        // crear el resto como tarea o NOTA», así que decía que la creaba y no se
        // proponía nada. Ofrecer algo que no se puede hacer es peor que no
        // ofrecerlo: la siguiente vez ya no te fías de lo que dice.
        //
        // La categoría se normaliza contra las que Memoria sabe filtrar.
        // 'Documento' se excluye a propósito: esa la escribe la subida de PDFs, y
        // `memoriaRelevante` la trata distinto —un documento que no casa con la
        // pregunta se DESCARTA; lo curado no—. Una nota dictada es curada.
        const CATS = ['General', 'Clientes', 'Procesos', 'Decisiones', 'Aprendizajes']
        const pedida = (accion.category || '').trim().toLowerCase()
        const cat = CATS.find(c => c.toLowerCase() === pedida) || 'General'
        await data.createMemoria({ title: accion.text.slice(0, 120), content: accion.text, category: cat })
        showToast(`Nota guardada en Memoria · ${cat}`)
        return true
      }

      case 'evento': {
        // La fecha es obligatoria y el prompt se la exige al modelo, pero si no la
        // dio NO se intenta: Google devolvería un error críptico y el usuario no
        // sabría que el problema es que falta la fecha.
        if (!accion.date) {
          showToast('Harvey no especificó fecha — dile "para el [fecha]" y vuelve a intentarlo')
          return false
        }
        const invitados = (accion.invitees || '').trim()
        // «todos» lo escribe el modelo tal cual cuando el usuario dice "todo el
        // equipo". Uno mismo se excluye siempre: eres el organizador.
        const emails = !invitados ? []
          : /^todos?$/i.test(invitados)
            ? equipo.map(m => m.email).filter((e): e is string => !!e && e !== perfil?.email)
            : invitados.split(',')
                .map(s => matchTeamMember(equipo, s))
                .filter(Boolean)
                .map((m: { email?: string }) => m.email)
                .filter((e): e is string => !!e && e !== perfil?.email)

        const res = await fetch('/api/calendar/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: accion.text, date: accion.date, time: accion.time, attendees: emails }),
        })
        const json = await res.json().catch(() => ({}))
        if (res.ok) {
          showToast(emails.length
            ? `Reunión creada · invitación enviada a ${plural(emails.length, 'persona')}`
            : 'Evento añadido a Google Calendar')
          await data.reload?.()
          return true
        }
        // Este mensaje es accionable y por eso merece rama propia: el usuario tiene
        // que ir a reconectar Gmail, no reintentar sin más.
          // El servidor SE MOLESTA en decir «No se entendió la fecha "martes" — tiene
          // que ser AAAA-MM-DD», y ese mensaje se tiraba a la basura: el usuario veía
          // un error genérico que culpaba a Google de un problema que no era suyo, y
          // no sabía que bastaba con repetir la fecha.
          //
          // `insufficient_scope` conserva rama propia porque su mensaje NO es el del
          // servidor: hay que ir a reconectar Gmail, no reintentar.
          showToast(json?.error === 'insufficient_scope'
            ? 'Re-conecta Gmail en Operativa → Sincronización → Reauth para activar la escritura'
            : (typeof json?.error === 'string' && json.error.length > 3
                ? json.error
                : 'Error al crear el evento en Google Calendar'))
        return false
      }
    }
  } catch (err) {
    console.error('[harvey] la acción propuesta falló:', err)
    showToast('Error al ejecutar la acción')
    return false
  }
}
