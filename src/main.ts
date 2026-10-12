import "./styles.css";
import { generateRound } from "./core/scheduler";
import type { Priority } from "./core/types";
import { watchForUpdates } from "./freshness";
import { activeIds, addMember, load, removeMember, resetAll, resetRounds, roster, save } from "./store";
import { byId } from "./ui/dom";
import { createMembersSheet } from "./ui/members";
import { createStack, type Direction } from "./ui/stack";

const state = load();

function ensureCurrent() {
  if (state.rounds.length > state.index) return;
  const r = generateRound(activeIds(state), state.rounds, { courts: state.courts, priority: state.priority });
  if (r) state.rounds.push(r);
}

/** Replaces the current round (and any rounds after it) with a fresh one. */
function regenerateFromCurrent() {
  state.rounds = state.rounds.slice(0, state.index);
  ensureCurrent();
  render();
}

const names = () => new Map(state.members.map(m => [m.id, m.name]));

const stack = createStack(byId("stack"), {
  commit(dir: Direction) {
    if (dir === "back") {
      if (state.index === 0) return false;
      state.index--;
      render();
    } else {
      if (!state.rounds[state.index]) return false;
      state.index++;
      ensureCurrent();
      render({ enter: true });
    }
    return true;
  },
  jumpTo(i) {
    state.index = i;
    render();
  },
  openMembers: () => sheet.open(),
});

const sheet = createMembersSheet({
  view: () => ({ members: roster(state), courts: state.courts, hasRounds: state.rounds.length > 0 }),
  toggle(id) {
    const m = state.members.find(x => x.id === id);
    if (m) m.active = !m.active;
  },
  remove: id => removeMember(state, id),
  add: name => addMember(state, name),
  setCourts(n) { state.courts = n; },
  reset() {
    resetRounds(state);
    ensureCurrent();
    render();
  },
  clearAll() {
    resetAll(state);
    render();
  },
  changed: regenerateFromCurrent,
});

function render(opts: { enter?: boolean } = {}) {
  const lookup = names();
  stack.render({ rounds: state.rounds, index: state.index, name: id => lookup.get(id) ?? "?" }, opts);
  byId("memberCount").textContent = String(activeIds(state).length);
  byId<HTMLButtonElement>("reshuffleBtn").disabled = !state.rounds[state.index];
  for (const b of byId("priority").querySelectorAll<HTMLButtonElement>("button[data-p]")) {
    b.setAttribute("aria-checked", String(b.dataset.p === state.priority));
  }
  save(state);
}

byId("priority").addEventListener("click", e => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-p]");
  const p = b?.dataset.p as Priority | undefined;
  if (!p || p === state.priority) return;
  state.priority = p;
  regenerateFromCurrent();
});
byId("reshuffleBtn").addEventListener("click", regenerateFromCurrent);
byId("openMembers").addEventListener("click", () => sheet.open());

document.addEventListener("keydown", e => {
  if (sheet.isOpen()) return;
  if (e.key === "ArrowDown") { e.preventDefault(); stack.commit("next"); }
  if (e.key === "ArrowUp") { e.preventDefault(); stack.commit("back"); }
});

ensureCurrent();
render();
watchForUpdates();
