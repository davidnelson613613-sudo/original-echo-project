import { createFileRoute } from "@tanstack/react-router";

/**
 * Server-side proxy for Lovable AI speech-to-text. The browser posts a
 * `file` (a self-contained audio blob recorded via MediaRecorder) as
 * multipart/form-data; we forward it to the gateway with our API key and
 * return the plain-text transcript.
 */
export const Route = createFileRoute("/api/explain-stt")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("LOVABLE_API_KEY missing", { status: 500 });

        let inbound: FormData;
        try {
          inbound = await request.formData();
        } catch {
          return new Response("multipart/form-data required", { status: 400 });
        }
        const file = inbound.get("file");
        if (!(file instanceof Blob) || file.size < 512) {
          return new Response("empty recording", { status: 400 });
        }

        // Preserve the real container extension so the model can decode it.
        const mime = (file.type || "").split(";")[0];
        const ext =
          ({
            "audio/webm": "webm",
            "audio/ogg": "ogg",
            "audio/mp4": "mp4",
            "audio/mpeg": "mp3",
            "audio/wav": "wav",
            "audio/x-wav": "wav",
          } as Record<string, string>)[mime] ?? "webm";

        const upstream = new FormData();
        upstream.append("model", "openai/gpt-4o-mini-transcribe");
        upstream.append("file", file, `explain.${ext}`);

        try {
          const res = await fetch(
            "https://ai.gateway.lovable.dev/v1/audio/transcriptions",
            {
              method: "POST",
              headers: { Authorization: `Bearer ${key}` },
              body: upstream,
            },
          );
          if (!res.ok) {
            const body = await res.text().catch(() => "");
            return new Response(body || `transcription failed: ${res.status}`, {
              status: res.status,
            });
          }
          const data = (await res.json()) as { text?: string };
          return Response.json({ text: (data.text ?? "").trim() });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return new Response(`stt error: ${msg}`, { status: 500 });
        }
      },
    },
  },
});
