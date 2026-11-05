#!/usr/bin/env node
// Serves the built page (dist/) and the API on 127.0.0.1 without Vite (docs/adr/0012-project-folder.md).
// The desktop shell reuses startServer(); in a checkout: `npm run build`, then `npm run serve [port]`.
// Port: the first argument, else TATTOO_PORT, else 4322; 0 picks a free one. The URL is printed.
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApi, type ApiContext } from "./api.ts";
import { isInside } from "./assetsApi.ts";
import { createContext, readEnv } from "./context.ts";

export const DEFAULT_PORT = 4322;

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

/** The file under `dist` for a request path; index.html for `/`. Null when it is missing or leaves dist. */
export async function staticFile(dist: string, urlPath: string): Promise<string | null> {
  let rel: string;
  try {
    rel = decodeURIComponent(urlPath.split("?")[0] ?? "/");
  } catch {
    return null;
  }
  if (rel.includes("\0")) return null;
  if (rel === "/" || rel === "") rel = "/index.html";
  try {
    const root = await realpath(dist);
    const file = await realpath(path.join(root, ...rel.split("/").filter(Boolean)));
    if (!isInside(root, file) || !(await stat(file)).isFile()) return null;
    return file;
  } catch {
    return null;
  }
}

async function serveStatic(dist: string, req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.end();
    return;
  }
  const file = await staticFile(dist, req.url ?? "/");
  if (!file) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("not found");
    return;
  }
  const s = await stat(file);
  res.statusCode = 200;
  res.setHeader("Content-Type", TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream");
  res.setHeader("Content-Length", String(s.size));
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Hashed bundle files never change; the page itself is revalidated.
  res.setHeader(
    "Cache-Control",
    file.includes(`${path.sep}assets${path.sep}`) ? "public, max-age=31536000, immutable" : "no-cache",
  );
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(file).pipe(res);
}

/** Only requests addressed to this server by its loopback name (no DNS rebinding through another host name). */
export function isLocalHost(host: string | undefined, port: number): boolean {
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

export type StartOptions = { context: ApiContext; dist: string; port?: number };

export async function startServer(opts: StartOptions): Promise<{ url: string; close: () => Promise<void> }> {
  const api = createApi(opts.context);
  let port = 0;
  const server = http.createServer((req, res) => {
    if (!isLocalHost(req.headers.host, port)) {
      res.statusCode = 421;
      res.end("wrong host");
      return;
    }
    api(req, res, (err?: unknown) => {
      if (err) {
        res.statusCode = 500;
        res.end();
        return;
      }
      serveStatic(opts.dist, req, res).catch(() => {
        res.statusCode = 500;
        res.end();
      });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? DEFAULT_PORT, "127.0.0.1", () => resolve());
  });
  port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: async () => {
      await api.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** The port from the command line or TATTOO_PORT; null when it is not a valid port. */
export function parsePort(arg: string | undefined, env: string | undefined): number | null {
  const raw = (arg ?? env ?? "").trim();
  if (raw === "") return DEFAULT_PORT;
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n <= 65535 ? n : null;
}

async function main(): Promise<number> {
  const root = path.resolve(import.meta.dirname, "..");
  const env = readEnv(root);
  const port = parsePort(process.argv[2], env.TATTOO_PORT);
  if (port === null) {
    console.error("usage: npm run serve -- [port]   (0 = any free port)");
    return 2;
  }
  const dist = path.join(root, "dist");
  if (!(await staticFile(dist, "/"))) {
    console.error("error: dist/index.html not found; run `npm run build` first.");
    return 1;
  }
  const { url, close } = await startServer({ context: createContext({ env, root }), dist, port });
  console.log(`Tattoo Planner: ${url}`);
  const stop = () => void close().then(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const code = await main();
  if (code !== 0) process.exitCode = code;
}
