// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import type { Plugin } from "vite";

function stripTanStackDevSourceAttributes(): Plugin {
  return {
    name: "strip-tanstack-dev-source-attributes",
    enforce: "post",
    transform(code, id) {
      if (!id.includes("/src/") || !/\.[jt]sx(?:\?|$)/.test(id)) return null;
      if (!code.includes("data-tsd-source")) return null;
      return {
        code: code.replace(/\sdata-tsd-source="[^"]*"/g, ""),
        map: null,
      };
    },
  };
}

export default defineConfig({
  plugins: [stripTanStackDevSourceAttributes()],
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
