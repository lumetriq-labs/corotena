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

  await setMembers(page, ["メンバー9", "メンバー10"], 2);
  m = await shot("06-2courts");
  expect("[mobile] 2 courts", m.courts.length === 2 && ratiosOk(m), JSON.stringify(m.courts));

  await setMembers(page, Array.from({ length: 6 }, (_, i) => `メンバー${i + 11}`), 4);
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
  expect("[hint] stops after the first swipe", (await hint.count()) === 0);
}, { hasTouch: true, isMobile: true });

await run(browser, "reset", { width: 390, height: 844 }, async page => {
  await setMembers(page, NAMES.slice(0, 5), 2);
  await swipe(page, -160);
  await page.click("#openMembers");
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/reset-01-sheet.png` });

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

await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed", `— screenshots in ${OUT}`);
process.exit(failures ? 1 : 0);
