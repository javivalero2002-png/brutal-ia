# Montar Nexus para un cliente

Cada cliente lleva **su propia instancia**: su base, su proyecto de Vercel, su
cliente de Google. No hay multi-tenancy y es una decisión de producto — además de
un argumento de venta: *sus datos van solos, no mezclados con los de nadie*.

Esta guía existe porque el primer montaje sale bien —estás concentrado— y en el
tercero te dejas una variable y te enteras cuando el cliente llama.

**El orden importa.** Cada paso necesita el anterior.

---

## 0 · Antes de empezar

Ten a mano: el nombre del cliente, el dominio que va a usar, y quién será el
propietario (su correo).

---

## 1 · Supabase  *(panel web)*

1. Proyecto nuevo. Región **eu-central-1 (Fráncfort)** salvo que el cliente esté
   fuera de Europa.
2. **Plan Pro.** No es opcional para un cliente: el plan gratuito **no tiene
   copias de seguridad automáticas**, y perder los datos de un cliente es el final
   del negocio, no un susto.
3. SQL Editor → pega **`supabase/schema.sql`** entero y ejecútalo.
4. Después, las migraciones de **`migrations/`** por orden de fecha.
   **Nunca ejecutes nada de `docs/sql-rechazado/`** — está ahí para no perderlo,
   no para correrlo.
5. Storage → bucket **`content-videos`**, **privado**.
   El nombre va escrito dentro de cada dirección guardada: renombrarlo después
   rompe todos los ficheros que ya haya.
6. Authentication → Site URL y Redirect URLs con el dominio del cliente.
   Esto es lo que Supabase mete en el correo de «¿olvidaste tu contraseña?». Si
   apunta a un sitio muerto, la recuperación manda a la gente a una página en
   blanco — y nadie lo nota, porque recuperar la contraseña es raro.
7. Copia el **Project URL**, la **clave publicable** y la **clave secreta**.

## 2 · Google Cloud  *(panel web)*

1. Proyecto nuevo → **pantalla de consentimiento** → externa.
2. **Credenciales → cliente OAuth** de tipo aplicación web.
3. URI de redirección autorizada: **la que imprime el revisor** (paso 5).
   Es `https://<dominio>/api/gmail/callback` y tiene que coincidir **exactamente**
   — un solo carácter de más y conectar Gmail falla con `redirect_uri_mismatch`.
4. Copia el **Client ID** y el **Client Secret**.

> Si algún día cambia el dominio: se toca en **cuatro sitios y en este orden** —
> Vercel, Google (editando el cliente que ya existe, **nunca creando uno nuevo**:
> uno nuevo invalida los tokens de todo el equipo), Supabase y
> `NEXT_PUBLIC_APP_URL`. En Google y Supabase se **añade** sin quitar la anterior.

## 3 · Vercel  *(panel web o CLI)*

1. Proyecto nuevo apuntando al repositorio.
2. Las variables de entorno. Las obligatorias y las opcionales están en
   `scripts/check-env.mjs`, cada una con lo que se rompe si falta.
3. **`CRON_SECRET`**: invéntate una cadena larga. Sin ella los crons devuelven 500
   y no corre nada de lo automático.
4. **Claves VAPID**: genera un par NUEVO por cliente
   (`npx web-push generate-vapid-keys`). Reutilizar el tuyo mezcla las
   notificaciones de dos negocios.
5. Dominio.

## 4 · Las primeras filas

1. Que el propietario entre una vez (crea su perfil).
2. Ponle `role = 'owner'` en la tabla `profiles`. Sin owner, las pantallas de
   propietario —Reportes, Copias, Equipo— no las ve nadie.
3. Carga sus clientes.

## 5 · Comprobar que está bien  *(el revisor)*

```bash
node scripts/revisar-instancia.mjs --env .env.cliente
```

Comprueba que las cosas **funcionan**, no que estén escritas: la base por las dos
claves, las 23 tablas, que el bucket exista y sea privado, que las claves de
Anthropic y Tavily respondan, que las dos claves VAPID sean **del mismo par** —el
fallo más silencioso de todos, porque los avisos se «envían» y no llega ninguno—
y que la app conteste sana.

Y te imprime la URI exacta que hay que pegar en Google Cloud.

## 6 · Vigilancia  *(5 minutos, y no te lo saltes)*

Da de alta la instancia en un vigilante externo gratuito (UptimeRobot, Better
Stack…) apuntando a:

```
https://<dominio>/api/salud
```

Devuelve **503** cuando la base, el Storage o el Auth fallan.

Tiene que ser **externo**: el vigilante que va dentro de la app
(`/api/cron/vigilante`) avisa de que un proceso automático se ha parado, pero si
lo que se cae es la base, se cae con ella. El 27 de agosto Supabase rechazó la
clave de servicio 40 minutos: la app arrancaba, el login daba 200 y no traía un
solo dato. Sin sonda externa, eso se descubre porque alguien la abre.
