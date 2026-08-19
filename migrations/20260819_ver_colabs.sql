-- Quién ve el buzón compartido de colaboraciones.
--
-- Hasta ahora: TODO el mundo. La consulta es
-- `.or('user_id.eq.<yo>, shared.eq.true')`, y los correos de colaboraciones se
-- guardan con `shared = true`, así que cualquiera con sesión los ve. Eso no lo
-- cambia dar de baja a alguien y volver a crearlo: la cuenta nueva los verá
-- exactamente igual, porque la marca está en el CORREO, no en la persona.
--
-- Javi quiere que Julio y Pablo no lo vean. Esta columna es la forma de hacerlo sin
-- tocar los correos ni borrar cuentas — y sin perder su Bandeja, su Fichar y sus
-- conversaciones con Harvey, que es lo que se llevaría por delante una baja.
--
-- `default true`: quien no se toque sigue viéndolo, que es como está hoy.

alter table public.profiles
  add column if not exists ver_colabs boolean not null default true;
