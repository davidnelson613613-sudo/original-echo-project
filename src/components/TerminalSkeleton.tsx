// Full-screen dark skeleton shown while auth resolves or a route chunk loads.
// Renders instantly (no data, no heavy imports) so the user never sees a
// blank page or a bare spinner on cold visits.

export function TerminalSkeleton() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Top nav strip */}
      <div className="border-b border-slate-800/60 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex h-12 max-w-7xl items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <div className="h-5 w-24 rounded bg-slate-800/70 animate-pulse shimmer" />
            <div className="hidden sm:flex gap-2">
              <div className="h-4 w-16 rounded bg-slate-800/50 animate-pulse shimmer" />
              <div className="h-4 w-20 rounded bg-slate-800/50 animate-pulse shimmer" />
              <div className="h-4 w-16 rounded bg-slate-800/50 animate-pulse shimmer" />
            </div>
          </div>
          <div className="h-7 w-7 rounded-full bg-slate-800/70 animate-pulse shimmer" />
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-4">
        {/* Status ribbon */}
        <div className="mb-3 flex flex-wrap gap-2">
          <div className="h-6 w-32 rounded-full bg-slate-800/60 animate-pulse shimmer" />
          <div className="h-6 w-24 rounded-full bg-slate-800/50 animate-pulse shimmer" />
          <div className="h-6 w-20 rounded-full bg-slate-800/50 animate-pulse shimmer" />
        </div>

        {/* Scan grid skeleton */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="rounded-2xl border border-slate-800/70 bg-slate-900/40 p-4"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <div className="flex items-center justify-between">
                <div className="h-4 w-16 rounded bg-slate-800/70 animate-pulse shimmer" />
                <div className="h-4 w-12 rounded bg-slate-800/50 animate-pulse shimmer" />
              </div>
              <div className="mt-3 h-8 w-28 rounded bg-slate-800/70 animate-pulse shimmer" />
              <div className="mt-4 space-y-2">
                <div className="h-3 w-full rounded bg-slate-800/50 animate-pulse shimmer" />
                <div className="h-3 w-5/6 rounded bg-slate-800/40 animate-pulse shimmer" />
                <div className="h-3 w-2/3 rounded bg-slate-800/40 animate-pulse shimmer" />
              </div>
              <div className="mt-4 flex gap-2">
                <div className="h-6 w-16 rounded bg-slate-800/50 animate-pulse shimmer" />
                <div className="h-6 w-16 rounded bg-slate-800/40 animate-pulse shimmer" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
