-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION: Gmail colabs fields + shared inbox + email cache
-- Run in: Supabase Dashboard → SQL Editor
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add colabs Gmail token fields to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS gmail_colabs_refresh_token text,
  ADD COLUMN IF NOT EXISTS gmail_colabs_connected boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gmail_account text,
  ADD COLUMN IF NOT EXISTS gmail_colabs_account text;

-- 2. Add shared flag and attachments to inbox_messages
ALTER TABLE public.inbox_messages
  ADD COLUMN IF NOT EXISTS shared boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS attachments jsonb;

-- 3. Index for fast shared-message lookups
CREATE INDEX IF NOT EXISTS idx_inbox_shared ON public.inbox_messages(shared) WHERE shared = true;

-- 4. Update inbox RLS: users see own messages OR shared team messages
DROP POLICY IF EXISTS "users_own_inbox" ON public.inbox_messages;
CREATE POLICY "users_inbox_access" ON public.inbox_messages
  FOR ALL USING (
    user_id = auth.uid()
    OR (shared = true AND auth.uid() IS NOT NULL)
  );

-- 5. Allow team members to read each other's connection status (owners can see all profiles)
-- (existing policy "owners_see_all_profiles" already handles this for SELECT)
