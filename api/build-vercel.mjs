import { build } from "esbuild";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { mkdirSync, writeFileSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Vercel Build Output API: https://vercel.com/docs/build-output-api/v3
// Writing here bypasses source-file validation — Vercel reads this dir directly.
const funcDir = resolve(__dirname, ".vercel/output/functions/api.func");
const outDir = resolve(__dirname, ".vercel/output");

mkdirSync(funcDir, { recursive: true });
mkdirSync(resolve(outDir, "static"), { recursive: true });

await build({
  entryPoints: [resolve(__dirname, "api/_handler.ts")],
  bundle: true,
  outfile: resolve(funcDir, "index.js"),
  platform: "node",
  // Firestore transitively depends on google-gax, which expects CommonJS
  // globals (e.g. __dirname) at runtime.
  format: "cjs",
  target: "node22",
  minify: false,
  sourcemap: false,
});

// Function config
writeFileSync(
  resolve(funcDir, ".vc-config.json"),
  JSON.stringify(
    {
      runtime: "nodejs22.x",
      handler: "index.js",
      launcherType: "Nodejs",
      maxDuration: 30,
    },
    null,
    2,
  ),
);

// Routing config — all requests go to the /api function
writeFileSync(
  resolve(outDir, "config.json"),
  JSON.stringify(
    {
      version: 3,
      routes: [{ src: "/(.*)", dest: "/api" }],
    },
    null,
    2,
  ),
);

console.log("✅ Vercel Build Output API written to .vercel/output/");
