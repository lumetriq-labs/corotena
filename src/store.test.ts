import { describe, expect, it } from "vitest";
import {
  activeIds, addMember, gamesPlayed, initialState, load, parseState, removeInactive, removeMember, resetAll, resetRounds, save, toggleMember,
} from "./store";

describe("parseState", () => {
  it("rejects malformed data", () => {
    expect(parseState(null)).toBeNull();
    expect(parseState({ version: 2, members: [], rounds: [] })).toBeNull();
    expect(parseState({ version: 1, members: [{ id: 1 }], rounds: [] })).toBeNull();
  });

  it("rejects rounds that reference unknown members", () => {
    const raw = {
      ...initialState(),
      members: [{ id: "a", name: "A", active: true }],
      rounds: [{ matches: [{ a: ["a", "x"], b: ["a", "a"] }], rest: [] }],
    };
    expect(parseState(raw)).toBeNull();
  });

  it("round-trips a valid state and clamps settings", () => {
    const s = initialState();
    for (const n of ["A", "B", "C", "D"]) addMember(s, n);
    const [a, b, c, d] = s.members.map(m => m.id) as [string, string, string, string];
    s.rounds = [{ matches: [{ a: [a, b], b: [c, d] }], rest: [] }];
    const parsed = parseState(JSON.parse(JSON.stringify({ ...s, courts: 9, index: 5 })));
    expect(parsed?.rounds).toEqual(s.rounds);
    expect(parsed?.courts).toBe(4);
    expect(parsed?.index).toBe(1);
  });
});

describe("load / save / resetAll", () => {
  const memory = (): Storage => {
    const m = new Map<string, string>();
    return {
      get length() { return m.size; },
      clear: () => m.clear(),
      getItem: k => m.get(k) ?? null,
      key: i => [...m.keys()][i] ?? null,
      removeItem: k => { m.delete(k); },
      setItem: (k, v) => { m.set(k, v); },
    };
  };

  it("restores what was saved and starts fresh after resetAll", () => {
    const storage = memory();
    const s = initialState();
    addMember(s, "A");
    s.courts = 2;
    save(s, storage);
    expect(load(storage).members.map(m => m.name)).toEqual(["A"]);
    resetAll(s);
    save(s, storage);
    expect(load(storage)).toEqual(initialState());
  });
});

