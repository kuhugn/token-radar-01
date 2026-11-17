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
//               ratios over between-category variance of category medians). A category with fewer
//               than 3 tokenised peers falls back to the global median and the row is flagged.
//               The result is clamped to [0.03, 1.20].
//   growth    = 1 + 0.50 x clamp(change_7d - category median change_7d, -30, +30) / 100, so a
//               protocol is scored on momentum relative to its own category, in [0.85, 1.15]. A
//               missing change_7d scores as its category's median (relative growth 0).
//   maturity  = two-piece in age without a token: 0.70 -> 0.85 linearly over the first 90 days,
//               then 0.85 -> 1.00 on a log scale out to 1095 days. Unknown age scores as 180 days
//               and the row is flagged.
//   breadth   = +3% for a second chain, +2% for a third, +1% each for a fourth and fifth (max +7%).
//   scale     = x0.90 above $1B TVL (mega-caps rarely re-rate), x0.85 below $20M TVL (thin record).
//   implied   = round(TVL x multiple x growth x maturity x breadth x scale), at least $1.
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

export const MODEL_VERSION = 'radar-2.1';

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
  scale_large_tvl: 1_000_000_000,
  scale_large: 0.9,
  scale_small_tvl: 20_000_000,
  scale_small: 0.85,
  bankroll_usd: 10_000,
} as const;

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
}

