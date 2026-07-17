// Recent alert history for the current user.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AlertHistoryRow = {
  id: string;
  symbol: string;
  alert_key: string;
  alert_kind: string;
  message: string | null;
  target_price: number | null;
  live_price: number | null;
  created_at: string;
};

export const getMyAlertHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AlertHistoryRow[]> => {
    const { data, error } = await context.supabase
      .from("alert_deliveries")
      .select("id,symbol,alert_key,alert_kind,message,target_price,live_price,created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return (data ?? []) as AlertHistoryRow[];
  });
