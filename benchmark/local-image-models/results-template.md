# Local image model benchmark: results

Copy this file (or paste it into the PR / issue) and fill it in. Images stay in the results folder outside the repo; only the numbers and notes go here.

- Date:
- Input image (asset id only, no path):
- Seed(s):
- mflux version: 0.24.0
- Results folder: `~/tattoo-benchmark-results/<date-time>`

## Machines

| Machine             | Chip / GPU cores | Memory | macOS | Power   | Notes (other apps open, room temperature) |
| ------------------- | ---------------- | ------ | ----- | ------- | ----------------------------------------- |
| MacBook Air M4      |                  | 16 GB  |       | plugged |                                           |
| MacBook Pro M4 base |                  | 16 GB  |       | plugged |                                           |

## Measurements and scores

Times, peak memory, swap and seam scores come from the script's `results.md`. Scores 1–5 from `scoring-rubric.md`.

| Machine | Candidate      | Case         | Time (s) | Peak (GB) | Swap + (MB) | Seam x/y | Faithful | Prompt | Quality | Tattoo fit | Notes |
| ------- | -------------- | ------------ | -------- | --------- | ----------- | -------- | -------- | ------ | ------- | ---------- | ----- |
| Air     | flux2-klein-4b | bg-clouds    |          |           |             | –        |          |        |         |            |       |
| Air     | flux2-klein-4b | snakes       |          |           |             | –        |          |        |         |            |       |
| Air     | flux2-klein-4b | stars        |          |           |             |          |          |        |         |            |       |
| Air     | flux2-klein-4b | stars-repair |          |           |             |          |          |        |         |            |       |
| Air     | flux2-klein-9b | bg-clouds    |          |           |             | –        |          |        |         |            |       |
| Air     | flux2-klein-9b | snakes       |          |           |             | –        |          |        |         |            |       |
| Air     | flux2-klein-9b | stars        |          |           |             |          |          |        |         |            |       |
| Air     | flux2-klein-9b | stars-repair |          |           |             |          |          |        |         |            |       |
| Air     | flux3-klein    | bg-clouds    |          |           |             | –        |          |        |         |            |       |
| Air     | flux3-klein    | snakes       |          |           |             | –        |          |        |         |            |       |
| Air     | flux3-klein    | stars        |          |           |             |          |          |        |         |            |       |
| Air     | flux3-klein    | stars-repair |          |           |             |          |          |        |         |            |       |
| –       | gpt-image      | bg-clouds    |          | –         | –           | –        |          |        |         |            | $     |
| –       | gpt-image      | snakes       |          | –         | –           | –        |          |        |         |            | $     |
| –       | gpt-image      | stars        |          | –         | –           |          |          |        |         |            | $     |
| –       | gpt-image      | stars-repair |          | –         | –           |          |          |        |         |            | $     |
| Pro     | …              |              |          |           |             |          |          |        |         |            |       |

## Summary

| Candidate      | Avg score (edits) | Fits 16 GB? | Air time per edit | Licence OK for the product? | Verdict |
| -------------- | ----------------- | ----------- | ----------------- | --------------------------- | ------- |
| flux2-klein-4b |                   |             |                   | yes (Apache 2.0)            |         |
| flux2-klein-9b |                   |             |                   | no (non-commercial)         |         |
| flux3-klein    |                   |             |                   | limited (< US$5M revenue)   |         |
| gpt-image      |                   | –           |                   | API (BYOK)                  |         |

Decision (ship a local engine? which model?):
