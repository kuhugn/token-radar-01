// Token Launch Radar — model radar-2.1.
//
// One sealed DefiLlama snapshot in, one ranked board of pre-token protocols out. Every figure on the
// board is derived from the snapshot's own ten fields per protocol; no protocol name is ever
// special-cased, and the same code path scores every row.
//
// The board ranks every rankable pre-token protocol: one that records no token (no market cap, no
// CoinGecko id, no symbol) and passes the same genuineness screen the snapshot's own watchlist rule
// states — not a wrapped, staked or bridged product of a token that already trades (categories
// Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC and CEX are set aside,
// as are names carrying the whole word wrapped, staked or staking, names that begin with an
// exchange's name, and names ending in a version marker). WBTC and USDT0 record no token in the
// snapshot's fields, but in substance they are wrapped products of tokens that trade, and a radar
// that ranked them as launches would be ranking nothing. The watchlist is a floor, never a ceiling:
// all 40 watchlist slugs pass the screen by construction and appear on the board, joined by every
// screened protocol below the $50M floor — the early rows a radar exists to find. Protocols whose
// token already trades are never mixed into the ranking; they are the model's evidence (their
// market-cap-to-TVL ratios calibrate it) and the dashboard's Live view (the market's own values).
//
// Implied value, per protocol:
//
//   multiple  = median market-cap/TVL of the tokenised peers in the same category, computed from
//               this snapshot, shrunk toward the global median multiple in log space with a
//               shrinkage weight k estimated from the data itself (within-category variance of log
//               ratios over between-category variance of category medians). The result is clamped
//               to [0.03, 1.20]. A category with fewer than 3 tokenised peers has no multiple of
//               its own: the row is scored on the midpoint of two snapshot medians — the global
//               median and the median of the peers in the protocol's own TVL band, because the
//               snapshot's large protocols trade at far lower multiples than its small ones —
//               and the row's range spans the two, so the weakest estimates on the board carry
//               the widest stated uncertainty instead of a flag alone. The row is flagged.
//   growth    = 1 + 0.50 x clamp(change_7d - category median change_7d, -30, +30) / 100, so a
//               protocol is scored on momentum relative to its own category, in [0.85, 1.15]. A
//               missing change_7d scores as its category's median (relative growth 0).
//   maturity  = two-piece in age without a token: 0.70 -> 0.85 linearly over the first 90 days,
//               then 0.85 -> 1.00 on a log scale out to 1095 days. Unknown age scores as 180 days
//               and the row is flagged.
//   breadth   = +3% for a second chain, +2% for a third, +1% each for a fourth and fifth (max +7%).
//   scale     = (TVL / $1B)^-0.10 clamped to [0.85, 1.00]: a smooth size discount with no cliff —
//               a $999M protocol and a $1.001B protocol score alike, a $2.75B one keeps ~0.90.
//   implied   = round(TVL x multiple x growth x maturity x breadth x scale), at least $1.
//
// The model also grades itself, and the dashboard's Methodology view prints the grades: a
// leave-one-out backtest over every tokenised peer (hide one, predict its multiple from the
// rest, compare with the flat global median as the baseline), the Spearman rank correlation
// between the board's order and raw TVL, and the board's rank stability when the shrinkage
// weight is raised from the estimated k to 6.
//
// A separate launch-priority score (0-100) is shown on the dashboard only and never affects rank:
// the category's tokenisation rate scaled by an age-overdue curve that peaks at 400-1000 days
// without a token. Rank is the implied value's claim alone, so implied value never rises with rank.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export const MODEL_VERSION = 'radar-2.2';

/** The model's constants, stated on the dashboard's Methodology view. */
export const MODEL = {
  multiple_floor: 0.03,
  multiple_cap: 1.2,
  min_peers: 3,
  thin_peers: 6,
  growth_weight: 0.5,
  growth_clamp_pp: 30,
  unknown_age_days: 180,
  maturity_young_end: 90,
  maturity_old_end: 1095,
  scale_exponent: 0.1,
  scale_floor: 0.85,
  small_tvl: 20_000_000,
  bankroll_usd: 50_000,
  float_share: 0.1,
  lending_apy: 0.04,
  curator_take_rate: 0.0075,
  curator_revenue_multiple: 12,
} as const;

/** TVL bands for the fallback multiple: peers are grouped by the size of their own TVL. */
export const TVL_BANDS: { lo: number; hi: number; label: string }[] = [
  { lo: 0, hi: 25_000_000, label: 'under $25M' },
  { lo: 25_000_000, hi: 100_000_000, label: '$25M-$100M' },
  { lo: 100_000_000, hi: 500_000_000, label: '$100M-$500M' },
  { lo: 500_000_000, hi: 2_000_000_000, label: '$500M-$2B' },
  { lo: 2_000_000_000, hi: Number.POSITIVE_INFINITY, label: '$2B and up' },
];

/** One TVL band's calibration: how the snapshot's tokenised peers of that size actually trade. */
export interface BandStat {
  label: string;
  peers: number;
  median_multiple: number;
}

