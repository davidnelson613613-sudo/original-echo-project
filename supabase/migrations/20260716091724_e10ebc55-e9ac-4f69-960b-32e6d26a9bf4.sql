
-- Restrict system_alert_deliveries: no client-side reads. Only service_role (bypasses RLS) accesses it.
DROP POLICY IF EXISTS "Authenticated can view system alert deliveries" ON public.system_alert_deliveries;

CREATE POLICY "No direct access to system alert deliveries"
  ON public.system_alert_deliveries
  FOR SELECT
  TO authenticated
  USING (false);

-- Re-scope telegram_link_codes policy explicitly to authenticated only (split ALL into per-command policies for clarity).
DROP POLICY IF EXISTS "Users manage own link codes" ON public.telegram_link_codes;

CREATE POLICY "Users select own link codes"
  ON public.telegram_link_codes FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own link codes"
  ON public.telegram_link_codes FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own link codes"
  ON public.telegram_link_codes FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own link codes"
  ON public.telegram_link_codes FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
