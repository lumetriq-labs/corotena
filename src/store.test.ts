import { describe, expect, it } from "vitest";
import { activeIds, addMember, initialState, parseState, removeMember, resetRounds } from "./store";

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
