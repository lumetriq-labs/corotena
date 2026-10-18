import type { Member, MemberId } from "../core/types";
import { byId, h } from "./dom";

export interface MembersView {
  members: readonly Member[];
  games: ReadonlyMap<MemberId, number>;
  courts: number;
  hasRounds: boolean;
  /** Number of the newest round when it can be cancelled (not the first round), otherwise null. */
  cancellable: number | null;
}

export interface MembersHandlers {
  view: () => MembersView;
  remove: (id: MemberId) => void;
  add: (name: string) => boolean;
  setCourts: (n: number) => void;
  reset: () => void;
  /** Drops the newest round. The confirmation has already been given. */
  cancelLatest: () => void;
  clearAll: () => void;
  /** Called on close only if something changed while the sheet was open. */
  changed: () => void;
  /** Called on every close, after `changed`. */
  closed: () => void;
}

export function createMembersSheet(handlers: MembersHandlers) {
  const sheet = byId("sheet"), bg = byId("sheetBg"), chips = byId("chips");
  const input = byId<HTMLInputElement>("addInput"), resetBtn = byId<HTMLButtonElement>("resetBtn");
  const clearBtn = byId<HTMLButtonElement>("clearBtn"), undoBtn = byId<HTMLButtonElement>("undoBtn");
  let dirty = false;

  function render() {
    const v = handlers.view();
    chips.replaceChildren(...v.members.map(m => {
      const x = h("button", "x", "✕") as HTMLButtonElement;
      x.type = "button";
      x.dataset.del = m.id;
      x.setAttribute("aria-label", `${m.name}を削除`);
      const games = h("span", "games", String(v.games.get(m.id) ?? 0));
      games.setAttribute("aria-label", `${v.games.get(m.id) ?? 0}試合`);
      return h("span", "chip", m.name, games, x);
    }));
    for (const b of byId("courtSeg").querySelectorAll<HTMLButtonElement>("button")) {
      b.classList.toggle("on", Number(b.dataset.v) === v.courts);
    }
    resetBtn.hidden = !v.hasRounds;
    undoBtn.hidden = v.cancellable === null;
    undoBtn.textContent = `↶ ${v.cancellable ?? ""}試合目を取り消す`;
    clearBtn.hidden = !v.hasRounds && v.members.length === 0;
  }

  const mutate = (fn: () => void) => { fn(); dirty = true; render(); };

  function open() {
    dirty = false;
    render();
    sheet.classList.add("open");
    bg.classList.add("open");
  }

  function close() {
    if (!isOpen()) return;
    sheet.classList.remove("open");
    bg.classList.remove("open");
    input.blur();
    if (dirty) handlers.changed();
    handlers.closed();
  }

  const isOpen = () => sheet.classList.contains("open");

  chips.addEventListener("click", e => {
    const target = e.target as HTMLElement;
    const del = target.closest<HTMLElement>("[data-del]");
    if (del) mutate(() => handlers.remove(del.dataset.del!));
  });

  byId("addForm").addEventListener("submit", e => {
    e.preventDefault();
    if (!handlers.add(input.value)) return;
    input.value = "";
    dirty = true;
    render();
  });

  byId("courtSeg").addEventListener("click", e => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-v]");
    if (b) mutate(() => handlers.setCourts(Number(b.dataset.v)));
  });

  // Closes the sheet so the card the stack falls back to is in view.
  undoBtn.addEventListener("click", () => {
    const n = handlers.view().cancellable;
    if (n === null || !confirm(`${n}試合目の組み合わせを取り消しますか？`)) return;
    handlers.cancelLatest();
    close();
  });

  resetBtn.addEventListener("click", () => {
    if (!confirm("試合の履歴を消して1試合目からやり直しますか？")) return;
    handlers.reset();
    dirty = false;
    render();
  });

  // Stays open so the next group can be entered right away.
  clearBtn.addEventListener("click", () => {
    if (!confirm("メンバーと試合の記録をすべて消しますか？元に戻せません。")) return;
    handlers.clearAll();
    dirty = false;
    render();
    input.focus();
  });

  bg.addEventListener("click", close);
  document.addEventListener("keydown", e => { if (e.key === "Escape") close(); });

  return { open, close, isOpen };
}
