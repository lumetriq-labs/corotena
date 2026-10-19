/**
 * On-screen event log and page-load timings for diagnosing problems on real devices, enabled with `?debug=1`.
 * The panel ignores touches so it never becomes the target it is reporting on.
 */
const TYPES = ["touchstart", "touchend", "touchcancel", "pointerdown", "pointerup", "pointercancel",
  "mouseover", "mousemove", "mousedown", "mouseup", "click", "focusin"] as const;
const MAX_LINES = 18;

function describe(t: EventTarget | null): string {
  if (!(t instanceof Element)) return String(t);
  const cls = [...t.classList].slice(0, 3).join(".");
  return `${t.tagName.toLowerCase()}${t.id ? `#${t.id}` : ""}${cls ? `.${cls}` : ""}`;
}

const FLAG = "corotena:debug";
const TAP = "corotena:debug:tap";

/** `?debug=1` turns it on for the rest of the tab's session (so it follows links); `?debug=0` turns it off. */
function debugOn(): boolean {
  const q = new URLSearchParams(location.search).get("debug");
  try {
    if (q === "0") sessionStorage.removeItem(FLAG);
    else if (q !== null) sessionStorage.setItem(FLAG, "1");
    return sessionStorage.getItem(FLAG) === "1";
  } catch {
    return q !== null && q !== "0";
  }
}

/** Times, in ms, from the link tap on the previous page to each stage of loading this one. */
type Tap = { from: string; down?: number; click?: number; hide?: number } | null;

function takeTap(): Tap {
  try {
    const tap = JSON.parse(sessionStorage.getItem(TAP) ?? "null") as Tap;
    sessionStorage.removeItem(TAP);
    return tap;
  } catch {
    return null;
  }
}

function navigationReport(tap: Tap): string[] {
  const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  const start = performance.timeOrigin;
  const ms = (v: number | undefined) => (v === undefined || !Number.isFinite(v) ? "-" : String(Math.round(v)));
  const fcp = performance.getEntriesByName("first-contentful-paint")[0]?.startTime;
  const lines = [`page ${location.pathname.split("/").pop() || "/"} sw=${navigator.serviceWorker?.controller ? "yes" : "no"} type=${nav?.type ?? "-"}`];
  if (tap?.click) {
    lines.push(`tap from ${tap.from}: down→click ${ms(tap.down && tap.click - tap.down)} click→leave ${ms(tap.hide && tap.hide - tap.click)} click→navStart ${ms(start - tap.click)}`);
  }
  if (nav) {
    lines.push(`navStart→ worker ${ms(nav.workerStart)} fetch ${ms(nav.fetchStart)} resStart ${ms(nav.responseStart)} resEnd ${ms(nav.responseEnd)}`);
    lines.push(`navStart→ domInteractive ${ms(nav.domInteractive)} dcl ${ms(nav.domContentLoadedEventEnd)} fcp ${ms(fcp)}`);
  }
  return lines;
}

function recordLinkTaps() {
  const save = (patch: object) => {
    try {
      const prev = JSON.parse(sessionStorage.getItem(TAP) ?? "{}");
      sessionStorage.setItem(TAP, JSON.stringify({ ...prev, ...patch }));
    } catch { /* storage unavailable */ }
  };
  const from = location.pathname.split("/").pop() || "/";
  window.addEventListener("pointerdown", e => {
    if ((e.target as Element).closest?.("a[href]")) save({ from, down: Date.now(), click: undefined, hide: undefined });
  }, { capture: true, passive: true });
  window.addEventListener("click", e => {
    if ((e.target as Element).closest?.("a[href]")) save({ from, click: Date.now() });
  }, { capture: true, passive: true });
  window.addEventListener("pagehide", () => save({ hide: Date.now() }));
}

export function enableDebug() {
  if (!debugOn()) return;
  const tap = takeTap();
  recordLinkTaps();
  const report = navigationReport(tap);
  const panel = document.createElement("pre");
  panel.id = "debugLog";
  panel.style.cssText = "position:fixed;left:4px;right:4px;bottom:4px;z-index:9999;margin:0;padding:6px;"
    + "max-height:42vh;overflow:hidden;pointer-events:none;background:rgba(0,0,0,.72);color:#fff;"
    + "font:10px/1.35 ui-monospace,Menlo,monospace;white-space:pre-wrap;border-radius:8px;";
  document.body.append(panel);

  const t0 = performance.now();
  const lines: string[] = [];
  let mutations = 0;
  new MutationObserver(list => { mutations += list.filter(r => !panel.contains(r.target)).length; })
    .observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "style", "hidden"] });

  let lastMove = 0;
  const log = (e: Event) => {
    if (e.type === "mousemove") {
      if (performance.now() - lastMove < 100) return;
      lastMove = performance.now();
    }
    const top = document.querySelector(".card.top");
    const state = `${top?.classList.contains("cancellable") ? "✕" : "-"} dom+${mutations}`;
    mutations = 0;
    lines.push(`${((performance.now() - t0) / 1000).toFixed(2)} ${e.type} ${describe(e.target)} `
      + `act=${describe(document.activeElement)} ${state}`);
    if (lines.length > MAX_LINES) lines.shift();
    panel.textContent = [...report, ...lines].join("\n");
  };
  panel.textContent = report.join("\n");
  // Paint and load timings land after this script runs.
  addEventListener("load", () => setTimeout(() => {
    report.splice(0, report.length, ...navigationReport(tap));
    panel.textContent = [...report, ...lines].join("\n");
  }, 0));
  for (const type of TYPES) window.addEventListener(type, log, { capture: true, passive: true });
}
