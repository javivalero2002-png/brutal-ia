# Nexus / BRUTAL.IA — contexto para trabajar en este repo

App interna de Brutal Studios (7 personas de confianza). **No es SaaS público** —
juzga cada recomendación contra esa escala.

Stack: Next.js 16 App Router · React 19 · TypeScript `strict` · Tailwind ·
Supabase (Postgres + Auth + Storage + Realtime) · Anthropic SDK · Gmail OAuth2
(personal + buzón compartido "colabs") · Google Calendar · web-push · PWA.
~20k LOC, 59 rutas API, 14 secciones. UI y comentarios en español.

---

## ⚠️ Trampas que ya han mordido

**1. `git push` a `main` DESPLIEGA A PRODUCCIÓN.** La integración Git de Vercel
está conectada (proyecto `brutalstudios-ia`). No hay staging. Todo commit en main
es una release: verifica antes de subir.

**2. El cron es UNO, horario — pero solo porque la cuenta es Pro.** Hasta el
2026-08-13 `vercel.json` llevaba **24 entradas diarias** (`0 0 * * *` … `0 23 * * *`),
un apaño deliberado y correcto: el plan **Hobby** limita cada cron job a *una vez
al día*, y 24 entradas individualmente diarias eran la única forma legal de tener
cobertura horaria. Al pasar a **Pro** el límite desaparece y se colapsaron en
`0 * * * *`.

**Si algún día se vuelve a Hobby, hay que deshacerlo** o el deploy falla con
`Hobby accounts are limited to daily cron jobs`. Y ojo al motivo real de estar en
Pro, que no es el cron: la documentación de Vercel dice que Hobby **restringe el
uso a no comercial y personal**, y esto es la herramienta de trabajo de una
empresa. Ver el comentario en `src/app/api/cron/sync-colabs/route.ts`.

**3. El techo de 60s ya NO es de la plataforma: es NUESTRO.** Esto decía «Hobby
implica funciones de 60s máximo» y **es falso desde 2026**. La documentación de
Vercel (verificada el 2026-08-13) da a Hobby **300s de máximo y de defecto** con
fluid compute, que viene activado por defecto en los proyectos nuevos. Los 60s que
ves son un `export const maxDuration = 60` escrito a mano en nuestras rutas.

Que sea nuestro no significa que sobre: las rutas que llaman a Claude en bucle
(`gmail/sync` hace hasta 20 llamadas secuenciales) se acotan a propósito con sus
presupuestos internos, y un tope bajo es lo que convierte «se colgó» en un error
con mensaje. Si algún día hace falta más margen, ahora se puede subir — pero
comprueba antes que el proyecto tiene fluid compute activo.

Lo que **sí sigue siendo cierto** es el límite de crons diarios del punto 2:
verificado el mismo día, con el mismo mensaje de error.

**3-bis. La app vive en `brutalia.tech` desde el 2026-08-13.** `brutalstudios-ia.vercel.app`
sigue activa y funcionando: se conservan las dos a propósito, para no dejar fuera a
quien tenga la PWA instalada con la vieja.

La URL **no se escribe a mano en ningún sitio** — sale de `NEXT_PUBLIC_APP_URL` a
través de `src/lib/appUrl.ts` (`APP_URL` / `APP_HOST` / `rutaApp`), y hay un test
que lo protege. Estaba cableada en cuatro sitios y tres eran texto que lee el
usuario: las instrucciones de invitación y la URL del webhook que se pega en Meta.

`GOOGLE_REDIRECT_URI` **no existe como variable**: el redirect se deriva de
`NEXT_PUBLIC_APP_URL` en `src/lib/gmail.ts`. Estaba en el `.env.local.example`
sin que la leyera nadie.

