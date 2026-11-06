// The Assets tab (docs/adr/0020-asset-structure.md): a sidebar of sections like Photos on the Mac
// (library: Ideas, Made in studio, Backgrounds; the current person's Measuring and Tattoo photos;
// smart albums Unused, Hidden, Missing file), a thumbnail grid with search and tags, and the detail
// of one image on the right. "Select" (or cmd/shift-click) selects several images as in Photos on
// the iPhone; the bar at the bottom hides, moves or trashes them. Every action can be undone for a
// few seconds. Dropping files copies them into the open section. Logic lives in pure modules
// (category, filter, selection, references, copy); this file wires them to the page.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { desktopBridge } from "../desktop/bridge.ts";
import { getProject } from "../project/api.ts";
import { personHeading, useCurrentPerson } from "./person.ts";
import { UndoToast, type UndoToastMessage } from "../ui/UndoToast.tsx";
import { ActionError, commitDelete, importFile, runBatch, undoAction } from "./actions.ts";
import {
  CATEGORY_LABELS,
  CATEGORY_LABELS_ONE,
  dropCategory,
  isPersonCategory,
  MOVE_TARGETS,
  SECTION_LABELS,
  type AssetCategory,
  type SectionId,
} from "./category.ts";
import {
  actionToast,
  allHiddenText,
  emptySectionText,
  filterEmptyText,
  images,
  poseLabel,
  trashBody,
  trashTitle,
  unsupportedDrop,
} from "./copy.ts";
import {
  facets,
  filterAssets,
  hiddenInSection,
  NO_FILTER,
  sectionAssets,
  sectionCounts,
  type AssetFilter,
} from "./filter.ts";
import { showElement } from "./navigation.ts";
import { deleteCheck, describeUse, isInUse, usageBadge, type AssetUse, type UsageMap } from "./references.ts";
import {
  focusAfterRemoval,
  moveFocus,
  NO_SELECTION,
  prune,
  selectAll,
  selectOnly,
  selectRange,
  startSelecting,
  stopSelecting,
  toggle,
  type Selection,
} from "./selection.ts";
import {
  assetEntryUrl,
  assetImageUrl,
  UNDO_MS,
  type AssetInfo,
  type DeleteRefusal,
  type PersonRef,
  type TrashMode,
} from "./types.ts";
import { parseTags } from "./usage.ts";
import { announceManifestChanged, useAssetListing, useAssetUsage } from "./useAssets.ts";

const SETUP_HREF = "#settings/project";
const READ_ONLY_HINT =
  "The sample project is read-only. Save it as a new project (Settings → Project) to change images.";

const LIBRARY_SECTIONS: SectionId[] = ["ideas", "studio", "backgrounds"];
const PERSON_SECTIONS: SectionId[] = ["measuring", "existing"];
const SMART_SECTIONS: SectionId[] = ["unused", "hidden", "missing"];

type StudioSub = "" | "generated" | "edit";

type TrashDialog = {
  ids: string[];
  refusal: DeleteRefusal | null;
  force: boolean;
  busy: boolean;
  error: string | null;
};

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

const mod = (e: { metaKey: boolean; ctrlKey: boolean }) => e.metaKey || e.ctrlKey;

