// radar-2: the token radar's scoring model.
//
// What goes in is one sealed snapshot of the protocol universe; what comes out is a ranked board
// of the protocols that record no token, each with an implied value and a farm plan. The live-token
// protocols are never ranked: the board shows their market caps as facts, apart from the ranking.
//
// How one protocol is valued, from the snapshot's figures alone:
//
//   value = tvl x 0.25
//         x (1 + clamped 7-day growth x 0.5)
//         x (0.6 + age share of 3 years x 0.4)
//         x (1 + extra chains x 0.015)
//
// The last factor is radar-2's change from the starter model: TVL spread over more chains reaches
// more wallets and more snapshots, so it earns up to 15% extra. Nothing here names a protocol: one
// function scores every row, and the same function runs again inside the dashboard so the page can
// prove its numbers match board.json.

/** One protocol exactly as the sealed snapshot lists it: ten fields, no more. */
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

/** The whole sealed input document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** Every number the model uses, stated in one place so the dashboard can print them. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_step: number;
  breadth_cap: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.25,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  breadth_step: 0.015,
  breadth_cap: 10,
};

/** The version the dashboard prints next to the snapshot date. */
export const MODEL_VERSION = 'radar-2';

/** Early rows taken from below the watchlist floor, by TVL: 249 covers every rankable one. */
export const EARLY_ROWS = 249;

/** Live-token rows the dashboard's second tab shows, by market cap. */
export const LIVE_ROWS = 24;

/** One farm step before it is flattened into a string: action, cost, time. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One ranked row of board.json. */
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
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    chains: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The slim row the dashboard renders, with the farm plan rebuilt in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
}

/** A protocol whose token already trades: market cap, not a model. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs in one object. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** The headline figures for the dashboard's fact column. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** Thrown when the snapshot file is not the shape this model scores. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** Clamp `n` into [lo, hi]. */
function clamp(n: number, lo: number, hi: number): number {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

/** A finite number, or `fallback` when the value is missing or not a number. */
function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listedAt` to `asOf`, never negative; null when either date is missing or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const start = Date.parse(`${asOf}T00:00:00Z`);
  const listed = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(listed)) return null;
  const span = start - listed;
  if (span <= 0) return 0;
  return Math.floor(span / DAY_MS);
}

/** Four-decimal rounding for the multipliers the board prints. */
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** The growth multiplier from a clamped seven-day change. */
function growthMultiplier(change7d: number | null, model: ModelConstants): { pct: number; mult: number } {
  const pct = clamp(asNumber(change7d, 0), model.growth_floor, model.growth_cap);
  return { pct, mult: 1 + (pct / 100) * model.growth_weight };
}

/** The maturity multiplier from an age in days, capped at the model's day range. */
function maturityMultiplier(age: number | null, model: ModelConstants): number {
  const days = age ?? model.unknown_age_days;
  const share = clamp(days, 0, model.maturity_days) / model.maturity_days;
  return model.maturity_floor + share * model.maturity_range;
}

/** The breadth multiplier from a chain count, capped at the model's extra-chain cap. */
function breadthMultiplier(chainCount: number, model: ModelConstants): number {
  const extra = clamp(chainCount - 1, 0, model.breadth_cap);
  return 1 + extra * model.breadth_step;
}

/**
 * Score one protocol: the four multipliers and the implied value.
 * Growth is clamped so one wild week cannot dominate; age is capped at three years; breadth is
 * capped at ten extra chains. An unknown age scores as one year old.
 */
export function impliedValue(protocol: SnapshotProtocol, asOf: string, model: ModelConstants): { implied: number; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const growth = growthMultiplier(protocol.change_7d, model);
  const maturityMult = maturityMultiplier(age, model);
  const breadthMult = breadthMultiplier(protocol.chains.length, model);
  const base = protocol.tvl_usd * model.base_multiple;
  const implied = Math.max(1, Math.round(base * growth.mult * maturityMult * breadthMult));
  return { implied, growthPct: growth.pct, growthMult: growth.mult, maturityMult, breadthMult, age };
}

/** A name ending in a version marker (V2, v2, 2.0 and the like) is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** No token on record: no market cap, no CoinGecko id, no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Rankable means pre-token, not an exchange, and not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category === 'CEX') return false;
  if (VERSIONED.test(p.name)) return false;
  return true;
}

/** Index the snapshot's protocols by slug for the watchlist lookup. */
function indexBySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  const index = new Map<string, SnapshotProtocol>();
  for (const protocol of protocols) index.set(protocol.slug, protocol);
  return index;
}

/** The first chain a protocol names, or a neutral phrase when it names none. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The second chain a protocol names, or null when it runs on a single chain. */
function secondChainOf(p: SnapshotProtocol): string | null {
  return p.chains.length > 1 ? p.chains[1]! : null;
}

/** Capital steps: [TVL floor, capital]. The first floor the TVL clears wins. */
const CAPITAL_STEPS: Array<[number, number]> = [
  [5_000_000_000, 250],
  [1_000_000_000, 150],
  [100_000_000, 100],
  [0, 50],
];

/** Capital for one farm position, stepped from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  for (const [floor, capital] of CAPITAL_STEPS) {
    if (p.tvl_usd >= floor) return capital;
  }
  return 50;
}

/** Hold steps: [age ceiling in days, hold in days]. The first ceiling the age fits wins. */
const HOLD_STEPS: Array<[number, number]> = [
  [180, 60],
  [365, 45],
  [Number.POSITIVE_INFINITY, 30],
];

/** How long to hold: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  for (const [ceiling, hold] of HOLD_STEPS) {
    if (age < ceiling) return hold;
  }
  return 30;
}

/**
 * The category actions, as a table: each row names the category words it answers and the sentence
 * it builds. The first row whose words appear in the category wins; the last row is the fallback
 * every protocol gets. A table, not a chain of branches, so a new category is one row.
 */
type ActionRow = { words: string[]; make: (name: string, capital: number, chain: string) => string };
const ACTION_TABLE: ActionRow[] = [
  { words: ['lend', 'cdp', 'collateral'], make: (name, capital, chain) => `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.` },
  { words: ['dex', 'yield', 'leveraged farm'], make: (name, capital, chain) => `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.` },
  { words: ['bridge'], make: (name, capital, chain) => `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.` },
  { words: ['staking', 'restak'], make: (name, capital, chain) => `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.` },
  { words: ['perpetual', 'derivative'], make: (name, capital, chain) => `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.` },
  { words: ['prediction'], make: (name, capital, chain) => `Fund $${capital} and place one market position on ${name}.` },
  { words: ['curator', 'allocator'], make: (name, capital, chain) => `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.` },
  { words: ['stable'], make: (name, capital, chain) => `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.` },
  { words: ['rwa'], make: (name, capital, chain) => `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.` },
  { words: ['insurance'], make: (name, capital, chain) => `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.` },
];

/** The category's one action, in words a farmer can follow with no extra research. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const category = (p.category ?? '').toLowerCase();
  for (const row of ACTION_TABLE) {
    for (const word of row.words) {
      if (category.includes(word)) return row.make(p.name, capital, chain);
    }
  }
  return `Deposit $${capital} of USDC into ${p.name} on ${chain} and keep the position open.`;
}

/** One step flattened into a single string: action, then cost and time, 20 to 600 characters. */
export function stepText(step: FarmStep): string {
  const joined = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (joined.length > 600) return `${joined.slice(0, 596)}...`;
  if (joined.length < 20) return `${joined} Hold the position and check the protocol's own page.`;
  return joined;
}