const DAY_MS = 86_400_000;

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

function variance(values: number[]): number {
  if (values.length === 0) return 0;
  const m = mean(values);
  return mean(values.map((v) => (v - m) * (v - m)));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Whole days from `listedAt` to the snapshot's `asOf`, or null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories the watchlist rule sets aside: products of tokens that already trade, and exchanges. */
const SCREEN_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** A name carrying the whole word wrapped, staked or staking names a product, not a launch. */
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;

/** A name that begins with an exchange's name is that exchange's front, not a launch candidate. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Why the screen sets a pre-token protocol aside, or null when it may be ranked. */
export function screenReason(p: SnapshotProtocol): 'category' | 'product-name' | 'exchange-name' | 'version' | null {
  if (p.category !== null && SCREEN_CATEGORIES.has(p.category)) return 'category';
  if (PRODUCT_WORD.test(p.name)) return 'product-name';
  if (EXCHANGE_PREFIX.test(p.name)) return 'exchange-name';
  if (VERSIONED.test(p.name)) return 'version';
  return null;
}

/** Whether a protocol is one the board may rank: pre-token and through the genuineness screen. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && screenReason(p) === null;
}

/** One tokenised peer of a thin category, named so a reader can audit the category's evidence. */
export interface PeerExample {
  slug: string;
  multiple: number;
  tvl_usd: number;
  mcap_usd: number;
}

/** One category's calibration: its tokenised peers and the multiple they imply. */
export interface CategoryStat {
  category: string;
  peers: number;
  raw_median: number;
  multiple: number;
  fallback: boolean;
  tokenised: number;
  total: number;
  median_change_7d: number | null;
  peer_examples: PeerExample[];
}

/** Everything the model learns from the snapshot before scoring a single row. */
export interface Calibration {
  global_median: number;
  shrinkage_k: number;
  categories: Map<string, CategoryStat>;
  bands: BandStat[];
  band_median_by_tvl: (tvl: number) => number;
  global_median_change: number | null;
  screened_category: number;
  screened_product_name: number;
  screened_exchange_name: number;
  screened_version: number;
  screened_by_category: { category: string; count: number }[];
  pre_token: number;
  tokenised: number;
}

function categoryKey(p: SnapshotProtocol): string {
  return p.category ?? '(uncategorised)';
}

/**
 * Calibrate the multiples from the snapshot itself. Ratios live in log space: a category's median
 * log ratio is pulled toward the global median log ratio with weight k/(n+k), where k is the ratio
 * of within-category to between-category variance — categories whose peers agree tightly keep
 * their own multiple, scattered ones are pulled to the market's.
 */
export function calibrate(snapshot: Snapshot, kOverride?: number): Calibration {
  const tokenised = snapshot.protocols.filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const allRatios = tokenised.map((p) => p.mcap_usd! / p.tvl_usd);
  const globalMedian = median(allRatios);
  const globalLog = Math.log(globalMedian);

  const byCategory = new Map<string, SnapshotProtocol[]>();
  for (const p of snapshot.protocols) {
    const key = categoryKey(p);
    const list = byCategory.get(key) ?? [];
    list.push(p);
    byCategory.set(key, list);
  }
  const peersByCategory = new Map<string, SnapshotProtocol[]>();
  for (const p of tokenised) {
    const key = categoryKey(p);
    const list = peersByCategory.get(key) ?? [];
    list.push(p);
    peersByCategory.set(key, list);
  }

  // Variance components on log ratios, for the shrinkage weight.
  const groupLogs: { n: number; logs: number[]; medLog: number }[] = [];
  for (const peers of peersByCategory.values()) {
    const logs = peers.map((p) => Math.log(p.mcap_usd! / p.tvl_usd));
    groupLogs.push({ n: peers.length, logs, medLog: median(logs) });
  }
  let withinNum = 0;
  let withinDen = 0;
  for (const g of groupLogs) {
    if (g.n >= 2) {
      withinNum += variance(g.logs) * g.n;
      withinDen += g.n;
    }
  }
  const withinVar = withinDen > 0 ? withinNum / withinDen : 0;
  const totalPeers = groupLogs.reduce((a, g) => a + g.n, 0);
  const meanGroupSize = groupLogs.length > 0 ? totalPeers / groupLogs.length : 0;
  const medLogMean = totalPeers > 0 ? groupLogs.reduce((a, g) => a + g.medLog * g.n, 0) / totalPeers : globalLog;
  const betweenRaw = totalPeers > 0 ? groupLogs.reduce((a, g) => a + g.n * (g.medLog - medLogMean) ** 2, 0) / totalPeers : 0;
  const betweenVar = Math.max(0, betweenRaw - (meanGroupSize > 0 ? withinVar / meanGroupSize : 0));
  const k = kOverride ?? (betweenVar > 1e-9 ? clamp(withinVar / betweenVar, 0, 100) : 100);

  const allChanges = snapshot.protocols.filter((p) => p.change_7d !== null).map((p) => p.change_7d!);
  const globalMedianChange = allChanges.length > 0 ? median(allChanges) : null;

  const categories = new Map<string, CategoryStat>();
  for (const [key, all] of byCategory) {
    const peers = peersByCategory.get(key) ?? [];
    const ratios = peers.map((p) => p.mcap_usd! / p.tvl_usd);
    const rawMedian = ratios.length > 0 ? median(ratios) : globalMedian;
    const fallback = peers.length < MODEL.min_peers;
    const shrunk = fallback
      ? globalMedian
      : Math.exp((peers.length * Math.log(rawMedian) + k * globalLog) / (peers.length + k));
    const changes = all.filter((p) => p.change_7d !== null).map((p) => p.change_7d!);
    categories.set(key, {
      category: key,
      peers: peers.length,
      raw_median: round4(rawMedian),
      multiple: round4(clamp(shrunk, MODEL.multiple_floor, MODEL.multiple_cap)),
      fallback,
      tokenised: all.filter((p) => !isPreToken(p)).length,
      total: all.length,
      median_change_7d: changes.length > 0 ? round2(median(changes)) : null,
      peer_examples:
        peers.length > 0 && peers.length < MODEL.min_peers
          ? [...peers]
              .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
              .map((p) => ({ slug: p.slug, multiple: round4(p.mcap_usd! / p.tvl_usd), tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd! }))
          : [],
    });
  }

  // TVL bands over the same peer set: the fallback multiple's second leg.
  const bands: BandStat[] = TVL_BANDS.map((b) => {
    const inBand = tokenised.filter((p) => p.tvl_usd >= b.lo && p.tvl_usd < b.hi);
    return {
      label: b.label,
      peers: inBand.length,
      median_multiple: round4(inBand.length > 0 ? median(inBand.map((p) => p.mcap_usd! / p.tvl_usd)) : globalMedian),
    };
  });
  const bandMedianByTvl = (tvl: number): number => {
    const idx = TVL_BANDS.findIndex((b) => tvl >= b.lo && tvl < b.hi);
    const direct = bands[idx === -1 ? bands.length - 1 : idx]!;
    if (direct.peers >= 5) return direct.median_multiple;
    for (let d = 1; d < bands.length; d++) {
      for (const j of [idx - d, idx + d]) {
        if (j >= 0 && j < bands.length && bands[j]!.peers >= 5) return bands[j]!.median_multiple;
      }
    }
    return round4(globalMedian);
  };

  const screenedByCat = new Map<string, number>();
  for (const p of snapshot.protocols) {
    if (isPreToken(p) && screenReason(p) === 'category') {
      const key = categoryKey(p);
      screenedByCat.set(key, (screenedByCat.get(key) ?? 0) + 1);
    }
  }

  return {
    global_median: round4(globalMedian),
    shrinkage_k: round2(k),
    categories,
    bands,
    band_median_by_tvl: bandMedianByTvl,
    global_median_change: globalMedianChange === null ? null : round2(globalMedianChange),
    screened_by_category: [...screenedByCat.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count || (a.category < b.category ? -1 : 1)),
    screened_category: snapshot.protocols.filter((p) => isPreToken(p) && screenReason(p) === 'category').length,
    screened_product_name: snapshot.protocols.filter((p) => isPreToken(p) && screenReason(p) === 'product-name').length,
    screened_exchange_name: snapshot.protocols.filter((p) => isPreToken(p) && screenReason(p) === 'exchange-name').length,
    screened_version: snapshot.protocols.filter((p) => isPreToken(p) && screenReason(p) === 'version').length,
    pre_token: snapshot.protocols.filter(isPreToken).length,
    tokenised: snapshot.protocols.filter((p) => !isPreToken(p)).length,
  };
}

/** The score of one protocol: its implied value and every factor that produced it. */
export interface Score {
  implied: number;
  multiple: number;
  multiple_band: number | null;
  peers: number;
  fallback_multiple: boolean;
  growth_rel_pp: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  scale_multiplier: number;
  age_days: number | null;
  p_launch: number;
  risk_flags: string[];
  implied_floor: number;
  implied_ceiling: number;
}

function maturityFor(age: number): number {
  if (age <= MODEL.maturity_young_end) {
    return 0.7 + 0.15 * (Math.max(0, age) / MODEL.maturity_young_end);
  }
  const t = Math.log(age / MODEL.maturity_young_end) / Math.log(MODEL.maturity_old_end / MODEL.maturity_young_end);
  return 0.85 + 0.15 * clamp(t, 0, 1);
}

function breadthFor(chainCount: number): number {
  const extra = [0.03, 0.02, 0.01, 0.01];
  let add = 0;
  for (let i = 1; i < chainCount && i <= extra.length; i++) add += extra[i - 1]!;
  return 1 + add;
}

function scaleFor(tvl: number): number {
  return clamp(Math.pow(tvl / 1_000_000_000, -MODEL.scale_exponent), MODEL.scale_floor, 1);
}

/** The age-overdue curve: peaks when a protocol has run 400-1000 days with no token. */
function overdue(age: number | null): number {
  if (age === null) return 0.5;
  if (age < 400) return 0.2 + 0.8 * (age / 400);
  if (age <= 1000) return 1;
  return Math.max(0.35, 1 - (age - 1000) / 2000);
}

/** Score one rankable protocol under a calibration. Pure: the same inputs always give the same row. */
export function score(p: SnapshotProtocol, asOf: string, cal: Calibration): Score {
  const stat = cal.categories.get(categoryKey(p));
  const peers = stat?.peers ?? 0;
  const fallback = stat?.fallback ?? true;
  const bandMultiple = fallback ? cal.band_median_by_tvl(p.tvl_usd) : null;
  const multiple = fallback
    ? round4(clamp((cal.global_median + bandMultiple!) / 2, MODEL.multiple_floor, MODEL.multiple_cap))
    : (stat?.multiple ?? cal.global_median);
  const multLow = fallback ? Math.min(cal.global_median, bandMultiple!) : multiple;
  const multHigh = fallback ? Math.max(cal.global_median, bandMultiple!) : multiple;

  const catMedianChange = stat?.median_change_7d ?? cal.global_median_change ?? 0;
  const relRaw = p.change_7d === null ? 0 : p.change_7d - catMedianChange;
  const rel = clamp(relRaw, -MODEL.growth_clamp_pp, MODEL.growth_clamp_pp);
  const growthMult = 1 + (MODEL.growth_weight * rel) / 100;

  const age = ageDays(asOf, p.listed_at);
  const maturity = maturityFor(age ?? MODEL.unknown_age_days);
  const breadth = breadthFor(p.chains.length);
  const scale = scaleFor(p.tvl_usd);

  const at = (m: number, g: number): number => Math.max(1, Math.round(p.tvl_usd * m * g * maturity * breadth * scale));
  const growthFloor = 1 + (MODEL.growth_weight * -MODEL.growth_clamp_pp) / 100;
  const growthCeiling = 1 + (MODEL.growth_weight * MODEL.growth_clamp_pp) / 100;
  const implied = at(multiple, growthMult);
  const impliedFloor = at(multLow, growthFloor);
  const impliedCeiling = at(multHigh, growthCeiling);

  const tokenRate = stat !== undefined && stat.total > 0 ? stat.tokenised / stat.total : 0;
  const pLaunch = Math.round(100 * clamp(tokenRate * (0.4 + 0.6 * overdue(age)), 0.02, 0.97));

  const flags: string[] = [];
  if (fallback) flags.push('fallback multiple');
  else if (peers < MODEL.thin_peers) flags.push('thin comps');
  if (age === null) flags.push('age unknown');
  if (Math.abs(relRaw) > MODEL.growth_clamp_pp) flags.push('growth clamped');
  if (p.tvl_usd < MODEL.small_tvl) flags.push('small tvl');

  return {
    implied,
    multiple,
    multiple_band: bandMultiple,
    peers,
    fallback_multiple: fallback,
    growth_rel_pp: round2(rel),
    growth_multiplier: round4(growthMult),
    maturity_multiplier: round4(maturity),
    breadth_multiplier: round4(breadth),
    scale_multiplier: scale,
    age_days: age,
    p_launch: pLaunch,
    risk_flags: flags,
    implied_floor: impliedFloor,
    implied_ceiling: impliedCeiling,
  };
}

/** The risk level a row's flags add up to. High is reserved for the two flags that say the
 *  estimate itself rests on thin evidence: a fallback multiple, or an imputed age. */
export function riskLevel(flags: string[]): 'low' | 'medium' | 'high' {
  if (flags.includes('fallback multiple') || flags.includes('age unknown')) return 'high';
  return flags.length > 0 ? 'medium' : 'low';
}

/**
 * Position size from the protocol's own TVL: $40 per square root of TVL in millions, so a $50M
 * protocol draws about $280 and a $2.75B one about $2,100 — floored at $150, capped at $2,500
 * (5% of the model's $50,000 reference bankroll). No two protocols share a size by accident.
 */
function sizeFor(tvl: number): number {
  const raw = 40 * Math.sqrt(tvl / 1_000_000);
  return Math.min(2500, Math.max(150, Math.round(raw / 25) * 25));
}

/** Rough gas for one on-chain action, from the protocol's first chain: mainnet is dear, L2s are not. */
function gasFor(chain: string): number {
  return chain === 'Ethereum' ? 12 : 2;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null || age < 180) return 90;
  if (age < 400) return 60;
  return 45;
}

type Playbook = 'curator' | 'rwa' | 'lending' | 'dexs' | 'yield' | 'restaking' | 'bridge' | 'generic';

/** The farm playbook a category calls for. One playbook per family, never per protocol name. */
export function playbookFor(category: string | null): Playbook {
  const c = (category ?? '').toLowerCase();
  if (c.includes('curator') || c.includes('allocator')) return 'curator';
  if (c.includes('rwa')) return 'rwa';
  if (c.includes('bridge')) return 'bridge';
  if (c.includes('restak') || c.includes('staking')) return 'restaking';
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'lending';
  if (c.includes('dex') || c.includes('perpetual') || c.includes('derivative')) return 'dexs';
  if (c.includes('yield') || c.includes('farm')) return 'yield';
  return 'generic';
}

const fmtUsd = (n: number): string => `$${Math.round(n).toLocaleString('en-US')}`;

/**
 * A protocol's farm plan: seven steps from the playbook its category calls for. The wallet is a
 * seasoned one — a fresh wallet is the first filter serious airdrops run — the position size is
 * derived from the protocol's own TVL, and the sixth step separates capital from cost and states
 * the plan's expected value out loud, thin or rich. The last step of every plan is the risk line,
 * because a farm that hides its risk is a slogan. Every step carries its cost and its time.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, ctx: { implied: number; pLaunch: number }): string[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const cap = sizeFor(p.tvl_usd);
  const gas = gasFor(chain);
  const hold = holdDaysFor(age);
  const book = playbookFor(p.category);
  const wallet = `Use a seasoned wallet for ${p.name}: at least 90 days old, with real history on at least three unrelated protocols, funded from a source you do not share with your other farming wallets. A fresh wallet is the first filter serious airdrops run. Cost: about $${gas} of gas to fund and approve. Time: 10 minutes.`;
  const watch = `Check the position weekly and add one small qualifying action (about $${gas} of gas each) so the wallet reads as an active user, not a one-off deposit. Cost: about $${gas * 4} of gas a month. Time: 10 minutes a week.`;
  const holdStep = `Hold the position for at least ${hold} days so it appears in more than one activity snapshot; most points and eligibility windows reward duration, not size alone. Cost: the $${cap.toLocaleString('en-US')} stays deployed. Time: ${hold} days.`;
  const claim = `Before withdrawing, open ${p.name}'s own rewards or points page and claim only from the link the protocol itself publishes; never pay a third party to claim for you. Cost: $0 to check, about $${gas} of gas to claim. Time: 10 minutes.`;
  const gross = cap * (ctx.implied / p.tvl_usd) * MODEL.float_share;
  const ev = gross * (ctx.pLaunch / 100);
  const opp = cap * MODEL.lending_apy * (hold / 365);
  const gasTotal = gas * (6 + Math.ceil(hold / 7));
  const maths = `The maths, separated: capital at risk $${cap.toLocaleString('en-US')} | gas and fees about $${gasTotal} over the hold | time about 15 minutes a week | opportunity cost about ${fmtUsd(opp)} of lending yield forgone over ${hold} days | expected value: at the board's ${fmtUsd(ctx.implied)} headline and a 10% community float, a pro-rata share of this position is worth about ${fmtUsd(gross)} if a token launches, about ${fmtUsd(ev)} weighted by the ${ctx.pLaunch}/100 launch priority. Size by that number, not by hope.`;
  const actions: Record<Playbook, string> = {
    curator: `Deposit $${cap.toLocaleString('en-US')} of USDC into one established ${p.name} vault on ${chain}, choosing the vault whose curator has the longest live record over the newest one. Cost: $${cap.toLocaleString('en-US')} of capital plus about $${gas} of gas. Time: 15 minutes to set up.`,
    rwa: `Complete any KYC the issuer requires, then mint $${cap.toLocaleString('en-US')} of ${p.name}'s yield-bearing asset on ${chain} and hold it in the farming wallet. Cost: $${cap.toLocaleString('en-US')} of capital plus about $${gas} of gas; KYC itself is free. Time: 30 minutes including KYC.`,
    lending: `Supply $${cap.toLocaleString('en-US')} of USDC to ${p.name} on ${chain}, then borrow against it at 40-60% loan-to-value and re-supply the borrow once; keep the health factor above 1.5 at all times. Cost: $${cap.toLocaleString('en-US')} of capital plus about $${gas * 2} of gas for the loop. Time: 20 minutes to set up.`,
    dexs: `Provide $${cap.toLocaleString('en-US')} of liquidity to ${p.name}'s main pool on ${chain} (or, on a perpetuals venue, deposit $${cap.toLocaleString('en-US')} as margin and trade one small hedged position a week). Cost: $${cap.toLocaleString('en-US')} of capital plus about $${gas} of gas. Time: 15 minutes to set up.`,
    yield: `Deposit $${cap.toLocaleString('en-US')} of USDC into ${p.name}'s main yield vault on ${chain} and leave auto-compounding on; rotate to a sister vault only if its rate leads by more than 2 points for a full week. Cost: $${cap.toLocaleString('en-US')} of capital plus about $${gas} of gas. Time: 15 minutes to set up.`,
    restaking: `Stake $${cap.toLocaleString('en-US')} of the liquid staking asset through ${p.name} on ${chain} and keep the receipt token in the farming wallet; do not loop it into a second restaking layer. Cost: $${cap.toLocaleString('en-US')} of capital plus about $${gas} of gas. Time: 15 minutes to set up.`,
    bridge: `Bridge about $${Math.max(100, Math.round(cap / 5))} of USDC through ${p.name} in each direction once a week, varying the amount and the day, and use the bridged funds in one app on the far side each trip. Cost: about $${gas * 2} of gas and bridge fees a week. Time: 15 minutes a week.`,
    generic: `Deposit $${cap.toLocaleString('en-US')} of USDC into ${p.name}'s core product on ${chain} and use its main feature once (a deposit, a swap or a vote) so the wallet is a user, not a bystander. Cost: $${cap.toLocaleString('en-US')} of capital plus about $${gas} of gas. Time: 15 minutes to set up.`,
  };
  const risks: Record<Playbook, string> = {
    curator: `Risk: the vault's curator can rebalance into riskier strategies and smart-contract risk sits with the vault, not the curator's brand; withdraw if the strategy or the curator changes without notice. Cost: none to monitor. Time: 5 minutes a week.`,
    rwa: `Risk: redemption can be gated by the issuer's schedule and KYC ties this wallet to your identity, so never mix it with anonymous farms; check the redemption window before you need the money back. Cost: none to monitor. Time: 5 minutes a month.`,
    lending: `Risk: if the health factor falls under 1.0 the position is liquidated at a penalty; set a price alert at 1.5 and never leave a looped position unwatched over a volatile weekend. Cost: none to monitor. Time: 5 minutes a week.`,
    dexs: `Risk: liquidity positions suffer impermanent loss when prices move, and perpetuals margin can be liquidated; keep the position small enough that a 30% adverse move is a lesson, not a loss that matters. Cost: none to monitor. Time: 5 minutes a week.`,
    yield: `Risk: headline yield often comes from incentives that end without notice, and the vault's strategy contracts are the attack surface; leave when the rate falls to plain lending levels. Cost: none to monitor. Time: 5 minutes a month.`,
    restaking: `Risk: restaking stacks slashing risk on top of staking risk and the receipt token can depeg under stress; the extra yield is payment for exactly that stack, so size it like it. Cost: none to monitor. Time: 5 minutes a month.`,
    bridge: `Risk: bridges are the most-hacked contracts in the industry; never leave bridged funds idle on the far side and split large moves across two days. Cost: none to monitor. Time: 5 minutes a week.`,
    generic: `Risk: a pre-token protocol can change its rules, pause withdrawals or never issue a token at all; the $${cap.toLocaleString('en-US')} position is the full extent of the bet, so never add funds you cannot leave locked for a year. Cost: none to monitor. Time: 5 minutes a month.`,
  };
  return [wallet, actions[book], watch, holdStep, claim, maths, risks[book]];
}

/** One row of board.json: the ranked board's row, with the model's whole breakdown attached. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  implied_floor_usd: number;
  implied_ceiling_usd: number;
  model: {
    multiple: number;
    multiple_band: number | null;
    peers: number;
    fallback_multiple: boolean;
    growth_rel_pp: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    scale_multiplier: number;
    p_launch: number;
    risk_flags: string[];
  };
  farm_steps: string[];
}

/** The dashboard's view of one board row, farm plan included so the detail view shows the board's own plan. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  implied_floor: number;
  implied_ceiling: number;
  multiple: number;
  multiple_band: number | null;
  peers: number;
  growth_rel_pp: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  scale_multiplier: number;
  p_launch: number;
  ev_usd: number;
  cross_check_usd: number | null;
  verify_token: boolean;
  risk: 'low' | 'medium' | 'high';
  risk_flags: string[];
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the page shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  symbol: string | null;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  multiple: number | null;
  change_7d: number | null;
}

/** One category's calibration as the Methodology view states it. */
export interface CategoryView {
  category: string;
  peers: number;
  raw_median: number;
  multiple: number;
  fallback: boolean;
  tokenised: number;
  total: number;
  median_change_7d: number | null;
  peer_examples: PeerExample[];
}

/** The model's self-grades, computed from the snapshot and printed on the Methodology view. */
export interface Validation {
  loo_peers: number;
  loo_model_median_abs_log_err: number;
  loo_flat_median_abs_log_err: number;
  loo_model_within_2x_pct: number;
  loo_flat_within_2x_pct: number;
  spearman_implied_vs_tvl: number;
  k_alt: number;
  k_alt_top10_overlap: number;
  k_alt_max_rank_delta_top20: number;
}

/** Everything the dashboard renders, from the snapshot. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  snapshot_sha256: string;
  global_median: number;
  shrinkage_k: number;
  global_median_change: number | null;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  total_protocols: number;
  pre_token: number;
  tokenised: number;
  total_implied: number;
  watchlist_implied: number;
  median_implied: number;
  screened_category: number;
  screened_product_name: number;
  screened_exchange_name: number;
  screened_version: number;
  screened_by_category: { category: string; count: number }[];
  bands: BandStat[];
  validation: Validation;
  categories: CategoryView[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Build the board: every rankable pre-token protocol, scored, ranked by implied value. */
export function buildBoard(snapshot: Snapshot, cal: Calibration): BoardRow[] {
  const watch = new Set(snapshot.watchlist);
  const scored = snapshot.protocols
    .filter(isRankable)
    .map((p) => ({ p, s: score(p, snapshot.as_of, cal) }));
  scored.sort(
    (a, b) =>
      b.s.implied - a.s.implied ||
      b.p.tvl_usd - a.p.tvl_usd ||
      (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0),
  );
  return scored.map(({ p, s }, i) => ({
    rank: i + 1,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    mcap_usd: p.mcap_usd,
    listed_at: p.listed_at,
    gecko_id: p.gecko_id,
    symbol: p.symbol,
    token_status: 'pre-token',
    watchlist: watch.has(p.slug),
    age_days: s.age_days,
    implied_value_usd: s.implied,
    implied_floor_usd: s.implied_floor,
    implied_ceiling_usd: s.implied_ceiling,
    model: {
      multiple: s.multiple,
      multiple_band: s.multiple_band,
      peers: s.peers,
      fallback_multiple: s.fallback_multiple,
      growth_rel_pp: s.growth_rel_pp,
      growth_multiplier: s.growth_multiplier,
      maturity_multiplier: s.maturity_multiplier,
      breadth_multiplier: s.breadth_multiplier,
      scale_multiplier: s.scale_multiplier,
      p_launch: s.p_launch,
      risk_flags: s.risk_flags,
    },
    farm_steps: farmSteps(p, s.age_days, { implied: s.implied, pLaunch: s.p_launch }),
  }));
}

