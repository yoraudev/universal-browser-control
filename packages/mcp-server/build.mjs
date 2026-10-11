import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const version = process.env.UBC_VERSION || JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;

await build({
  entryPoints: [join(root, "src/index.ts")],
  outfile: join(root, "dist/index.cjs"),
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  define: { __UBC_VERSION__: JSON.stringify(version) },
  logLevel: "warning",
});
