// Built-in engine UI of the Image studio (ADR 0013): the list of operations with their one or two
// controls, and a live preview of the chosen one on a small copy of the image. UI only; the operations
// and their catalogue live in src/render/builtinOps.ts and builtin.ts.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Pixels } from "../render/builtinOps.ts";
import {
  applyBuiltin,
  BUILTIN_OPS,
  builtinOp,
  cleanParams,
  PREVIEW_MAX_SIDE,
  type BuiltinOpId,
  type BuiltinParams,
} from "./builtin.ts";
import { drawPixels, loadPixels } from "./pixelsDom.ts";

export function BuiltinPanel({
  opId,
  params,
  disabled,
  onOp,
  onParams,
}: {
  opId: BuiltinOpId;
  params: BuiltinParams;
  disabled: boolean;
  onOp: (id: BuiltinOpId) => void;
  onParams: (p: BuiltinParams) => void;
}) {
  return (
    <ul className="builtin-ops" role="radiogroup" aria-label="Operation">
      {BUILTIN_OPS.map((op) => {
        const on = op.id === opId;
        const values = on ? cleanParams(op.id, params) : {};
        return (
          <li key={op.id} className={on ? "on" : undefined}>
            <button
              type="button"
              role="radio"
              aria-checked={on}
              className={`builtin-op${on ? " on" : ""}`}
              title={op.hint}
              disabled={disabled}
              onClick={() => onOp(op.id)}
            >
              {op.label}
            </button>
            {on && op.params.length > 0 && (
              <div className="builtin-controls">
                {op.params.map((p) =>
                  p.kind === "range" ? (
                    <label key={p.key} className="builtin-range">
                      <span>{p.label}</span>
                      <input
                        type="range"
                        min={p.min}
                        max={p.max}
                        step={p.step}
                        value={values[p.key]}
                        disabled={disabled}
                        onChange={(e) => onParams({ ...values, [p.key]: Number(e.target.value) })}
                      />
                      <span className="mono faint">
                        {values[p.key]}
                        {p.unit ? ` ${p.unit}` : ""}
                      </span>
                    </label>
                  ) : (
                    <span key={p.key} className="segmented" role="group" aria-label={p.label}>
                      {p.options.map((o) => (
                        <button
                          key={o.value}
                          type="button"
                          aria-pressed={values[p.key] === o.value}
                          disabled={disabled}
                          onClick={() => onParams({ ...values, [p.key]: o.value })}
                        >
                          {o.label}
                        </button>
                      ))}
                    </span>
                  ),
                )}
              </div>
            )}
            {on && <p className="faint small builtin-hint">{op.hint}</p>}
          </li>
        );
      })}
    </ul>
  );
}

/** The image with the chosen operation applied, on a copy of at most 640 px; redrawn on every change. */
export function BuiltinPreview({
  src,
  opId,
  params,
}: {
  src: string;
  opId: BuiltinOpId;
  params: BuiltinParams;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [source, setSource] = useState<{ src: string; pixels: Pixels; scale: number; width: number } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { pixels, scale, fullWidth } = await loadPixels(src, PREVIEW_MAX_SIDE);
        if (!cancelled) {
          setSource({ src, pixels, scale, width: fullWidth });
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [src]);

  useEffect(() => {
    if (!source || source.src !== src || !ref.current) return;
    drawPixels(ref.current, applyBuiltin(source.pixels, opId, params, source.scale));
  }, [source, src, opId, params]);

  if (error) return <p className="error-text small">{error}</p>;
  const ready = source?.src === src;
  const style = ready
    ? ({
        "--natural-w": `${source.width}px`,
        "--aspect": source.pixels.width / source.pixels.height,
      } as CSSProperties)
    : undefined;
  return (
    <canvas
      ref={ref}
      className="builtin-preview"
      style={style}
      aria-label={`Preview: ${builtinOp(opId)?.label ?? opId}`}
      hidden={!ready}
    />
  );
}
