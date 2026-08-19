# Operación

Lo que hay que saber para mantener esto en pie sin haberlo escrito.

`CLAUDE.md` cuenta las trampas del **código**. Este documento cuenta las de la
**infraestructura**: qué hacer cuando algo se cae, cómo levantar una instancia
desde cero y qué pasos tienen un orden que no se puede cambiar.

---

## Lo primero, si algo va mal

```bash
curl -sD- -o /dev/null https://brutalia.tech/login | grep x-vercel-error
```

| Lo que sale | Qué significa | Qué hacer |
|---|---|---|
| *nada* + `HTTP/2 200` | La app responde | El problema es de datos o de una integración, no del despliegue |
| `402 DEPLOYMENT_DISABLED` | **Facturación**: factura pendiente, límite del plan o suscripción suspendida | Ver abajo, tiene truco |
| `503 DEPLOYMENT_PAUSED` | El límite de gasto que uno se pone a sí mismo | Subirlo en el panel de Vercel |

### La trampa del despliegue que no despliega

Pasó el 18 de agosto de 2026 y es el fallo más traicionero que ha tenido esto.

Con la suscripción de Vercel suspendida, un merge a `main` **no despliega y no
falla**: la PR se queda con *cero* checks — ni build roto ni error, simplemente
ningún intento. Producción sigue sirviendo el commit anterior tan tranquila.

Y lo peor: **reactivar la cuenta no reintenta ese commit**. La app vuelve a
responder 200, el panel se pone verde, y lo que hay vivo es el despliegue viejo.

Si `main` tiene commits sin desplegar hay que **forzar una construcción nueva**, y
no vale ni redesplegar desde el panel (repite el commit viejo) ni `vercel --prod`
(sube tu árbol de trabajo, no un commit — por eso se retiró `deploy.sh`). Un
commit nuevo por PR es la única vía limpia.

Ojo también: **pagar la factura no reactiva una suscripción suspendida**. Son dos
arreglos distintos, y por creer que era uno solo esto se cayó dos veces el mismo
día.

### Comprobar qué commit está vivo

```bash
gh api repos/javivalero2002-png/brutal-ia/commits/$(git rev-parse origin/main)/status \
  -q '.state, (.statuses[]? | "\(.context): \(.state)")'
```

`Vercel: success` es lo que quieres ver. `pending` durante un par de minutos es
normal; nada en absoluto es la trampa de arriba.

---

## Recuperar datos

### Dónde están las copias

Se hacen **solas cada miércoles** (04:00 UTC, `/api/cron/backup`) y se guardan en
el bucket privado `copias` de Supabase, un JSON comprimido por copia. Se conservan
las 12 últimas —unos tres meses— más una de cada mes durante un año.
Desde la app: **Operativa → Copias**, donde también se puede forzar una y
descargarla.

### Qué hay dentro y qué no

Guarda **las filas** de las 17 tablas con contenido. Es lo irrecuperable.

**No** guarda la estructura de la base (se reconstruye desde este repositorio),
ni los ficheros de Storage (siguen en su bucket), ni los tokens de Gmail (se
omiten a propósito: un fichero descargado no es sitio para la llave del correo de
nadie; quien restaure vuelve a conectar su cuenta con un clic).

### Restaurar

1. Reconstruye el esquema: `supabase/schema.sql`, luego `migrations/*.sql` por fecha.
2. Descarga el JSON del día que quieras (Operativa → Copias).
3. Inserta tabla por tabla **en el orden en que vienen en el fichero** — está
   puesto a propósito para que las claves ajenas no reboten: `profiles` primero,
   las hijas después de sus padres.
4. Cada uno vuelve a conectar su Gmail desde Operativa → Sincronización.

> Una copia que no se ha restaurado nunca es una hipótesis. Merece la pena
> probarlo una vez contra un proyecto de Supabase de usar y tirar.

---

## Levantar una instancia desde cero

El orden importa: saltárselo deja la app en pie pero sin poder entrar.

**1 · Supabase.** Proyecto nuevo → SQL Editor → `supabase/schema.sql` y después
`migrations/*.sql` por fecha. En **Authentication → URL Configuration**, poner el
Site URL y los Redirect URLs del dominio definitivo.

> El Site URL es lo que Supabase mete en los correos de «¿olvidaste tu
> contraseña?». Aquí apuntó semanas a un proyecto borrado, así que quien intentaba
> recuperar su cuenta acababa en un 404 — y no lo detectó nadie, porque recuperar
> la contraseña es raro. **Compruébalo mandándote uno.**

**2 · Storage.** Crear los buckets que usa la app. El de copias se crea solo la
primera vez. Todos **privados**: dentro hay contratos, presupuestos y briefs, y
la app ya firma cada enlace justo antes de responder.