/**
 * Seven steps for one protocol, all derived from its own record: category, chains, TVL and age.
 * Step five spreads the farm onto a second chain where the protocol runs on one, so the position
 * is counted in more than one place; step six is the claim check, step seven the log.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const second = secondChainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const half = Math.round(capital / 2);
  const secondAction = second === null
    ? `Open a second, smaller position of $${half} in the same market so one failed transaction does not end the farm.`
    : `Repeat the main action with $${half} on ${second} so the farm is counted on two chains.`;
  const gas = capital >= 150 ? 8 : 4;
  const steps: FarmStep[] = [];
  steps.push({ text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`, cost: 'under $3 of gas for the first transaction', time: '5 minutes' });
  steps.push({ text: action, cost: `$${capital} of capital and about $${gas} of gas`, time: '15 minutes to set up' });
  steps.push({ text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`, cost: 'about $2 of gas a week', time: '10 minutes a week' });
  steps.push({ text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`, cost: `the $${capital} stays in the position`, time: `${hold} days` });
  steps.push({ text: secondAction, cost: `$${half} of capital and about $3 of gas`, time: '15 minutes' });
  steps.push({ text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`, cost: 'no fee to check, and never pay to claim', time: '10 minutes' });
  steps.push({ text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`, cost: 'nothing but the log', time: '5 minutes' });
  return steps;
}

/** Rank rows strongest first; ties break on slug so the order is stable run to run. */
function byImpliedDesc(a: { implied: number; p: SnapshotProtocol }, b: { implied: number; p: SnapshotProtocol }): number {
  if (b.implied !== a.implied) return b.implied - a.implied;
  if (a.p.slug < b.p.slug) return -1;
  if (a.p.slug > b.p.slug) return 1;
  return 0;
}

