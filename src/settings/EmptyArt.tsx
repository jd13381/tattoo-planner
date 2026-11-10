import type { ReactNode } from "react";
// Small line illustrations for empty states (Compare, Projection overview). Decorative, drawn with
// currentColor and tokens through the pg-art-* classes, so they follow the theme.

/** Two layout variants side by side, one differing. */
export function CompareArt() {
  return (
    <span className="pg-empty-art" aria-hidden="true">
      <svg width="264" height="132" viewBox="0 0 220 110">
        <rect className="pg-art-surface" x="6" y="8" width="96" height="94" rx="10" />
        <rect className="pg-art-surface" x="118" y="8" width="96" height="94" rx="10" />
        <text className="pg-art-label" x="16" y="26">
          A
        </text>
        <text className="pg-art-label" x="128" y="26">
          B
        </text>
        <path className="pg-art-line" d="M54 36v56M38 46q16-6 32 0M40 92h28" />
        <circle className="pg-art-line" cx="54" cy="36" r="5" />
        <path className="pg-art-line" d="M166 36v56M150 46q16-6 32 0M152 92h28" />
        <circle className="pg-art-line" cx="166" cy="36" r="5" />
        <path className="pg-art-accent" d="M160 60c4-5 10-5 12 0s-4 9-8 9-8-4-4-9z" />
        <path className="pg-art-accent" d="M104 55h12m-4-4 4 4-4 4" />
      </svg>
    </span>
  );
}

/** Photos, outline, wrapped onto the body. */
export function HowItWorks() {
  const step = (n: number, title: string, text: string, art: ReactNode) => (
    <li className="pg-step">
      <svg width="96" height="72" viewBox="0 0 96 72" aria-hidden="true">
        {art}
      </svg>
      <span>
        <b>
          {n}. {title}
        </b>
        <br />
        {text}
      </span>
    </li>
  );
  return (
    <ol className="pg-steps" aria-label="How it works">
      {step(
        1,
        "Photos",
        "Of the tattoo",
        <>
          <rect className="pg-art-surface" x="10" y="14" width="46" height="40" rx="5" />
          <rect className="pg-art-surface" x="34" y="20" width="46" height="40" rx="5" />
          <circle className="pg-art-line" cx="50" cy="34" r="4" />
          <path className="pg-art-line" d="M38 56l12-10 10 8 8-6 6 6" />
        </>,
      )}
      {step(
        2,
        "Mark",
        "Outline and sizes",
        <>
          <rect className="pg-art-surface" x="16" y="10" width="64" height="52" rx="5" />
          <path
            className="pg-art-accent"
            d="M30 40c0-14 12-20 22-18s16 12 8 22-28 6-30-4z"
            strokeDasharray="3 3"
          />
          <path className="pg-art-line" d="M24 56h48M24 53v6M72 53v6" />
        </>,
      )}
      {step(
        3,
        "Wrapped",
        "Onto the body",
        <>
          <path className="pg-art-surface" d="M30 8h36v56H30z" />
          <path className="pg-art-line" d="M30 8c-6 18-6 38 0 56M66 8c6 18 6 38 0 56" />
          <path className="pg-art-fill" d="M34 26c8-6 20-6 28 0-2 8-2 14 0 20-8 5-20 5-28 0 2-6 2-12 0-20z" />
        </>,
      )}
    </ol>
  );
}
