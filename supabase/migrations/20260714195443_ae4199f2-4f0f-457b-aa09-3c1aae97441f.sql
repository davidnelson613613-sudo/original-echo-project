
-- telegram_links: drop old policies, recreate with anon-exclusion + add INSERT/UPDATE
DROP POLICY IF EXISTS "Users view own telegram link" ON public.telegram_links;
DROP POLICY IF EXISTS "Users delete own telegram link" ON public.telegram_links;

CREATE POLICY "Users view own telegram link"
  ON public.telegram_links FOR SELECT TO authenticated
  USING (auth.uid() = user_id AND (auth.jwt() ->> 'is_anonymous')::boolean IS NOT TRUE);

CREATE POLICY "Users insert own telegram link"
  ON public.telegram_links FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND (auth.jwt() ->> 'is_anonymous')::boolean IS NOT TRUE);

CREATE POLICY "Users update own telegram link"
  ON public.telegram_links FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND (auth.jwt() ->> 'is_anonymous')::boolean IS NOT TRUE)
  WITH CHECK (auth.uid() = user_id AND (auth.jwt() ->> 'is_anonymous')::boolean IS NOT TRUE);

CREATE POLICY "Users delete own telegram link"
  ON public.telegram_links FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND (auth.jwt() ->> 'is_anonymous')::boolean IS NOT TRUE);

-- market_scan_snapshots: restrict to authenticated users only
DROP POLICY IF EXISTS "Anyone can read latest snapshot" ON public.market_scan_snapshots;

CREATE POLICY "Authenticated users read snapshots"
  ON public.market_scan_snapshots FOR SELECT TO authenticated
  USING (true);

REVOKE SELECT ON public.market_scan_snapshots FROM anon;
GRANT SELECT ON public.market_scan_snapshots TO authenticated;
