[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/kuhugn/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/kuhugn/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

# Token Launch Radar

A make.fun **token-radar-01** entry: a radar that ranks pre-token protocols by the value their
token would carry if it launched on the snapshot's own record, and gives every row a concrete
farm plan. Model **radar-2.3**.

## Run it

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

Node 22, standard library only, no network. The program reads the sealed snapshot, writes
`board.json` and `data.js` to the output directory, copies `dashboard/` and `screenshots/`
beside them, and writes `dossier.json` last with the vendored `buildDossier`.

## The model in one paragraph

Implied value = TVL × category multiple × relative growth × maturity × breadth × scale. The
category multiple is the median market-cap/TVL of the tokenised protocols in the same category,
computed from the snapshot itself and shrunk toward the global median in log space (shrinkage
weight estimated from the data's variance components). The peers are cleaned first: duplicate
deployments of one token collapse to the largest, and a peer whose ratio falls outside
[0.002, 3.0] — a parent token's cap recorded against a side deployment, or a dead token — is
set aside. Every ratio median is a geometric median. A category earns its own multiple when
its peers corroborate each other (at least two), or when its single peer is itself substantial
and near the row's own scale; otherwise its rows are scored on the geometric midpoint of the
global median and the median multiple of the peers in the protocol's own TVL band — the
snapshot's largest protocols trade near 0.03×, its smallest near 0.38× — and the row's
published range spans the two, so the weakest estimates carry the widest stated uncertainty.
Growth is scored relative to the category's own median 7-day change, clamped at ±30pp with
weight 0.50. Maturity rises from 0.70 to 1.00 the longer a protocol has run without a token;
breadth adds up to +7% for multi-chain reach; scale is a smooth size discount,
(TVL / $1B)^−0.10 clamped to [0.85, 1.00], with no cliff. The model also grades itself — a
leave-one-out backtest over the cleaned peer set, the board's rank correlation with raw TVL,
and rank stability at a forced k — and the Methodology view prints the grades with their
limits stated: the board's order is largely TVL's order, and what the model adds is
calibration of levels, not a better order. Two watchlist rows known to accrue value to tokens
that already trade (USDD, Bittensor dTAO) are disclosed as a manual-review exception in the
model and on the Methodology view; they stay on the board because every watchlist slug must.

The board ranks only protocols that record no token and pass the genuineness screen the
snapshot's watchlist itself uses (no wrapped/staked/bridged products of trading tokens, no
exchange fronts, no versioned pools). All 40 watchlist protocols are ranked, joined by every
screened protocol below the $50M floor. Protocols whose token already trades are never ranked;
their realised multiples calibrate the model and appear in the dashboard's Live view.

A launch-priority score (category tokenisation rate × an age-overdue curve) is displayed for
farming triage only and never affects rank; the dashboard's EV column (implied × priority)
sorts that triage without touching the board's order. Each farm plan uses a seasoned wallet,
sizes its position from the protocol's own TVL, separates capital from cost, and states its
expected value — thin numbers included.

## Layout

- `main.ts` — the entry point: snapshot in, board + dashboard data + dossier out.
- `lib/model.ts` — calibration, scoring, farm playbooks, snapshot parsing, board validation.
- `vendor/makefun-board.ts` — the kit's dossier library, byte-for-byte as shipped.
- `dashboard/` — a static page (board, detail drawer, Live view, Methodology), no framework,
  no network; it renders `data.js`, which `main.ts` writes beside it.
- `screenshots/` — the board, a protocol detail, a filtered view and the methodology view,
  captured from the real generated page at 1440×900.

MIT licensed — see `LICENSE`.
