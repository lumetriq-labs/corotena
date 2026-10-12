import "./styles.css";
import "./about.css";
import { watchForUpdates } from "./freshness";
import { clear } from "./store";
import { byId } from "./ui/dom";

byId("clearData").addEventListener("click", () => {
  if (!confirm("メンバー・試合の記録・設定をすべて消します。元に戻せません。よろしいですか？")) return;
  clear();
  location.href = "./";
});

watchForUpdates();
