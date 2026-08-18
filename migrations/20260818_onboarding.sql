-- Marca de que una persona ya ha pasado por la puesta en marcha.
--
-- Va en `profiles` y no en localStorage porque es de la PERSONA, no del aparato:
-- con localStorage, quien abra la app en el móvil después del portátil se comería
-- el proceso otra vez, y quien limpie el navegador también.
--
-- `timestamptz` y no un booleano: saber CUÁNDO la hizo cada uno responde a «¿este
-- ya lo tiene configurado?», que es la pregunta que se acaba haciendo. Un `true`
-- no responde a eso.
--
-- NO se rellena a nadie: hasta ahora todo han sido pruebas, así que el equipo
-- entero debe verla la próxima vez que abra la app. Esa es la razón de existir de
-- esta columna, y rellenarla aquí la dejaría sin efecto el mismo día que se crea.
alter table public.profiles
  add column if not exists onboarding_at timestamptz;
