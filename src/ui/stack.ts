import { pairKey, tally } from "../core/scheduler";
import type { Match, MemberId, Round } from "../core/types";
import { h } from "./dom";

export type Direction = "next" | "back";

export interface StackView {
  rounds: readonly Round[];
  index: number;
  name: (id: MemberId) => string;
}

export interface StackHandlers {
  /** Returns false when the move isn't possible, so the card springs back. */
  commit: (dir: Direction) => boolean;
  jumpTo: (index: number) => void;
  openMembers: () => void;
  /** Cancels the newest round. Only offered on the newest card when it's on top and isn't the first round. */
  cancelLatest: () => void;
}

const PAST_VISIBLE = 3;
const THRESHOLD = 80;
const ANIMATION_MS = 400;
const NARROW_COURT_PX = 160;

// Slot 0 is the topmost strip; the current card always sits in the bottom slot.
const slotY = (depth: number) => `calc(var(--strip) * ${PAST_VISIBLE - depth})`;
const belowY = `calc(${slotY(0)} + 110%)`;

// Older cards recede: smaller and fainter. (A CSS filter here would break the card's backdrop-filter glass.)
function setPose(el: HTMLElement, depth: number) {
  el.style.transform = `translateY(${slotY(depth)}) scale(${1 - depth * 0.07})`;
  el.style.opacity = String(Math.max(0, 1 - depth * 0.2));
}

// Upward drag is damped so the card visibly "pushes" into the strips without covering them.
const drag = (el: HTMLElement, dy: number) => {
  el.style.transform = `translateY(calc(${slotY(0)} + ${dy < 0 ? dy * 0.6 : dy}px))`;
};

function settle(el: HTMLElement) {
  el.classList.remove("dragging");
  el.style.transform = `translateY(${slotY(0)})`;
}

const LINES = ["single-l", "single-r", "svc-t", "svc-b", "center", "mark-t", "mark-b"];

function courtEl(m: Match, view: StackView, pastPairs: Map<string, number>): HTMLElement {
  const player = (p: MemberId, mate: MemberId, pos: string, team: "a" | "b") => {
    const again = (pastPairs.get(pairKey(p, mate)) ?? 0) > 0;
    const el = h("div", `player ${team} ${pos}${again ? " again" : ""}`, view.name(p));
    el.title = view.name(p);
    return el;
  };
  return h("div", "court",
    h("div", "court-in",
      ...LINES.map(l => h("div", `ln ${l}`)),
      h("div", "net"),
      player(m.a[0], m.a[1], "p-a1", "a"), player(m.a[1], m.a[0], "p-a2", "a"),
      player(m.b[0], m.b[1], "p-b1", "b"), player(m.b[1], m.b[0], "p-b2", "b")));
}

function fillCard(el: HTMLElement, view: StackView, i: number, onCancel: () => void) {
  const round = view.rounds[i]!;
  const history = view.rounds.slice(0, i);
  const prevRest = new Set(history[history.length - 1]?.rest ?? []);
  const strip = h("div", "strip", h("div", "no", String(i + 1), h("small", "", "試合目")));
  if (round.rest.length) {
    const list = h("div", "rest-list", ...round.rest.map(p => h("span", prevRest.has(p) ? "warn" : "", view.name(p))));
    const fade = () => list.classList.toggle("more", list.scrollLeft + list.clientWidth < list.scrollWidth - 1);
    list.addEventListener("scroll", fade, { passive: true });
    requestAnimationFrame(fade);
    strip.append(h("div", "rest", "🪑", list));
  }
  const cancel = h("button", "cancel", "✕") as HTMLButtonElement;
  cancel.type = "button";
  cancel.setAttribute("aria-label", `${i + 1}試合目の組み合わせを取り消す`);
  cancel.addEventListener("click", () => { if (el.classList.contains("cancellable")) onCancel(); });
  strip.append(cancel);
  const pastPairs = tally(history).pair;
  el.replaceChildren(strip, h("div", "courts", ...round.matches.map(m => courtEl(m, view, pastPairs))));
}

