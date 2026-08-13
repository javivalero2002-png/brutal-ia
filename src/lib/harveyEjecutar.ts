import type { AccionHarvey } from '@/lib/harveyAccion'
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
  perfil: { email?: string | null } | null | undefined
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
        const miembro = accion.assigneeName ? matchTeamMember(equipo, accion.assigneeName) : null
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
          deadline: accion.date || 'TBD',
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
        const cliente = buscarCliente(accion.clientName)
        await data.createAgenda({
          title: accion.text,
          platform: accion.platform || 'Instagram',
          content_type: accion.contentType || 'Post',
          status: 'borrador',
          publish_date: accion.date || undefined,
          client_id: cliente?.id,
        })
        showToast('Pieza añadida al pipeline de contenido')
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
        showToast(json?.error === 'insufficient_scope'
          ? 'Re-conecta Gmail en Operativa → Sincronización → Reauth para activar la escritura'
          : 'Error al crear el evento en Google Calendar')
        return false
      }
    }
  } catch (err) {
    console.error('[harvey] la acción propuesta falló:', err)
    showToast('Error al ejecutar la acción')
    return false
  }
}
