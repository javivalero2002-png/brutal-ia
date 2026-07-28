-- Migración: columnas de cuenta y vídeo para las piezas de contenido
-- Ejecutar en: Supabase Dashboard → SQL Editor → New query → Run
alter table public.content_agenda add column if not exists account_name text;
alter table public.content_agenda add column if not exists video_url text;
