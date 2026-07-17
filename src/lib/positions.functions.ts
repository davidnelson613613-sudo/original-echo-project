import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { FillEntry, Position, PositionMap, PositionSettings } from "./positions-shared";

const fillSchema = z.object({
  day: z.number(),
  pct: z.number(),
  shares: z.number(),
  price: z.number(),
  filledAt: z.string(),
  auto: z.boolean(),
});

const rungSchema = z.object({
  pct: z.number(),
  price: z.number(),
  label: z.string(),
  reason: z.string(),
});

const positionInputSchema = z.object({
  symbol: z.string().min(1).max(12),
  totalCapital: z.number(),
  scenario: z.string(),
  createdAt: z.string(),
  entries: z.array(fillSchema),
  plannedLadder: z.array(rungSchema).optional(),
});

function rowToPosition(row: {
  symbol: string;
  total_capital: number;
  scenario: string;
  created_at: string;
  entries: unknown;
  planned_ladder: unknown;
}): Position {
  return {
    symbol: row.symbol,
    totalCapital: Number(row.total_capital),
    scenario: row.scenario,
    createdAt: row.created_at,
    entries: Array.isArray(row.entries) ? (row.entries as FillEntry[]) : [],
    plannedLadder: Array.isArray(row.planned_ladder)
      ? (row.planned_ladder as Position["plannedLadder"])
      : undefined,
  };
}

export const listPositionsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PositionMap> => {
    const { data, error } = await context.supabase
      .from("positions")
      .select("symbol,total_capital,scenario,created_at,entries,planned_ladder")
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    const map: PositionMap = {};
    for (const row of data ?? []) map[row.symbol] = rowToPosition(row);
    return map;
  });

export const upsertPositionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => positionInputSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("positions").upsert(
      {
        user_id: context.userId,
        symbol: data.symbol,
        total_capital: data.totalCapital,
        scenario: data.scenario,
        created_at: data.createdAt,
        entries: data.entries,
        planned_ladder: data.plannedLadder ?? null,
      },
      { onConflict: "user_id,symbol" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deletePositionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ symbol: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("positions")
      .delete()
      .eq("user_id", context.userId)
      .eq("symbol", data.symbol);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getSettingsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PositionSettings> => {
    const { data, error } = await context.supabase
      .from("position_settings")
      .select("auto_fill,recovery_capture")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return {
      autoFill: data?.auto_fill ?? false,
      recoveryCapture: data?.recovery_capture ?? true,
    };
  });

export const updateSettingsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ autoFill: z.boolean().optional(), recoveryCapture: z.boolean().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const patch = {
      user_id: context.userId,
      ...(data.autoFill !== undefined ? { auto_fill: data.autoFill } : {}),
      ...(data.recoveryCapture !== undefined ? { recovery_capture: data.recoveryCapture } : {}),
    };
    const { error } = await context.supabase
      .from("position_settings")
      .upsert(patch, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });