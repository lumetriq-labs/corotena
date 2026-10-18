import { tally } from "./core/scheduler";
import { MAX_COURTS, type Member, type MemberId, type Priority, type Round, type Team } from "./core/types";

export interface State {
  version: 1;
  members: Member[];
  courts: number;
  priority: Priority;
  rounds: Round[];
  /** Round shown at the front of the stack. May equal rounds.length while a round can't be generated. */
  index: number;
}

const KEY = "pairloom:v1";

export const initialState = (): State => ({ version: 1, members: [], courts: 1, priority: "rest", rounds: [], index: 0 });

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isStr = (v: unknown): v is string => typeof v === "string";

function parseMember(v: unknown): Member | null {
  if (!isObj(v) || !isStr(v.id) || !isStr(v.name) || typeof v.active !== "boolean") return null;
  const credit = typeof v.credit === "number" && Number.isFinite(v.credit) && v.credit > 0 ? Math.floor(v.credit) : 0;
  return {
    id: v.id, name: v.name, active: v.active,
    ...(v.archived === true ? { archived: true } : {}),
    ...(credit ? { credit } : {}),
  };
}

function parseTeam(v: unknown, ids: Set<MemberId>): Team | null {
  return Array.isArray(v) && v.length === 2 && v.every(p => isStr(p) && ids.has(p)) ? [v[0], v[1]] : null;
}

function parseRound(v: unknown, ids: Set<MemberId>): Round | null {
  if (!isObj(v) || !Array.isArray(v.matches) || !Array.isArray(v.rest)) return null;
  if (!v.rest.every(p => isStr(p) && ids.has(p))) return null;
  const matches = [];
  for (const m of v.matches) {
    if (!isObj(m)) return null;
    const a = parseTeam(m.a, ids), b = parseTeam(m.b, ids);
    if (!a || !b) return null;
    matches.push({ a, b });
  }
  return matches.length ? { matches, rest: v.rest as MemberId[] } : null;
}

/** Returns null when the stored data is missing or doesn't match the expected shape. */
export function parseState(raw: unknown): State | null {
  if (!isObj(raw) || raw.version !== 1 || !Array.isArray(raw.members) || !Array.isArray(raw.rounds)) return null;
  const members = raw.members.map(parseMember);
  if (members.some(m => !m)) return null;
  const ids = new Set(members.map(m => m!.id));
  const rounds = raw.rounds.map(r => parseRound(r, ids));
  if (rounds.some(r => !r)) return null;
  const courts = typeof raw.courts === "number" ? Math.min(MAX_COURTS, Math.max(1, Math.round(raw.courts))) : 1;
  const priority: Priority = raw.priority === "variety" ? "variety" : "rest";
  const index = typeof raw.index === "number" ? Math.min(rounds.length, Math.max(0, Math.floor(raw.index))) : rounds.length;
  return { version: 1, members: members as Member[], courts, priority, rounds: rounds as Round[], index };
}

export function load(storage: Storage = localStorage): State {
  try {
    const raw = storage.getItem(KEY);
    return (raw && parseState(JSON.parse(raw))) || initialState();
  } catch {
    return initialState();
  }
}

export function save(state: State, storage: Storage = localStorage): void {
  try {
    storage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Quota exceeded or storage disabled (e.g. some private modes): keep working in memory.
  }
}

const SWIPED_KEY = "pairloom:swiped";

/** Whether this device has ever advanced a round, so the swipe hint is no longer needed. */
export function hasSwiped(storage: Storage = localStorage): boolean {
  try {
    return storage.getItem(SWIPED_KEY) === "1";
  } catch {
    return false;
  }
}

export function markSwiped(storage: Storage = localStorage): void {
  try {
    storage.setItem(SWIPED_KEY, "1");
  } catch {
    // Storage disabled: the hint simply shows again next time.
  }
}

export function newId(): MemberId {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const roster = (s: State) => s.members.filter(m => !m.archived);
export const activeIds = (s: State) => roster(s).filter(m => m.active).map(m => m.id);

export const credits = (s: State): Map<MemberId, number> =>
  new Map(s.members.filter(m => m.credit).map(m => [m.id, m.credit!]));

const appearsIn = (id: MemberId, rounds: Round[]) =>
  rounds.some(r => r.rest.includes(id) || r.matches.some(m => m.a.includes(id) || m.b.includes(id)));

/** Games each member has been on court for, up to and including the round on screen. Credit isn't included. */
export const gamesPlayed = (s: State): Map<MemberId, number> => tally(s.rounds.slice(0, s.index + 1)).play;

/**
 * Starts a joining or returning member level with the least-played active member, so they
 * play at the normal pace instead of catching up on rounds they weren't there for.
 * Never lowers a count they already have.
 */
function levelUp(s: State, m: Member): void {
  // Every dealt card counts: once shown, a round may already be in play and is never rewritten.
  const played = tally(s.rounds).play;
  const games = (x: Member) => (played.get(x.id) ?? 0) + (x.credit ?? 0);
  const others = roster(s).filter(x => x.active && x.id !== m.id);
  if (!others.length) return;
  const target = Math.min(...others.map(games));
  const credit = Math.max(m.credit ?? 0, target - (played.get(m.id) ?? 0));
  if (credit > 0) m.credit = credit;
}

/** Adds a member, or restores an archived one with the same name so their history carries over. */
export function addMember(s: State, name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed || roster(s).some(m => m.name === trimmed)) return false;
  let m = s.members.find(x => x.archived && x.name === trimmed);
  if (m) {
    delete m.archived;
    m.active = true;
  } else {
    m = { id: newId(), name: trimmed, active: true };
    s.members.push(m);
  }
  levelUp(s, m);
  return true;
}

export function toggleMember(s: State, id: MemberId): void {
  const m = s.members.find(x => x.id === id);
  if (!m) return;
  m.active = !m.active;
  if (m.active) levelUp(s, m);
}

/** Members referenced by past rounds are archived so those cards can still show their names. */
export function removeMember(s: State, id: MemberId): void {
  const m = s.members.find(x => x.id === id);
  if (!m) return;
  if (appearsIn(id, s.rounds)) {
    m.archived = true;
    m.active = false;
  } else {
    s.members = s.members.filter(x => x.id !== id);
  }
}

/** Resting can't be toggled from the UI right now, so members saved as resting would otherwise be stuck. */
export function removeInactive(s: State): void {
  for (const m of roster(s)) if (!m.active) removeMember(s, m.id);
}

/** Back to a fresh start (no members, no rounds, default settings). */
export function resetAll(s: State): void {
  Object.assign(s, initialState());
}

export function resetRounds(s: State): void {
  s.rounds = [];
  s.index = 0;
  s.members = s.members.filter(m => !m.archived);
  for (const m of s.members) delete m.credit;
}