Cambiar de dominio toca **cuatro sitios y en este orden**, o se rompe el acceso:
Vercel (dominio) → Google Cloud (URI de redirección del cliente OAuth **existente**,
sin crear uno nuevo: un cliente nuevo invalida los refresh tokens de todo el equipo)
→ Supabase (Site URL + Redirect URLs) → `NEXT_PUBLIC_APP_URL` + redeploy. En Google
y Supabase se **añade** sin quitar la anterior, para poder volver atrás.

**Ojo con el Site URL de Supabase:** hasta el 2026-08-13 apuntaba a
`nexus-web-red-three.vercel.app`, un proyecto de Vercel borrado que devolvía 404. Es
lo que Supabase mete en los correos de «¿Olvidaste tu contraseña?», así que la
recuperación de contraseña llevaba semanas mandando a la gente a una página muerta —
y la sección Equipo dice justo que usen esa vía para entrar. No lo detectó nadie
porque recuperar contraseña es raro. Si algo va por correo, comprueba a dónde apunta.

**3-ter. Si la suscripción de Vercel está suspendida, los merges a `main` NO
despliegan — y no te enteras.** Pasó el 2026-08-18. La cuenta quedó suspendida
(`402 DEPLOYMENT_DISABLED` en el dominio, chip **Paused** en el panel, banner
«Your account has been suspended»), y el merge de la PR #24 se quedó con **0
checks**: no un build fallido, sino ningún intento. Producción siguió sirviendo el
merge anterior tan tranquila.

Lo que lo hace traicionero es que **reactivar la cuenta no reintenta ese commit**.
La app vuelve a responder 200, el panel se pone verde, y parece que ya está — pero
lo que hay vivo es el despliegue viejo. Si `main` tiene commits sin desplegar, hay
que **forzar una construcción nueva**, y no vale ni redesplegar desde el panel
(repite el commit viejo) ni `vercel --prod` (sube el árbol de trabajo, que es por
lo que se retiró `deploy.sh`). Un commit nuevo por PR es la única vía limpia, y el
push directo a `main` lo rechaza el ruleset.

Ojo también con el diagnóstico, que tiene dos códigos parecidos y distintos:
`402 DEPLOYMENT_DISABLED` es **facturación** (factura pendiente, límites del plan
o suscripción suspendida); `503 DEPLOYMENT_PAUSED` es el límite de gasto que uno
se pone a sí mismo. Y pagar la factura **no** reactiva una suscripción suspendida:
esto se cayó dos veces el mismo día porque lo primero se arregló y lo segundo no.
Se comprueba con `curl -sD- -o /dev/null https://brutalia.tech/login | grep
x-vercel-error`.

**4. `deploy.sh` está retirado a propósito** y falla si lo ejecutas. Desplegaba el
*árbol de trabajo*, no un commit, y así llegó a producción código que no existía
en ningún commit de git.

**5. La CLI de Vercel no está instalada globalmente** (`/usr/local/lib` es de root,
`npm i -g` da EACCES). Usa `npx --yes vercel@latest ...` — ya está autenticado.

---

## Fechas: usa siempre los helpers de Madrid

`src/components/shared/helpers.ts` expone `todayKey()` y `localDayKey()`
(Europe/Madrid, `YYYY-MM-DD`). **Nunca** uses `new Date().toISOString().slice(0,10)`
para lógica de negocio: da la fecha en UTC y a partir de las ~22:00 de Madrid
salta al día siguiente.

Un deadline es un **día**, no un instante. Comparar timestamps causó un bug real:
una tarea que vencía *hoy* se marcaba como vencida desde las 02:00 de Madrid,
mientras la UI decía lo contrario. `src/lib/automations.ts` compara day keys, y
hay tests que lo protegen.

---

## Convenciones del código

- **Rutas API**: `createClient()` para consultas con el usuario, `createAdminClient()`
  (service role, **se salta RLS**) para lo demás. Toda ruta que use el admin client
  debe resolver antes al usuario con `supabase.auth.getUser()`.
