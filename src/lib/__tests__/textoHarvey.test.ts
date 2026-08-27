import { describe, it, expect } from 'vitest'
import { limpiarTextoHarvey, textoParaVoz } from '@/lib/textoHarvey'

describe('limpiarTextoHarvey', () => {
  // EL CASO REAL. Javi pidió el briefing y en la tarjeta salió, con asteriscos:
  // «**Estado del día:** Llevas 2h 10m.»
  it('quita los asteriscos de una negrita', () => {
    expect(limpiarTextoHarvey('**Estado del día:** Llevas 2h 10m.'))
      .toBe('Estado del día: Llevas 2h 10m.')
  })

  it('quita las viñetas de principio de línea', () => {
    // El bloque de respuesta pinta sus propios puntos: un `- ` delante sale como
    // un guion suelto al lado del punto azul.
    expect(limpiarTextoHarvey('- Tres tareas de alta prioridad\n- Nada urgente'))
      .toBe('Tres tareas de alta prioridad\nNada urgente')
  })

  it('deja el texto de un enlace y tira la dirección', () => {
    expect(limpiarTextoHarvey('Mira el [documento](https://brutalia.tech/x?u=1) cuando puedas'))
      .toBe('Mira el documento cuando puedas')
  })

  it('no se come un asterisco que no es énfasis', () => {
    // `2 * 3` no es cursiva. Y un asterisco suelto se tira, que tampoco es nada.
    expect(limpiarTextoHarvey('Quedan 3 * 2 sillas')).toBe('Quedan 3 2 sillas')
  })

  it('no toca un guion dentro de una palabra ni una hora', () => {
    expect(limpiarTextoHarvey('La reunión post-producción es a las 10:30'))
      .toBe('La reunión post-producción es a las 10:30')
  })

  it('cabeceras y código', () => {
    expect(limpiarTextoHarvey('### Resumen\nEl `deadline` es hoy')).toBe('Resumen\nEl deadline es hoy')
  })
})

describe('textoParaVoz', () => {
  // Javi: «cuando reprodujo en audio dos horas y diez minutos, dijo 2H10M».
  it('dice las duraciones enteras', () => {
    expect(textoParaVoz('Llevas 2h 10m.')).toBe('Llevas 2 horas y 10 minutos.')
    expect(textoParaVoz('Llevas 2h10m.')).toBe('Llevas 2 horas y 10 minutos.')
    expect(textoParaVoz('Fichaste 46m.')).toBe('Fichaste 46 minutos.')
    expect(textoParaVoz('Llevas 3h.')).toBe('Llevas 3 horas.')
  })

  it('respeta el singular', () => {
    expect(textoParaVoz('Llevas 1h 1m.')).toBe('Llevas 1 hora y 1 minuto.')
    expect(textoParaVoz('Queda 1m.')).toBe('Queda 1 minuto.')
  })

  it('los simbolos se dicen', () => {
    expect(textoParaVoz('El presupuesto es 8000€ y va al 60%'))
      .toBe('El presupuesto es 8000 euros y va al 60 por ciento')
  })

  it('el punto medio separa, no se lee', () => {
    // `resumenEquipo` junta los datos con « · », y eso dicho en voz alta no es nada.
    expect(textoParaVoz('Nike · Zara · Adidas')).toBe('Nike, Zara, Adidas')
  })

  it('una URL no se lee', () => {
    expect(textoParaVoz('Lo tienes en https://brutalia.tech/x?u=1 cuando quieras'))
      .toBe('Lo tienes en cuando quieras')
  })

  it('tambien limpia el markdown, no solo las unidades', () => {
    expect(textoParaVoz('**Estado del día:** Llevas 2h 10m.'))
      .toBe('Estado del día: Llevas 2 horas y 10 minutos.')
  })

  it('no destroza una hora del reloj ni un año', () => {
    expect(textoParaVoz('La reunión es a las 10:30 del 2026')).toBe('La reunión es a las 10:30 del 2026')
  })
})
