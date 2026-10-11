import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { TOOLS } from "../packages/shared/src/tools.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const GROUP_STARTS = {
  browser_list: "Tabs and windows",
  page_snapshot: "Reading the page",
  click: "Interaction",
  evaluate_js: "DevTools",
  cookies: "Browser data",
};

function typeOf(schema) {
  if (schema.enum) return schema.enum.map((value) => `\`${JSON.stringify(value)}\``).join(" or ");
  if (schema.type === "array") return `${typeOf(schema.items ?? {})}[]`;
  if (schema.type === "object") return "object";
  return schema.type ?? "any";
}

function cell(text) {
  return String(text).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

const lines = [
  "# Tools",
  "",
  "This file is generated from `packages/shared/src/tools.ts` by `npm run docs:tools`. Do not edit it by hand.",
  "",
  `There are ${TOOLS.length} tools. Every tool except \`browser_list\` also accepts an optional \`browser\` parameter (a browser id or part of its name from \`browser_list\`), which is only needed when several browsers are connected.`,
  "",
  "Elements are addressed by `ref` (from `page_snapshot` or `page_find`), by CSS `selector`, or by viewport coordinates `x` / `y` in CSS pixels.",
];

for (const tool of TOOLS) {
  if (GROUP_STARTS[tool.name]) lines.push("", `## ${GROUP_STARTS[tool.name]}`);
  lines.push("", `### \`${tool.name}\``, "", tool.description);
  const schema = z.toJSONSchema(tool.input, { io: "input" });
  const properties = Object.entries(schema.properties ?? {});
  if (!properties.length) {
    lines.push("", "No parameters.");
    continue;
  }
  const required = new Set(schema.required ?? []);
  lines.push("", "| Parameter | Type | Required | Default | Description |", "| --- | --- | --- | --- | --- |");
  for (const [name, property] of properties) {
    const fallback = property.default === undefined ? "" : `\`${JSON.stringify(property.default)}\``;
    lines.push(`| \`${name}\` | ${cell(typeOf(property))} | ${required.has(name) ? "yes" : ""} | ${cell(fallback)} | ${cell(property.description ?? "")} |`);
  }
}

writeFileSync(join(root, "docs/tools.md"), `${lines.join("\n")}\n`);
console.log(`Wrote docs/tools.md with ${TOOLS.length} tools`);
