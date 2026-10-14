/** Registers the service worker that keeps the app usable without a connection (production builds only). */
export function enableOffline(): void {
  if (import.meta.env.DEV || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("./sw.js").catch(() => {
    // Unsupported or blocked (e.g. some private modes): the app still works online.
  });
}
