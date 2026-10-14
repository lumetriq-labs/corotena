import "./styles.css";
import "./about.css";
import { watchForUpdates } from "./freshness";
import { enableOffline } from "./offline";

watchForUpdates();
enableOffline();
