// Browser smoke check against a running dev/preview server.
// Usage: npm run preview -- --port 4173 & URL=http://localhost:4173/ node scripts/check.mjs
import { chromium } from "playwright-core";
import fs from "node:fs";

const URL = process.env.URL ?? "http://localhost:4173/";
const OUT = process.env.OUT ?? `screenshots/${new Date().toISOString().slice(0, 10)}`;
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const NAMES = ["たろう", "はなこ", "けんた", "ゆうき", "さくら", "りょう", "みき", "<b>x</b>"];
fs.mkdirSync(OUT, { recursive: true });

let failures = 0;
const expect = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
};

const metrics = () => {
  const top = document.querySelector(".card.top");
  const players = [...(top?.querySelectorAll(".player") ?? [])];
  return {
    title: top?.querySelector(".no")?.textContent ?? null,
    courts: [...(top?.querySelectorAll(".court") ?? [])].map(c => {
      const b = c.getBoundingClientRect();
      return +(b.width / b.height).toFixed(2);
    }),
    players: players.length,
    truncated: players.filter(p => p.scrollWidth > p.clientWidth + 1).map(p => p.textContent),
    overlapping: players.flatMap((p, i) => players.slice(i + 1).filter(q => {
      const a = p.getBoundingClientRect(), b = q.getBoundingClientRect();
      return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    }).map(q => `${p.textContent}/${q.textContent}`)),
    noWraps: top ? top.querySelector(".no").getBoundingClientRect().height < 34 : true,
    injected: document.querySelectorAll(".card b, .chips b").length,
    stored: JSON.parse(localStorage.getItem("pairloom:v1") ?? "null"),
  };
};

async function swipe(page, dy) {
  const box = await page.locator(".card.top").boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(x, y + (dy * i) / 12);
  await page.mouse.up();
  await page.waitForTimeout(700);
}

async function setMembers(page, names, courts) {
  await page.click("#openMembers");
  await page.waitForTimeout(400);
  for (const name of names) {
    await page.fill("#addInput", name);
    await page.press("#addInput", "Enter");
  }
  await page.click(`#courtSeg button[data-v="${courts}"]`);
  await page.mouse.click(5, 5);
  await page.waitForTimeout(700);
}

async function run(browser, label, viewport, scenario, contextOptions = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, ...contextOptions });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => m.type() === "error" && errors.push(m.text()));
  await page.goto(URL);
  await page.waitForTimeout(800);
  const shot = async name => {
    await page.screenshot({ path: `${OUT}/${label}-${name}.png` });
    const m = await page.evaluate(metrics);
    if (m.title) {
      expect(`[${label}] ${name}: names don't overlap`, m.overlapping.length === 0, m.overlapping.join(","));
      expect(`[${label}] ${name}: round number on one line`, m.noWraps);
    }
    return m;
  };
  await scenario(page, shot);
  expect(`[${label}] no page errors`, errors.length === 0, errors.join(" | "));
  await ctx.close();
}

const ratiosOk = m => m.courts.length > 0 && m.courts.every(r => Math.abs(r - 0.62) < 0.03);

const browser = await chromium.launch({ executablePath: CHROME, headless: true });