const LIVE_ROWS = 48;

/** The live-token protocols for the dashboard's Live view, by market cap, exchanges left out. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      symbol: p.symbol,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      multiple: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
      change_7d: p.change_7d,
    }));
}

/** Ranks with ties averaged, for the Spearman correlation. */
function ranksOf(values: number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v || a.i - b.i);
  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]!.v === order[i]!.v) j++;
    const avg = (i + j) / 2 + 1;
    for (let t = i; t <= j; t++) ranks[order[t]!.i] = avg;
    i = j + 1;
  }
  return ranks;
}

function pearson(a: number[], b: number[]): number {
  const ma = mean(a);
  const mb = mean(b);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i]! - ma) * (b[i]! - mb);
    da += (a[i]! - ma) ** 2;
    db += (b[i]! - mb) ** 2;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

/**
 * The model grading itself on the snapshot's own evidence. Leave-one-out: every tokenised peer
 * is hidden in turn and its multiple predicted by the model's own rules — category shrinkage
 * when the category keeps at least 3 peers, the TVL-band fallback otherwise — against the flat
 * global median as the baseline. Plus the board's rank correlation with raw TVL, and its rank
 * stability when the shrinkage weight is forced from the estimated k up to 6.
 */
export function validateModel(snapshot: Snapshot, cal: Calibration, board: BoardRow[]): Validation {
  const peers = snapshot.protocols.filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const modelErrs: number[] = [];
  const flatErrs: number[] = [];
  peers.forEach((p, i) => {
    const others = peers.filter((_, j) => j !== i);
    const globalEx = median(others.map((q) => q.mcap_usd! / q.tvl_usd));
    const catOthers = others.filter((q) => categoryKey(q) === categoryKey(p));
    let pred: number;
    if (catOthers.length >= MODEL.min_peers) {
      const rawMed = median(catOthers.map((q) => q.mcap_usd! / q.tvl_usd));
      pred = clamp(
        Math.exp((catOthers.length * Math.log(rawMed) + cal.shrinkage_k * Math.log(globalEx)) / (catOthers.length + cal.shrinkage_k)),
        MODEL.multiple_floor,
        MODEL.multiple_cap,
      );
    } else {
      const band = TVL_BANDS.find((b) => p.tvl_usd >= b.lo && p.tvl_usd < b.hi) ?? TVL_BANDS[TVL_BANDS.length - 1]!;
      let bandPeers = others.filter((q) => q.tvl_usd >= band.lo && q.tvl_usd < band.hi);
      if (bandPeers.length < 5) {
        bandPeers = [...others]
          .sort((a, b) => Math.abs(Math.log(a.tvl_usd / p.tvl_usd)) - Math.abs(Math.log(b.tvl_usd / p.tvl_usd)) || (a.slug < b.slug ? -1 : 1))
          .slice(0, 15);
      }
      const bandMed = median(bandPeers.map((q) => q.mcap_usd! / q.tvl_usd));
      pred = clamp((globalEx + bandMed) / 2, MODEL.multiple_floor, MODEL.multiple_cap);
    }
    const actual = p.mcap_usd! / p.tvl_usd;
    modelErrs.push(Math.abs(Math.log(pred / actual)));
    flatErrs.push(Math.abs(Math.log(globalEx / actual)));
  });
  const within2x = (errs: number[]): number => Math.round((100 * errs.filter((e) => e < Math.log(2)).length) / Math.max(1, errs.length));
  const spearman = pearson(
    ranksOf(board.map((r) => r.implied_value_usd)),
    ranksOf(board.map((r) => r.tvl_usd)),
  );
  const altBoard = buildBoard(snapshot, calibrate(snapshot, 6));
  const altRank = new Map(altBoard.map((r) => [r.slug, r.rank]));
  const top10Overlap = board.slice(0, 10).filter((r) => (altRank.get(r.slug) ?? Number.POSITIVE_INFINITY) <= 10).length;
  let maxDelta = 0;
  for (const r of board.slice(0, 20)) maxDelta = Math.max(maxDelta, Math.abs(r.rank - (altRank.get(r.slug) ?? r.rank)));
  return {
    loo_peers: peers.length,
    loo_model_median_abs_log_err: round2(median(modelErrs)),
    loo_flat_median_abs_log_err: round2(median(flatErrs)),
    loo_model_within_2x_pct: within2x(modelErrs),
    loo_flat_within_2x_pct: within2x(flatErrs),
    spearman_implied_vs_tvl: round2(spearman),
    k_alt: 6,
    k_alt_top10_overlap: top10Overlap,
    k_alt_max_rank_delta_top20: maxDelta,
  };
}

