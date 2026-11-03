# Measuring and photographing the arm

How to collect the numbers for `config/measurements.yaml` (PROJECT_BRIEF.md §13.1) and the photos for `arm-photos/` and `existing/` in the data folder. The planner builds the 3D arm from the numbers; the photos are for checking the shape and placing the Anubis.

**You need:** a soft tape measure (tailor's tape), a skin-safe pen or small stickers, a helper (most measurements can't be taken one-handed), a phone camera, a plain wall.

## Landmarks

Mark these on the left arm first. Every length and position below starts from one of them.

| Landmark       | Where                                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------------- |
| Shoulder point | The bony tip at the outer top of the shoulder (acromion). Feel along the collarbone outwards to its end. |
| Elbow tip      | The bony point at the back of the elbow (olecranon), arm straight.                                       |
| Wrist crease   | The skin crease where hand and forearm meet, palm side.                                                  |

## Posture

Stand upright, left arm hanging relaxed and straight, slightly away from the body, palm facing forward. Muscles relaxed (no flexing), for every measurement.

## Lengths

Measure along the outside of the arm, tape lying on the skin, not pulled tight.

| Field               | From → to                                                                   |
| ------------------- | --------------------------------------------------------------------------- |
| `shoulder_to_elbow` | shoulder point → elbow tip                                                  |
| `elbow_to_wrist`    | elbow tip → wrist crease (around the outer forearm edge to the crease line) |

## Circumferences

Tape horizontal (at a right angle to the arm), snug on the skin without pressing in. Read the value where the tape overlaps. Measure each twice; if the two readings differ by more than 0.5 cm, take a third and use the middle value.

| Field          | Where                                                                                                                                    |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `wrist`        | at the wrist crease                                                                                                                      |
| `forearm_mid`  | halfway between wrist crease and elbow tip                                                                                               |
| `forearm_max`  | the thickest point of the forearm, a few cm below the elbow; also note `positions.forearm_max_below_elbow` (elbow tip down to the tape)  |
| `elbow`        | over the elbow tip                                                                                                                       |
| `above_elbow`  | 5 cm above the elbow tip                                                                                                                 |
| `biceps_mid`   | halfway between elbow tip and shoulder point, relaxed                                                                                    |
| `armpit_level` | at the height of the armpit fold; also note `positions.armpit_level_below_shoulder` (shoulder point down to the tape, along the outside) |
| `shoulder`     | as high around the deltoid as the tape still sits horizontally; also note `positions.shoulder_below_shoulder`                            |

## Anubis

Lay the tape along the forearm, palm up.

| Field                 | What                                                                                |
| --------------------- | ----------------------------------------------------------------------------------- |
| `distance_from_wrist` | wrist crease → lowest point of the tattoo (ribbons included)                        |
| `height`              | lowest → highest point of the tattoo, along the arm                                 |
| `width`               | widest extent across the arm, measured over the skin (not straight through the air) |

## Photos

Save them in the data folder, never in the repo:

- `arm-photos/front.jpg`, `back.jpg`, `lateral.jpg`, `medial.jpg`
- `existing/anubis-front.jpg`

**For all photos:** plain wall, even light without hard shadows, sleeveless shirt. The helper stands about 2 m away and zooms in (2× on most phones) instead of walking closer: this keeps the perspective flat. Camera at elbow height, held straight (not tilted). Lay a tape measure along the arm or stick it next to it, so the scale is readable in the picture. Keep the whole arm from shoulder to wrist in frame.

| Photo          | Pose                                                                     | Camera                                                            |
| -------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `front`        | facing the camera, arm hanging slightly away from the body, palm forward | in front                                                          |
| `back`         | back to the camera, same arm pose                                        | behind                                                            |
| `lateral`      | left side to the camera, arm hanging, palm towards the thigh             | to the left                                                       |
| `medial`       | arm stretched forward to horizontal, palm up                             | to the right of the arm, at arm height, looking at its inner side |
| `anubis-front` | forearm resting palm up on a table, tape measure next to the tattoo      | straight above the tattoo, lens parallel to the skin              |

If you take more photos (bent elbow, close-ups), any extra file names are fine.
