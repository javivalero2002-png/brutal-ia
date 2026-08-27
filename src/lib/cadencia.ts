/**
 * Cada cuánto DEBERÍA correr cada proceso automático, en minutos.
 *
 * Vive aquí y no dentro de la ruta del panel porque ahora la miran DOS: el panel
 * de latido, que la pinta, y el vigilante, que avisa cuando algo se pasa. Dos
 * copias de esta tabla serían un panel que dice que todo va bien y un aviso que
 * salta, o al revés — y las dos formas de fallar enseñan a ignorar los avisos.
 *
 * Hay una regla en `regresiones.test.ts` que la compara contra los crons de
 * `vercel.json`: si aquí dice una cosa y allí otra, el panel avisaría de una
 * avería que no existe.
 */
export const CADENCIA: Record<string, number> = {
  'sync-colabs': 60,
  copia: 7 * 24 * 60,
  // LOS CUATRO, no dos. El panel dice «TODO LO AUTOMÁTICO, AL DÍA» y solo miraba
  // la mitad: los dos recordatorios podian llevar dias sin correr y aqui salia
  // todo en verde. Un panel que afirma mas de lo que mira es peor que no tenerlo,
  // porque se deja de comprobar a mano.
  //
  // Cadencia diaria para los dos: corren de lunes a viernes (`0 8,9 * * 1-5` y
  // `0 18,19 * * 1-5`), asi que un fin de semana son ~72h sin latir. Con el margen
  // del doble que aplica el codigo de abajo, 24h*4 no da falsa alarma el lunes.
  'recordatorio-fichar': 4 * 24 * 60,
  'recordatorio-cerrar': 4 * 24 * 60,
  // El vigilante se vigila a sí mismo: no sirve para el caso en que está muerto
  // —ahí nadie avisa— pero hace que se VEA en el panel, que es lo único que queda.
  vigilante: 60,
}

/**
 * El margen antes de dar algo por caído: el DOBLE de su cadencia.
 *
 * Un cron horario que se retrasa diez minutos no es una avería, es un cron. Con
 * el doble, `sync-colabs` avisa a las dos horas — tarde para un susto, pronto
 * para un día perdido, que es el caso real del 18 de agosto.
 */
export const MARGEN = 2

/** ¿Lleva demasiado sin correr? `minutosDesde` null = no ha corrido nunca. */
export const seHaPasado = (tarea: string, minutosDesde: number | null) => {
  const c = CADENCIA[tarea]
  if (!c) return false
  // Nunca ha corrido: en una instancia recién montada eso es lo normal durante la
  // primera hora, así que no es avería — es que aún no ha tocado.
  if (minutosDesde === null) return false
  return minutosDesde > c * MARGEN
}
