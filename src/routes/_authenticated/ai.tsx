import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { ClientOnlyAiBubble } from "@/components/ClientOnlyChrome";

export const Route = createFileRoute("/_authenticated/ai")({
  head: () => ({
    meta: [
      { title: "Laddrx AI — Full-screen Copilot" },
      { name: "description", content: "Full-page AI copilot for the Laddrx terminal — choose between Gemini, GPT-5 and more." },
      { property: "og:title", content: "Laddrx AI — Full-screen Copilot" },
      { property: "og:description", content: "Full-page AI copilot for the Laddrx terminal — choose between Gemini, GPT-5 and more." },
    ],
  }),
  component: AiPage,
});

function AiPage() {
  return (
    <div className="min-h-dvh bg-slate-950">
      <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-slate-800/70 bg-slate-950/85 pl-16 pr-3 py-2.5 backdrop-blur sm:pl-20">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/60 px-2.5 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-cyan-400/40 hover:text-cyan-100"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Back to terminal</span>
          <span className="sm:hidden">Back</span>
        </Link>
        <div className="truncate font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">
          Laddrx AI · Full Screen
        </div>
        <div className="w-[60px] shrink-0 sm:w-[130px]" />
      </header>
      <main>
        <ClientOnlyAiBubble variant="page" />
      </main>
    </div>
  );
}