export function AssetsPage() {
  const { listing, reload, scanNote } = useAssetListing();
  const { usage } = useAssetUsage();
  const person = useCurrentPerson();
  const [section, setSection] = useState<SectionId>("all");
  const [filter, setFilter] = useState<AssetFilter>(NO_FILTER);
  const [studioSub, setStudioSub] = useState<StudioSub>("");
  const [showHidden, setShowHidden] = useState(false);
  const [selection, setSelection] = useState<Selection>(NO_SELECTION);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<TrashDialog | null>(null);
  const [toast, setToast] = useState<UndoToastMessage | null>(null);
  const [dropping, setDropping] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toastSeq = useRef(0);
  const gridRef = useRef<HTMLUListElement>(null);
  const pendingFocus = useRef(false);

  const ok = listing?.status === "ok" ? listing : null;
  const assets = useMemo(() => ok?.assets ?? [], [ok]);
  const readOnly = ok?.readOnly === true;
  const trashMode: TrashMode | undefined = ok?.trash;
  const persons = ok?.persons ?? [];
  const currentPerson = persons.find((p) => p.id === person.id) ?? person;
  const ctx = useMemo(() => ({ usage, person: person.id, showHidden }), [usage, person.id, showHidden]);
  const counts = useMemo(() => sectionCounts(assets, ctx), [assets, ctx]);
  const inSection = useMemo(() => {
    const list = sectionAssets(assets, section, ctx);
    return section === "studio" && studioSub ? list.filter((a) => a.effectiveCategory === studioSub) : list;
  }, [assets, section, ctx, studioSub]);
  const tags = useMemo(() => facets(inSection.flatMap((a) => a.tags)), [inSection]);
  const shown = useMemo(() => filterAssets(inSection, { ...filter, kind: "" }), [inSection, filter]);
  const shownIds = useMemo(() => shown.map((a) => a.id), [shown]);
  const byId = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);
  const detail = detailId ? (byId.get(detailId) ?? null) : null;
  const selected = selection.ids.flatMap((id) => byId.get(id) ?? []);

  // Ids that left the listing (deleted, or a reload) leave the selection too.
  const allIds = useMemo(() => assets.map((a) => a.id), [assets]);
  // Ids to select once the reloaded listing has them (dropped files, an undone delete).
  const [selectWhenListed, setSelectWhenListed] = useState<string[] | null>(null);
  if (selectWhenListed && selectWhenListed.every((id) => allIds.includes(id))) {
    setSelectWhenListed(null);
    setSelection(selectOnly(selectWhenListed));
  }
  const pruned = prune(selection, allIds);
  if (!selectWhenListed && pruned !== selection) setSelection(pruned);

  // Focus follows focusId after a render that asked for it (arrow keys, after a delete).
  useEffect(() => {
    if (!pendingFocus.current) return;
    pendingFocus.current = false;
    const el = gridRef.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(focusId ?? "")}"]`);
    (el ?? gridRef.current)?.focus();
  });
  const focusCard = (id: string | null) => {
    pendingFocus.current = true;
    setFocusId(id);
  };
  const rovingId = focusId && shownIds.includes(focusId) ? focusId : (shownIds[0] ?? null);

  // ── Toast and undo ────────────────────────────────────────────────────────────────────────────
  const pendingToken = useRef<string | null>(null);
  const showToast = useCallback((text: string, undo: (() => void) | null, onExpire?: () => void) => {
    toastSeq.current += 1;
    setToast({ id: toastSeq.current, text, onUndo: undo, onExpire });
  }, []);
  const closeToast = useCallback(() => setToast(null), []);
  // A pending delete becomes final when its toast is replaced, the tab closes or the page unloads.
  const finishPending = useCallback((beacon = false) => {
    const token = pendingToken.current;
    pendingToken.current = null;
    if (token) commitDelete(token, beacon);
  }, []);
  useEffect(() => {
    const onHide = () => finishPending(true);
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      finishPending();
    };
  }, [finishPending]);

  const undo = useCallback(
    async (token: string, refocus: string[]) => {
      if (pendingToken.current === token) pendingToken.current = null;
      try {
        await undoAction(token);
        announceManifestChanged();
        if (refocus.length) setSelectWhenListed(refocus);
        showToast("Undone", null);
      } catch (e) {
        showToast(`Could not undo: ${e instanceof Error ? e.message : String(e)}`, null);
      }
    },
    [showToast],
  );

  // ── Actions ───────────────────────────────────────────────────────────────────────────────────
  const act = async (
    ids: string[],
    kind: "hide" | "unhide" | "move",
    target?: { category: AssetCategory; person: string | null },
  ) => {
    if (readOnly || ids.length === 0) return;
    setBusy(true);
    try {
      const r = await runBatch(
        kind === "move"
          ? {
              action: "set",
              ids,
              patch: {
                category: target!.category,
                ...(isPersonCategory(target!.category) ? { person: target!.person } : {}),
              },
            }
          : { action: kind, ids },
      );
      announceManifestChanged();
      finishPending();
      const token = r.undo?.token;
      if (r.changed.length === 0) showToast("Nothing to change", null);
      else
        showToast(
          actionToast(kind, r.changed.length, target?.category),
          token ? () => void undo(token, selection.active ? ids : []) : null,
        );
    } catch (e) {
      showToast(`Not done: ${e instanceof Error ? e.message : String(e)}`, null);
    } finally {
      setBusy(false);
    }
  };

  const openTrash = (ids: string[]) => {
    if (readOnly || ids.length === 0) return;
    setDialog({ ids, refusal: null, force: false, busy: false, error: null });
  };

  const confirmTrash = async () => {
    if (!dialog) return;
    setDialog({ ...dialog, busy: true, error: null });
    const ids = dialog.ids;
    try {
      const r = await runBatch({ action: "delete", ids, force: dialog.force });
      const next = focusAfterRemoval(shownIds, ids);
      setDialog(null);
      if (detailId && ids.includes(detailId)) setDetailId(null);
      finishPending();
      const token = r.undo?.token ?? null;
      pendingToken.current = token;
      announceManifestChanged();
      showToast(
        actionToast("delete", ids.length, undefined, trashMode),
        token ? () => void undo(token, selection.active ? ids : []) : null,
        () => {
          if (token && pendingToken.current === token) finishPending();
        },
      );
      focusCard(next);
    } catch (e) {
      if (e instanceof ActionError && e.refusal)
        setDialog({
          ...dialog,
          busy: false,
          refusal: e.refusal,
          error: e.refusal.inSession.length ? e.message : null,
        });
      else setDialog({ ...dialog, busy: false, error: e instanceof Error ? e.message : String(e) });
    }
  };

  // ── Drop to import ────────────────────────────────────────────────────────────────────────────
  const dropTarget = dropCategory(section) ?? "reference";
  const dropLabel =
    section === "all" || !dropCategory(section) ? CATEGORY_LABELS.reference : SECTION_LABELS[section];
  const onDragOver = (e: DragEvent) => {
    if (readOnly || !ok || !e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDropping(true);
  };
  const onDrop = async (e: DragEvent) => {
    if (readOnly || !ok) return;
    e.preventDefault();
    setDropping(false);
    const files = [...e.dataTransfer.files];
    const added: string[] = [];
    const skipped: string[] = [];
    for (const f of files) {
      const refused = unsupportedDrop(f.name);
      if (refused) {
        skipped.push(refused);
        continue;
      }
      try {
        const r = await importFile(f, dropTarget, isPersonCategory(dropTarget) ? person.id : null);
        added.push(r.id);
      } catch (err) {
        skipped.push(err instanceof Error ? err.message : String(err));
      }
    }
    if (added.length) {
      announceManifestChanged();
      setSelectWhenListed(added);
    }
    setNotice(skipped.length ? `Skipped: ${skipped.join("; ")}` : null);
    showToast(added.length ? `Added ${images(added.length)} to ${dropLabel}` : "No image added", null);
  };

  // ── Clicks and keys ───────────────────────────────────────────────────────────────────────────
  const onCardClick = (e: MouseEvent, id: string) => {
    setFocusId(id);
    if (e.shiftKey) {
      const base =
        selection.active || !detailId ? selection : { active: true, ids: [detailId], anchor: detailId };
      setSelection(selectRange(base, shownIds, id));
      return;
    }
    if (mod(e) || selection.active) {
      setSelection(toggle(selection, id));
      return;
    }
    setDetailId(id);
  };

  const targetIds = (): string[] =>
    selection.active ? [...selection.ids] : (focusId ?? detailId) ? [(focusId ?? detailId)!] : [];

  const onGridKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const index = rovingId ? shownIds.indexOf(rovingId) : -1;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      const cols = gridRef.current
        ? getComputedStyle(gridRef.current).gridTemplateColumns.split(" ").filter(Boolean).length
        : 1;
      const next = moveFocus(index, shownIds.length, cols, e.key as "Home");
      const id = shownIds[next] ?? null;
      focusCard(id);
      if (e.shiftKey && id) setSelection(selectRange(startSelecting(selection), shownIds, id));
      return;
    }
    if (!rovingId) return;
    if (e.key === "Enter") {
      e.preventDefault();
      setDetailId(rovingId);
    } else if (e.key === " ") {
      e.preventDefault();
      setSelection(toggle(selection, rovingId));
    }
  };

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (dialog) return; // the dialog has its own keys (Esc closes it)
      const typing = isTyping(e.target);
      if (e.key === "Escape") {
        if (typing) return;
        if (selection.active) {
          e.preventDefault();
          setSelection(stopSelecting());
        } else if (detailId) {
          e.preventDefault();
          setDetailId(null);
        }
        return;
      }
      if (typing) return;
      if (mod(e) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelection(selectAll(selection, shownIds));
      } else if (mod(e) && e.key.toLowerCase() === "z" && toast?.onUndo) {
        e.preventDefault();
        const u = toast.onUndo;
        setToast(null);
        u();
      } else if ((e.key === "Delete" || e.key === "Backspace") && !mod(e)) {
        const ids = targetIds();
        if (ids.length) {
          e.preventDefault();
          openTrash(ids);
        }
      } else if (e.key.toLowerCase() === "h" && !mod(e) && !e.altKey) {
        const ids = targetIds();
        if (ids.length && !readOnly) {
          e.preventDefault();
          const allHidden = ids.every((id) => byId.get(id)?.hidden);
          void act(ids, allHidden ? "unhide" : "hide");
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ── Render ────────────────────────────────────────────────────────────────────────────────────
  let body: React.ReactNode;
  if (!listing) body = <p className="muted assets-loading">Loading…</p>;
  else if (listing.status === "unset")
    body = (
      <div className="empty">
        <h2>No project folder yet</h2>
        <p>
          Your reference images, photos and exports live in a project folder outside the planner. Set one up
          to see your images here.
        </p>
        <a className="button primary" href={SETUP_HREF}>
          Set up in Settings → Project
        </a>
      </div>
    );
  else if (listing.status === "error")
    body = (
      <div className="empty">
        <h2>The images cannot be read</h2>
        <p>{listing.message}</p>
        <a className="button" href={SETUP_HREF}>
          Open Settings → Project
        </a>
      </div>
    );
  else {
    const hiddenHere = hiddenInSection(assets, section, ctx);
    const nav = (id: SectionId) => (
      <li key={id}>
        <button
          type="button"
          className={`assets-nav-item${section === id ? " current" : ""}`}
          aria-current={section === id ? "true" : undefined}
          onClick={() => {
            setSection(id);
            setStudioSub("");
            setFilter((f) => ({ ...f, tag: "" }));
          }}
        >
          <span>{SECTION_LABELS[id]}</span>
          <span className="faint mono">{counts[id]}</span>
        </button>
      </li>
    );
    let grid: React.ReactNode;
    if (shown.length > 0)
      grid = (
        <ul
          ref={gridRef}
          className="asset-grid large assets-grid"
          role="listbox"
          aria-label={`${SECTION_LABELS[section]}: ${images(shown.length)}`}
          aria-multiselectable={selection.active || undefined}
          onKeyDown={onGridKey}
          tabIndex={-1}
        >
          {shown.map((a) => (
            <AssetCard
              key={a.id}
              asset={a}
              uses={usage?.[a.id]}
              usageKnown={usage !== null}
              selecting={selection.active}
              selected={selection.ids.includes(a.id)}
              current={!selection.active && a.id === detailId}
              tabIndex={a.id === rovingId ? 0 : -1}
              onClick={(e) => onCardClick(e, a.id)}
              onFocus={() => setFocusId(a.id)}
            />
          ))}
        </ul>
      );
    else if (inSection.length > 0)
      grid = (
        <p className="muted small assets-empty-line">
          {filterEmptyText(filter.text, section)}{" "}
          <button type="button" className="link" onClick={() => setFilter(NO_FILTER)}>
            Clear filter
          </button>
        </p>
      );
    else if (hiddenHere > 0)
      grid = (
        <p className="muted small assets-empty-line">
          {allHiddenText(hiddenHere)}{" "}
          <button type="button" className="link" onClick={() => setShowHidden(true)}>
            Show hidden
          </button>
        </p>
      );
    else
      grid = (
        <div className="assets-empty">
          <p className="muted">{emptySectionText(section)}</p>
          {(section === "all" || section === "ideas") && assets.length === 0 && (
            <button type="button" onClick={reload}>
              Look for new images
            </button>
          )}
        </div>
      );

    const inUse = selected.filter((a) => isInUse(usage?.[a.id])).length;
    body = (
      <div className={`assets-layout${selection.active ? " selecting" : ""}`}>
        <nav className="assets-nav" aria-label="Sections">
          <ul>{nav("all")}</ul>
          <h3 className="assets-nav-head">Library</h3>
          <ul>{LIBRARY_SECTIONS.map(nav)}</ul>
          <h3 className="assets-nav-head">{personHeading(currentPerson, persons.length > 1)}</h3>
          <ul>{PERSON_SECTIONS.map(nav)}</ul>
          <h3 className="assets-nav-head">Smart albums</h3>
          <ul>{SMART_SECTIONS.map(nav)}</ul>
        </nav>
        <section
          className={`assets-main${dropping ? " dropping" : ""}`}
          aria-label={SECTION_LABELS[section]}
          onDragOver={onDragOver}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropping(false);
          }}
          onDrop={(e) => void onDrop(e)}
        >
          <div className="assets-filters">
            <input
              type="search"
              placeholder={`Search ${SECTION_LABELS[section].toLowerCase()}: id, notes, source, tags`}
              value={filter.text}
              onChange={(e) => setFilter({ ...filter, text: e.target.value })}
              aria-label="Search images"
            />
            {section === "studio" && (
              <div className="segmented" role="group" aria-label="Made in studio">
                {(["", "generated", "edit"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={studioSub === v}
                    onClick={() => setStudioSub(v)}
                  >
                    {v === "" ? "All" : CATEGORY_LABELS[v]}
                  </button>
                ))}
              </div>
            )}
            <select
              value={filter.tag}
              onChange={(e) => setFilter({ ...filter, tag: e.target.value })}
              aria-label="Tag"
            >
              <option value="">All tags</option>
              {tags.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.value} ({t.count})
                </option>
              ))}
            </select>
            {section !== "hidden" && (
              <label className="inline switch-label">
                <input
                  type="checkbox"
                  role="switch"
                  className="switch"
                  checked={showHidden}
                  onChange={(e) => setShowHidden(e.target.checked)}
                />
                Show hidden
              </label>
            )}
            <span className="faint small">
              {shown.length} of {counts[section]}
            </span>
          </div>
          {readOnly && <p className="notice info small">{READ_ONLY_HINT}</p>}
          {notice && (
            <p className="notice warn small">
              {notice}{" "}
              <button type="button" className="link" onClick={() => setNotice(null)}>
                Dismiss
              </button>
            </p>
          )}
          {grid}
          {listing.warnings.length > 0 && (
            <details className="small warn">
              <summary>
                {listing.warnings.length} catalogue warning{listing.warnings.length === 1 ? "" : "s"}
              </summary>
              <ul>
                {listing.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </details>
          )}
          {dropping && (
            <div className="assets-drop" aria-hidden="true">
              Drop to add to {dropLabel}
            </div>
          )}
          {selection.active && (
            <div className="assets-actionbar" role="toolbar" aria-label="Selected images">
              <span className="assets-actionbar-count" aria-live="polite">
                {selection.ids.length} selected
                {inUse > 0 && <span className="faint"> · {inUse} in use</span>}
              </span>
              <span className="spacer" />
              <HideButton
                assets={selected}
                disabled={readOnly || busy || selected.length === 0}
                onHide={(hide) => void act(selection.ids.slice(), hide ? "hide" : "unhide")}
              />
              <MoveSelect
                disabled={readOnly || busy || selected.length === 0}
                persons={persons}
                onMove={(category, p) => void act(selection.ids.slice(), "move", { category, person: p })}
              />
              <button
                type="button"
                className="danger"
                disabled={readOnly || busy || selected.length === 0}
                onClick={() => openTrash(selection.ids.slice())}
              >
                Move to Trash…
              </button>
              <button type="button" className="primary" onClick={() => setSelection(stopSelecting())}>
                Done
              </button>
            </div>
          )}
        </section>
        <aside className="assets-detail" aria-label="Image details">
          {selection.active && selected.length > 0 ? (
            <SelectionSummary assets={selected} usage={usage} />
          ) : detail ? (
            <AssetDetail
              key={detail.id}
              asset={detail}
              all={assets}
              uses={usage?.[detail.id] ?? []}
              usageKnown={usage !== null}
              readOnly={readOnly}
              persons={persons}
              busy={busy}
              onOpen={setDetailId}
              onHide={(hide) => void act([detail.id], hide ? "hide" : "unhide")}
              onMove={(category, p) => void act([detail.id], "move", { category, person: p })}
              onTrash={() => openTrash([detail.id])}
            />
          ) : (
            <p className="muted small assets-detail-empty">
              {selection.active
                ? "Click images to select them. Shift-click selects a range."
                : "Click an image to see where it is used and to edit it. Press Select to choose several."}
            </p>
          )}
        </aside>
      </div>
    );
  }

  return (
    <div className="assets-page">
      <header className="assets-head">
        <h2>Assets</h2>
        {ok && <span className="faint mono">{images(assets.length)}</span>}
        <span className="spacer" />
        {scanNote && <span className="faint small assets-note">{scanNote}</span>}
        {ok && (
          <button
            type="button"
            onClick={reload}
            title="Catalogue images newly copied into the project folder"
          >
            Look for new images
          </button>
        )}
        {ok && assets.length > 0 && (
          <button
            type="button"
            aria-pressed={selection.active}
            className={selection.active ? "primary" : ""}
            onClick={() => setSelection(selection.active ? stopSelecting() : startSelecting(selection))}
          >
            {selection.active ? "Done" : "Select"}
          </button>
        )}
      </header>
      {body}
      {dialog && (
        <TrashDialogView
          dialog={dialog}
          usage={usage}
          mode={trashMode}
          onForce={(force) => setDialog({ ...dialog, force })}
          onCancel={() => setDialog(null)}
          onHide={() => {
            const ids = dialog.ids;
            setDialog(null);
            void act(ids, "hide");
          }}
          onConfirm={() => void confirmTrash()}
        />
      )}
      <UndoToast message={toast} ms={UNDO_MS} onClose={closeToast} />
    </div>
  );
}

