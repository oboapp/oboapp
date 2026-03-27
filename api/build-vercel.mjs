import { build } from "esbuild";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [resolve(__dirname, "api/_handler.ts")],
  bundle: true,
  outfile: resolve(__dirname, "api/index.mjs"),
  platform: "node",
  format: "esm",
  target: "node20",
  // Only @vercel/node is external — provided by the runtime
  // Everything else (hono, @oboapp/shared, @oboapp/db, etc.) gets bundled
  external: ["@vercel/node"],
  minify: false,
  sourcemap: true,
});

console.log("✅ Bundled api/index.mjs");
