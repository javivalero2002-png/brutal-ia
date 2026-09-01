export const BLU = '#1B5FFA'
export const RED = '#E51D2A'
export const GRN = '#22c55e'
// Ámbar de prioridad "alta". EN HEX a propósito: la UI construye variantes
// concatenando opacidad (`color + '18'`), y eso solo es CSS válido con hex.
// Estaba escrito como rgba(255,176,32,0.9) en 5 secciones, así que producía
// `"rgba(255,176,32,0.9)18"` — invalido, y el elemento se pintaba SIN fondo.
export const AMBAR = '#FFB020'
// Morado del orbe de Harvey cuando piensa. Estaba escrito como
// rgba(139,92,246,0.9) en HoySection y en HarveySection —el mismo color, dos
// copias— y las dos concatenaban opacidad encima, asi que el halo y el
// resplandor del boton de voz desaparecian JUSTO en modo 'thinking'. Es el
// mismo tono: #8B5CF6 al 90% es exactamente ese rgba.
export const VIO = '#8B5CF6'

// El amarillo de la marca, el de la insignia de Instagram (`public/brutal-logo-ig.svg`).
// Está aquí y no escrito a mano en un componente porque la comprobación de
// opacidad de `scripts/check-color-opacity.mjs` exige que la base sea hex: en
// cuanto alguien lo concatene con '18' tiene que salir un color válido.
export const AMARILLO = '#FFE000'
export const SURFACE = '#0A0A14'
export const SURF2 = '#0F0F1E'
export const BORDER = 'rgba(255,255,255,0.06)'

export const ACCENT_COLORS = ['#1B5FFA','#E51D2A','#22c55e','#F97316','#A78BFA','#06B6D4','#EC4899','#84CC16','#F59E0B','#10B981']

// Colores de marca de cada plataforma.
//
// Estaba copiado SEIS veces en cinco ficheros (CreateModal, Reportes, Contenido
// ×3 y Calendario). Eso es una fabrica de gemelos: al oscurecer el rosa de TikTok
// para el modo claro hubo que encontrarlo en cada copia, y cualquier plataforma
// nueva habria que añadirla seis veces — o, mas probable, en cinco.
//
// HEX de 6 digitos, obligatorio: la UI concatena la opacidad (color + '18'), y con
// rgba() el navegador descarta la declaracion entera sin decir nada.
export const PLATAFORMA_COLOR: Record<string, string> = {
  TikTok: '#ff0050',
  Instagram: '#C13584',
  LinkedIn: '#0A66C2',
  YouTube: '#FF0000',
  Twitter: '#1DA1F2',
  Pinterest: '#E60023',
}

// El color de cada ESTADO DE CLIENTE.
//
// Estaba escrito como el ternario `status === 'Activo' ? GRN : gris` en TRES
// pantallas —la rejilla de Clientes, la lista de Reportes y la ficha que sale al
// abrir un correo—. Al añadir «Potencial» las tres lo habrían pintado del gris de
// «lo demás», o sea igual que un archivado: el estado nuevo existiría en la base y
// sería invisible justo donde hace falta distinguirlo.
//
// HEX de 6 dígitos, obligatorio: la UI concatena la opacidad (`color + '18'`).
export const COLOR_ESTADO_CLIENTE: Record<string, string> = {
  Activo: GRN,
  // Violeta, el mismo tono que el orbe pensando: es el estado «todavía no».
  Potencial: VIO,
  Pausado: AMBAR,
  Archivado: '#FFFFFF',
}
/** El color del estado, con el blanco de «archivado» como suelo para uno que no conozca. */
export const colorEstadoCliente = (status?: string | null): string =>
  COLOR_ESTADO_CLIENTE[status || ''] || '#FFFFFF'
/** Los cuatro estados, en el orden del embudo. Un solo sitio del que salen el
 *  selector de la ficha y los filtros de la rejilla, que iban por separado. */
export const ESTADOS_CLIENTE = ['Activo', 'Potencial', 'Pausado', 'Archivado'] as const