function AssetCard(props: {
  asset: AssetInfo;
  uses: AssetUse[] | undefined;
  usageKnown: boolean;
  selecting: boolean;
  selected: boolean;
  current: boolean;
  tabIndex: number;
  onClick: (e: MouseEvent) => void;
  onFocus: () => void;
}) {
  const { asset: a, uses } = props;
  const label = [
    a.id,
    CATEGORY_LABELS_ONE[a.effectiveCategory],
    a.hidden && "hidden",
    !a.exists && "file missing",
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <li
      role="option"
      data-id={a.id}
      aria-selected={props.selecting ? props.selected : props.current}
      aria-label={label}
      tabIndex={props.tabIndex}
      className={`asset-card assets-card${props.current ? " current" : ""}${props.selected ? " selected" : ""}${a.exists ? "" : " missing"}${a.hidden ? " hidden-asset" : ""}`}
      title={[a.id, a.source, a.notes].filter(Boolean).join("\n")}
      onClick={props.onClick}
      onFocus={props.onFocus}
    >
      {a.exists ? (
        <img src={assetImageUrl(a.id)} alt={a.notes ?? a.id} loading="lazy" decoding="async" />
      ) : (
        <span className="asset-missing">file missing</span>
      )}
      {props.selecting && (
        <span className={`select-check${props.selected ? " on" : ""}`} aria-hidden="true">
          {props.selected ? "✓" : ""}
        </span>
      )}
      <span className="asset-id">{a.id}</span>
      <span className="asset-badges">
        {props.usageKnown && (
          <span className={`asset-badge${isInUse(uses) ? " used" : ""}`}>{usageBadge(uses)}</span>
        )}
        {a.hidden && <span className="asset-badge">hidden</span>}
      </span>
    </li>
  );
}

