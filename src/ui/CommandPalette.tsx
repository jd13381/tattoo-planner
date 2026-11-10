// The command palette (Cmd/Ctrl+K): one field that finds every place and action of the app. The
// caller passes the commands; matching and ranking live in ./commands.ts.
//
//   <CommandPalette open={open} onClose={() => setOpen(false)} commands={commands} />
//
// Keyboard: ↑ ↓ (Home / End, PageUp / PageDown) move, Enter runs, Esc closes. Focus stays in the
// field while the palette is open (the rows are picked with the arrow keys or the pointer) and
// returns to where it was when it closes. Markup follows the WAI-ARIA combobox pattern with a
// grouped listbox.
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  groupMatches,
  moveActive,
  rankCommands,
  splitByRanges,
  type CommandMatch,
  type CommandSpec,
} from "./commands.ts";
import { SearchIcon } from "./icons.tsx";
import { keyLabel } from "./Tooltip.tsx";

export type PaletteCommand = CommandSpec & {
  icon?: ReactNode;
  /** Runs after the palette has closed. */
  run: () => void;
};

type Props = {
  open: boolean;
  onClose: () => void;
  commands: readonly PaletteCommand[];
  placeholder?: string;
};

export function CommandPalette({ open, ...rest }: Props) {
  if (!open) return null;
  return createPortal(<Palette {...rest} />, document.body);
}

const PAGE = 6;

function Palette({ onClose, commands, placeholder = "Search places and actions" }: Omit<Props, "open">) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  /** The id of a command waiting for its second Enter (CommandSpec.confirm). */
  const [armed, setArmed] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const uid = useId();
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  const groups = useMemo(() => groupMatches(rankCommands(commands, query)), [commands, query]);
  const rows = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const current = rows[Math.min(active, rows.length - 1)];
  const optionId = (id: string) => `${uid}-opt-${id.replace(/[^\w-]/g, "_")}`;

  // Focus the field; give focus back on close, unless the command moved it elsewhere.
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const field = inputRef.current;
    field?.focus();
    // Esc closes the palette only: it must not reach the editor (deselect) or a wizard (close).
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      const now = document.activeElement;
      if (before?.isConnected && (now === null || now === document.body || now === field)) before.focus();
    };
  }, []);

  // Keep the active row in view.
  useEffect(() => {
    if (!current) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-command="${CSS.escape(current.command.id)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const run = (m: CommandMatch<PaletteCommand>) => {
    const c = m.command;
    if (c.confirm && armed !== c.id) return setArmed(c.id);
    onClose();
    c.run();
  };
  const move = (to: number) => {
    setActive(to);
    setArmed(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // An IME composition uses these keys itself.
    if (e.nativeEvent.isComposing) return;
    const n = rows.length;
    const at = Math.min(active, n - 1);
    const to =
      e.key === "ArrowDown"
        ? moveActive(at, 1, n)
        : e.key === "ArrowUp"
          ? moveActive(at, -1, n)
          : e.key === "PageDown"
            ? Math.min(at + PAGE, n - 1)
            : e.key === "PageUp"
              ? Math.max(at - PAGE, 0)
              : e.key === "Home" && !e.shiftKey && query === ""
                ? 0
                : e.key === "End" && !e.shiftKey && query === ""
                  ? n - 1
                  : null;
    if (to !== null) {
      e.preventDefault();
      if (n > 0) move(to);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (current) run(current);
    } else if (e.key === "Tab") {
      // The field is the palette's only tab stop: focus stays inside.
      e.preventDefault();
    }
    // No palette key may reach the page's own shortcuts.
    e.stopPropagation();
  };

  return (
    <div
      className="cmdk-scrim"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="cmdk" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="cmdk-field">
          <SearchIcon />
          <input
            ref={inputRef}
            className="cmdk-input"
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={`${uid}-list`}
            aria-activedescendant={current ? optionId(current.command.id) : undefined}
            aria-autocomplete="list"
            aria-label={placeholder}
            placeholder={placeholder}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              move(0);
            }}
            onKeyDown={onKeyDown}
          />
          <kbd className="kbd">Esc</kbd>
        </div>
        <div
          ref={listRef}
          id={`${uid}-list`}
          className="cmdk-list"
          role="listbox"
          aria-label="Commands"
          // A click on a row must not take the focus out of the field.
          onMouseDown={(e) => e.preventDefault()}
        >
          {groups.map((g, gi) => (
            <div key={g.group} className="cmdk-group" role="group" aria-labelledby={`${uid}-g${gi}`}>
              <div className="cmdk-group-label" id={`${uid}-g${gi}`} role="presentation">
                {g.group}
              </div>
              {g.items.map((m) => {
                const c = m.command;
                const isActive = current === m;
                const isArmed = armed === c.id;
                return (
                  <div
                    key={c.id}
                    id={optionId(c.id)}
                    role="option"
                    aria-selected={isActive}
                    data-command={c.id}
                    className={`cmdk-item${isActive ? " active" : ""}${isArmed ? " armed" : ""}`}
                    onPointerMove={() => {
                      if (!isActive) move(rows.indexOf(m));
                    }}
                    onClick={() => run(m)}
                  >
                    <span className="cmdk-icon" aria-hidden="true">
                      {c.icon}
                    </span>
                    <span className="cmdk-title">
                      {isArmed
                        ? c.confirm
                        : splitByRanges(c.title, m.ranges).map((part, i) =>
                            part.hit ? <mark key={i}>{part.text}</mark> : part.text,
                          )}
                    </span>
                    {isArmed ? (
                      <span className="cmdk-hint">
                        Press <kbd className="kbd">↵</kbd> again
                      </span>
                    ) : (
                      <>
                        {c.hint && <span className="cmdk-hint">{c.hint}</span>}
                        {c.keys && <kbd className="kbd">{keyLabel(c.keys)}</kbd>}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          {rows.length === 0 && (
            <div className="cmdk-empty" role="presentation">
              <SearchIcon />
              <p className="cmdk-empty-title">No results for “{query.trim()}”</p>
              <p>Try a tab, a body region, a person or “theme”.</p>
            </div>
          )}
        </div>
        <div className="cmdk-foot" aria-hidden="true">
          <span>
            <kbd className="kbd">↑</kbd>
            <kbd className="kbd">↓</kbd> Move
          </span>
          <span>
            <kbd className="kbd">↵</kbd> Run
          </span>
          <span className="spacer" />
          <span>
            {rows.length} {rows.length === 1 ? "result" : "results"}
          </span>
        </div>
        <div className="sr-only" role="status" aria-live="polite">
          {rows.length === 0 ? "No results" : `${rows.length} results`}
        </div>
      </div>
    </div>
  );
}