describe("members", () => {
  it("ignores blank and duplicate names", () => {
    const s = initialState();
    expect(addMember(s, " A ")).toBe(true);
    expect(addMember(s, "A")).toBe(false);
    expect(addMember(s, "  ")).toBe(false);
    expect(s.members.map(m => m.name)).toEqual(["A"]);
  });

  it("archives members that appear in history and restores them by name", () => {
    const s = initialState();
    for (const n of ["A", "B", "C", "D", "E"]) addMember(s, n);
    const [a, b, c, d, e] = s.members.map(m => m.id) as [string, string, string, string, string];
    s.rounds = [{ matches: [{ a: [a, b], b: [c, d] }], rest: [e] }];

    removeMember(s, a);
    expect(s.members.find(m => m.id === a)?.archived).toBe(true);
    expect(activeIds(s)).not.toContain(a);

    addMember(s, "A");
    expect(s.members.filter(m => m.name === "A")).toHaveLength(1);
    expect(activeIds(s)).toContain(a);

    addMember(s, "F");
    const f = s.members.find(m => m.name === "F")!.id;
    removeMember(s, f);
    expect(s.members.some(m => m.id === f)).toBe(false);
  });

  it("starts late joiners and returners level with the least-played member", () => {
    const s = initialState();
    for (const n of ["A", "B", "C", "D", "E"]) addMember(s, n);
    const [a, b, c, d, e] = s.members.map(m => m.id) as [string, string, string, string, string];
    // Two finished rounds plus the round in play (index 2), which is excluded from the count.
    s.rounds = [
      { matches: [{ a: [a, b], b: [c, d] }], rest: [e] },
      { matches: [{ a: [a, e], b: [c, b] }], rest: [d] },
      { matches: [{ a: [a, d], b: [e, b] }], rest: [c] },
    ];
    s.index = 2;

    addMember(s, "F");
    expect(s.members.find(m => m.name === "F")?.credit).toBe(1);

    toggleMember(s, a);
    toggleMember(s, a);
    expect(s.members.find(m => m.id === a)?.credit).toBeUndefined();

    removeMember(s, s.members.find(m => m.name === "F")!.id);
    toggleMember(s, e);
    s.rounds.push({ matches: [{ a: [a, b], b: [c, d] }], rest: [] });
    s.rounds.push({ matches: [{ a: [a, b], b: [c, d] }], rest: [] });
    s.index = 4;
    // Finished rounds 1–4: a 4, b 4, c 3, d 3, e 2 → e returns level with c and d.
    toggleMember(s, e);
    expect(s.members.find(m => m.id === e)?.credit).toBe(1);

    expect(parseState(JSON.parse(JSON.stringify(s)))?.members.find(m => m.id === e)?.credit).toBe(1);
    resetRounds(s);
    expect(s.members.some(m => m.credit)).toBe(false);
  });

  it("removes members saved as resting, keeping the history of those who played", () => {
    const s = initialState();
    for (const n of ["A", "B", "C", "D", "E", "F"]) addMember(s, n);
    const [a, b, c, d, e, f] = s.members.map(m => m.id) as [string, string, string, string, string, string];
    s.rounds = [{ matches: [{ a: [a, b], b: [c, d] }], rest: [e] }];
    s.members.find(m => m.id === e)!.active = false;
    s.members.find(m => m.id === f)!.active = false;
    removeInactive(s);
    expect(s.members.find(m => m.id === e)?.archived).toBe(true);
    expect(s.members.some(m => m.id === f)).toBe(false);
    expect(activeIds(s)).toEqual([a, b, c, d]);
  });

  it("brings a deleted member back with their history when re-added by name", () => {
    const s = initialState();
    for (const n of ["A", "B", "C", "D", "E"]) addMember(s, n);
    const [a, b, c, d, e] = s.members.map(m => m.id) as [string, string, string, string, string];
    s.rounds = [{ matches: [{ a: [a, b], b: [c, d] }], rest: [e] }];
    removeMember(s, e);
    s.rounds.push({ matches: [{ a: [a, c], b: [b, d] }], rest: [] });
    s.index = 2;
    addMember(s, "E");
    expect(s.members.find(m => m.id === e)).toMatchObject({ active: true, credit: 2 });
  });

  it("counts games up to the round on screen, without credit", () => {
    const s = initialState();
    for (const n of ["A", "B", "C", "D", "E"]) addMember(s, n);
    const [a, b, c, d, e] = s.members.map(m => m.id) as [string, string, string, string, string];
    s.rounds = [
      { matches: [{ a: [a, b], b: [c, d] }], rest: [e] },
      { matches: [{ a: [a, e], b: [c, b] }], rest: [d] },
      { matches: [{ a: [a, d], b: [e, b] }], rest: [c] },
    ];
    s.index = 1;
    s.members.find(m => m.id === e)!.credit = 5;
    const g = gamesPlayed(s);
    expect([a, b, c, d, e].map(id => g.get(id) ?? 0)).toEqual([2, 2, 2, 1, 1]);
  });

  it("drops archived members on reset", () => {
    const s = initialState();
    for (const n of ["A", "B", "C", "D"]) addMember(s, n);
    const [a, b, c, d] = s.members.map(m => m.id) as [string, string, string, string];
    s.rounds = [{ matches: [{ a: [a, b], b: [c, d] }], rest: [] }];
    removeMember(s, a);
    resetRounds(s);
    expect(s.rounds).toEqual([]);
    expect(s.members.map(m => m.name)).toEqual(["B", "C", "D"]);
  });
});
