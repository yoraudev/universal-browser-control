import { build } from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, "dist");
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

await build({
  entryPoints: {
    background: join(root, "src/background/index.ts"),
    popup: join(root, "src/popup/popup.ts"),
  },
  outdir: dist,
  bundle: true,
  format: "esm",
  target: "chrome120",
  logLevel: "warning",
});
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
if (process.env.UBC_VERSION) manifest.version = process.env.UBC_VERSION;
writeFileSync(join(dist, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
cpSync(join(root, "src/popup/popup.html"), join(dist, "popup.html"));
cpSync(join(root, "icons"), join(dist, "icons"), { recursive: true, filter: (source) => !/\.(svg|mjs)$/.test(source) });
