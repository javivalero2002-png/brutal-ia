import type { AccionHarvey } from '@/lib/harveyAccion'
import { plataformaContenido, tipoContenido, fechaOTBD, todayKey } from '@/components/shared/helpers'
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
        // EL PROYECTO. Sin esto, una tarea dictada no pertenecía a ningún sitio:
        // Proyectos no reflejaba nada de lo que se creaba por voz, aunque el
        // usuario hubiera dicho de cuál era.
        //
        // Se busca entre los ACTIVOS. Un proyecto completado que aún se llama
        // parecido casaría primero y la tarea se iría a algo ya cerrado, donde
        // nadie mira. Y si no se reconoce NO se inventa: la tarea se crea suelta y
        // el aviso lo dice, que es recuperable — engancharla al proyecto
        // equivocado no lo es, porque nadie sabe que hay que buscarla.
        const proyecto = accion.projectName
          ? (data.projects as { id: string; name: string; status?: string }[])
              .filter(p => p.status !== 'completado')
              .find(p => p.name.toLowerCase().includes(accion.projectName!.toLowerCase())
                      || accion.projectName!.toLowerCase().includes(p.name.toLowerCase()))
          : undefined

        await data.createTask({
          text: accion.text,
          level: accion.level,          // ya normalizado en el parser
          source: 'ai',
          ...(miembro ? { assigned_to: miembro.id } : {}),
          ...(proyecto ? { project_id: proyecto.id } : {}),
        })
        // El aviso dice las DOS cosas que pueden haber salido mal, y las dice
        // aunque la tarea se haya creado: «creada» a secas cuando el proyecto no
        // se reconoció deja al usuario creyendo que está en el proyecto.
        const noEncontrado = accion.projectName && !proyecto
          ? ` (fuera de proyecto: no encontré "${accion.projectName}")`
          : proyecto ? ` en ${proyecto.name}` : ''
        showToast(
          (miembro ? `Tarea creada y asignada a ${miembro.name}`
           : accion.assigneeName ? `Tarea creada (sin asignar: no encontré a "${accion.assigneeName}")`
           : 'Tarea creada por Harvey') + noEncontrado,
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
      case 'diario': {
        // Cerrar el día hablando. Hasta ahora había que teclearlo en la sección, y
        // si estás recogiendo material a las ocho eso es la diferencia entre que se
        // escriba y que no. Es justo lo que el aviso de las 20:00 pide.
        const texto = (accion.text || '').trim()
        if (!texto) { showToast('No he entendido qué apuntar en el diario'); return false }

        // SE AÑADE, NO SE PISA. `PATCH /api/diario` hace un upsert con el valor que
        // le mandes, así que escribir a pelo BORRA lo que hubiera escrito antes —
        // y borrar el cierre de alguien es lo peor que puede hacer una acción por
        // voz: no hay papelera, y el texto no está en ningún otro sitio.
        //
        // Así que primero se lee. Si la lectura falla NO se escribe: escribir sin
        // saber qué había es exactamente el caso que hay que evitar.
        const hoy = todayKey()
        let previo = ''
        try {
          const r = await fetch(`/api/diario?dia=${hoy}`)
          if (!r.ok) throw new Error(String(r.status))
          const j = await r.json()
          // `{ dia, entradas, porPersona }` — la forma real de la respuesta, no
          // una adivinada: `entradas` es una fila por persona que fichó ese día.
          const mio = (Array.isArray(j?.entradas) ? j.entradas : [])
            .find((d: { user_id?: string }) => d?.user_id && perfil?.id && d.user_id === perfil.id)
          previo = String(mio?.cierre || '').trim()
        } catch {
          showToast('No he podido leer tu diario de hoy, así que no escribo nada para no pisarlo')
          return false
        }

        const res = await fetch('/api/diario', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dia: hoy, cierre: previo ? `${previo}\n${texto}` : texto }),
        })
        if (!res.ok) {
          const json = await res.json().catch(() => null)
          showToast(typeof json?.error === 'string' && json.error.length > 3
            ? json.error
            : 'No se ha podido guardar en el diario')
          return false
        }
        showToast(previo ? 'Añadido al cierre de tu día' : 'Día cerrado')
        return true
      }
      case 'completar': {
        // La contraria de 'tarea'. Harvey leía en voz alta lo que había pendiente y
        // no podía tachar nada: decir «ya está» y que la tarea siga ahí es lo que
        // hace que se deje de usar por voz.
        //
        // CUÁL es exactamente lo decide AQUÍ, no el modelo. El modelo repite el
        // título que él mismo acaba de leer del contexto, y aquí está la lista de
        // verdad: comparar contra ella es lo único que puede fallar en voz alta
        // («la del guion» no es un título) y por tanto lo único que hay que hacer
        // bien.
        const norm = (t: string) => t.toLowerCase()
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // «guion» casa «guión»
          .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
        const buscado = norm(accion.text)
        if (!buscado) { showToast('No he entendido qué tarea marcar como hecha'); return false }

        const pendientes = ((data.tasks || []) as { id: string; text: string; done?: boolean }[])
          .filter(t => !t.done)
        // Por capas y de más estricta a menos: exacta, luego empieza por, luego
        // contiene. Sin las capas, «guion» elegía la primera que lo llevara dentro
        // aunque hubiera una que se llamara exactamente así.
        const exactas = pendientes.filter(t => norm(t.text) === buscado)
        const empiezan = pendientes.filter(t => norm(t.text).startsWith(buscado))
        const contienen = pendientes.filter(t => norm(t.text).includes(buscado) || buscado.includes(norm(t.text)))
        const candidatas = exactas.length ? exactas : empiezan.length ? empiezan : contienen

        if (!candidatas.length) {
          showToast(`No encuentro ninguna tarea pendiente que sea «${accion.text}»`)
          return false
        }
        if (candidatas.length > 1) {
          // NO se elige la primera. Marcar hecha la tarea equivocada es un error
          // que nadie ve —desaparece de la lista— y que el usuario descubre
          // cuando ya cuenta como trabajo terminado de alguien.
          showToast(`Hay ${candidatas.length} tareas que encajan con eso. Dime cuál: ${candidatas.slice(0, 3).map(t => `«${t.text}»`).join(', ')}`)
          return false
        }

        await data.toggleTask(candidatas[0].id)
        showToast(`Hecha: ${candidatas[0].text}`)
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