/** TVL descending, ties on slug: the order the early radar is filled in. */
function byTvlDesc(a: SnapshotProtocol, b: SnapshotProtocol): number {
  if (b.tvl_usd !== a.tvl_usd) return b.tvl_usd - a.tvl_usd;
  if (a.slug < b.slug) return -1;
  if (a.slug > b.slug) return 1;
  return 0;
}

/** The board: every watchlist slug, plus the early radar below the floor, strongest first. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = indexBySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor, never a gamble: every slug it names is in, even one the snapshot
  // no longer carries (it cannot, but coverage is the gate's row and is never left to chance).
  for (const slug of snapshot.watchlist) {
    const found = index.get(slug);
    if (found !== undefined) chosen.set(slug, found);
  }
  // The early radar: rankable pre-token protocols below the floor, by TVL, capped at EARLY_ROWS.
  // A chosen protocol stays chosen; the early rows only add.
  const candidates: SnapshotProtocol[] = [];
  for (const protocol of snapshot.protocols) {
    if (chosen.has(protocol.slug)) continue;
    if (!isRankable(protocol)) continue;
    if (protocol.tvl_usd >= snapshot.floor_usd) continue;
    candidates.push(protocol);
  }
  candidates.sort(byTvlDesc);
  const early = candidates.slice(0, EARLY_ROWS);
  for (const protocol of early) chosen.set(protocol.slug, protocol);

  const scored: Array<{ p: SnapshotProtocol; implied: number; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; age: number | null }> = [];
  for (const protocol of chosen.values()) {
    const result = impliedValue(protocol, snapshot.as_of, model);
    scored.push({ p: protocol, implied: result.implied, growthPct: result.growthPct, growthMult: result.growthMult, maturityMult: result.maturityMult, breadthMult: result.breadthMult, age: result.age });
  }
  scored.sort(byImpliedDesc);
  const board: BoardRow[] = [];
  for (let i = 0; i < scored.length; i++) {
    const s = scored[i]!;
    board.push({
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token',
      age_days: s.age,
      implied_value_usd: s.implied,
      model: {
        base_multiple: model.base_multiple,
        growth_pct: s.growthPct,
        growth_multiplier: round4(s.growthMult),
        maturity_multiplier: round4(s.maturityMult),
        breadth_multiplier: round4(s.breadthMult),
        chains: s.p.chains.length,
        age_days: s.age,
      },
      farm_steps: farmSteps(s.p, s.age).map(stepText),
    });
  }
  return board;
}

/** Live-token protocols by market cap, for the dashboard's second tab. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  const live: SnapshotProtocol[] = [];
  for (const protocol of snapshot.protocols) {
    if (isPreToken(protocol)) continue;
    if (protocol.category === 'CEX') continue;
    live.push(protocol);
  }
  live.sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd);
  const rows: LiveRow[] = [];
  for (const protocol of live.slice(0, LIVE_ROWS)) {
    rows.push({
      slug: protocol.slug,
      name: protocol.name,
      category: protocol.category,
      chains: protocol.chains,
      tvl_usd: protocol.tvl_usd,
      mcap_usd: protocol.mcap_usd,
      change_7d: protocol.change_7d,
    });
  }
  return rows;
}

/** A board row slimmed down for data.js; the page rebuilds the farm plan from these fields. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
  };
}

/** Build the board and the dashboard data together. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  let early = 0;
  for (const row of board) {
    if (!snapshot.watchlist.includes(row.slug)) early += 1;
  }
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** Read the snapshot out of a file's text, refusing anything but the shape the model scores. */
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
  const protocols: SnapshotProtocol[] = [];
  for (let i = 0; i < o.protocols.length; i++) {
    const v = o.protocols[i];
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    const chains: string[] = [];
    if (Array.isArray(p.chains)) {
      for (const chain of p.chains) {
        if (typeof chain === 'string') chains.push(chain);
      }
    }
    protocols.push({
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains,
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    });
  }
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/**
 * Why a board is not one the gate will take, or null when it is fine: coverage of the watchlist,
 * ranks 1..N each once, implied values never rising with rank, no shared value across the board,
 * and every row's farm steps within their shape.
 */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const seen = new Set<string>();
  for (const row of board) seen.add(row.slug);
  const missing: string[] = [];
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) missing.push(slug);
  }
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks: number[] = [];
  for (const row of board) ranks.push(row.rank);
  ranks.sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const row of board) {
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `${row.slug} has ${row.farm_steps.length} farm steps`;
    for (const step of row.farm_steps) {
      if (step.length < 20 || step.length > 600) return `${row.slug} has a farm step of ${step.length} characters`;
    }
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0) return `${row.slug} has implied value ${row.implied_value_usd}`;
  }
  return null;
}

/** The dashboard's dataset as one script: no fetch, no network, just window.RADAR. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
