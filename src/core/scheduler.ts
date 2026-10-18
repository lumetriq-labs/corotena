import type { Match, MemberId, Priority, Round, Team } from "./types";

export const pairKey = (a: MemberId, b: MemberId): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

export interface Tally {
  play: Map<MemberId, number>;
  rest: Map<MemberId, number>;
  pair: Map<string, number>;
  opp: Map<string, number>;
}

const bump = <K>(m: Map<K, number>, k: K) => m.set(k, (m.get(k) ?? 0) + 1);

export function tally(rounds: readonly Round[]): Tally {
  const t: Tally = { play: new Map(), rest: new Map(), pair: new Map(), opp: new Map() };
  for (const r of rounds) {
    for (const p of r.rest) bump(t.rest, p);
    for (const m of r.matches) {
      for (const p of [...m.a, ...m.b]) bump(t.play, p);
      bump(t.pair, pairKey(...m.a));
      bump(t.pair, pairKey(...m.b));
      for (const x of m.a) for (const y of m.b) bump(t.opp, pairKey(x, y));
    }
  }
  return t;
}

export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = s;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Lower is better; compared element by element. */
type Score = number[];

const compare = (a: Score, b: Score): number => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
};

/**
 * An arrangement is a flat list: the first `restN` ids rest, then each court takes
 * four ids as [a0, a1, b0, b1].
 */
type Arrangement = MemberId[];

function createEvaluator(
  players: readonly MemberId[], history: readonly Round[], restN: number, courts: number, priority: Priority,
  credit: ReadonlyMap<MemberId, number> | undefined, satOut: ReadonlySet<MemberId> | undefined,
) {
  const t = tally(history);
  const last = history[history.length - 1];
  const lastRest = new Set([...(last?.rest ?? []), ...(satOut ?? [])]);
  const lastPairs = new Set(last?.matches.flatMap(m => [pairKey(...m.a), pairKey(...m.b)]) ?? []);
  const basePlay = new Map(players.map(p => [p, (t.play.get(p) ?? 0) + (credit?.get(p) ?? 0)]));

  return (order: Arrangement): Score => {
    let consecutive = 0;
    let maxPlay = -Infinity, minPlay = Infinity;
    for (let i = 0; i < order.length; i++) {
      const p = order[i]!;
      const resting = i < restN;
      if (resting && lastRest.has(p)) consecutive++;
      const games = basePlay.get(p)! + (resting ? 0 : 1);
      if (games > maxPlay) maxPlay = games;
      if (games < minPlay) minPlay = games;
    }
    // Keep everyone's game count within one of each other (the fairness baseline).
    const spread = Math.max(0, maxPlay - minPlay - 1);

    let pairRepeat = 0, lastPair = 0, oppRepeat = 0;
    for (let c = 0; c < courts; c++) {
      const o = restN + c * 4;
      const a0 = order[o]!, a1 = order[o + 1]!, b0 = order[o + 2]!, b1 = order[o + 3]!;
      for (const k of [pairKey(a0, a1), pairKey(b0, b1)]) {
        const n = t.pair.get(k) ?? 0;
        pairRepeat += n * n;
        if (lastPairs.has(k)) lastPair++;
      }
      for (const x of [a0, a1]) for (const y of [b0, b1]) oppRepeat += t.opp.get(pairKey(x, y)) ?? 0;
    }

    return priority === "rest"
      ? [spread, consecutive, lastPair, pairRepeat, oppRepeat]
      : [spread, lastPair, pairRepeat, consecutive, oppRepeat];
  };
}