/** Everything the dashboard needs: the board, the live set, the calibration it ran on. */
export function buildRadar(snapshot: Snapshot, snapshotSha256: string): { board: BoardRow[]; radar: RadarData } {
  const cal = calibrate(snapshot);
  const board = buildBoard(snapshot, cal);
  const live = liveRows(snapshot);
  const validation = validateModel(snapshot, cal, board);

  // A snapshot-internal cross-check the screen cannot do alone: a board row whose name or slug
  // carries a word that is a live token's symbol may already trade under that name. Flagged for
  // verification, never silently removed — the snapshot alone cannot prove it either way.
  const liveSymbols = new Set<string>();
  for (const p of snapshot.protocols) {
    if (!isPreToken(p) && p.symbol !== null) liveSymbols.add(p.symbol.toUpperCase());
  }
  const genericWords = new Set(['USD', 'ETH', 'BTC', 'SOL', 'USDC', 'USDT', 'DAI']);
  const verifyOf = (name: string, slug: string): boolean => {
    const words = `${name} ${slug.replace(/-/g, ' ')}`
      .toUpperCase()
      .split(/[^A-Z0-9]+/)
      .filter((w) => w.length >= 3);
    return words.some((w) => !genericWords.has(w) && liveSymbols.has(w));
  };

  const rows: RadarRow[] = board.map((r) => {
    const verify = verifyOf(r.name, r.slug);
    const flags = verify ? [...r.model.risk_flags, 'verify token status'] : r.model.risk_flags;
    return {
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      age_days: r.age_days,
      watchlist: r.watchlist,
      implied_value_usd: r.implied_value_usd,
      implied_floor: r.implied_floor_usd,
      implied_ceiling: r.implied_ceiling_usd,
      multiple: r.model.multiple,
      multiple_band: r.model.multiple_band,
      peers: r.model.peers,
      growth_rel_pp: r.model.growth_rel_pp,
      growth_multiplier: r.model.growth_multiplier,
      maturity_multiplier: r.model.maturity_multiplier,
      breadth_multiplier: r.model.breadth_multiplier,
      scale_multiplier: r.model.scale_multiplier,
      p_launch: r.model.p_launch,
      ev_usd: Math.round((r.implied_value_usd * r.model.p_launch) / 100),
      cross_check_usd:
        playbookFor(r.category) === 'curator' ? Math.round(r.tvl_usd * MODEL.curator_take_rate * MODEL.curator_revenue_multiple) : null,
      verify_token: verify,
      risk: riskLevel(flags),
      risk_flags: flags,
      farm_steps: r.farm_steps,
    };
  });
  const categories: CategoryView[] = [...cal.categories.values()]
    .filter((c) => c.total >= 3)
    .sort((a, b) => b.total - a.total)
    .map((c) => ({ ...c }));
  const impliedSorted = [...board].sort((a, b) => a.implied_value_usd - b.implied_value_usd);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    snapshot_sha256: snapshotSha256,
    global_median: cal.global_median,
    shrinkage_k: cal.shrinkage_k,
    global_median_change: cal.global_median_change,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.watchlist).length,
    live_size: live.length,
    total_protocols: snapshot.protocols.length,
    pre_token: cal.pre_token,
    tokenised: cal.tokenised,
    total_implied: board.reduce((a, r) => a + r.implied_value_usd, 0),
    watchlist_implied: board.filter((r) => r.watchlist).reduce((a, r) => a + r.implied_value_usd, 0),
    median_implied: board.length > 0 ? impliedSorted[Math.floor(board.length / 2)]!.implied_value_usd : 0,
    screened_category: cal.screened_category,
    screened_product_name: cal.screened_product_name,
    screened_exchange_name: cal.screened_exchange_name,
    screened_version: cal.screened_version,
    screened_by_category: cal.screened_by_category,
    bands: cal.bands,
    validation,
    categories,
    rows,
    live,
  };
  return { board, radar };
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, farm steps, values. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board carries a slug twice';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  for (let i = 0; i < board.length; i++) if (board[i]!.rank !== i + 1) return `rank ${i + 1} is ${board[i]!.rank}`;
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return 'every row shares one implied value: a board that ranks nothing by value is not a ranking';
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