- **`pick(body, [...])`**: allowlist de columnas. Es lo que impide que un cliente
  escriba `created_by` o `role`. **No lo quites de donde está.** Ojo: se usa en 10
  de las 33 rutas que escriben; las otras 23 construyen el objeto campo a campo
  (comprobado: no es un agujero, pero tampoco des por hecho que `pick()` te cubre).
- **Autorización**: `src/lib/authz.ts`. `profiles.role` es la **única** señal de
  autorización del servidor. Las escrituras a `profiles` van solo por service role
  (el rol `authenticated` tiene REVOKE de update/insert/delete).
- **Modelo de seguridad**: workspace único compartido, sin multi-tenancy. La API
  es la barrera; RLS es defensa en profundidad.
- **supabase-js NO lanza** en error: devuelve `{ data: null, error }`. En un
  `Promise.all` que desestructura solo `data`, un fallo es indistinguible de "no
  hay filas" — un bug así vivió semanas. Usa `logQueryErrors()` de `src/lib/queryLog.ts`.
- **URLs del cliente**: valida con `isOwnStorageUrl()` (`src/lib/safeFetch.ts`)
  antes de hacer `fetch()` de cualquier URL que llegue en un body.

---

## Colores: la opacidad se concatena, así que la base tiene que ser hex

La UI genera variantes con `color + '18'`. Con hex sale `#1B5FFA18` (válido).
Con `rgba()` sale `rgba(27,95,250,0.9)18`, y el navegador **descarta la
declaración entera** — sin error y sin nada en consola: el elemento se pinta sin
fondo ni borde. Ha aparecido nueve veces.

`scripts/check-color-opacity.mjs` (en `prebuild`) lo detecta con el AST de
TypeScript. **No lo reescribas con expresiones regulares**: se intentó tres veces
y las tres fallaron con 385, 291 y 118 falsos positivos, porque en un ternario
`cond ? BLU : 'rgba(...)'` el texto plano parece asignarle el rgba a `BLU`, que es
hex. Prioriza precisión sobre cobertura: lo que no puede resolver se lo calla.

Bases hex disponibles en `design-tokens.ts`: `BLU`, `RED`, `GRN`, `AMBAR`.

## El modo claro es un filtro invertido, no un tema

`html.theme-light body` lleva `filter: invert(1) hue-rotate(180deg)`. Funciona
para grises y blancos, pero **hunde los colores de marca**: están elegidos para
fondo oscuro y al invertirse salen claros sobre blanco. Medido: rojo 4,26 → 2,17
· verde 8,64 → 3,10 · azul 3,81 → 2,70, con AA en 4,5.

Dos cosas que parecen la solución y no lo son:

**Ajustar los parámetros del filtro.** Probados `contrast`/`brightness`/
`saturate` en todo su rango útil; el mejor caso deja el peor color en 2,46.
Oscurecer el color oscurece también el fondo, así que la razón entre ambos
apenas se mueve.

**Declarar un color pre-compensado**, más claro, para que la inversión lo
devuelva oscuro. `hue-rotate(180deg)` **no es una rotación de tono**: es una
aproximación matricial que destruye el matiz en colores saturados. Un azul
`#467DFB` sale **verde oliva `#518D02`**, y un violeta sale marrón.

Lo único que funciona es **cancelar el filtro** en ese elemento
(`filter: invert(1) hue-rotate(180deg)`, que es lo que hace `.nx-noinvert`) y
declararle una variante oscura. Es lo que hay al final de `globals.css`, con
`src/lib/__tests__/modoClaro.test.ts` cubriéndolo.

Ojo con la forma del selector, que es donde se falla: `rgb(` **no** casa
`rgba(`, son dos selectores distintos. Y el de opacidad va sin paréntesis de
cierre para casar cualquier alfa, mientras que el de los grises lo lleva
**obligatoriamente**, porque ahí el alfa es justo lo que hay que distinguir
(`0.3` casaría `0.35`). Son reglas opuestas y conviven a diez líneas.

