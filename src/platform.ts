/** Opened from the home screen (installed), rather than in a browser tab. */
export const isStandalone = (): boolean =>
  matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** iPhone/iPad. iPadOS reports itself as a Mac, so touch support tells them apart. */
export const isIOS = (): boolean =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
