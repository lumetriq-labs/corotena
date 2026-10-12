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
  return { id: v.id, name: v.name, active: v.active, ...(v.archived === true ? { archived: true } : {}) };
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

export function newId(): MemberId {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const roster = (s: State) => s.members.filter(m => !m.archived);
export const activeIds = (s: State) => roster(s).filter(m => m.active).map(m => m.id);

const appearsIn = (id: MemberId, rounds: Round[]) =>
  rounds.some(r => r.rest.includes(id) || r.matches.some(m => m.a.includes(id) || m.b.includes(id)));

/** Adds a member, or restores an archived one with the same name so their history carries over. */
export function addMember(s: State, name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed || roster(s).some(m => m.name === trimmed)) return false;
  const archived = s.members.find(m => m.archived && m.name === trimmed);
  if (archived) {
    delete archived.archived;
    archived.active = true;
  } else {
    s.members.push({ id: newId(), name: trimmed, active: true });
  }
  return true;
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

/** Back to a fresh start (no members, no rounds, default settings). */
export function resetAll(s: State): void {
  Object.assign(s, initialState());
}

export function resetRounds(s: State): void {
  s.rounds = [];
  s.index = 0;
  s.members = s.members.filter(m => !m.archived);
}
