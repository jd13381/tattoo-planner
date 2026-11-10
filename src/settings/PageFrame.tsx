// The common frame of the padded Settings pages: one content column, and a header with the title,
// an optional status chip, a one-line description and the page's main action on the right.
import type { ReactNode } from "react";

type Props = {
  title: string;
  /** A status chip next to the title ("Ready", "Not set up"). */
  status?: ReactNode;
  /** One or two plain sentences under the title. */
  description?: ReactNode;
  /** The page's primary action, aligned right. */
  actions?: ReactNode;
  children?: ReactNode;
  /** A page that scrolls itself (the Projection overview fills the Settings height). */
  className?: string;
};

export function PageFrame({ title, status, description, actions, children, className }: Props) {
  return (
    <div className={`pg-frame${className ? ` ${className}` : ""}`}>
      <header className="pg-head">
        <div className="pg-head-text">
          <div className="pg-title-row">
            <h1 className="pg-title">{title}</h1>
            {status}
          </div>
          {description && <p className="pg-desc">{description}</p>}
        </div>
        {actions && <div className="pg-head-actions">{actions}</div>}
      </header>
      {children}
    </div>
  );
}
