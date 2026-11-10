# ADR 0025: One 3D stage, neutral tone mapping, rendering on demand

- Status: accepted (2026-11-10, decided by Claude in the UX overhaul Jan asked for: "ux, usability und dass es state-of-the-art aussieht"; listed for his review in `docs/claude-decisions.md`)
- Context: the four 3D views (Layout arm, Settings → Body, Home, Compare) each set up their own canvas, lights and controls. The skin looked flat and slightly grey under ACES tone mapping, which also shifted the colours of reference images against the 2D unwrap. Every canvas rendered 60 frames a second even when nothing moved (measured over 3 s idle: 68 draw calls in Layout, 54 in Body, 361 in the full-body view), which keeps the fan-less MacBook Air warm for no reason. Camera presets jumped.

## Decision

- **One stage module.** `src/viewer/Stage.tsx` holds the shared pieces: `StageLights`, `StageShadow` (a soft contact shadow), `useCameraFlight` and the renderer settings (`STAGE_GL`, `STAGE_DPR`). The viewers keep their own geometry and controls.
- **Neutral tone mapping, exposure 1.0.** `NeutralToneMapping` keeps hue and saturation of the motif textures close to the 2D unwrap; ACES desaturated and darkened them.
- **A camera-relative light rig** (`STAGE_LIGHTS` in `src/viewer/scene.ts`): hemisphere light, a warm key from the upper front right, a cool low fill, a rim light and a weak kicker from behind. The lights follow the camera, so the body reads the same from every side and never turns its dark side to the viewer.
- **Rendering on demand** (`frameloop="demand"`): a frame is drawn only after a change (orbit, texture update, pose, resize, theme). Idle draw calls are 0 in Layout, Body, Compare and the full-body view. Home's turntable draws only while it turns and the tab is visible.
- **Eased camera moves.** Presets and the double-click reset fly in 420 ms (`src/viewer/cameraTween.ts`, tested; instant under `prefers-reduced-motion`). Orbit has damping and zoom limits.
- **The export keeps its own lights** (`LIGHTS` in `scene.ts`, ACES): the handout must not change with a screen-only decision.

## Consequences

- Code that changes something three.js cannot see through React props must call `invalidate()`, or the view stays on the old frame.
- The handout's 3D views are slightly different in tone from the screen. If that bothers, move the export to `STAGE_LIGHTS` in a separate, checked step.
- The light values were tuned with the sample project under software rendering; check them once on the Mac with real photos.

## Alternatives

- Keep rendering every frame: simplest, but costs battery and heat for a mostly still picture.
- An environment map (image-based lighting): better skin, but needs an HDR file in the repo or at runtime and is heavier.
- Post-processing (ambient occlusion, bloom): too heavy for the target machines and not needed for a sketch tool.