await run(browser, "mobile", { width: 390, height: 844 }, async (page, shot) => {
  let m = await shot("01-empty");
  expect("[mobile] starts empty", m.title === null && (await page.locator(".empty").count()) === 1);

  await setMembers(page, NAMES, 1);
  m = await shot("02-1court");
  expect("[mobile] 1 court rendered", m.courts.length === 1 && m.players === 4, JSON.stringify(m.courts));
  expect("[mobile] court ratio", ratiosOk(m), JSON.stringify(m.courts));
  expect("[mobile] names are text, not HTML", m.injected === 0);

  await swipe(page, -160); await swipe(page, -160); await swipe(page, -160);
  m = await shot("03-swiped-3");
  expect("[mobile] swipe up advances", m.title === "4試合目", m.title);
  await swipe(page, 160);
  m = await shot("04-swiped-back");
  expect("[mobile] swipe down goes back", m.title === "3試合目", m.title);

  const before = m.stored;
  await page.reload();
  await page.waitForTimeout(800);
  m = await shot("05-reloaded");
  expect("[mobile] state survives reload", m.title === "3試合目"
    && JSON.stringify(m.stored.rounds) === JSON.stringify(before.rounds), m.title);

  // Round 4 was already dealt, so new settings start at round 5.
  await setMembers(page, ["メンバー9", "メンバー10"], 2);
  await swipe(page, -160); await swipe(page, -160);
  m = await shot("06-2courts");
  expect("[mobile] 2 courts", m.title === "5試合目" && m.courts.length === 2 && ratiosOk(m), JSON.stringify(m.courts));

  await setMembers(page, Array.from({ length: 6 }, (_, i) => `メンバー${i + 11}`), 4);
  await swipe(page, -160);
  m = await shot("07-4courts");
  expect("[mobile] 4 courts", m.courts.length === 4 && ratiosOk(m), JSON.stringify(m.courts));
  expect("[mobile] no truncated names", m.truncated.length === 0, m.truncated.join(","));
});

await run(browser, "desktop", { width: 1280, height: 800 }, async (page, shot) => {
  await setMembers(page, NAMES.slice(0, 7), 1);
  await page.mouse.move(640, 500);
  await page.mouse.wheel(0, 200);
  await page.waitForTimeout(800);
  let m = await shot("01-wheel");
  expect("[desktop] wheel advances", m.title === "2試合目", m.title);

  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(600);
  m = await shot("02-key-back");
  expect("[desktop] ArrowUp goes back", m.title === "1試合目", m.title);

  await setMembers(page, Array.from({ length: 9 }, (_, i) => `メンバー${i + 8}`), 4);
  await page.keyboard.press("ArrowDown"); await page.waitForTimeout(600);
  await page.keyboard.press("ArrowDown"); await page.waitForTimeout(600);
  m = await shot("03-4courts");
  expect("[desktop] 4 courts", m.courts.length === 4 && ratiosOk(m), JSON.stringify(m.courts));
  expect("[desktop] no truncated names", m.truncated.length === 0, m.truncated.join(","));
});

