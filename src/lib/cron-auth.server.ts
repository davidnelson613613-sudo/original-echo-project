// Shared auth check for cron hook endpoints. Accepts CRON_SECRET via
// `Authorization: Bearer <secret>` or `x-cron-secret` header. The
// publishable Supabase anon key is NOT accepted — it ships in the client
// bundle and is not a secret.
import { timingSafeEqual } from "node:crypto";

export function requireCronSecret(request: Request): Response | null {
  const expected = process.env.CRON_SECRET ?? "";
  if (!expected) {
    return new Response(JSON.stringify({ error: "cron_secret_not_configured" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
  const auth = request.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
  const alt = request.headers.get("x-cron-secret") ?? "";
  const provided = bearer || alt;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  const ok = a.length === b.length && timingSafeEqual(a, b);
  if (!ok) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  return null;
}