Queda sin arreglar, medido y a propósito: el anillo del orbe de Harvey (2,70 en
claro, 3,80 en oscuro, el mínimo son 3,0). Arreglarlo pide cancelar el filtro en
todo el botón, y entonces el icono blanco de dentro se vuelve invisible sobre
claro — hay que tocar el componente, no el CSS.

## El service worker sirve código viejo en desarrollo

Si un cambio no aparece en el navegador pero **sí está en el HTML servido**
(`curl localhost:3000/... | grep`), no es el dev server: es `public/sw.js`.
Cachea `/_next/static/` con estrategia *cache-first*, y en desarrollo los nombres
de chunk de Turbopack son **estables**, así que sirve el mismo fichero para
siempre. Ni reiniciar el servidor, ni borrar `.next`, ni abrir una pestaña nueva
lo arreglan — la caché vive en el navegador.

```js
// En la consola de la página, y recargar:
(async () => {
  for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister()
  for (const k of await caches.keys()) await caches.delete(k)
  location.reload()
})()
```

Esto costó horas en una sesión: se persiguieron bugs de hidratación que ya estaban
arreglados y se dudó de diagnósticos correctos. **La fuente de verdad es el HTML
servido y el bundle de producción, no lo que pinta la pestaña.**

## Antes de subir

```bash
npx tsc --noEmit && npm test && npm run build
```

`npm test` corre con `TZ=UTC` a propósito: en un portátil español los bugs de zona
horaria se esconden. `prebuild` ejecuta `scripts/check-env.mjs`, que aborta si
falta una variable obligatoria.

Desde agosto esto ya no depende de que te acuerdes: `.github/workflows/ci.yml`
corre tsc, los tests y el checker de colores en cada PR. **No corre `npm run
build`** a propósito — Vercel ya construye en cada push, y `prebuild` exige nueve
variables reales: darle credenciales falsas a CI sería validar algo que no se
parece a lo que se despliega.

## Los tests fijan REGLAS, no casos

Cuatro ficheros de `src/lib/__tests__/` no comprueban qué devuelve tal función:
comprueban un invariante sobre **todo** el código, incluido el que se escriba
mañana. Es la respuesta al hallazgo de fondo de la auditoría — más de la mitad de
los fallos graves eran **gemelos**, el mismo error escrito dos veces, arreglado en
una copia y vivo en la otra.

- `apiRoutes.test.ts` — toda ruta con service role resuelve antes al usuario,
  nadie se asciende a owner, ningún fallo de consulta se disfraza de lista vacía,
  ningún `select` saca tokens al cliente.
- `regresiones.test.ts` — ningún push sin `await` (y quien lo espera declara
  `maxDuration`), ningún borrado de Storage sin mirar su `error`, ningún deadline
  medido restando timestamps, ninguna respuesta de la API usada sin comprobar
  `ok`, ni `level` ni `status` silenciados con `as any`.
- `secciones.test.ts` — ninguna sección declara sus props como `any` ni recibe
  `data` sin tiparlo con `NexusData`.
- `logic.test.ts` / `automations.test.ts` — las fechas de Madrid y el motor.

**Si añades una regla, reintroduce el bug y comprueba que la suite se pone roja.**
Un test que nunca ha fallado no demuestra nada. Las cinco de `regresiones.test.ts`
están verificadas así.

Cada excepción va en una lista **con su motivo escrito**, y los tests avisan de las
entradas que ya no existen: una excepción que sobra se nota sola.

**Una regla que un comentario puede satisfacer no comprueba código, comprueba
prosa.** Pasó de verdad: este repo comenta mucho, y explicar en un comentario lo que
se acaba de quitar —«antes: `updateAgenda(id, { cover_url: json.url })`»— hace que la
regla que busca ese patrón lo encuentre. El fallo simétrico es el grave. Por eso
`regresiones.test.ts` tiene `leerCodigo()`, que quita los comentarios antes de mirar.