function HideButton(props: { assets: AssetInfo[]; disabled: boolean; onHide: (hide: boolean) => void }) {
  const allHidden = props.assets.length > 0 && props.assets.every((a) => a.hidden);
  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={() => props.onHide(!allHidden)}
      title={
        allHidden
          ? "Offer these images in the pickers again (H)"
          : "Leave them out of the pickers; the files stay (H)"
      }
    >
      {allHidden ? "Unhide" : "Hide"}
    </button>
  );
}

/** "Move to …": a section, for photos per person when the project has several. */
function MoveSelect(props: {
  disabled: boolean;
  persons: PersonRef[];
  current?: AssetInfo;
  onMove: (category: AssetCategory, person: string | null) => void;
}) {
  const options: { value: string; label: string }[] = [];
  for (const c of MOVE_TARGETS) {
    if (isPersonCategory(c) && props.persons.length > 1)
      for (const p of props.persons)
        options.push({ value: `${c}:${p.id}`, label: `${CATEGORY_LABELS[c]} · ${personHeading(p, true)}` });
    else options.push({ value: `${c}:`, label: CATEGORY_LABELS[c] });
  }
  const now = props.current
    ? `${props.current.effectiveCategory}:${props.current.effectivePerson ?? ""}`
    : "";
  return (
    <select
      aria-label="Move to"
      value=""
      disabled={props.disabled}
      onChange={(e) => {
        const [c, p] = e.target.value.split(":");
        if (c) props.onMove(c as AssetCategory, p || null);
      }}
    >
      <option value="">Move to…</option>
      {options.map((o) => (
        <option
          key={o.value}
          value={o.value}
          disabled={
            o.value === now || (props.persons.length <= 1 && o.value.split(":")[0] === now.split(":")[0])
          }
        >
          {o.label}
        </option>
      ))}
    </select>
  );
}

