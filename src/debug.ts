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
type Tap = { from: string; down?: number; click?: number; hide?: number; trace?: string[] } | null;

function takeTap(): Tap {
  try {
    const tap = JSON.parse(sessionStorage.getItem(TAP) ?? "null") as Tap;
    sessionStorage.removeItem(TAP);
    return tap;
  } catch {
    return null;
  }
}

let firstFrame: number | undefined;

function navigationReport(tap: Tap): string[] {
  const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  const start = performance.timeOrigin;
  const ms = (v: number | undefined) => (v === undefined || !Number.isFinite(v) ? "-" : String(Math.round(v)));
  const fcp = performance.getEntriesByName("first-contentful-paint")[0]?.startTime;
  const lines = [`page ${location.pathname.split("/").pop() || "/"} sw=${navigator.serviceWorker?.controller ? "yes" : "no"} type=${nav?.type ?? "-"}`];
  if (tap?.click) {
    lines.push(`tap from ${tap.from}: down→click ${ms(tap.down && tap.click - tap.down)} click→leave ${ms(tap.hide && tap.hide - tap.click)} click→navStart ${ms(start - tap.click)}`);
    if (tap.trace?.length) lines.push(`prev page after click (ms): ${tap.trace.join(" | ")}`);
  }
  if (nav) {
    lines.push(`navStart→ worker ${ms(nav.workerStart)} fetch ${ms(nav.fetchStart)} resStart ${ms(nav.responseStart)} resEnd ${ms(nav.responseEnd)}`);
    lines.push(`navStart→ domInteractive ${ms(nav.domInteractive)} dcl ${ms(nav.domContentLoadedEventEnd)} load ${ms(nav.loadEventEnd || undefined)} frame ${ms(firstFrame)} fcp ${ms(fcp)}`);
  }
  // Each file the page pulled in: start → served by the worker → done.
  for (const r of performance.getEntriesByType("resource") as PerformanceResourceTiming[]) {
    lines.push(`  ${r.name.split("/").pop()?.slice(0, 28)} ${ms(r.startTime)}→${ms(r.workerStart || undefined)}→${ms(r.responseEnd)}`);
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
  // After a link tap, everything this page still does (frames drawn, events) is kept for the next page to show.
  let clickAt = 0;
  let trace: string[] = [];
  const note = (what: string) => {
    if (!clickAt || trace.length >= 60) return;
    trace.push(`+${Date.now() - clickAt} ${what}`);
    save({ trace });
  };
  window.addEventListener("click", e => {
    if (!(e.target as Element).closest?.("a[href]")) return;
    clickAt = Date.now();
    trace = [];
    save({ from, click: clickAt, trace });
    const frame = () => {
      note("frame");
      if (Date.now() - clickAt < 5000) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }, { capture: true, passive: true });
  for (const type of [...TYPES, "blur", "scroll"]) {
    window.addEventListener(type, e => note(`${type} ${describe(e.target)}`), { capture: true, passive: true });
  }
  document.addEventListener("visibilitychange", () => note(`visibility=${document.visibilityState}`));
  document.addEventListener("freeze", () => note("freeze"));
  window.addEventListener("pagehide", e => {
    note(`pagehide persisted=${e.persisted}`);
    save({ hide: Date.now() });
  });
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
  const refresh = () => {
    report.splice(0, report.length, ...navigationReport(tap));
    panel.textContent = [...report, ...lines].join("\n");
  };
  // The second frame callback runs once the first frame has been put on screen.
  requestAnimationFrame(() => requestAnimationFrame(() => { firstFrame = performance.now(); refresh(); }));
  addEventListener("load", () => setTimeout(refresh, 0));
  setTimeout(refresh, 5000);
  for (const type of TYPES) window.addEventListener(type, log, { capture: true, passive: true });
}