await run(browser, "about", { width: 390, height: 844 }, async page => {
  await page.click(".help-btn");
  await page.waitForLoadState();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/about-01-top.png` });
  await page.screenshot({ path: `${OUT}/about-02-full.png`, fullPage: true });
  expect("[about] help link opens the page", (await page.locator("h1").textContent()) === "組み合わせの決め方");
  expect("[about] page scrolls", await page.evaluate(() => document.documentElement.scrollHeight > innerHeight));
  await page.click(".back");
  await page.waitForLoadState();
  expect("[about] back returns to the app", (await page.locator("#stack").count()) === 1);

});

await run(browser, "history", { width: 390, height: 844 }, async page => {
  const rounds = () => page.evaluate(() => JSON.parse(localStorage.getItem("pairloom:v1")).rounds);
  const title = () => page.locator(".card.top .no").textContent();
  const notice = async () => ((await page.locator(".hint").count()) ? await page.locator(".hint").textContent() : "");
  const cancelVisible = () => page.locator(".card.top.cancellable .cancel").isVisible();
  const players = r => new Set([...r.rest, ...r.matches.flatMap(m => [...m.a, ...m.b])]).size;

  // Yesterday's case: 8 players up to round 3, then 2 more join.
  await setMembers(page, NAMES.slice(0, 8), 2);
  expect("[history] first round can't be cancelled", !(await cancelVisible()));
  await swipe(page, -160); await swipe(page, -160);
  const before = await rounds();
  expect("[history] round 3 dealt", (await title()) === "3試合目" && before.length === 3);

  await setMembers(page, ["メンバー9", "メンバー10"], 2);
  await page.screenshot({ path: `${OUT}/history-01-after-joining.png` });
  let after = await rounds();
  expect("[history] joining keeps the card on screen", JSON.stringify(after) === JSON.stringify(before)
    && (await title()) === "3試合目");
  expect("[history] notice says it applies next round", (await notice()) === "変更は次の試合から反映されます", await notice());
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT}/history-01b-swipe-hint-follows.png` });
  expect("[history] swipe hint follows the notice", (await notice()).endsWith("で次の試合")
    && (await page.locator(".hint .hint-hand").count()) === 1, await notice());
  await swipe(page, -160);
  after = await rounds();
  expect("[history] joiners are in the next round", (await title()) === "4試合目" && players(after[3]) === 10);
  const joinerIds = await page.evaluate(() => JSON.parse(localStorage.getItem("pairloom:v1")).members
    .filter(m => m.name === "メンバー9" || m.name === "メンバー10").map(m => m.id));
  expect("[history] joiners play rather than rest", joinerIds.length === 2 && !after[3].rest.some(id => joinerIds.includes(id)),
    JSON.stringify(after[3].rest));

  await page.waitForTimeout(3000);
  await page.click('#priority button[data-p="variety"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/history-02-after-priority.png` });
  expect("[history] priority change keeps the card on screen",
    JSON.stringify(await rounds()) === JSON.stringify(after) && (await title()) === "4試合目");
  expect("[history] priority notice", (await notice()) === "変更は次の試合から反映されます", await notice());
  await page.mouse.click(195, 700);
  await page.waitForTimeout(3500);
  expect("[history] no swipe hint once the notice was touched away", (await notice()) === "", await notice());

  await swipe(page, -160);
  expect("[history] newest card can be cancelled", (await title()) === "5試合目" && (await cancelVisible()));
  await page.screenshot({ path: `${OUT}/history-03-cancel-button.png` });
  page.once("dialog", d => d.dismiss());
  await page.click(".card.top .cancel");
  await page.waitForTimeout(500);
  expect("[history] dismissing the dialog keeps the round", (await rounds()).length === 5 && (await title()) === "5試合目");

  page.once("dialog", d => d.accept());
  await page.click(".card.top .cancel");
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/history-04-cancelled.png` });
  expect("[history] cancel drops the newest round and shows the previous one",
    JSON.stringify(await rounds()) === JSON.stringify(after) && (await title()) === "4試合目");

  await swipe(page, 160);
  expect("[history] older cards can't be cancelled", (await title()) === "3試合目" && !(await cancelVisible()));
  await swipe(page, -160); await swipe(page, -160);
  expect("[history] a fresh round 5 is dealt after cancelling", (await title()) === "5試合目" && (await rounds()).length === 5);
  expect("[history] no reshuffle button", (await page.locator("#reshuffleBtn").count()) === 0);
});

await run(browser, "streak", { width: 390, height: 844 }, async page => {
  await setMembers(page, [...NAMES, "メンバー9", "メンバー10"], 1);
  for (let i = 0; i < 12; i++) await swipe(page, -160);
  await page.screenshot({ path: `${OUT}/streak-01-10-on-1-court.png` });
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("pairloom:v1")));
  const longest = Math.max(...stored.members.map(m => {
    let run = 0, best = 0;
    for (const r of stored.rounds) { run = r.rest.includes(m.id) ? run + 1 : 0; best = Math.max(best, run); }
    return best;
  }));
  expect("[streak] 10 players on 1 court never rest 3 in a row", stored.rounds.length === 13 && longest <= 2,
    `rounds ${stored.rounds.length}, longest ${longest}`);

  const list = page.locator(".card.top .rest-list");
  const before = await list.evaluate(el => ({ overflows: el.scrollWidth > el.clientWidth, faded: el.classList.contains("more") }));
  expect("[streak] six resting names overflow and fade at the edge", before.overflows && before.faded, JSON.stringify(before));
  await list.evaluate(el => { el.scrollLeft = el.scrollWidth; });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/streak-02-rest-scrolled.png` });
  const end = await list.evaluate(el => ({
    faded: el.classList.contains("more"),
    lastVisible: el.lastElementChild.getBoundingClientRect().right <= el.getBoundingClientRect().right + 1,
  }));
  expect("[streak] scrolling reveals the last name and drops the fade", end.lastVisible && !end.faded, JSON.stringify(end));

  const box = await list.boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(x, y - (160 * i) / 12);
  await page.mouse.up();
  await page.waitForTimeout(700);
  const title = await page.locator(".card.top .no").textContent();
  expect("[streak] a swipe starting on the rest names still advances", title === "14試合目", title);
});

