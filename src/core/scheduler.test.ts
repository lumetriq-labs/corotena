import { describe, expect, it } from "vitest";
import { countArrangements, generateRound, mulberry32, pairKey, tally } from "./scheduler";
import type { Priority, Round } from "./types";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);

function run(n: number, courts: number, priority: Priority, rounds: number, seed = 1): Round[] {
  const players = ids(n);
  const random = mulberry32(seed);
  const history: Round[] = [];
  for (let i = 0; i < rounds; i++) {
    const r = generateRound(players, history, { courts, priority, random });
    if (!r) throw new Error("no round");
    history.push(r);
  }
  return history;
}

const consecutiveRests = (rounds: Round[]) =>
  rounds.slice(1).reduce((n, r, i) => n + r.rest.filter(p => rounds[i]!.rest.includes(p)).length, 0);

const pairRepeats = (rounds: Round[]) =>
  [...tally(rounds).pair.values()].reduce((n, c) => n + c - 1, 0);

const playSpread = (rounds: Round[], n: number) => {
  const play = tally(rounds).play;
  const games = ids(n).map(p => play.get(p) ?? 0);
  return Math.max(...games) - Math.min(...games);
};

describe("generateRound", () => {
  it("needs at least four players", () => {
    expect(generateRound(ids(3), [], { courts: 1, priority: "rest" })).toBeNull();
  });

  it("caps courts at what the roster can fill", () => {
    const r = generateRound(ids(9), [], { courts: 4, priority: "rest" });
    expect(r?.matches).toHaveLength(2);
    expect(r?.rest).toHaveLength(1);
  });

  it("places every player exactly once per round", () => {
    for (const [n, c] of [[4, 1], [7, 1], [11, 2], [14, 3], [16, 4], [19, 4]] as const) {
      for (const r of run(n, c, "rest", 6)) {
        const seen = [...r.rest, ...r.matches.flatMap(m => [...m.a, ...m.b])];
        expect(seen.sort()).toEqual(ids(n).sort());
        expect(r.matches).toHaveLength(c);
      }
    }
  });

  it("rotates rests evenly with five players", () => {
    const rounds = run(5, 1, "rest", 10);
    const rest = tally(rounds).rest;
    for (const p of ids(5)) expect(rest.get(p)).toBe(2);
    expect(consecutiveRests(rounds)).toBe(0);
  });

  it("avoids consecutive rests and keeps games even when rest has priority", () => {
    for (const seed of [1, 2, 3]) {
      const rounds = run(7, 1, "rest", 10, seed);
      expect(consecutiveRests(rounds)).toBe(0);
      expect(playSpread(rounds, 7)).toBeLessThanOrEqual(1);
    }
  });

  it("repeats fewer pairs when variety has priority", () => {
    let rest = 0, variety = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      rest += pairRepeats(run(7, 1, "rest", 10, seed));
      variety += pairRepeats(run(7, 1, "variety", 10, seed));
    }
    expect(variety).toBeLessThan(rest);
  });

  it("never repeats a pair from the previous round when avoidable", () => {
    const rounds = run(8, 2, "variety", 12);
    for (let i = 1; i < rounds.length; i++) {
      const prev = new Set(rounds[i - 1]!.matches.flatMap(m => [pairKey(...m.a), pairKey(...m.b)]));
      for (const m of rounds[i]!.matches) {
        expect(prev.has(pairKey(...m.a))).toBe(false);
        expect(prev.has(pairKey(...m.b))).toBe(false);
      }
    }
  });

  it("stays fast for large rosters", () => {
    const start = performance.now();
    run(20, 4, "rest", 10);
    expect(performance.now() - start).toBeLessThan(2000);
  });

  it("is deterministic for a given seed", () => {
    expect(run(9, 2, "variety", 5, 42)).toEqual(run(9, 2, "variety", 5, 42));
  });
});

describe("countArrangements", () => {
  it("matches known counts", () => {
    expect(countArrangements(4, 1)).toBe(3);
    expect(countArrangements(5, 1)).toBe(15);
    expect(countArrangements(8, 2)).toBe(35 * 9);
  });
});
