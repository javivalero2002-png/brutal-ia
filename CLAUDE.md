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

**2. NO colapses los 24 crons de `vercel.json`.** La cuenta es plan **Hobby**,
donde cada cron job debe ser como máximo *diario*. Las 24 entradas
(`0 0 * * *` … `0 23 * * *`) son un apaño **deliberado y correcto** para tener
cobertura horaria. Un solo `0 * * * *` hace que el deploy falle con
`Hobby accounts are limited to daily cron jobs`. Ver el comentario en
`src/app/api/cron/sync-colabs/route.ts`.

**3. Hobby también implica funciones de 60s máximo.** Las rutas que llaman a
Claude en bucle (`gmail/sync` hace hasta 20 llamadas secuenciales) rozan ese techo.

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

## Antes de subir

```bash
npx tsc --noEmit && npm test && npm run build
```

`npm test` corre con `TZ=UTC` a propósito: en un portátil español los bugs de zona
horaria se esconden. `prebuild` ejecuta `scripts/check-env.mjs`, que aborta si
falta una variable obligatoria.

---

## Trabajo pendiente que NO debe hacerse a la ligera

Dos bloques tocan **datos que ya existen** y sus planes fueron rechazados por
verificación adversarial (15 y 17 roturas concretas). Requieren análisis nuevo y
que el fundador esté delante — incluyen SQL contra la base de datos viva:

1. **Bucket a privado.** `content-videos` es público y contiene contratos,
   presupuestos y briefs. El problema no es hacerlo privado: es que las URLs
   públicas están **guardadas como strings** en `projects.cover_url`,
   `projects.pdf_url`, `content_agenda.*`, `task_attachments.url`. Todas devuelven
   404 en cuanto cambie el bucket. Además `clients/[id]/files` deriva su listado en
   vivo de `storage.list()`, y `task_attachments.url` es `NOT NULL`.
2. **Reconciliación de esquema.** Hay columnas que el código usa y que no tienen
   DDL en ningún `.sql` del repo. La más crítica: `src/app/api/tasks/route.ts` hace
   embed de `co_assignee:profiles!co_assigned_to(...)` en **toda** lectura de
   tareas — sin esa FK, `GET /api/tasks` devuelve 500 y la app arranca sin tareas.

Los restos de ese plan rechazado viven en `docs/sql-rechazado/`. **No los
ejecutes.** Estuvieron por error dentro de `migrations/`, junto a una migración
legítima y con el mismo prefijo de fecha: se colaron en el commit `5861947` con un
`git add -A` sin la exclusión que llevaban los demás commits de esa tanda.

---

## Fuera de alcance (decidido, no olvidado)

No propongas esto sin un motivo nuevo: CSP con nonce (no hay ni un
`dangerouslySetInnerHTML`) · `timingSafeEqual` (no medible por internet) ·
migrar a React Query (Realtime + optimistic updates ya reconcilian) · extraer un
design system (la duplicación medida es de ~127 líneas) · paginación general (a
esta escala el seq scan gana) · RLS multi-tenant (el producto *es* un workspace
único) · Server Components (PWA realtime tras auth, sin SEO) · prompt caching en
`/api/chat` (el bloque estático son ~400 tokens, el mínimo de Sonnet son 1024).
