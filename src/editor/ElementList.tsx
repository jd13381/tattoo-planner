import { useState, type DragEvent, type ReactNode } from "react";
import type { ElementType, LayoutElement } from "../layout/schema.ts";
import { BandIcon, ExistingIcon, FigureIcon, LineIcon, LockIcon } from "../ui/icons.tsx";
import { GripIcon } from "./editorIcons.tsx";
import { KIND_LABEL } from "./labels.ts";
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
  /** Image URL per element id (figures and existing tattoos with an image); the rest show an icon. */
  thumbs?: ReadonlyMap<string, string>;
  /** Shown instead of the list while the variant has no elements. */
  empty?: ReactNode;
};

type Drop = { over: number; above: boolean };

const KIND_ICON: Record<ElementType, ReactNode> = {
  figure: <FigureIcon />,
  existing: <ExistingIcon />,
  band: <BandIcon />,
  line: <LineIcon />,
};

/** Every element of the variant, topmost first: select, lock, and drag to change the layer order. */
export function ElementList(props: Props) {
  const { elements, issues, selected, onSelect, onToggleLock, onMove, heading = true, thumbs } = props;
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
        </div>
      )}
      {elements.length === 0 && props.empty}
      <ul>
        {order.map((i) => {
          const el = elements[i]!;
          const locked = !!el.locked;
          const dots = issues[i] ?? [];
          const thumb = thumbs?.get(el.id);
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
              <span className="el-grip" aria-hidden="true" title="Drag to change the layer order">
                <GripIcon />
              </span>
              <button
                type="button"
                className="element-select"
                aria-current={i === selected ? "true" : undefined}
                onClick={() => onSelect(i)}
                title={`${el.id} (${KIND_LABEL[el.type].toLowerCase()}), layer ${i + 1} of ${elements.length}`}
              >
                <span className={`el-thumb el-thumb-${el.type}`} aria-hidden="true">
                  {thumb ? <img src={thumb} alt="" loading="lazy" draggable={false} /> : KIND_ICON[el.type]}
                </span>
                <span className="el-text">
                  <span className="element-id">{el.id}</span>
                  <span className="element-type">{KIND_LABEL[el.type]}</span>
                </span>
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
                title={
                  locked
                    ? "Locked: cannot be moved, edited or deleted. Click to unlock."
                    : "Lock against accidental edits"
                }
                onClick={() => onToggleLock(i)}
              >
                <LockIcon open={!locked} />
              </button>
            </li>
          );
        })}
      </ul>
      {elements.length > 1 && <p className="el-order-hint">Listed front to back. Drag a row to reorder.</p>}
    </section>
  );
}
