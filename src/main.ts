import "./styles.css";
import { generateRound } from "./core/scheduler";
import type { Priority } from "./core/types";
import { watchForUpdates } from "./freshness";
import { activeIds, addMember, hasSwiped, load, markSwiped, removeMember, resetAll, resetRounds, roster, save } from "./store";
import { byId } from "./ui/dom";
import { createMembersSheet } from "./ui/members";
import { createStack, type Direction } from "./ui/stack";

const state = load();

function ensureCurrent() {
  if (state.rounds.length > state.index) return;
  const r = generateRound(activeIds(state), state.rounds, { courts: state.courts, priority: state.priority });
  if (r) state.rounds.push(r);
}

/**
 * Rebuilds only the round still in play (the newest one) and shows it.
 * Earlier rounds have been played and are never rewritten.
 */
function regenerateLatest() {
  const live = Math.max(state.index, state.rounds.length - 1);
  state.rounds = state.rounds.slice(0, live);
  state.index = live;
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
      markSwiped();
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
  changed: regenerateLatest,
  // Wait for the sheet to slide away so the hint isn't spent behind it.
  closed: () => setTimeout(() => showHint({ always: true }), 350),
});

function render(opts: { enter?: boolean } = {}) {
  const lookup = names();
  stack.render({ rounds: state.rounds, index: state.index, name: id => lookup.get(id) ?? "?" }, opts);
  byId("memberCount").textContent = String(activeIds(state).length);
  for (const b of byId("priority").querySelectorAll<HTMLButtonElement>("button[data-p]")) {
    b.setAttribute("aria-checked", String(b.dataset.p === state.priority));
  }
  save(state);
}

/** On launch the hint is only for first-timers; after editing members it's shown every time. */
function showHint({ always = false } = {}) {
  if ((!always && hasSwiped()) || !state.rounds[state.index] || sheet.isOpen()) return;
  stack.hint(matchMedia("(pointer: coarse)").matches ? "上にスワイプで次の試合" : "スクロールで次の試合");
}

byId("priority").addEventListener("click", e => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-p]");
  const p = b?.dataset.p as Priority | undefined;
  if (!p || p === state.priority) return;
  state.priority = p;
  regenerateLatest();
});
byId("openMembers").addEventListener("click", () => sheet.open());

document.addEventListener("keydown", e => {
  if (sheet.isOpen()) return;
  if (e.key === "ArrowDown") { e.preventDefault(); stack.commit("next"); }
  if (e.key === "ArrowUp") { e.preventDefault(); stack.commit("back"); }
});

ensureCurrent();
render();
showHint();
watchForUpdates();
