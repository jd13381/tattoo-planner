#!/usr/bin/env node
// README screenshots (docs/adr/0026-readme-screenshots.md): `npm run screenshots`.
//
// Starts the planner on a free local port with an isolated, empty settings folder, opens the
// read-only sample project shipped in samples/demo (its Sam carries the author's Anubis tattoo,
// docs/adr/0029) and photographs a fixed set of views into
// docs/screenshots/*.webp. It never reads the user's own projects, settings, .env or OpenAI key:
// the server gets a hand-built environment instead of process.env and the git-ignored .env, with a
// placeholder key and the key check off, so nothing is ever sent to OpenAI.
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
  /** The sample person to show (persons in samples/demo/project.yaml); default the first, Alice. */
  person?: string;
  /** Runs after the page opened on the sample's Home. */
  go(page: Page): Promise<void>;
}

const tab = (page: Page, label: string) =>
  page.locator('nav[aria-label="Sections"] [role=tab]', { hasText: label }).first().click();

const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true }).first().click();

/**
 * Turns the Home body a little towards its left side by dragging, so Sam's inner left forearm with
 * the projected Anubis faces the camera, then moves the mouse off the body (no hover label).
 */
async function turnHomeBody(page: Page, dx: number) {
  const box = await page.locator("canvas").first().boundingBox();
  if (!box) throw new Error("Home shows no 3D view");
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 10 });
  await page.mouse.up();
  await page.mouse.move(box.x + box.width + 200, box.y + box.height - 20);
}

/** In README order. Dark mode throughout (Jan, 2026-11-15). */
const SHOTS: Shot[] = [
  // The README hero: Home with Sam, the male body, and the Anubis already projected (Jan, 2026-11-16).
  { name: "hero", scheme: "dark", person: "sam", go: (page) => turnHomeBody(page, -75) },
  { name: "layout", scheme: "dark", go: (page) => tab(page, "Layout") },
  {
    name: "image-studio",
    scheme: "dark",
    go: async (page) => {
      await tab(page, "Image studio");
      await page.locator('aside[aria-label="Images"] button[title^="compass"]').first().click();
      await page.locator('button.engine-option:has-text("Generative")').first().click();
    },
  },
  {
    name: "measure",
    scheme: "dark",
    go: async (page) => {
      await tab(page, "Settings");
      await page.getByText("Body & measurements", { exact: true }).first().click();
      await button(page, "Measure yourself");
      for (let i = 0; i < 3; i++) await button(page, "Next");
    },
  },
  {
    // Sam's Anubis in the projection workspace: a photo with its outline and distances, the 3D arm
    // and the unwrap built from all five photos.
    name: "projection",
    scheme: "dark",
    person: "sam",
    go: async (page) => {
      await tab(page, "Settings");
      await page.getByText("Projection", { exact: true }).first().click();
      await button(page, "Edit");
    },
  },
  {
    name: "layout-blockout",
    scheme: "dark",
    go: async (page) => {
      await tab(page, "Layout");
      await button(page, "Blockout");
    },
  },
];

/** Waits until the page has stopped loading and the 3D view had time to draw a few frames. */
async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2500);
}

async function main() {
  const settingsDir = await mkdtemp(join(tmpdir(), "tattoo-planner-screenshots-"));
  // The key check at start is off, so the server never contacts OpenAI.
  await mkdir(join(settingsDir, "tattoo-planner"), { recursive: true });
  await writeFile(
    join(settingsDir, "tattoo-planner", "config.json"),
    JSON.stringify({ openaiStartupCheck: false }),
  );
  // Only these variables: no TATTOO_DATA_DIR, settings in a throwaway folder, and a placeholder
  // instead of a real OpenAI key, so the Image studio shows its generative panel. Nothing is sent.
  const env = {
    HOME: settingsDir,
    XDG_CONFIG_HOME: settingsDir,
    TATTOO_OPENAI_API_KEY: "sk-screenshot-placeholder-not-a-real-key",
  };
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
      const action = "open-sample";
      const res = await page.request.post(new URL(`/api/project/${action}`, url).href);
      if (!res.ok()) throw new Error(`POST /api/project/${action}: ${res.status()}`);
      if (shot.person) {
        const select = `/api/project/persons/${shot.person}/select`;
        const sel = await page.request.post(new URL(select, url).href);
        if (!sel.ok()) throw new Error(`POST ${select}: ${sel.status()}`);
      }
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
