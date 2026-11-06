# Scoring rubric

Score every result image from 1 to 5 on four criteria. Look at the result next to the input at the same size; judge it as a **sketch to show the tattoo artist**, not as a finished design.

| Score | Faithful (kept what it should)                                       | Prompt (did what was asked)                                    | Quality (image as such)                                   | Tattoo fit (usable for planning)                                   |
| ----- | -------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------ |
| 5     | Figure, face, line work and shading unchanged; only the asked change | Exactly the change, complete (two snakes, clouds everywhere)   | Clean, no artefacts, consistent style, sharp at full size | Could go into the handout as it is                                 |
| 4     | Small drift (a line, a shade) that only shows side by side           | The change is there with a small miss (one snake short, a gap) | Minor artefacts visible only when zoomed in               | Good after one more edit or a built-in clean-up (levels, line art) |
| 3     | Noticeable changes (face or proportions differ, style shifted)       | Partly done (snakes beside the figure, not around it)          | Visible artefacts (smudges, broken lines, odd anatomy)    | Shows the idea, but needs explaining to the artist                 |
| 2     | Largely redrawn; it reads as a different image                       | Wrong change, or only a trace of it                            | Many artefacts, muddy, low detail                         | Misleading rather than helpful                                     |
| 1     | Unrelated to the input                                               | Ignored the instruction                                        | Broken (noise, black, cut off)                            | Unusable                                                           |

For the **`stars`** case (text-to-image), "Faithful" scores the **tiling** instead:

| Score | Tiling (use `stars-tiled-2x2.png` and `stars-repaired-tiled-2x2.png`, plus the seam scores) |
| ----- | ------------------------------------------------------------------------------------------- |
| 5     | No visible seam in the 2 × 2 preview; seam scores ≤ 1.3                                     |
| 4     | A seam visible only when searched for; scores ≤ 2                                           |
| 3     | Visible seam, but the repaired version fixes most of it                                     |
| 2     | Clear seam or density jump at the edges; repair makes it worse or leaves a cross            |
| 1     | Not usable as a repeating background                                                        |

## Hard limits (not scored, but decisive)

Write these in the Notes column; any of them means "does not ship on this machine" regardless of the scores:

- **Does not fit:** the run failed with an out-of-memory error, or swap grew by more than ~2 GB, or the Mac became unusable during the run.
- **Too slow:** more than **3 minutes** per edit on the MacBook Air (GPT Image takes about 1 minute; a local engine may be slower, but not so slow that nobody waits for it).
- **Licence:** the model cannot be offered to other planner users (non-commercial, research-only); fine for your own use, but it cannot be the default.

## Decision

The feature is worth building if one candidate reaches, on the **MacBook Air**: an average of **≥ 3.5** over Faithful, Prompt and Quality for `bg-clouds` and `snakes`, no hard limit hit, and an Apache 2.0 (or similarly permissive) licence. Compare with the GPT Image column to see the gap.