await run(browser, "touch", { width: 390, height: 844 }, async page => {
  await setMembers(page, NAMES.slice(0, 6), 1);
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: 195, y }] });
  const swipeUp = async () => {
    await touch("touchStart", 600);
    for (let i = 1; i <= 8; i++) await touch("touchMove", 600 - i * 25);
    await touch("touchEnd", 400);
    await page.waitForTimeout(500);
  };
  const tap = async selector => {
    const b = await page.locator(selector).boundingBox();
    await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForTimeout(450);
  };

  await swipeUp();
  expect("[touch] a touch swipe advances", (await page.locator(".card.top .no").textContent()) === "2試合目");
  await tap("#openMembers");
  expect("[touch] members opens on the first tap after a swipe", (await page.locator("#sheet.open").count()) === 1);
  await page.touchscreen.tap(5, 5);
  await page.waitForTimeout(800);

  await swipeUp();
  await tap('#priority button[data-p="variety"]');
  expect("[touch] priority switches on the first tap after a swipe",
    (await page.getAttribute('#priority button[data-p="variety"]', "aria-checked")) === "true");

  expect("[touch] no debug log without ?debug", (await page.locator("#debugLog").count()) === 0);
  await page.goto(`${URL}?debug=1`);
  await page.waitForTimeout(500);
  await swipeUp();
  await tap("#openMembers");
  const log = await page.locator("#debugLog").textContent();
  expect("[touch] ?debug=1 logs touches and clicks", log.includes("touchstart") && log.includes("click button#openMembers"), log.slice(-300));
  expect("[touch] the members sheet still opens with the log on", (await page.locator("#sheet.open").count()) === 1);
  await page.screenshot({ path: `${OUT}/touch-debug.png` });
}, { hasTouch: true, isMobile: true });

await run(browser, "hint", { width: 390, height: 844 }, async page => {
  const hint = page.locator(".hint");
  await setMembers(page, NAMES.slice(0, 5), 1);
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/hint-01-shown.png` });
  const text = (await hint.count()) ? await hint.textContent() : "";
  expect("[hint] shows on first use with touch wording", text.includes("上にスワイプ"), text);
  await page.waitForTimeout(3200);
  expect("[hint] fades out on its own", (await hint.count()) === 0);

  await page.reload();
  await page.waitForTimeout(400);
  expect("[hint] shows again until the user swipes", (await hint.count()) === 1);
  await page.mouse.click(195, 500);
  await page.waitForTimeout(600);
  expect("[hint] a touch dismisses it", (await hint.count()) === 0);

  await page.click("#openMembers");
  await page.waitForTimeout(400);
  await page.mouse.click(5, 5);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/hint-02-after-sheet.png` });
  expect("[hint] shows again after closing the members sheet", (await hint.count()) === 1);
  await page.waitForTimeout(3200);

  await swipe(page, -160);
  await page.reload();
  await page.waitForTimeout(400);
  expect("[hint] stops on launch after the first swipe", (await hint.count()) === 0);

  await page.click("#openMembers");
  await page.waitForTimeout(400);
  await page.mouse.click(5, 5);
  await page.waitForTimeout(700);
  expect("[hint] still shows after closing the members sheet", (await hint.count()) === 1);
}, { hasTouch: true, isMobile: true });

