import { it, expect } from "vitest";
import { cssVariables } from "./tokens";

const render = () => `/* Generated from src/theme/tokens.ts by \`npm run tokens\`. Do not edit. */\n:root {\n${Object.entries(cssVariables()).map(([k, v]) => `  ${k}: ${v};`).join("\n")}\n}\n`;

it("tokens.css is generated from tokens.ts", async () => {
  // Node APIs via a runtime specifier: the app's tsconfig has no Node types.
  const fsName = "node:fs", fs = await import(/* @vite-ignore */ fsName) as { readFileSync(p: URL, e: string): string; writeFileSync(p: URL, d: string): void };
  const path = new URL("./tokens.css", import.meta.url);
  if ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.UPDATE_TOKENS) fs.writeFileSync(path, render());
  expect(fs.readFileSync(path, "utf8")).toBe(render());
});
