// Response headers for every answer of the standalone server (server/standalone.ts) and the policy the
// desktop shell sets on its pages (desktop/main.ts). The planner loads nothing from other origins and is
// never framed, so the policy is "own origin only". Checked in CI by the OWASP ZAP baseline scan
// (.github/workflows/security.yml, docs/adr/0027-ci-security-pipeline.md).
import type { ServerResponse } from "node:http";

/** The Content-Security-Policy for the app's pages: own origin only, no remote content. */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  // React and three.js set inline style attributes; no inline <style> or script is needed otherwise.
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

/** Browser features the page never uses; the clipboard is the only one it needs and is not listed. */
export const PERMISSIONS_POLICY = [
  "camera=()",
  "microphone=()",
  "geolocation=()",
  "payment=()",
  "usb=()",
  "serial=()",
].join(", ");

/** The headers set on every response, in a stable order. */
export const SECURITY_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ["Content-Security-Policy", CONTENT_SECURITY_POLICY],
  ["X-Content-Type-Options", "nosniff"],
  ["X-Frame-Options", "DENY"],
  ["Referrer-Policy", "no-referrer"],
  ["Permissions-Policy", PERMISSIONS_POLICY],
  ["Cross-Origin-Opener-Policy", "same-origin"],
  ["Cross-Origin-Resource-Policy", "same-origin"],
];

/** Sets SECURITY_HEADERS on a response before anything is written. */
export function setSecurityHeaders(res: ServerResponse): void {
  for (const [name, value] of SECURITY_HEADERS) res.setHeader(name, value);
}
