#!/usr/bin/env node
// README screenshots (docs/adr/0026-readme-screenshots.md): `npm run screenshots`.
//
// Starts the planner on a free local port with an isolated, empty settings folder, opens the
// read-only sample project shipped in samples/demo and photographs a fixed set of views into
// docs/screenshots/*.webp. It never reads the user's own projects, settings, .env or OpenAI key:
// the server gets a hand-built environment instead of process.env and the git-ignored .env.
//
// Needs a Chromium for Playwright once: `npx playwright install chromium`. A different binary can
// be given with SCREENSHOTS_CHROMIUM=/path/to/chrome (for example in a container).
import react from "@vitejs/plugin-react";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { createServer } from "vite";
import { createApi } from "../server/api.ts";
import { createContext } from "../server/context.ts";

const root = join(import.meta.dirname, "..");
const outDir = join(root, "docs", "screenshots");
const viewport = { width: 1440, height: 900 };

/** One README image: how to get there from the sample's Home, and the colour scheme. */
interface Shot {
  name: string;
  scheme: "light" | "dark";
  /** Runs after the page opened on Home (the start screen for "start"). */
  go(page: Page): Promise<void>;
}

const tab = (page: Page, label: string) =>
  page.locator('nav[aria-label="Sections"] [role=tab]', { hasText: label }).first().click();

const SHOTS: Shot[] = [
  { name: "start", scheme: "light", go: async () => {} },
  { name: "home", scheme: "light", go: async () => {} },
  { name: "layout", scheme: "light", go: (page) => tab(page, "Layout") },
  {
    name: "layout-blockout",
    scheme: "light",
    go: async (page) => {
      await tab(page, "Layout");
      await page.getByRole("button", { name: "Blockout", exact: true }).first().click();
    },
  },
  {
    name: "image-studio",
    scheme: "light",
    go: async (page) => {
      await tab(page, "Image studio");
      await page.locator('aside[aria-label="Images"] button[title^="compass"]').first().click();
    },
  },
  { name: "assets", scheme: "light", go: (page) => tab(page, "Assets") },
  { name: "layout-dark", scheme: "dark", go: (page) => tab(page, "Layout") },
];

/** Waits until the page has stopped loading and the 3D view had time to draw a few frames. */
async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2500);
}

async function main() {
  const settingsDir = await mkdtemp(join(tmpdir(), "tattoo-planner-screenshots-"));
  // Only these variables: no TATTOO_DATA_DIR, no OpenAI key, settings in a throwaway folder.
  const env = { HOME: settingsDir, XDG_CONFIG_HOME: settingsDir };
  const context = createContext({ env, root });
  const api = createApi(context);
  const server = await createServer({
    configFile: false,
    root,
    logLevel: "warn",
    plugins: [react(), { name: "tattoo-planner-api", configureServer: (s) => void s.middlewares.use(api) }],
    server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  if (!url) throw new Error("the dev server did not report its address");

  const browser = await chromium.launch({
    executablePath: process.env.SCREENSHOTS_CHROMIUM || undefined,
    // WebGL without a GPU (CI, containers); a no-op where a GPU is present.
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  await mkdir(outDir, { recursive: true });
  try {
    for (const shot of SHOTS) {
      const page = await browser.newPage({
        viewport,
        deviceScaleFactor: 2,
        colorScheme: shot.scheme,
        reducedMotion: "reduce",
      });
      // The server remembers the open project, so each shot sets it explicitly before loading.
      const action = shot.name === "start" ? "close" : "open-sample";
      const res = await page.request.post(new URL(`/api/project/${action}`, url).href);
      if (!res.ok()) throw new Error(`POST /api/project/${action}: ${res.status()}`);
      await page.goto(url);
      await settle(page);
      await shot.go(page);
      await settle(page);
      const file = join(outDir, `${shot.name}.webp`);
      // Playwright writes PNG or JPEG only; the browser re-encodes to WebP to keep the files small.
      const png = await page.screenshot({ type: "png" });
      const webp = await page.evaluate(async (b64) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const canvas = new OffscreenCanvas(img.width / 2, img.height / 2);
        canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
        const blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.85 });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let s = "";
        for (const b of bytes) s += String.fromCharCode(b);
        return btoa(s);
      }, png.toString("base64"));
      await writeFile(file, Buffer.from(webp, "base64"));
      console.log(
        `wrote docs/screenshots/${shot.name}.webp (${Math.round((webp.length * 3) / 4 / 1024)} KB)`,
      );
      await page.close();
    }
  } finally {
    await browser.close();
    await server.close();
    await api.close();
    await rm(settingsDir, { recursive: true, force: true });
  }
}

await main();
