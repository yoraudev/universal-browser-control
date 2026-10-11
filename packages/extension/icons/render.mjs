import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const dir = dirname(fileURLToPath(import.meta.url));
const svg = readFileSync(join(dir, "icon.svg"), "utf8");
const browser = await puppeteer.launch();
const page = await browser.newPage();

for (const size of [16, 32, 48, 128]) {
  await page.setViewport({ width: size, height: size });
  await page.setContent(`<style>html, body { margin: 0; background: transparent; } svg { display: block; width: ${size}px; height: ${size}px; }</style>${svg}`);
  await page.screenshot({ path: join(dir, `icon-${size}.png`), omitBackground: true });
}

await browser.close();