/** Everything the model learns from the snapshot before scoring a single row. */
export interface Calibration {
  global_median: number;
  shrinkage_k: number;
  categories: Map<string, CategoryStat>;
  global_median_change: number | null;
  screened_category: number;
  screened_product_name: number;
  screened_exchange_name: number;
  screened_version: number;
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
export function calibrate(snapshot: Snapshot): Calibration {
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
  const k = betweenVar > 1e-9 ? clamp(withinVar / betweenVar, 0, 100) : 100;

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
    });
  }

  return {
    global_median: round4(globalMedian),
    shrinkage_k: round2(k),
    categories,
    global_median_change: globalMedianChange === null ? null : round2(globalMedianChange),
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
  if (tvl > MODEL.scale_large_tvl) return MODEL.scale_large;
  if (tvl < MODEL.scale_small_tvl) return MODEL.scale_small;
  return 1;
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
  const multiple = stat?.multiple ?? cal.global_median;
  const peers = stat?.peers ?? 0;
  const fallback = stat?.fallback ?? true;

  const catMedianChange = stat?.median_change_7d ?? cal.global_median_change ?? 0;
  const relRaw = p.change_7d === null ? 0 : p.change_7d - catMedianChange;
  const rel = clamp(relRaw, -MODEL.growth_clamp_pp, MODEL.growth_clamp_pp);
  const growthMult = 1 + (MODEL.growth_weight * rel) / 100;

  const age = ageDays(asOf, p.listed_at);
  const maturity = maturityFor(age ?? MODEL.unknown_age_days);
  const breadth = breadthFor(p.chains.length);
  const scale = scaleFor(p.tvl_usd);

  const at = (g: number): number => Math.max(1, Math.round(p.tvl_usd * multiple * g * maturity * breadth * scale));
  const implied = at(growthMult);
  const impliedFloor = at(1 + (MODEL.growth_weight * -MODEL.growth_clamp_pp) / 100);
  const impliedCeiling = at(1 + (MODEL.growth_weight * MODEL.growth_clamp_pp) / 100);

  const tokenRate = stat !== undefined && stat.total > 0 ? stat.tokenised / stat.total : 0;
  const pLaunch = Math.round(100 * clamp(tokenRate * (0.4 + 0.6 * overdue(age)), 0.02, 0.97));

  const flags: string[] = [];
  if (fallback) flags.push('fallback multiple');
  else if (peers < MODEL.thin_peers) flags.push('thin comps');
  if (age === null) flags.push('age unknown');
  if (Math.abs(relRaw) > MODEL.growth_clamp_pp) flags.push('growth clamped');
  if (p.tvl_usd < MODEL.scale_small_tvl) flags.push('small tvl');

  return {
    implied,
    multiple,
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

/** The risk level a row's flags add up to, for the dashboard's badges. */
export function riskLevel(flags: string[]): 'low' | 'medium' | 'high' {
  if (flags.includes('fallback multiple') || flags.includes('small tvl')) return 'high';
  return flags.length > 0 ? 'medium' : 'low';
}

/** Position size on the model's $10,000 reference bankroll, from the protocol's own TVL. */
function capitalFor(tvl: number): number {
  if (tvl >= 1_000_000_000) return 2500;
  if (tvl >= 250_000_000) return 2000;
  if (tvl >= 50_000_000) return 1500;
  if (tvl >= 10_000_000) return 750;
  return 400;
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
function playbookFor(category: string | null): Playbook {
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

/**
 * A protocol's farm plan: five steps from the playbook its category calls for, sized from its own
 * TVL, priced from its first chain, timed from its age. Every step carries its cost and its time;
 * the last step of every plan is the risk line, because a farm that hides its risk is a slogan.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const cap = capitalFor(p.tvl_usd);
  const gas = gasFor(chain);
  const hold = holdDaysFor(age);
  const book = playbookFor(p.category);
  const wallet = `Start with a fresh wallet funded only with the $${cap} you plan to farm ${p.name} with, and keep its seed phrase offline. Cost: about $${gas} of gas to fund and approve. Time: 10 minutes.`;
  const watch = `Check the position weekly and add one small qualifying action (about $${gas} of gas each) so the wallet reads as an active user, not a one-off deposit. Cost: about $${gas * 4} of gas a month. Time: 10 minutes a week.`;
  const holdStep = `Hold the position for at least ${hold} days so it appears in more than one activity snapshot; most points and eligibility windows reward duration, not size alone. Cost: the $${cap} stays deployed. Time: ${hold} days.`;
  const claim = `Before withdrawing, open ${p.name}'s own rewards or points page and claim only from the link the protocol itself publishes; never pay a third party to claim for you. Cost: $0 to check, about $${gas} of gas to claim. Time: 10 minutes.`;
  const actions: Record<Playbook, string> = {
    curator: `Deposit $${cap} of USDC into one established ${p.name} vault on ${chain}, choosing the vault whose curator has the longest live record over the newest one. Cost: $${cap} of capital plus about $${gas} of gas. Time: 15 minutes to set up.`,
    rwa: `Complete any KYC the issuer requires, then mint $${cap} of ${p.name}'s yield-bearing asset on ${chain} and hold it in the farming wallet. Cost: $${cap} of capital plus about $${gas} of gas; KYC itself is free. Time: 30 minutes including KYC.`,
    lending: `Supply $${cap} of USDC to ${p.name} on ${chain}, then borrow against it at 40-60% loan-to-value and re-supply the borrow once; keep the health factor above 1.5 at all times. Cost: $${cap} of capital plus about $${gas * 2} of gas for the loop. Time: 20 minutes to set up.`,
    dexs: `Provide $${cap} of liquidity to ${p.name}'s main pool on ${chain} (or, on a perpetuals venue, deposit $${cap} as margin and trade one small hedged position a week). Cost: $${cap} of capital plus about $${gas} of gas. Time: 15 minutes to set up.`,
    yield: `Deposit $${cap} of USDC into ${p.name}'s main yield vault on ${chain} and leave auto-compounding on; rotate to a sister vault only if its rate leads by more than 2 points for a full week. Cost: $${cap} of capital plus about $${gas} of gas. Time: 15 minutes to set up.`,
    restaking: `Stake $${cap} of the liquid staking asset through ${p.name} on ${chain} and keep the receipt token in the farming wallet; do not loop it into a second restaking layer. Cost: $${cap} of capital plus about $${gas} of gas. Time: 15 minutes to set up.`,
    bridge: `Bridge about $${Math.max(100, Math.round(cap / 5))} of USDC through ${p.name} in each direction once a week, varying the amount and the day, and use the bridged funds in one app on the far side each trip. Cost: about $${gas * 2} of gas and bridge fees a week. Time: 15 minutes a week.`,
    generic: `Deposit $${cap} of USDC into ${p.name}'s core product on ${chain} and use its main feature once (a deposit, a swap or a vote) so the wallet is a user, not a bystander. Cost: $${cap} of capital plus about $${gas} of gas. Time: 15 minutes to set up.`,
  };
  const risks: Record<Playbook, string> = {
    curator: `Risk: the vault's curator can rebalance into riskier strategies and smart-contract risk sits with the vault, not the curator's brand; withdraw if the strategy or the curator changes without notice. Cost: none to monitor. Time: 5 minutes a week.`,
    rwa: `Risk: redemption can be gated by the issuer's schedule and KYC ties this wallet to your identity, so never mix it with anonymous farms; check the redemption window before you need the money back. Cost: none to monitor. Time: 5 minutes a month.`,
    lending: `Risk: if the health factor falls under 1.0 the position is liquidated at a penalty; set a price alert at 1.5 and never leave a looped position unwatched over a volatile weekend. Cost: none to monitor. Time: 5 minutes a week.`,
    dexs: `Risk: liquidity positions suffer impermanent loss when prices move, and perpetuals margin can be liquidated; keep the position small enough that a 30% adverse move is a lesson, not a loss that matters. Cost: none to monitor. Time: 5 minutes a week.`,
    yield: `Risk: headline yield often comes from incentives that end without notice, and the vault's strategy contracts are the attack surface; leave when the rate falls to plain lending levels. Cost: none to monitor. Time: 5 minutes a month.`,
    restaking: `Risk: restaking stacks slashing risk on top of staking risk and the receipt token can depeg under stress; the extra yield is payment for exactly that stack, so size it like it. Cost: none to monitor. Time: 5 minutes a month.`,
    bridge: `Risk: bridges are the most-hacked contracts in the industry; never leave bridged funds idle on the far side and split large moves across two days. Cost: none to monitor. Time: 5 minutes a week.`,
    generic: `Risk: a pre-token protocol can change its rules, pause withdrawals or never issue a token at all; the $${cap} position is the full extent of the bet, so never add funds you cannot leave locked for a year. Cost: none to monitor. Time: 5 minutes a month.`,
  };
  return [wallet, actions[book], watch, holdStep, claim, risks[book]].slice(0, 6);
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
  peers: number;
  growth_rel_pp: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  scale_multiplier: number;
  p_launch: number;
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
  pre_token: number;
  tokenised: number;
  screened_category: number;
  screened_product_name: number;
  screened_exchange_name: number;
  screened_version: number;
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
    farm_steps: farmSteps(p, s.age_days),
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

/** Everything the dashboard needs: the board, the live set, the calibration it ran on. */
export function buildRadar(snapshot: Snapshot, snapshotSha256: string): { board: BoardRow[]; radar: RadarData } {
  const cal = calibrate(snapshot);
  const board = buildBoard(snapshot, cal);
  const live = liveRows(snapshot);
  const rows: RadarRow[] = board.map((r) => {
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
      peers: r.model.peers,
      growth_rel_pp: r.model.growth_rel_pp,
      growth_multiplier: r.model.growth_multiplier,
      maturity_multiplier: r.model.maturity_multiplier,
      breadth_multiplier: r.model.breadth_multiplier,
      scale_multiplier: r.model.scale_multiplier,
      p_launch: r.model.p_launch,
      risk: riskLevel(r.model.risk_flags),
      risk_flags: r.model.risk_flags,
      farm_steps: r.farm_steps,
    };
  });
  const categories: CategoryView[] = [...cal.categories.values()]
    .filter((c) => c.total >= 3)
    .sort((a, b) => b.total - a.total)
    .map((c) => ({ ...c }));
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
    pre_token: cal.pre_token,
    tokenised: cal.tokenised,
    screened_category: cal.screened_category,
    screened_product_name: cal.screened_product_name,
    screened_exchange_name: cal.screened_exchange_name,
    screened_version: cal.screened_version,
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
