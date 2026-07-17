import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { computeIntradayProjection, type IntradayProjectionResult } from "./intraday-analog.server";

const input = z.object({
  symbol: z.string().min(1).max(12),
  // Client cache-buster. The server calculation only needs `symbol`, but this
  // keeps old successful/empty GET payloads from being reused after pipeline
  // fixes or timestamp-parser changes.
  version: z.string().optional(),
});

export const getIntradayAnalogProjection = createServerFn({ method: "GET" })
  .inputValidator((d) => input.parse(d))
  .handler(async ({ data }): Promise<IntradayProjectionResult> => {
    return computeIntradayProjection(data.symbol);
  });

export type { IntradayProjectionResult } from "./intraday-analog.server";