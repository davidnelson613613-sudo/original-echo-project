-- Fix PRIVILEGE_ESCALATION on public.telegram_config: any authenticated user
-- (including anonymous guests) could hijack the shared chat_id, quiet hours,
-- and alert flags. Restrict every operation to the owning user.

DROP POLICY IF EXISTS "Anyone authenticated can read telegram_config"   ON public.telegram_config;
DROP POLICY IF EXISTS "Anyone authenticated can insert telegram_config" ON public.telegram_config;
DROP POLICY IF EXISTS "Anyone authenticated can update telegram_config" ON public.telegram_config;

-- Owner-only read
CREATE POLICY "Owner reads telegram_config"
  ON public.telegram_config
  FOR SELECT
  TO authenticated
  USING (owner_user_id IS NOT NULL AND owner_user_id = auth.uid());

-- Owner-only insert: caller must claim ownership as themselves
CREATE POLICY "Owner inserts telegram_config"
  ON public.telegram_config
  FOR INSERT
  TO authenticated
  WITH CHECK (owner_user_id = auth.uid());

-- Owner-only update: must stay the owner
CREATE POLICY "Owner updates telegram_config"
  ON public.telegram_config
  FOR UPDATE
  TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

-- Owner-only delete (kept tight even though the UI doesn't delete)
CREATE POLICY "Owner deletes telegram_config"
  ON public.telegram_config
  FOR DELETE
  TO authenticated
  USING (owner_user_id = auth.uid());
