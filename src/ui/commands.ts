// The command palette's matching and ranking (src/ui/CommandPalette.tsx), framework-free: which
// commands fit a query, in which order, in which groups, and which letters of a title to mark.
import type { Platform } from "../editor/shortcuts.ts";

/** What the palette needs to know about a command to find and list it. */
export type CommandSpec = {
  id: string;
  /** The line the user reads and types against ("Go to Layout"). */
  title: string;
  /** The heading it is listed under ("Go to", "Theme"). */
  group: string;
  /** Extra words that also find it ("sleeve arm"); never shown. */
  keywords?: string;
  /** Quiet text at the right end of the row ("current"). */
  hint?: string;
  /** A shortcut in the notation of src/editor/shortcuts.ts ("Mod+K"). */
  keys?: string;
  /** When set, the first Enter only shows this line; a second Enter runs the command. */
  confirm?: string;
};

/** Half-open [start, end) ranges of a title that matched the query. */
export type MatchRange = readonly [number, number];

export type CommandMatch<T extends CommandSpec> = { command: T; score: number; ranges: MatchRange[] };

export type CommandGroup<T extends CommandSpec> = { group: string; items: CommandMatch<T>[] };

const isWordStart = (text: string, i: number) => i === 0 || /[\s\-_/:·→(]/.test(text[i - 1]!);

/**
 * One query word against one text: a score above 0 and the matched ranges, or null. `loose` (titles)
 * also takes a hit inside a word and letters with gaps.
 */
function matchToken(
  token: string,
  text: string,
  loose: boolean,
): { score: number; ranges: MatchRange[] } | null {
  const hay = text.toLowerCase();
  // A whole-word start beats a later substring ("set" finds "Settings" before "Reset").
  let at = -1;
  for (let i = hay.indexOf(token); i !== -1; i = hay.indexOf(token, i + 1)) {
    if (isWordStart(hay, i)) {
      at = i;
      break;
    }
    if (at === -1) at = i;
  }
  // Keywords and group names only count from the start of a word: "le" is not in "sleeve".
  if (at !== -1 && !loose && !isWordStart(hay, at)) at = -1;
  if (at !== -1) {
    const base = at === 0 ? 100 : isWordStart(hay, at) ? 80 : 55;
    // A whole word ("sam" in "Switch to Sam") beats the start of a longer one ("sample").
    const end = at + token.length;
    const whole = isWordStart(hay, at) && (end === hay.length || isWordStart(hay, end + 1)) ? 12 : 0;
    return { score: base + whole - Math.min(at, 20) * 0.5, ranges: [[at, end]] };
  }
  if (!loose || token.length < 2) return null;
  // Letters in order with gaps ("imst" finds "Image studio"); tight runs and word starts score higher.
  const ranges: [number, number][] = [];
  let score = 30;
  let from = 0;
  let first = -1;
  let last = -1;
  for (const ch of token) {
    const i = hay.indexOf(ch, from);
    if (i === -1) return null;
    if (first === -1) {
      // The first letter starts a word; "arm" is not in "Dark theme".
      if (!isWordStart(hay, i)) return null;
      first = i;
    }
    if (i === last + 1 && ranges.length > 0) {
      ranges[ranges.length - 1]![1] = i + 1;
      score += 3;
    } else {
      ranges.push([i, i + 1]);
      if (isWordStart(hay, i)) score += 4;
      else score -= 2;
    }
    last = i;
    from = i + 1;
  }
  // Letters scattered over a long text are a coincidence, not a match.
  if (last - first + 1 > token.length * 2 + 1) return null;
  return { score: Math.max(score, 1), ranges };
}

function mergeRanges(ranges: MatchRange[]): MatchRange[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [s, e] of sorted) {
    const prev = out[out.length - 1];
    if (prev && s <= prev[1]) prev[1] = Math.max(prev[1], e);
    else out.push([s, e]);
  }
  return out;
}

/**
 * How well a command fits a query: every word of the query must be found in the title (also with
 * gaps), the group name or the keywords. Null: no match. An empty query matches all with score 0.
 */
export function matchCommand<T extends CommandSpec>(command: T, query: string): CommandMatch<T> | null {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  let score = 0;
  const ranges: MatchRange[] = [];
  for (const token of tokens) {
    const inTitle = matchToken(token, command.title, true);
    const inOther =
      matchToken(token, command.keywords ?? "", false) ?? matchToken(token, command.group, false);
    if (inTitle && (!inOther || inTitle.score >= inOther.score * 0.6)) {
      score += inTitle.score;
      ranges.push(...inTitle.ranges);
    } else if (inOther) score += inOther.score * 0.6;
    else return null;
  }
  return { command, score, ranges: mergeRanges(ranges) };
}

/** The commands that fit, best first; equal scores keep the given order. An empty query keeps all. */
export function rankCommands<T extends CommandSpec>(
  commands: readonly T[],
  query: string,
): CommandMatch<T>[] {
  const matches = commands
    .map((c, i) => ({ m: matchCommand(c, query), i }))
    .filter((x): x is { m: CommandMatch<T>; i: number } => x.m !== null);
  matches.sort((a, b) => b.m.score - a.m.score || a.i - b.i);
  return matches.map((x) => x.m);
}

/**
 * Ranked matches under their group headings. Groups come in the order of their best match (so for an
 * empty query in the order the commands were given); within a group the ranking is kept. Reading the
 * groups top to bottom gives the order the arrow keys walk.
 */
export function groupMatches<T extends CommandSpec>(matches: readonly CommandMatch<T>[]): CommandGroup<T>[] {
  const groups = new Map<string, CommandMatch<T>[]>();
  for (const m of matches) {
    const list = groups.get(m.command.group);
    if (list) list.push(m);
    else groups.set(m.command.group, [m]);
  }
  return [...groups].map(([group, items]) => ({ group, items }));
}

/** The next active row for an arrow key; wraps around. -1 when there are no rows. */
export function moveActive(index: number, delta: number, count: number): number {
  if (count <= 0) return -1;
  return (((index + delta) % count) + count) % count;
}

/** A title cut into plain and matched pieces, for marking the matched letters. */
export function splitByRanges(text: string, ranges: readonly MatchRange[]): { text: string; hit: boolean }[] {
  const out: { text: string; hit: boolean }[] = [];
  let at = 0;
  for (const [s, e] of ranges) {
    if (s > at) out.push({ text: text.slice(at, s), hit: false });
    out.push({ text: text.slice(s, e), hit: true });
    at = e;
  }
  if (at < text.length) out.push({ text: text.slice(at), hit: false });
  return out;
}

type ChordInput = { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean };

/**
 * Whether a key press is the palette's chord: Cmd+K on a Mac, Ctrl+K elsewhere, nothing else held.
 * It works while typing in a field too; the Layout tab's shortcuts (src/editor/shortcuts.ts) do not
 * use K.
 */
export function isPaletteChord(e: ChordInput, platform: Platform): boolean {
  const mod = platform === "mac" ? e.metaKey : e.ctrlKey;
  const otherMod = platform === "mac" ? e.ctrlKey : e.metaKey;
  return mod && !otherMod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k";
}