function SelectionSummary({ assets, usage }: { assets: AssetInfo[]; usage: UsageMap | null }) {
  const bySection = facets(assets.map((a) => CATEGORY_LABELS[a.effectiveCategory]));
  const used = assets.filter((a) => isInUse(usage?.[a.id]));
  return (
    <section className="asset-detail">
      <h3 className="asset-detail-id">{images(assets.length)} selected</h3>
      <ul className="selection-strip" aria-hidden="true">
        {assets.slice(0, 8).map((a) => (
          <li key={a.id}>
            {a.exists ? <img src={assetImageUrl(a.id)} alt="" /> : <span className="asset-missing" />}
          </li>
        ))}
      </ul>
      <dl className="asset-facts">
        {bySection.map((s) => (
          <div key={s.value} className="contents">
            <dt>{s.value}</dt>
            <dd>{s.count}</dd>
          </div>
        ))}
        <dt>In use</dt>
        <dd>{used.length === 0 ? "none" : used.map((a) => a.id).join(", ")}</dd>
        <dt>Hidden</dt>
        <dd>{assets.filter((a) => a.hidden).length}</dd>
      </dl>
      <p className="faint small">
        <kbd className="kbd">H</kbd> hides, <kbd className="kbd">Delete</kbd> moves to the Trash,{" "}
        <kbd className="kbd">Esc</kbd> ends selecting.
      </p>
    </section>
  );
}

