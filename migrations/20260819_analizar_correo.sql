-- Que cada uno decida si su correo PERSONAL pasa por el modelo.
--
-- Por qué existe: desde que la aplicación está publicada como externa, cualquiera
-- puede conectar su Gmail personal — y eso es lo que se quería. Pero el asunto y el
-- principio del cuerpo de esos correos salen a Claude para sacar el resumen y
-- marcar lo urgente. En un buzón de trabajo eso es la función; en el correo
-- personal de alguien es una decisión suya, no de la empresa.
--
-- `default true` a propósito: cambiar el comportamiento de todo el mundo en
-- silencio con una migración sería peor que no tener el interruptor. Quien no haga
-- nada se queda exactamente como estaba.
--
-- NO afecta al buzón compartido. `colaboraciones@brutalstudios.es` es correo de
-- trabajo del estudio entero y su análisis es la razón de ser de la Bandeja: que la
-- preferencia de una persona pudiera apagarlo para los siete sería un fallo, no una
-- opción. Hay una regla en regresiones.test.ts que lo vigila.

alter table public.profiles
  add column if not exists analizar_correo boolean not null default true;
