// The Settings tab: everything that is set up once rather than used every day, as sections with a
// small side navigation. The sections are the former tabs (Data folder, Arm & measurements,
// Projection), shown unchanged, plus the image-generation status.
import type { ReactNode } from "react";
import { DataFolderPage } from "../data/DataFolderPage.tsx";
import type { HeaderSlots } from "../editor/LayoutPage.tsx";
import { ProjectionPage } from "../projection/ProjectionPage.tsx";
import { ArmPage } from "../viewer/ArmPage.tsx";
import type { ArmState, Pose } from "../viewer/useArm.ts";
import { ImageGenerationSettings } from "./ImageGenerationSettings.tsx";
import { SETTINGS_SECTIONS, type SettingsSection } from "./routes.ts";

type Props = {
  section: SettingsSection;
  onSection: (s: SettingsSection) => void;
  arm: ArmState;
  pose: Pose;
  onProjectionDirty: (dirty: boolean) => void;
  /** Sections with unsaved edits get a dot in the side navigation. */
  unsaved?: Partial<Record<SettingsSection, boolean>>;
  header?: HeaderSlots;
};

/** Sections whose page is a full-bleed workspace (a 3D view filling the height). */
const WORKSPACES: ReadonlySet<SettingsSection> = new Set(["body", "projection"]);

export function SettingsPage({ section, onSection, arm, pose, onProjectionDirty, unsaved, header }: Props) {
  let body: ReactNode;
  switch (section) {
    case "project":
      body = <DataFolderPage />;
      break;
    case "body":
      body = <ArmPage arm={arm} pose={pose} />;
      break;
    case "projection":
      body = <ProjectionPage arm={arm} pose={pose} onDirty={onProjectionDirty} header={header} />;
      break;
    case "image-generation":
      body = <ImageGenerationSettings />;
      break;
  }
  return (
    <div className="settings-page">
      <nav className="settings-nav" aria-label="Settings sections">
        <p className="settings-nav-title">Settings</p>
        <ul>
          {SETTINGS_SECTIONS.map((s) => (
            <li key={s.id}>
              <a
                href={`#settings/${s.id}`}
                aria-current={s.id === section ? "page" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  onSection(s.id);
                }}
              >
                {s.label}
                {unsaved?.[s.id] && (
                  <span className="tab-dot" role="img" aria-label="unsaved changes" title="Unsaved changes" />
                )}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className={WORKSPACES.has(section) ? "settings-body workspace-body" : "settings-body"}>{body}</div>
    </div>
  );
}
