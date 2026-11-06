// Guards src/styles.css against one class being styled in two unrelated places. The measuring wizard
// and the projection wizard once both used .wizard-body: the projection wizard's two-column grid
// leaked into the one-column measuring panel and its text overlapped (2026-11-06 test notes). A class
// that needs more rules gets them in one block; a second component picks its own prefix (mw-*).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** The selectors of the top-level rules (not inside @media, @supports, …), comments removed. */
function topLevelSelectors(css: string): string[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: string[] = [];
  let depth = 0;
  let buf = "";
  for (const ch of text) {
    if (ch === "{") {
      if (depth === 0) out.push(buf.trim());
      depth++;
      buf = "";
    } else if (ch === "}") {
      depth--;
      buf = "";
    } else if (ch === ";" && depth <= 1) buf = "";
    else buf += ch;
  }
  return out;
}

/** Rules whose whole selector is one plain class (".wizard-body") that appear more than once at the top
 * level. Shared selector lists (".a, .b") and overrides in media queries are fine. */
function duplicateClassRules(css: string): string[] {
  const seen = new Map<string, number>();
  for (const sel of topLevelSelectors(css))
    if (/^\.[\w-]+$/.test(sel)) seen.set(sel, (seen.get(sel) ?? 0) + 1);
  return [...seen].filter(([, n]) => n > 1).map(([sel]) => sel);
}

describe("styles.css", () => {
  it("finds a class styled twice, but not media-query overrides", () => {
    const css = ".a { color: red; }\n@media (max-width: 9px) { .a { color: blue; } }\n.b, .a { margin: 0; }";
    expect(duplicateClassRules(css)).toEqual([]);
    expect(duplicateClassRules(`${css}\n.a { padding: 0; }`)).toEqual([".a"]);
    expect(duplicateClassRules(".a { x: 1; }\n.a .b { y: 2; }\n.a:hover { z: 3; }")).toEqual([]);
  });

  it("styles each plain class in one top-level rule", () => {
    const css = readFileSync(path.join(import.meta.dirname, "../src/styles.css"), "utf8");
    expect(duplicateClassRules(css)).toEqual([]);
  });
});
