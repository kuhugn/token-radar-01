# Token Launch Radar

A make.fun **token-radar-01** entry: a radar that ranks pre-token protocols by the value their
token would carry if it launched on the snapshot's own record, and gives every row a concrete
farm plan. Model **radar-2.1**.

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
weight estimated from the data's variance components; categories with fewer than 3 tokenised
peers fall back to the global median and are flagged). Growth is scored relative to the
category's own median 7-day change, clamped at ±30pp with weight 0.50. Maturity rises from 0.70
to 1.00 the longer a protocol has run without a token; breadth adds up to +7% for multi-chain
reach; scale trims the very large (×0.90 over $1B TVL) and the very small (×0.85 under $20M).

The board ranks only protocols that record no token and pass the genuineness screen the
snapshot's watchlist itself uses (no wrapped/staked/bridged products of trading tokens, no
exchange fronts, no versioned pools). All 40 watchlist protocols are ranked, joined by every
screened protocol below the $50M floor. Protocols whose token already trades are never ranked;
their realised multiples calibrate the model and appear in the dashboard's Live view.

A launch-priority score (category tokenisation rate × an age-overdue curve) is displayed for
farming triage only and never affects rank.

## Layout

- `main.ts` — the entry point: snapshot in, board + dashboard data + dossier out.
- `lib/model.ts` — calibration, scoring, farm playbooks, snapshot parsing, board validation.
- `vendor/makefun-board.ts` — the kit's dossier library, byte-for-byte as shipped.
- `dashboard/` — a static page (board, detail drawer, Live view, Methodology), no framework,
  no network; it renders `data.js`, which `main.ts` writes beside it.
- `screenshots/` — the board, a protocol detail, a filtered view and the methodology view,
  captured from the real generated page at 1440×900.

MIT licensed — see `LICENSE`.