function binomial(n: number, k: number): number {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

/** Distinct (rest set, court grouping, pairing) combinations, ignoring court order and sides. */
export function countArrangements(n: number, courts: number): number {
  const playing = courts * 4;
  let groupings = 1;
  for (let left = playing; left > 0; left -= 4) groupings *= binomial(left - 1, 3);
  return binomial(n, n - playing) * groupings * 3 ** courts;
}

const PAIRINGS: [number, number, number, number][] = [[0, 1, 2, 3], [0, 2, 1, 3], [0, 3, 1, 2]];

function exhaustive(players: readonly MemberId[], restN: number, evaluate: (o: Arrangement) => Score, random: () => number): Arrangement {
  let best: Arrangement = [];
  let bestScore: Score | null = null;
  let ties = 0;
  const consider = (order: Arrangement) => {
    const s = evaluate(order);
    const c = bestScore ? compare(s, bestScore) : -1;
    if (c < 0) { best = order.slice(); bestScore = s; ties = 1; }
    else if (c === 0 && random() * ++ties < 1) best = order.slice();
  };

  const pairUp = (rest: MemberId[], groups: MemberId[][], gi: number, acc: MemberId[]) => {
    if (gi === groups.length) { consider([...rest, ...acc]); return; }
    const g = groups[gi]!;
    for (const [w, x, y, z] of PAIRINGS) pairUp(rest, groups, gi + 1, [...acc, g[w]!, g[x]!, g[y]!, g[z]!]);
  };

  const group = (rest: MemberId[], remaining: MemberId[], groups: MemberId[][]) => {
    if (remaining.length === 0) { pairUp(rest, groups, 0, []); return; }
    const [head, ...others] = remaining as [MemberId, ...MemberId[]];
    for (let i = 0; i < others.length; i++)
      for (let j = i + 1; j < others.length; j++)
        for (let k = j + 1; k < others.length; k++) {
          const g = [head, others[i]!, others[j]!, others[k]!];
          group(rest, others.filter((_, idx) => idx !== i && idx !== j && idx !== k), [...groups, g]);
        }
  };

  const chooseRest = (start: number, rest: MemberId[]) => {
    if (rest.length === restN) { group(rest, players.filter(p => !rest.includes(p)), []); return; }
    for (let i = start; i <= players.length - (restN - rest.length); i++) chooseRest(i + 1, [...rest, players[i]!]);
  };

  chooseRest(0, []);
  return best;
}

function localSearch(players: readonly MemberId[], restN: number, evaluate: (o: Arrangement) => Score, random: () => number, restarts: number): Arrangement {
  // Slots in the same block (rest area, or the same team) are interchangeable, so swapping them is a no-op.
  const block = (i: number) => (i < restN ? -1 : Math.floor((i - restN) / 2));
  let best: Arrangement = [];
  let bestScore: Score | null = null;
  let ties = 0;
  for (let r = 0; r < restarts; r++) {
    const order = shuffle(players, random);
    let score = evaluate(order);
    for (let improved = true; improved;) {
      improved = false;
      for (let i = 0; i < order.length; i++)
        for (let j = i + 1; j < order.length; j++) {
          if (block(i) === block(j)) continue;
          [order[i], order[j]] = [order[j]!, order[i]!];
          const s = evaluate(order);
          if (compare(s, score) < 0) { score = s; improved = true; }
          else [order[i], order[j]] = [order[j]!, order[i]!];
        }
    }
    const c = bestScore ? compare(score, bestScore) : -1;
    if (c < 0) { best = order.slice(); bestScore = score; ties = 1; }
    else if (c === 0 && random() * ++ties < 1) best = order.slice();
  }
  return best;
}

function toRound(order: Arrangement, restN: number, courts: number, random: () => number): Round {
  const side = (t: Team): Team => (random() < 0.5 ? t : [t[1], t[0]]);
  const matches: Match[] = [];
  for (let c = 0; c < courts; c++) {
    const o = restN + c * 4;
    const a = side([order[o]!, order[o + 1]!]);
    const b = side([order[o + 2]!, order[o + 3]!]);
    matches.push(random() < 0.5 ? { a, b } : { a: b, b: a });
  }
  return { matches: shuffle(matches, random), rest: order.slice(0, restN) };
}

export interface GenerateOptions {
  courts: number;
  priority: Priority;
  random?: () => number;
  /** Games counted as already played, so mid-session joiners don't have to catch up on rounds they missed. */
  credit?: ReadonlyMap<MemberId, number>;
  /** Players who weren't in the last round (e.g. just joined), treated as having rested in it. */
  satOut?: ReadonlySet<MemberId>;
}

/** Above this many combinations, fall back from exhaustive search to restarted local search. */
const EXHAUSTIVE_LIMIT = 60_000;
const LOCAL_SEARCH_RESTARTS = 24;

export function generateRound(players: readonly MemberId[], history: readonly Round[], opts: GenerateOptions): Round | null {
  const courts = Math.min(Math.max(1, Math.floor(opts.courts)), Math.floor(players.length / 4));
  if (courts < 1) return null;
  const random = opts.random ?? Math.random;
  const restN = players.length - courts * 4;
  const evaluate = createEvaluator(players, history, restN, courts, opts.priority, opts.credit, opts.satOut);
  const order = countArrangements(players.length, courts) <= EXHAUSTIVE_LIMIT
    ? exhaustive(players, restN, evaluate, random)
    : localSearch(players, restN, evaluate, random, LOCAL_SEARCH_RESTARTS);
  return toRound(order, restN, courts, random);
}
