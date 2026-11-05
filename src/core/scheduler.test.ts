import { createHash } from "node:crypto";
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

const longestStreak = (rounds: Round[], n: number) => Math.max(...ids(n).map(p => {
  let run = 0, best = 0;
  for (const r of rounds) { run = r.rest.includes(p) ? run + 1 : 0; best = Math.max(best, run); }
  return best;
}));

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

  it("never rests anyone three rounds in a row when more rest than play, if rest has priority", () => {
    for (const n of [9, 10, 11, 12]) {
      for (const seed of [1, 2, 3]) {
        const rounds = run(n, 1, "rest", 20, seed);
        expect(longestStreak(rounds, n)).toBeLessThanOrEqual(2);
        expect(playSpread(rounds, n)).toBeLessThanOrEqual(1);
      }
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

  it("lets a credited late joiner play at the normal pace", () => {
    const players = ids(6);
    const random = mulberry32(1);
    const history: Round[] = [];
    for (let i = 0; i < 6; i++) history.push(generateRound(players, history, { courts: 1, priority: "rest", random })!);
    const least = Math.min(...players.map(p => tally(history).play.get(p) ?? 0));
    const joined = [...players, "late"];
    const credit = new Map([["late", least]]);
    const after: Round[] = [];
    for (let i = 0; i < 7; i++) {
      after.push(generateRound(joined, [...history, ...after], { courts: 1, priority: "rest", random, credit })!);
    }
    const latePlays = after.filter(r => !r.rest.includes("late")).length;
    const play = tally(after).play;
    const othersAvg = players.reduce((s, p) => s + (play.get(p) ?? 0), 0) / players.length;
    expect(latePlays).toBeLessThan(after.length);
    expect(Math.abs(latePlays - othersAvg)).toBeLessThanOrEqual(1);
  });

  it("never rests anyone three rounds in a row under balance", () => {
    for (const [n, c] of [[5, 1], [6, 1], [7, 1], [8, 1], [9, 1], [10, 1], [11, 1], [12, 1], [9, 2], [10, 2], [11, 2], [12, 2], [13, 2], [14, 2]] as const) {
      for (const seed of [1, 2]) {
        const rounds = run(n, c, "balance", 20, seed);
        expect(longestStreak(rounds, n)).toBeLessThanOrEqual(2);
        expect(playSpread(rounds, n)).toBeLessThanOrEqual(1);
      }
    }
  }, 30_000);

  it("forms every pair with eight players on one court under balance, unlike rest", () => {
    const pairs = (rounds: Round[]) => tally(rounds).pair.size;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      expect(pairs(run(8, 1, "balance", 30, seed))).toBe(28);
      expect(pairs(run(8, 1, "rest", 30, seed))).toBeLessThan(28);
    }
  });

  it("sits between rest and variety on consecutive rests", () => {
    let rest = 0, balance = 0, variety = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      rest += consecutiveRests(run(8, 1, "rest", 30, seed));
      balance += consecutiveRests(run(8, 1, "balance", 30, seed));
      variety += consecutiveRests(run(8, 1, "variety", 30, seed));
    }
    expect(rest).toBeLessThan(balance);
    expect(balance).toBeLessThan(variety);
  });

  it("keeps rest and variety rounds unchanged", () => {
    const out: Record<string, Round[]> = {};
    for (const [n, c] of [[4, 1], [5, 1], [6, 1], [7, 1], [8, 1], [9, 2], [10, 2], [12, 2], [13, 3], [16, 2]] as const) {
      for (const priority of ["rest", "variety"] as const) {
        for (const seed of [1, 2, 3]) out[`${n}-${c}-${priority}-${seed}`] = run(n, c, priority, 20, seed);
      }
    }
    const hash = createHash("sha256").update(JSON.stringify(out)).digest("hex");
    expect(hash).toBe("6ff34487ef609d7377a042199964838ee1aae6d847434785031f6b397c0bdee9");
  }, 30_000);

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
