-- ─────────────────────────────────────────────────────────────────────────────
-- BRUTAL.IA — RLS como red de seguridad (OPCIONAL, ejecutar DESPUÉS del otro)
--
-- Contexto: todas las rutas API usan el service role, que se salta RLS. El
-- control de acceso real vive en el código (src/lib/authz.ts). Esto NO lo
-- sustituye: es una segunda barrera por si alguna ruta futura se olvida.
--
-- ⚠️  IMPORTANTE — orden y verificación:
--   1) Ejecuta primero 20260809_audit_fixes.sql
--   2) Ejecuta este archivo
--   3) Abre la app y comprueba que el INBOX SIGUE ACTUALIZÁNDOSE SOLO
--      (Supabase Realtime necesita la política SELECT de abajo).
--      Si algo falla, la última sección revierte todo.
-- ─────────────────────────────────────────────────────────────────────────────


-- El service role ignora RLS, así que las rutas API siguen funcionando igual.
alter table public.inbox_messages   enable row level security;
alter table public.tasks            enable row level security;
alter table public.projects         enable row level security;
alter table public.clients          enable row level security;
alter table public.reglas           enable row level security;
alter table public.content_agenda   enable row level security;
alter table public.chat_messages    enable row level security;


-- ── inbox_messages: IMPRESCINDIBLE para que Realtime siga funcionando ────────
-- El navegador se suscribe directamente a esta tabla (useNexusData). Sin esta
-- política, el inbox dejaría de actualizarse en tiempo real.
drop policy if exists "inbox: leer propios y compartidos" on public.inbox_messages;
create policy "inbox: leer propios y compartidos"
  on public.inbox_messages for select
  to authenticated
  using (user_id = auth.uid() or shared = true);


-- ── chat_messages: cada usuario ve solo su historial ────────────────────────
drop policy if exists "chat: leer propios" on public.chat_messages;
create policy "chat: leer propios"
  on public.chat_messages for select
  to authenticated
  using (user_id = auth.uid());


-- El resto de tablas queda sin políticas a propósito: solo se acceden vía API
-- con service role. Ningún cliente del navegador las consulta directamente.


-- ─────────────────────────────────────────────────────────────────────────────
-- REVERTIR (si el inbox en tiempo real deja de funcionar, ejecuta esto):
--
--   alter table public.inbox_messages disable row level security;
--   alter table public.tasks          disable row level security;
--   alter table public.projects       disable row level security;
--   alter table public.clients        disable row level security;
--   alter table public.reglas         disable row level security;
--   alter table public.content_agenda disable row level security;
--   alter table public.chat_messages  disable row level security;
-- ─────────────────────────────────────────────────────────────────────────────
