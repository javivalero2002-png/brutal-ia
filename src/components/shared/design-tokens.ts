export const BLU = '#1B5FFA'
export const RED = '#E51D2A'
export const GRN = '#22c55e'
// Ámbar de prioridad "alta". EN HEX a propósito: la UI construye variantes
// concatenando opacidad (`color + '18'`), y eso solo es CSS válido con hex.
// Estaba escrito como rgba(255,176,32,0.9) en 5 secciones, así que producía
// `"rgba(255,176,32,0.9)18"` — invalido, y el elemento se pintaba SIN fondo.
export const AMBAR = '#FFB020'
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
