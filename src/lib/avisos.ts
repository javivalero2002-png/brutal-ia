// ─────────────────────────────────────────────────────────────────────────────
// De qué avisa la app. Un solo sitio.
//
// Por qué existe: la pantalla de Notificaciones tenía una lista escrita a mano de
// tres cosas, y la app manda OCHO — tres de ellas añadidas el mismo día que se
// escribió esto. Una pantalla que describe una app que no existe es peor que una
// pantalla vacía: promete de menos, así que quien lea «solo me avisa de tareas y
// correos» desactiva los avisos sin saber que se está perdiendo que un cliente
// respondió o que su Gmail lleva una semana desconectado.
//
// Ahora la lista de la pantalla SALE de aquí, cada envío declara su categoría, y
// hay una regla que impide mandar un aviso sin categoría. Así la pantalla no
// puede volver a quedarse atrás: si alguien añade un aviso nuevo, o lo declara
// aquí —y entonces aparece solo— o la suite se pone roja.
//
// Y de paso esto permite lo que de verdad hacía falta: poder silenciar una
// categoría sin apagar los avisos enteros.
// ─────────────────────────────────────────────────────────────────────────────

export type CategoriaAviso =
  | 'tarea'
  | 'mensaje'
  | 'correo'
  | 'cliente'
  | 'automatizacion'
  | 'averia'
  | 'prueba'

type Ficha = {
  /** Cómo se llama para quien lo lee. Sin jerga. */
  label: string
  /** Qué le pasa a quien lo recibe. En una frase. */
  desc: string
  /**
   * `false` = no se puede silenciar. Solo para lo que, si se pierde, deja de
   * funcionar algo sin que nadie se entere: es justo lo contrario de ruido.
   */
  silenciable: boolean
}

export const AVISOS: Record<CategoriaAviso, Ficha> = {
  tarea: {
    label: 'Tareas tuyas',
    desc: 'Cuando alguien te asigna una tarea, o te pone como responsable de una que ya existía.',
    silenciable: true,
  },
  mensaje: {
    label: 'Mensajes del equipo',
    desc: 'Cuando alguien del estudio te escribe por la app.',
    silenciable: true,
  },
  correo: {
    label: 'Correo nuevo',
    desc: 'Cuando entra un email en tu Gmail o en el buzón de colaboraciones.',
    silenciable: true,
  },
  // La CLAVE se queda en `cliente` a propósito, aunque el concepto sea otro.
  //
  // Javi: «el concepto está mal entendido: no será visto por clientes, sino por
  // nuestros jefes, y las revisiones las darán ellos». Tiene razón y las palabras
  // estaban mal — pero esta clave viaja guardada en las preferencias de avisos de
  // cada persona. Renombrarla haría que a quien lo tuviera silenciado se le
  // reactivara de golpe, sin avisar y sin entender por qué. Se cambia lo que se
  // lee, que es lo que estaba mal; la clave es un detalle de implementación.
  cliente: {
    label: 'Revisiones de piezas',
    desc: 'Cuando alguien aprueba una pieza o pide cambios desde el enlace de revisión.',
    silenciable: true,
  },
  automatizacion: {
    label: 'Automatizaciones',
    desc: 'Cuando salta una de las reglas que habéis configurado.',
    silenciable: true,
  },
  averia: {
    label: 'Algo ha dejado de funcionar',
    // No silenciable a propósito: es el aviso de que los correos han dejado de
    // entrar. Silenciarlo sería apagar la única señal de una avería silenciosa —
    // y esa avería ya ha pasado, con el token de Gmail caducando cada siete días.
    desc: 'Cuando tu Gmail se desconecta y dejan de entrarte correos. No se puede silenciar.',
    silenciable: false,
  },
  prueba: {
    label: 'Pruebas',
    desc: 'El botón de «enviar prueba» de esta pantalla.',
    silenciable: false,
  },
}

/** El orden en que se pintan. Lo más frecuente arriba, la avería al final. */
export const ORDEN_AVISOS: CategoriaAviso[] = [
  'tarea', 'correo', 'cliente', 'mensaje', 'automatizacion', 'averia',
]

/**
 * ¿Se le manda este aviso a alguien con estas preferencias?
 *
 * Ausente = SÍ. Quien nunca ha tocado la pantalla recibe todo, que es lo que
 * espera al haber activado los avisos; solo silencia quien lo pide.
 */
export const quiereAviso = (prefs: Record<string, boolean> | null | undefined, cat: CategoriaAviso) => {
  if (!AVISOS[cat]?.silenciable) return true
  return prefs?.[cat] !== false
}
