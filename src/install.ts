import "./styles.css";
import "./about.css";
import { watchForUpdates } from "./freshness";
import { enableOffline } from "./offline";
import { isIOS, isStandalone } from "./platform";
import { byId } from "./ui/dom";

/** Chromium-only, non-standard: https://developer.mozilla.org/docs/Web/API/BeforeInstallPromptEvent */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<unknown>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const main = byId("installMain"), android = byId("android"), ios = byId("ios");
const button = byId<HTMLButtonElement>("installBtn");

const showInstalled = (text: string) => {
  const box = byId("installed");
  box.querySelector("p")!.textContent = text;
  box.hidden = false;
};

if (isIOS()) main.insertBefore(ios, android);
if (isStandalone()) showInstalled("いまはホーム画面から開いています。");

// The browser only offers this when the app can be installed and isn't yet; it can be used once.
let deferred: BeforeInstallPromptEvent | null = null;
addEventListener("beforeinstallprompt", e => {
  e.preventDefault();
  deferred = e as BeforeInstallPromptEvent;
  button.hidden = false;
});
button.addEventListener("click", async () => {
  if (!deferred) return;
  const prompt = deferred;
  deferred = null;
  button.hidden = true;
  await prompt.prompt();
});
addEventListener("appinstalled", () => {
  deferred = null;
  button.hidden = true;
  showInstalled("ホーム画面のアイコンから開けます。");
});

watchForUpdates();
enableOffline();
