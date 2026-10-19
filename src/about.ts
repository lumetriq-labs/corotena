import "./styles.css";
import "./about.css";
import { enableDebug } from "./debug";
import { watchForUpdates } from "./freshness";
import { enableOffline } from "./offline";
import { isStandalone } from "./platform";
import { byId } from "./ui/dom";

if (isStandalone()) byId("installLink").hidden = true;

watchForUpdates();
enableOffline();
enableDebug();
