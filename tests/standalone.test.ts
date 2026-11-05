import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { route } from "../server/api.ts";
import { createContext } from "../server/context.ts";
import type { Handler } from "../server/http.ts";
import { isLocalHost, parsePort, startServer, staticFile } from "../server/standalone.ts";

describe("route", () => {
  const a: Handler = async () => undefined;
  const b: Handler = async () => undefined;
  const routes = new Map([
    ["/api/assets", a],
    ["/api/project", b],
  ]);

  it("strips the prefix like Connect's use(prefix)", () => {
    expect(route(routes, "/api/assets")).toEqual({ handler: a, rest: "/" });
    expect(route(routes, "/api/assets/image/x")).toEqual({ handler: a, rest: "/image/x" });
    expect(route(routes, "/api/project?x=1")).toEqual({ handler: b, rest: "/?x=1" });
  });

  it("does not match a longer name or other paths", () => {
    expect(route(routes, "/api/assetsx")).toBeNull();
    expect(route(routes, "/index.html")).toBeNull();
  });
});

describe("standalone server", () => {
  let dir: string;
  let dist: string;
  let server: { url: string; close: () => Promise<void> };

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "tattoo-serve-"));
    dist = path.join(dir, "dist");
    await mkdir(path.join(dist, "assets"), { recursive: true });
    await writeFile(path.join(dist, "index.html"), "<!doctype html><title>t</title>");
    await writeFile(path.join(dist, "assets", "app.js"), "console.log(1)");
    await writeFile(path.join(dir, "secret.txt"), "secret");
    await symlink(path.join(dir, "secret.txt"), path.join(dist, "link.txt"));
    server = await startServer({
      dist,
      port: 0,
      context: createContext({
        env: {},
        root: dir,
        home: dir,
        configFile: path.join(dir, "config.json"),
      }),
    });
  });

  afterAll(async () => {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("serves the page, the bundle and the API on 127.0.0.1", async () => {
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    const page = await fetch(server.url);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    const js = await fetch(new URL("assets/app.js", server.url));
    expect(js.headers.get("content-type")).toContain("javascript");
    const layouts = await fetch(new URL("api/layouts", server.url));
    expect(await layouts.json()).toEqual([]);
  });

  it("answers 404 for missing files and files outside dist", async () => {
    expect((await fetch(new URL("nope.js", server.url))).status).toBe(404);
    expect((await fetch(new URL("link.txt", server.url))).status).toBe(404);
    expect(await staticFile(dist, "/../secret.txt")).toBeNull();
    expect(await staticFile(dist, "/%2e%2e/secret.txt")).toBeNull();
  });

  it("refuses another Host header (DNS rebinding)", () => {
    expect(isLocalHost("127.0.0.1:4322", 4322)).toBe(true);
    expect(isLocalHost("localhost:4322", 4322)).toBe(true);
    expect(isLocalHost("evil.example:4322", 4322)).toBe(false);
    expect(isLocalHost(undefined, 4322)).toBe(false);
  });
});

describe("parsePort", () => {
  it("takes the argument, then the variable, then the default", () => {
    expect(parsePort("5000", "6000")).toBe(5000);
    expect(parsePort(undefined, "6000")).toBe(6000);
    expect(parsePort(undefined, undefined)).toBe(4322);
    expect(parsePort("0", undefined)).toBe(0);
    expect(parsePort("x", undefined)).toBeNull();
    expect(parsePort("70000", undefined)).toBeNull();
  });
});