**3 · Google Cloud.** Cliente OAuth con la dirección de vuelta
`https://TU-DOMINIO/api/gmail/callback`. Los permisos que pide la app son
`gmail.readonly`, `calendar.readonly`, `calendar.events` y el correo del usuario.

> `gmail.readonly` es un permiso **restringido** de Google: para usuarios de
> cualquier dominio hace falta pasar su verificación y una auditoría de seguridad.
> La vía corta, si la empresa tiene Google Workspace: crear el cliente OAuth como
> **interno** en su propia consola, y entonces no hace falta nada de eso.

**4 · Vercel.** Importar el repositorio, poner las variables (ver el README) y
desplegar. El plan **Pro** es obligatorio: Hobby limita los procesos automáticos a
uno al día y además prohíbe el uso comercial, y esto es la herramienta de trabajo
de una empresa.

**5 · Comprobar.** Entrar, conectar Gmail, forzar una copia desde Operativa →
Copias, y mandarse un correo de recuperación de contraseña.

---

## Cambiar de dominio

Cuatro sitios **en este orden**, o se rompe el acceso de todo el equipo:

1. **Vercel** — añadir el dominio.
2. **Google Cloud** — añadir la dirección de vuelta al cliente OAuth **que ya
   existe**. Crear uno nuevo invalida los tokens de todo el mundo y todos tienen
   que volver a conectar su correo.
3. **Supabase** — Site URL y Redirect URLs.
4. **`NEXT_PUBLIC_APP_URL`** y volver a desplegar.

En Google y en Supabase se **añade sin quitar** la anterior, para poder volver
atrás. La dirección no se escribe a mano en ningún sitio del código: sale de
`NEXT_PUBLIC_APP_URL` a través de `src/lib/appUrl.ts`, y hay un test que lo
protege.

---

## Lo que corre solo

| Cuándo | Qué | Si falla |
|---|---|---|
| Cada hora | `/api/cron/sync-colabs` — trae el correo del buzón compartido, lo analiza y ejecuta las automatizaciones | Dejan de entrar correos nuevos y no salen avisos |
| Miércoles (04:00 UTC) | `/api/cron/backup` — copia de la base y poda del histórico de avisos | Se deja de tener red debajo, en silencio |

Los dos se autentican con `CRON_SECRET`, que Vercel manda en la cabecera. Los dos
usan cerrojo (`job_locks`) para no pisarse consigo mismos.

**Si cambias la frecuencia de un proceso en `vercel.json`, cambia también su
cadencia esperada en `/api/admin/latido`.** Si no, el panel de Sincronización
avisa de una avería que no existe — y un aviso que salta sin motivo enseña a
ignorar los avisos, que es lo contrario de para lo que está.

**El token de Gmail caduca cada siete días** mientras la app de Google esté en
modo de prueba. Cuando pasa, los correos dejan de entrar sin ruido: quien lo sufra
tiene que volver a conectar su cuenta en Operativa → Sincronización.

---

## Cosas que parecen rotas y no lo son

**Los despliegues de vista previa de las PR fallan siempre.** Las variables de
entorno están solo en Production y el build exige nueve. El check de «Vercel» en
rojo en una PR es lo esperado; el que importa es «Tipos, tests y colores».

**Un cambio no aparece en el navegador aunque esté en el HTML servido.** No es el
servidor de desarrollo, es el service worker: cachea los recursos y en desarrollo
los nombres de fichero son estables, así que sirve el mismo para siempre. Ni
reiniciar ni borrar `.next` lo arregla, porque la caché vive en el navegador:

```js
// En la consola de la página, y recargar:
(async () => {
  for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister()
  for (const k of await caches.keys()) await caches.delete(k)
  location.reload()
})()
```

**`deploy.sh` falla si lo ejecutas.** Está retirado a propósito: desplegaba el
árbol de trabajo y no un commit, y así llegó a producción código que no existía en
ningún sitio de git.

**La CLI de Vercel no está instalada.** Usa `npx --yes vercel@latest ...`, que ya
está autenticado.

---

## Costes

| | |
|---|---|
| Vercel Pro | ~20 $/mes — obligatorio, ver arriba |
| Supabase | Gratis hoy. **Sin copias automáticas propias y se pausa tras ~1 semana sin uso**; el plan de pago quita las dos cosas |
| Anthropic | Según uso. Los presupuestos por llamada están en `src/lib/ai.ts` |
| Fish Audio | Solo la voz de Harvey. Sin clave, Harvey escribe pero no habla |

Y una advertencia que no es técnica: **vigila que la tarjeta de Vercel no caduque**.
Es lo que provoca la trampa del despliegue silencioso de arriba.