Y **acota la regla al sitio**, no al fichero: buscar `calendarId: calId` en todo
`gmail.ts` pasaba en verde con `mapEvent` roto, porque la LECTURA ya lo llevaba.
Igual con `maxRetries: 0`, que aparece en dos llamadas distintas. Las dos se
detectaron reintroduciendo el bug, que es justo para lo que sirve hacerlo.

## Lo que escribe el modelo no entra crudo en la base

Harvey emite `[ACCION:tarea|texto|nivel|persona]` y ese `nivel` es literalmente lo
que haya escrito Claude. El prompt le pide «urgent, high, normal» **en inglés**
dentro de una conversación entera en español, y `tasks.level` tiene
`CHECK (level in (...))`: un «urgente» hace que el INSERT rebote y la tarea **no se
cree**, después de que Harvey haya dicho en voz alta que la creaba. Vivió tanto
porque en `HoySection` el error de tipo estaba tapado con `as any`.

Pasa por `nivelTarea()` (`shared/helpers.ts`) cualquier valor que venga del modelo
y acabe en una columna con CHECK. Y **tipa las listas de literales**
(`const cols: ContentItem['status'][] = [...]`): sin el tipo, TypeScript las
ensancha a `string` y un valor mal escrito compila y revienta en ejecución. Ese
patrón exacto apareció en cinco sitios.

---

## Trabajo pendiente que NO debe hacerse a la ligera

Esto describía **dos** bloques con planes rechazados (15 y 17 roturas). Los dos se
midieron contra la base y el código reales, y encogieron mucho: los planes estaban
escritos sobre suposiciones.

**Reconciliación de esquema — CERRADA el 2026-08-13.** El embed crítico
`co_assignee:profiles!co_assigned_to` **ya funcionaba**, así que el 500 de
`GET /api/tasks` nunca llegó a existir. Solo faltaban dos columnas, y una de ellas
tenía la **revisión con cliente muerta**: sin `content_agenda.feedback`, la ruta
fallaba con 42703 y devolvía **404** — le mandabas el enlace a un cliente, escribía
su opinión, y le salía que no existe. Están en
`migrations/20260813_feedback_y_from_user_id.sql`.

**Bucket a privado — CERRADO, y verificado el 2026-08-19.** `content-videos` es
privado. No de palabra: se cogieron las seis direcciones que la base guarda de
verdad y se pidieron **sin sesión, sin cookies y sin cabeceras**. Las seis
responden `HTTP 400`, igual que una ruta inventada en el mismo bucket. Ese es el
único modo honesto de comprobarlo — el interruptor apagado en el panel y el bucket
cerrado de verdad no son la misma afirmación.

Esta sección decía «sigue público a propósito» y llevaba desfasada tiempo
indeterminado. Es la clase de mentira peor: hace que se trate como pendiente algo
ya hecho, y —al revés, si se cierra sin actualizar— que alguien confíe en una
puerta que cree abierta.

Cómo reproducir la comprobación, que es lo que hace que esto valga algo:

```bash
# Una dirección cualquiera de projects.cover_url / task_attachments.url,
# tal cual está guardada en la base:
curl -s -o /dev/null -w '%{http_code}\n' 'https://…supabase.co/storage/v1/object/public/content-videos/…'
# 400 = cerrado.   200 = ABIERTO: cualquiera con la dirección se lo descarga.
```

Lo que hizo posible cerrarlo, por si hay que rehacerlo en otra instancia: la base
guarda la dirección pública como **identificador estable** y cada ruta de lectura
la cambia por una firma temporal antes de responder (`src/lib/storageFirmado.ts`).
Hay dos reglas en `regresiones.test.ts` que lo vigilan — que toda ruta que
devuelve una columna de fichero la firme, y que lo que se firma sea lo que la
consulta trae. El caso que no encajaba ahí era Memoria, que guarda el enlace
DENTRO del texto de la nota; lo resuelve `/api/archivo`, y
`/api/admin/memoria-enlaces` encuentra y arregla las notas antiguas que aún
llevaran la dirección cruda (Operativa → Copias).

