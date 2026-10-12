export const byId = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el as T;
};

/** Creates an element; string children become text nodes, so user-provided names are never parsed as HTML. */
export function h(tag: string, className = "", ...children: (Node | string)[]): HTMLElement {
  const el = document.createElement(tag);
  if (className) el.className = className;
  el.append(...children);
  return el;
}
