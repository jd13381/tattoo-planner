// URL rules of the desktop window (docs/adr/0014-desktop-app.md): the window shows only the planner's
// own local server; https links open in the system browser; everything else is refused.
// Framework-free, so the rules are unit-tested without Electron.

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** True when `url` belongs to the planner's local server (`origin` = "http://127.0.0.1:<port>"). */
export function isAppUrl(url: string, origin: string): boolean {
  const u = parse(url);
  return u !== null && u.origin === origin && u.username === "" && u.password === "";
}

/** True for links that may open in the system browser: https only, no credentials in the URL. */
export function isExternalUrl(url: string): boolean {
  const u = parse(url);
  return u !== null && u.protocol === "https:" && u.username === "" && u.password === "" && u.hostname !== "";
}

/** Requests the window may make: its own server, plus in-page data and blob URLs and DevTools. */
export function isAllowedRequest(url: string, origin: string): boolean {
  if (isAppUrl(url, origin)) return true;
  const u = parse(url);
  return u !== null && ["data:", "blob:", "devtools:", "chrome-extension:"].includes(u.protocol);
}

/** Browser permissions the page may get; every other request (camera, location, …) is denied. */
export const ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set(["clipboard-sanitized-write"]);

/** The Content-Security-Policy for the app's pages: own origin only, no remote content. */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "media-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");
