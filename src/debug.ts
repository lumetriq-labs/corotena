/**
 * On-screen event log for diagnosing touch problems on real devices, enabled with `?debug=1`.
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

export function enableDebug() {
  if (!new URLSearchParams(location.search).has("debug")) return;
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
    panel.textContent = lines.join("\n");
  };
  for (const type of TYPES) window.addEventListener(type, log, { capture: true, passive: true });
}
