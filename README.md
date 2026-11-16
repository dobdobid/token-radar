# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/dobdobid/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/dobdobid/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar ranks pre-token protocols by implied value and shows how to farm each one. It reads a sealed DefiLlama snapshot, scores every protocol with no token on record, and renders a sortable, filterable dashboard with a detail view and a seven-step farm plan per protocol.

## Model

Model `radar-2` scores each protocol from the snapshot's own figures only, never from a hard-coded list of names:

```
implied = round(tvl_usd x 0.25
  x (1 + clamp(change_7d, -60, 120) / 100 x 0.5)
  x (0.6 + min(age_days, 1095) / 1095 x 0.4)
  x (1 + min(chains - 1, 10) x 0.015))
```

Size first (a quarter of TVL), then seven-day growth, then maturity (how long the protocol has run with no token), then breadth (each extra chain adds 1.5%, at most 15%). The board covers all 40 watchlist protocols plus every other rankable pre-token protocol below the floor: 226 rows in total. Live-token protocols are set aside with their market caps shown, never mixed into the ranking.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node.js 22.18 or later, standard library only. `main.ts` reads the snapshot, writes `out/board.json` and `out/data.js`, copies `dashboard/` and `screenshots/` to `out/`, and writes `out/dossier.json`.

## Layout

- `main.ts` — entrypoint: reads the snapshot, writes the board, data and dossier
- `lib/model.ts` — the radar-2 model, farm plans and board validation
- `dashboard/` — the offline dashboard (`index.html`, `app.css`, `app.js`)
- `screenshots/` — the board, a protocol detail view and a filtered view
- `vendor/makefun-board.ts` — the vendored dossier builder

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
