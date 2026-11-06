// The Settings tab: everything that is set up once rather than used every day, as sections with a
// small side navigation: Project (the former Data folder tab), Body & measurements (sample body, own
// measurements per region, the measuring wizard), the existing tattoos (list, guided setup and the
// Advanced calibration page), the image-generation status and the appearance (theme).
import type { ReactNode } from "react";
import type { HeaderSlots } from "../editor/LayoutPage.tsx";
import type { WorkingLayout } from "../layout/useLayouts.ts";
import { ProjectionSettings } from "../projection/ProjectionSettings.tsx";
import { ProjectPage } from "../project/ProjectPage.tsx";
import type { ArmState, Pose } from "../viewer/useArm.ts";
import { AppearanceSettings } from "./AppearanceSettings.tsx";
import { BodyPage } from "./BodyPage.tsx";
import { ImageGenerationSettings } from "./ImageGenerationSettings.tsx";
import { SETTINGS_SECTIONS, type SettingsSection } from "./routes.ts";

type Props = {
  section: SettingsSection;
  onSection: (s: SettingsSection) => void;
  arm: ArmState;
  pose: Pose;
  onProjectionDirty: (dirty: boolean) => void;
  /** The Layout tab's open variant: the projection wizard links a tattoo into it when it fits. */
  openLayout?: WorkingLayout | null;
  /** Sections with unsaved edits get a dot in the side navigation. */
  unsaved?: Partial<Record<SettingsSection, boolean>>;
  header?: HeaderSlots;
};

/** Sections whose page is a full-bleed workspace (a 3D view filling the height). */
const WORKSPACES: ReadonlySet<SettingsSection> = new Set(["body", "projection"]);

export function SettingsPage(props: Props) {
  const { section, onSection, arm, pose, onProjectionDirty, openLayout, unsaved, header } = props;
  let body: ReactNode;
  switch (section) {
    case "project":
      body = <ProjectPage />;
      break;
    case "body":
      body = <BodyPage arm={arm} pose={pose} />;
      break;
    case "projection":
      body = (
        <ProjectionSettings
          arm={arm}
          pose={pose}
          onDirty={onProjectionDirty}
          openLayout={openLayout}
          header={header}
        />
      );
      break;
    case "image-generation":
      body = <ImageGenerationSettings />;
      break;
    case "appearance":
      body = <AppearanceSettings />;
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