await run(browser, "reset", { width: 390, height: 844 }, async page => {
  await setMembers(page, NAMES.slice(0, 5), 2);
  await swipe(page, -160);
  await page.click("#openMembers");
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/reset-01-sheet.png` });

  const games = await page.locator(".chip .games").allTextContents();
  expect("[reset] game counts cover the two rounds so far", games.length === 5
    && games.reduce((sum, n) => sum + Number(n), 0) === 8 && games.every(n => Number(n) >= 1));

  await page.locator(".chip").first().click({ position: { x: 12, y: 12 } });
  await page.waitForTimeout(200);
  const afterTap = await page.evaluate(() => JSON.parse(localStorage.getItem("pairloom:v1")));
  expect("[reset] tapping a name doesn't rest them", (await page.locator(".chip").count()) === 5
    && afterTap.members.every(m => m.active));

  page.once("dialog", d => d.dismiss());
  await page.click("#clearBtn");
  await page.waitForTimeout(300);
  expect("[reset] cancel keeps members", (await page.locator(".chip").count()) === 5);

  page.once("dialog", d => d.accept());
  await page.click("#clearBtn");
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/reset-02-cleared.png` });
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("pairloom:v1")));
  expect("[reset] clears members, rounds and settings", (await page.locator(".chip").count()) === 0
    && stored.members.length === 0 && stored.rounds.length === 0 && stored.courts === 1);
  expect("[reset] sheet stays open for new members", await page.locator("#sheet.open").count() === 1);

  for (const name of ["A", "B", "C", "D"]) {
    await page.fill("#addInput", name);
    await page.press("#addInput", "Enter");
  }
  await page.mouse.click(5, 5);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/reset-03-new-group.png` });
  const title = await page.locator(".card.top .no").textContent();
  expect("[reset] new group starts at round 1", title === "1試合目", title);
});

{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(URL);
  await page.waitForTimeout(800);
  expect("[update] current build stays put", !new globalThis.URL(page.url()).searchParams.has("v"), page.url());

  await page.route("**/version.json*", route => route.fulfill({ json: { build: "newer-build" } }));
  await page.reload();
  await page.waitForURL(/[?&]v=newer-build/, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(800);
  expect("[update] stale build reloads with new URL", page.url().includes("v=newer-build"), page.url());
  expect("[update] no reload loop", (await page.locator("#stack").count()) === 1);
  await ctx.close();
}

await run(browser, "install", { width: 390, height: 844 }, async page => {
  await page.goto(new globalThis.URL("about.html", URL).href);
  await page.waitForTimeout(500);
  expect("[install] about page links to the guide", await page.locator("#installLink").isVisible());
  await page.click(".install-link");
  await page.waitForLoadState();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/install-01-android.png`, fullPage: true });
  expect("[install] guide opens", (await page.locator("h1").textContent()) === "ホーム画面に追加");
  const order = await page.evaluate(() => [...document.querySelectorAll("#android, #ios")].map(s => s.id).join(","));
  expect("[install] Android section first off iOS", order === "android,ios", order);
  expect("[install] no button until the browser offers install", !(await page.locator("#installBtn").isVisible()));

  await page.evaluate(() => {
    const e = new Event("beforeinstallprompt", { cancelable: true });
    e.prompt = () => { window.__prompted = true; return Promise.resolve(); };
    e.userChoice = Promise.resolve({ outcome: "accepted" });
    dispatchEvent(e);
  });
  expect("[install] button appears when install is offered", await page.locator("#installBtn").isVisible());
  await page.screenshot({ path: `${OUT}/install-02-button.png`, fullPage: true });
  await page.click("#installBtn");
  expect("[install] button opens the browser's install prompt", await page.evaluate(() => window.__prompted === true));
  expect("[install] button is single-use", !(await page.locator("#installBtn").isVisible()));
  await page.evaluate(() => dispatchEvent(new Event("appinstalled")));
  expect("[install] confirms once installed", await page.locator("#installed").isVisible());

  await page.click(".back");
  await page.waitForLoadState();
  expect("[install] back returns to the about page", (await page.locator("h1").textContent()) === "組み合わせの決め方");
});