// pointerup arrives before touchend. If a button (the ✕) appears while iOS still counts the touch as ongoing,
// iOS Safari drops the next tap elsewhere, so cards are redrawn only once the touch has fully ended.
function afterTouchEnds(fn: () => void) {
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    window.removeEventListener("touchend", run, true);
    window.removeEventListener("touchcancel", run, true);
    clearTimeout(fallback);
    setTimeout(fn);
  };
  window.addEventListener("touchend", run, { capture: true, passive: true });
  window.addEventListener("touchcancel", run, { capture: true, passive: true });
  const fallback = setTimeout(run, 300);
}

export function createStack(stack: HTMLElement, handlers: StackHandlers) {
  const cards = new Map<number, { el: HTMLElement; round: Round }>();
  let view: StackView = { rounds: [], index: 0, name: id => id };
  let animating = false;
  let empty: HTMLElement | null = null;

  const lockAnimation = () => {
    animating = true;
    setTimeout(() => { animating = false; }, ANIMATION_MS);
  };

  const commit = (dir: Direction) => {
    if (animating || !handlers.commit(dir)) return false;
    lockAnimation();
    return true;
  };

  function removeCard(i: number, el: HTMLElement, downward: boolean) {
    cards.delete(i);
    el.classList.remove("dragging", "top");
    if (downward) el.style.transform = `translateY(${belowY})`;
    else setPose(el, PAST_VISIBLE + 1);
    el.style.opacity = "0";
    setTimeout(() => el.remove(), ANIMATION_MS + 20);
  }

  function attachPointerSwipe(el: HTMLElement, i: number) {
    let startY = 0, dy = 0, active = false;
    el.addEventListener("pointerdown", e => {
      if (animating || e.button !== 0) return;
      if ((e.target as HTMLElement).closest(".cancel") && el.classList.contains("cancellable")) return;
      if (!el.classList.contains("top")) {
        if (i < view.index) { lockAnimation(); handlers.jumpTo(i); }
        return;
      }
      active = true; startY = e.clientY; dy = 0;
      el.classList.add("dragging");
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener("pointermove", e => {
      if (!active) return;
      dy = e.clientY - startY;
      drag(el, dy);
    });
    const end = (e: PointerEvent) => {
      if (!active) return;
      active = false;
      const moved = dy;
      const finish = () => { if (Math.abs(moved) <= THRESHOLD || !commit(moved < 0 ? "next" : "back")) settle(el); };
      if (e.type === "pointerup" && e.pointerType === "touch") afterTouchEnds(finish);
      else finish();
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  }

  // Trackpad two-finger swipe / mouse wheel arrive as wheel events (deltaY > 0 = swipe up with natural scrolling).
  let wheelDy = 0, wheelLocked = false;
  let wheelIdle: ReturnType<typeof setTimeout> | undefined;
  let wheelLockTimer: ReturnType<typeof setTimeout> | undefined;
  const lockWheel = () => {
    wheelLocked = true;
    clearTimeout(wheelLockTimer);
    wheelLockTimer = setTimeout(() => { wheelLocked = false; }, 250);
  };
  stack.addEventListener("wheel", e => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    e.preventDefault();
    // Inertial scrolling keeps firing after a commit; ignore until the gesture fully stops.
    if (wheelLocked) { lockWheel(); return; }
    const el = cards.get(view.index)?.el;
    if (!el || animating) return;
    el.classList.add("dragging");
    wheelDy -= e.deltaY;
    drag(el, wheelDy);
    clearTimeout(wheelIdle);
    if (Math.abs(wheelDy) > THRESHOLD) {
      const dir = wheelDy < 0 ? "next" : "back";
      wheelDy = 0;
      lockWheel();
      if (!commit(dir)) settle(el);
      return;
    }
    wheelIdle = setTimeout(() => { wheelDy = 0; settle(el); }, 140);
  }, { passive: false });

  // 3–4 courts wrap into 2 columns on narrow screens so names stay readable.
  function layoutCourts() {
    const top = cards.get(view.index);
    const n = top?.round.matches.length ?? 1;
    const cols = n >= 3 && window.innerWidth < 900 ? 2 : n;
    document.body.dataset.cols = String(cols);
    stack.style.setProperty("--cols", String(cols));
    stack.style.setProperty("--rows", String(Math.ceil(n / cols)));
    stack.classList.remove("narrow");
    const courts = [...(top?.el.querySelectorAll<HTMLElement>(".court") ?? [])];
    const narrow = courts.some(c => c.getBoundingClientRect().width < NARROW_COURT_PX || crowded(c));
    stack.classList.toggle("narrow", narrow);
  }

  // Side-by-side partners collide (or get cut off) once names outgrow half the court.
  function crowded(court: HTMLElement): boolean {
    const players = [...court.querySelectorAll<HTMLElement>(".player")];
    if (players.some(p => p.scrollWidth > p.clientWidth + 1)) return true;
    const [a1, a2, b1, b2] = players.map(p => p.getBoundingClientRect());
    return !!a1 && !!a2 && !!b1 && !!b2 && (a1.right + 4 > a2.left || b1.right + 4 > b2.left);
  }
  window.addEventListener("resize", layoutCourts);

  function render(next: StackView, { enter = false } = {}) {
    view = next;
    const from = Math.max(0, view.index - PAST_VISIBLE);
    const to = Math.min(view.index, view.rounds.length - 1);
    for (const [i, { el }] of cards) if (i < from || i > to) removeCard(i, el, i >= view.index);

    for (let i = from; i <= to; i++) {
      const depth = view.index - i;
      let card = cards.get(i);
      const isNew = !card;
      if (!card) {
        const el = h("div", "card glass");
        attachPointerSwipe(el, i);
        stack.append(el);
        card = { el, round: view.rounds[i]! };
        cards.set(i, card);
        fillCard(el, view, i, handlers.cancelLatest);
      } else if (card.round !== view.rounds[i]) {
        card.round = view.rounds[i]!;
        fillCard(card.el, view, i, handlers.cancelLatest);
        card.el.classList.remove("swap");
        void card.el.offsetWidth;
        card.el.classList.add("swap");
      }
      const { el } = card;
      el.classList.toggle("top", depth === 0);
      el.classList.toggle("cancellable", depth === 0 && i > 0 && i === view.rounds.length - 1);
      el.style.zIndex = String(100 + i);
      if (isNew) {
        el.classList.add("dragging");
        if (enter && depth === 0) el.style.transform = `translateY(${belowY})`;
        else { setPose(el, depth + 1); el.style.opacity = "0"; }
        void el.offsetWidth;
      }
      el.classList.remove("dragging");
      setPose(el, depth);
    }

    const hasTop = cards.has(view.index);
    if (!hasTop && !empty) {
      empty = h("button", "empty glass", h("div", "", h("span", "", "👥"), "4人以上"));
      empty.addEventListener("click", handlers.openMembers);
      stack.append(empty);
    } else if (hasTop && empty) {
      empty.remove();
      empty = null;
    }
    layoutCourts();
  }

  const HINT_MS = 2600;
  /**
   * Briefly shows a message; disappears on the first touch or after a few seconds. Replaces one already showing.
   * `then` runs only if it ran its full time, so a follow-up never interrupts someone already using the cards.
   */
  function hint(text: string, { hand = true, then }: { hand?: boolean; then?: () => void } = {}) {
    stack.querySelector(".hint")?.remove();
    const el = hand ? h("div", "hint glass", h("span", "hint-hand", "👆"), text) : h("div", "hint glass", text);
    el.setAttribute("role", "status");
    stack.append(el);
    const dismiss = (timedOut: boolean) => {
      clearTimeout(timer);
      stack.removeEventListener("pointerdown", touched);
      stack.removeEventListener("wheel", touched);
      el.classList.add("out");
      setTimeout(() => {
        const replaced = !el.isConnected;
        el.remove();
        if (timedOut && !replaced) then?.();
      }, 400);
    };
    const touched = () => dismiss(false);
    const timer = setTimeout(() => dismiss(true), HINT_MS);
    stack.addEventListener("pointerdown", touched);
    stack.addEventListener("wheel", touched, { passive: true });
  }

  return { render, commit, hint, isAnimating: () => animating };
}
