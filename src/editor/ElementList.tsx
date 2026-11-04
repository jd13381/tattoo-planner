import { useState, type DragEvent } from "react";
import type { LayoutElement } from "../layout/schema.ts";
import { LockIcon } from "../ui/icons.tsx";
import { dropIndex } from "./layoutOps.ts";

type Props = {
  elements: readonly LayoutElement[];
  /** Per element (layer order): what its warning dot says; empty = no dot. */
  issues: readonly (readonly string[])[];
  selected: number | null;
  onSelect: (index: number) => void;
  onToggleLock: (index: number) => void;
  /** Moves the element at layer `from` to layer `to` (0 = bottom). */
  onMove: (from: number, to: number) => void;
  /** false leaves out the heading (a tabbed panel names the list instead). */
  heading?: boolean;
};

type Drop = { over: number; above: boolean };

/** Every element of the variant, topmost first: select, lock, and drag to change the layer order. */
export function ElementList(props: Props) {
  const { elements, issues, selected, onSelect, onToggleLock, onMove, heading = true } = props;
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const order = elements.map((_, i) => elements.length - 1 - i);

  const onDragOver = (e: DragEvent<HTMLLIElement>, layer: number) => {
    if (dragFrom === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const r = e.currentTarget.getBoundingClientRect();
    const above = e.clientY < r.top + r.height / 2;
    if (drop?.over !== layer || drop.above !== above) setDrop({ over: layer, above });
  };
  const endDrag = () => {
    setDragFrom(null);
    setDrop(null);
  };

  return (
    <section className={heading ? "panel element-list" : "element-list"} aria-label="Elements">
      {heading && (
        <div className="panel-head">
          <h2>
            Elements <span className="muted small">{elements.length}</span>
          </h2>
          <span
            className="faint xs"
            title="The list shows the top layer first; drag a row to change the order."
          >
            top layer first
          </span>
        </div>
      )}
      <ul>
        {order.map((i) => {
          const el = elements[i]!;
          const locked = !!el.locked;
          const dots = issues[i] ?? [];
          const dropCls =
            drop && drop.over === i && dragFrom !== null && dragFrom !== i
              ? drop.above
                ? " drop-above"
                : " drop-below"
              : "";
          return (
            <li
              key={`${i}:${el.id}`}
              className={`element-row${i === selected ? " selected" : ""}${dragFrom === i ? " dragging" : ""}${dropCls}`}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", el.id);
                setDragFrom(i);
              }}
              onDragOver={(e) => onDragOver(e, i)}
              onDrop={(e) => {
                e.preventDefault();
                if (dragFrom !== null && drop) onMove(dragFrom, dropIndex(dragFrom, drop.over, drop.above));
                endDrag();
              }}
              onDragEnd={endDrag}
            >
              <button
                type="button"
                className="element-select"
                aria-current={i === selected ? "true" : undefined}
                onClick={() => onSelect(i)}
                title={`${el.id} (${el.type}), layer ${i + 1} of ${elements.length}`}
              >
                <span className={`swatch cat-${el.type}`} aria-hidden="true" />
                <span className="element-id">{el.id}</span>
                <span className="element-type">{el.type}</span>
                {dots.length > 0 && (
                  <span
                    className="issue-dot"
                    role="img"
                    aria-label={dots.join("; ")}
                    title={dots.join("\n")}
                  />
                )}
              </button>
              <button
                type="button"
                className={`ghost icon-button lock-toggle${locked ? " on" : ""}`}
                aria-pressed={locked}
                aria-label={`${locked ? "Unlock" : "Lock"} ${el.id}`}
                title={locked ? "Locked: cannot be moved, edited or deleted. Click to unlock." : "Lock"}
                onClick={() => onToggleLock(i)}
              >
                <LockIcon open={!locked} />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