await run(browser, "install-ios", { width: 390, height: 844 }, async page => {
  await page.goto(new globalThis.URL("install.html", URL).href);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/install-ios-01.png`, fullPage: true });
  const order = await page.evaluate(() => [...document.querySelectorAll("#android, #ios")].map(s => s.id).join(","));
  expect("[install-ios] iPhone section first on iOS", order === "ios,android", order);
}, { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", isMobile: true, hasTouch: true });

{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(() => Object.defineProperty(Navigator.prototype, "standalone", { get: () => true }));
  const page = await ctx.newPage();
  await page.goto(new globalThis.URL("about.html", URL).href);
  await page.waitForTimeout(500);
  expect("[standalone] about page hides the install link", !(await page.locator("#installLink").isVisible()));
  await page.goto(new globalThis.URL("install.html", URL).href);
  await page.waitForTimeout(500);
  expect("[standalone] guide says it's already installed", await page.locator("#installed").isVisible());
  await ctx.close();
}

{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on("pageerror", e => pageErrors.push(e.message));
  await page.goto(URL);

  const manifest = await page.evaluate(async () => {
    const href = document.querySelector('link[rel="manifest"]')?.href;
    const m = href ? await (await fetch(href)).json() : null;
    const icons = m ? await Promise.all(m.icons.map(async i => (await fetch(new URL(i.src, href))).ok)) : [];
    return { name: m?.name, display: m?.display, icons };
  });
  expect("[offline] manifest and icons are served", manifest.name === "pairloom" && manifest.display === "standalone"
    && manifest.icons.length === 3 && manifest.icons.every(Boolean), JSON.stringify(manifest));

  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise(r => navigator.serviceWorker.addEventListener("controllerchange", r, { once: true }));
    }
  });
  await setMembers(page, NAMES.slice(0, 5), 1);
  await swipe(page, -160);

  await ctx.setOffline(true);
  const reachable = await page.evaluate(() => fetch(`./version.json?t=${Date.now()}`, { cache: "no-store" }).then(() => true, () => false));
  expect("[offline] network is really off", !reachable);

  await page.reload();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/offline-01-reloaded.png` });
  let title = await page.locator(".card.top .no").textContent().catch(() => null);
  expect("[offline] app opens with the saved rounds", title === "2試合目", title);
  await swipe(page, -160);
  title = await page.locator(".card.top .no").textContent().catch(() => null);
  expect("[offline] next round can still be dealt", title === "3試合目", title);

  await page.click(".help-btn");
  await page.waitForLoadState();
  expect("[offline] about page opens", (await page.locator("h1").textContent().catch(() => null)) === "組み合わせの決め方");
  await page.click(".back");
  await page.waitForLoadState();
  expect("[offline] back to the app", (await page.locator("#stack").count()) === 1);

  await page.goto(new globalThis.URL("install.html", URL).href);
  expect("[offline] install guide opens", (await page.locator("h1").textContent().catch(() => null)) === "ホーム画面に追加");

  await page.goto(`${URL}?v=some-build`);
  await page.waitForTimeout(500);
  expect("[offline] opens with an update query string too", (await page.locator(".card.top").count()) > 0);
  expect("[offline] no page errors", pageErrors.length === 0, pageErrors.join(" | "));
  await ctx.close();
}

await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed", `— screenshots in ${OUT}`);
process.exit(failures ? 1 : 0);