**Lo irreversible sigue siendo *borrar* o *renombrar* el bucket**: el nombre va
escrito dentro de cada dirección guardada. Abrirlo y cerrarlo es el mismo clic.

Los restos del plan rechazado viven en `docs/sql-rechazado/`. **No los ejecutes.**
Estuvieron por error dentro de `migrations/`, junto a una migración legítima y con
el mismo prefijo de fecha: se colaron en el commit `5861947` con un `git add -A`
sin la exclusión que llevaban los demás commits de esa tanda.

## Un timeout no acota una llamada: acota un INTENTO

El `timeout` del SDK de Anthropic es **por intento**. Con `maxRetries: 1` son dos
intentos más el backoff (~30 s), y si llega un 429 el SDK **obedece su
`Retry-After` hasta 60 s**: una sola llamada puede costar ~75 s.

Por eso un presupuesto de bucle no funciona, y bajarlo tampoco: el bucle
comprobaba «¿me he pasado?» **entre** iteraciones, o sea que autorizaba una llamada
sin saber lo que iba a costar. Se probó bajar 45 s → 25 s y la verificación
adversarial lo tumbó: ningún número sobrevive a la rama del 429, y bajarlo se paga
todos los días en throughput (a ~3 s por email, 45 s son ~15 correos y 25 s son ~8).

Lo correcto es preguntar **si cabe la siguiente** y pasarle ese plazo a la llamada:
`plazoRestante()` y el parámetro `plazoMs` de `analyzeEmail` (`src/lib/ai.ts`). Y
el reloj arranca **antes** del fetch de Gmail — ese fetch y sus consultas también
gastan del minuto.

Lo mismo con los `fetch` crudos de servidor: sin `signal` rigen los defaults de
undici, **300 s**, cinco veces el `maxDuration`. El modo de fallo no es una caída
—esa cae sola en segundos— sino un **cuelgue**, y entonces Vercel mata la función
sin respuesta y el camino de error que hay escrito debajo no se ejecuta nunca.
Había cinco así.

## Lo que se PINTA de un fichero no es lo que hay GUARDADO

La base guarda la URL pública como **identificador estable** y las rutas de lectura
la sustituyen por una firma temporal antes de responder (`src/lib/storageFirmado.ts`).
O sea que un formulario enseña una firma con su token, y **reenviarla al guardar
rompe dos veces**:

- pisa el identificador con una firma que caduca;
- y si `firmarUrl()` falla devuelve `null` **a propósito** (un enlace roto que
  parece bueno confunde más que un hueco), el campo se pinta vacío y guardar
  escribe `null` encima. El fichero se queda en el bucket y la app olvida dónde
  está. Bastaba con escribir una nota y darle a guardar.

Regla: **un campo que el usuario no ha tocado no viaja en el PATCH.** Y cuando el
mismo valor tiene dos consumidores con requisitos opuestos —el visor necesita algo
que el navegador pueda abrir; `analyze-pdf` exige que pase `isOwnStorageUrl`— hay
que **separarlos en el estado** (`url` para pintar, `ident` para el servidor).
Envolver la URL sin separarlos arregla el visor y estropea el chat del PDF, y
**compila**, porque las dos son `string`.


---

## Fuera de alcance (decidido, no olvidado)

No propongas esto sin un motivo nuevo: CSP con nonce (no hay ni un
`dangerouslySetInnerHTML`) · `timingSafeEqual` (no medible por internet) ·
migrar a React Query (Realtime + optimistic updates ya reconcilian) · extraer un
design system (la duplicación medida es de ~127 líneas) · paginación general (a
esta escala el seq scan gana) · RLS multi-tenant (el producto *es* un workspace
único) · Server Components (PWA realtime tras auth, sin SEO) · prompt caching en
`/api/chat` (el bloque estático son ~400 tokens, el mínimo de Sonnet son 1024).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