function UseLink({ assetId, use }: { assetId: string; use: AssetUse }) {
  const text = describeUse(assetId, use).slice(assetId.length + 2);
  if (use.kind === "layout")
    return (
      <button
        type="button"
        className="link"
        onClick={() => showElement({ layout: use.layout, element: use.element })}
      >
        {text}
      </button>
    );
  if (use.kind === "projection") return <a href="#settings/projection">{text}</a>;
  if (use.kind === "session") return <a href="#images">{text}</a>;
  return <span>{text}</span>;
}

function AssetDetail(props: {
  asset: AssetInfo;
  all: AssetInfo[];
  uses: AssetUse[];
  usageKnown: boolean;
  readOnly: boolean;
  persons: PersonRef[];
  busy: boolean;
  onOpen: (id: string) => void;
  onHide: (hide: boolean) => void;
  onMove: (category: AssetCategory, person: string | null) => void;
  onTrash: () => void;
}) {
  const { asset, uses, readOnly } = props;
  const [tags, setTags] = useState(asset.tags.join(", "));
  const [notes, setNotes] = useState(asset.notes ?? "");
  const [state, setState] = useState<
    { kind: "idle" | "saving" | "saved" } | { kind: "error"; message: string }
  >({
    kind: "idle",
  });
  const [projectDir, setProjectDir] = useState<string | null>(null);
  const desktop = desktopBridge();
  useEffect(() => {
    if (!desktop) return;
    let cancelled = false;
    getProject().then(
      (p) => !cancelled && setProjectDir(p.path),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [desktop]);
  useEffect(() => {
    if (state.kind !== "saved") return;
    const t = setTimeout(() => setState({ kind: "idle" }), 1600);
    return () => clearTimeout(t);
  }, [state.kind]);
  const dirty = tags !== asset.tags.join(", ") || notes !== (asset.notes ?? "");
  const original = asset.derived_from ? props.all.find((a) => a.id === asset.derived_from) : undefined;
  const children = props.all.filter((a) => a.derived_from === asset.id);
  const layoutUses = uses.filter((u) => u.kind !== "derived");
  const pose = asset.effectiveCategory === "measuring" ? poseLabel(asset.file) : null;
  const owner = props.persons.find((p) => p.id === asset.effectivePerson);

  const save = async () => {
    setState({ kind: "saving" });
    try {
      const r = await fetch(assetEntryUrl(asset.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: parseTags(tags), notes: notes.trim() ? notes : null }),
      });
      if (!r.ok) {
        const msg = ((await r.json().catch(() => ({}))) as { error?: string }).error;
        throw new Error(msg ?? `HTTP ${r.status}`);
      }
      setState({ kind: "saved" });
      announceManifestChanged();
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <section className="asset-detail">
      <div className="asset-detail-image">
        {asset.exists ? (
          <img src={assetImageUrl(asset.id)} alt={asset.notes ?? asset.id} />
        ) : (
          <span className="asset-missing">file missing</span>
        )}
      </div>
      <h3 className="asset-detail-id">{asset.id}</h3>
      <div className="asset-detail-section">
        <span className="chip muted">{CATEGORY_LABELS_ONE[asset.effectiveCategory]}</span>
        <MoveSelect
          disabled={readOnly || props.busy}
          persons={props.persons}
          current={asset}
          onMove={props.onMove}
        />
      </div>
      <dl className="asset-facts">
        <dt>File</dt>
        <dd className="mono">{asset.file}</dd>
        {asset.source && (
          <>
            <dt>Source</dt>
            <dd>{asset.source}</dd>
          </>
        )}
        {asset.derived_from && (
          <>
            <dt>Edited from</dt>
            <dd>
              {original ? (
                <button type="button" className="link mono" onClick={() => props.onOpen(original.id)}>
                  {original.id}
                </button>
              ) : (
                <span className="mono">{asset.derived_from} (deleted)</span>
              )}
            </dd>
          </>
        )}
        {owner && props.persons.length > 1 && (
          <>
            <dt>Person</dt>
            <dd>{personHeading(owner, true)}</dd>
          </>
        )}
        {pose && (
          <>
            <dt>Pose</dt>
            <dd>{pose}</dd>
          </>
        )}
      </dl>
      {children.length > 0 && (
        <>
          <h4 className="props-head">Edits made from it</h4>
          <ul className="selection-strip">
            {children.map((c) => (
              <li key={c.id}>
                <button type="button" className="ghost" title={c.id} onClick={() => props.onOpen(c.id)}>
                  {c.exists ? (
                    <img src={assetImageUrl(c.id)} alt={c.id} />
                  ) : (
                    <span className="asset-missing" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <h4 className="props-head">Used in</h4>
      {!props.usageKnown ? (
        <p className="muted small">Checking…</p>
      ) : layoutUses.length === 0 ? (
        <p className="muted small">Not used in any layout or projection.</p>
      ) : (
        <ul className="asset-uses">
          {layoutUses.map((u, i) => (
            <li key={i}>
              <UseLink assetId={asset.id} use={u} />
            </li>
          ))}
        </ul>
      )}
      <form
        className="props"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label>
          Tags
          <input
            type="text"
            value={tags}
            placeholder="comma-separated, e.g. medusa, realistic"
            disabled={readOnly}
            onChange={(e) => setTags(e.target.value)}
          />
        </label>
        <label>
          Notes
          <textarea rows={3} value={notes} disabled={readOnly} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <div className="toolbar">
          <button
            type="submit"
            className={dirty ? "primary" : ""}
            disabled={readOnly || !dirty || state.kind === "saving"}
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => props.onHide(!asset.hidden)}
            disabled={readOnly || props.busy}
            title={
              asset.hidden
                ? "Offer this image in the pickers again (H)"
                : "Leave this image out of the pickers; the file and its entry stay (H)"
            }
          >
            {asset.hidden ? "Unhide" : "Hide"}
          </button>
          {desktop && projectDir && asset.exists && (
            <button
              type="button"
              className="ghost"
              onClick={() =>
                void desktop.revealInFinder(`${projectDir}/${asset.file}`).catch(() => undefined)
              }
            >
              Reveal in Finder
            </button>
          )}
          <span className="spacer" />
          {state.kind === "saved" && <span className="small ok-text">Saved</span>}
        </div>
        {state.kind === "error" && <p className="small error-text">Not saved: {state.message}</p>}
        {readOnly && <p className="faint small">{READ_ONLY_HINT}</p>}
      </form>
      <div className="danger-zone">
        <button type="button" className="danger" disabled={readOnly || props.busy} onClick={props.onTrash}>
          Move to Trash…
        </button>
        <span className="faint small">The file goes to the Trash; undo for a few seconds.</span>
      </div>
    </section>
  );
}

function TrashDialogView(props: {
  dialog: TrashDialog;
  usage: UsageMap | null;
  mode: TrashMode | undefined;
  onForce: (force: boolean) => void;
  onCancel: () => void;
  onHide: () => void;
  onConfirm: () => void;
}) {
  const { dialog, usage } = props;
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const onCancelRef = useRef(props.onCancel);
  useEffect(() => {
    onCancelRef.current = props.onCancel;
  });
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const opener = document.activeElement as HTMLElement | null;
    if (!d.open) d.showModal?.();
    cancelRef.current?.focus();
    const onClose = () => onCancelRef.current();
    d.addEventListener("cancel", onClose);
    return () => {
      d.removeEventListener("cancel", onClose);
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  const check = deleteCheck(dialog.ids, usage ?? {});
  const projections = dialog.refusal?.projections ?? check.projections;
  const inSession = dialog.refusal?.inSession.length ? dialog.refusal.inSession : check.inSession;
  const projectionNames = [
    ...new Set(projections.map((p) => (p.use.kind === "projection" ? p.use.label : ""))),
  ];
  const blocked = inSession.length > 0 || (projections.length > 0 && !dialog.force);
  return (
    <dialog
      ref={ref}
      className="trash-dialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="trash-title"
      aria-describedby="trash-body"
    >
      <h2 id="trash-title" className="popover-title">
        {trashTitle(dialog.ids, props.mode)}
      </h2>
      <p id="trash-body" className="small muted">
        {trashBody(dialog.ids.length, props.mode)}
      </p>
      {(check.layouts.length > 0 || projections.length > 0) && (
        <>
          <p className="small">Still in use: layouts then show a placeholder, projections lose the photo.</p>
          <ul className="asset-uses trash-uses">
            {[...check.layouts, ...projections].map((u, i) => (
              <li key={i}>{describeUse(u.id, u.use)}</li>
            ))}
          </ul>
        </>
      )}
      {inSession.length > 0 && (
        <p className="small error-text">
          {inSession.join(", ")} {inSession.length === 1 ? "is" : "are"} open in the Image studio. Close that
          session first.
        </p>
      )}
      {projections.length > 0 && inSession.length === 0 && (
        <label className="inline trash-force">
          <input type="checkbox" checked={dialog.force} onChange={(e) => props.onForce(e.target.checked)} />I
          know this breaks the projection{projectionNames.length === 1 ? "" : "s"}{" "}
          {projectionNames.join(", ")}
        </label>
      )}
      {dialog.error && <p className="small error-text">{dialog.error}</p>}
      <div className="toolbar">
        <button ref={cancelRef} type="button" onClick={props.onCancel}>
          Cancel
        </button>
        <button type="button" onClick={props.onHide} disabled={dialog.busy}>
          Hide instead
        </button>
        <span className="spacer" />
        <button type="button" className="danger" onClick={props.onConfirm} disabled={blocked || dialog.busy}>
          {dialog.busy ? "Moving…" : props.mode === "project" ? "Move to trash folder" : "Move to Trash"}
        </button>
      </div>
    </dialog>
  );
}
