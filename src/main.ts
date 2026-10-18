import "./styles.css";
import { generateRound } from "./core/scheduler";
import type { Priority } from "./core/types";
import { watchForUpdates } from "./freshness";
import { enableOffline } from "./offline";
import {
  activeIds, addMember, credits, gamesPlayed, hasSwiped, load, markSwiped, removeInactive, removeMember, resetAll, resetRounds, roster, save,
} from "./store";
import { byId } from "./ui/dom";
import { createMembersSheet } from "./ui/members";
import { createStack, type Direction } from "./ui/stack";

const state = load();
removeInactive(state);

function ensureCurrent() {
  if (state.rounds.length > state.index) return;
  const r = generateRound(activeIds(state), state.rounds, {
    courts: state.courts, priority: state.priority, credit: credits(state),
  });
  if (r) state.rounds.push(r);
}

const NEXT_ROUND_NOTICE = "変更は次の試合から反映されます";

/**
 * Settings and member changes only shape rounds dealt from now on: a card on screen may already be in play.
 * Returns true when a card is on screen, i.e. the change is deferred to the next round.
 */
function applySettings(): boolean {
  const deferred = !!state.rounds[state.index];
  ensureCurrent();
  render();
  return deferred;
}

function cancelLatest() {
  if (!confirm("この組み合わせを取り消しますか？")) return;
  state.rounds.pop();
  state.index = state.rounds.length - 1;
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
  cancelLatest,
});

let noticePending = false;

const sheet = createMembersSheet({
  view: () => ({
    members: roster(state), games: gamesPlayed(state), courts: state.courts, hasRounds: state.rounds.length > 0,
  }),
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
  changed() { noticePending = applySettings(); },
  // Wait for the sheet to slide away so the message isn't spent behind it.
  closed() {
    const notice = noticePending;
    noticePending = false;
    setTimeout(() => (notice ? stack.hint(NEXT_ROUND_NOTICE, { hand: false }) : showHint({ always: true })), 350);
  },
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
  if (applySettings()) stack.hint(NEXT_ROUND_NOTICE, { hand: false });
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
enableOffline();
