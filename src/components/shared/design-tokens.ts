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
