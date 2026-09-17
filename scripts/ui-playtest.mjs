/**
 * UI play-test: drives the real interface with 4 headless-Chrome "players"
 * (one on a phone-sized viewport) through the 3-round clue/decision/voting
 * flow: Scenario A (3 full clue rounds), Scenario B (majority-vote shortcut),
 * Scenario C (tie triggers next round), plus refresh, late-join, scores,
 * room-close, and console-error scanning.
 *
 * Usage: node scripts/ui-playtest.mjs [baseUrl]
 */
import puppeteer from "puppeteer-core";

const BASE = process.argv[2] ?? "http://localhost:3200";
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

let passed = 0;
let failed = 0;
function check(name, cond, extra = "") {
  if (cond) {
    passed++;
    console.log(`  ok  ${name}`);
  } else {
    failed++;
    console.log(`FAIL  ${name} ${extra}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(fn, timeoutMs = 10000, label = "condition") {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeoutMs) {
    try {
      last = await fn();
      if (last) return last;
    } catch {
      /* keep waiting */
    }
    await sleep(150);
  }
  throw new Error(`timeout waiting for ${label} (last=${JSON.stringify(last)})`);
}

async function makePlayer(browser, name, { mobile = false } = {}) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport(
    mobile
      ? { width: 390, height: 844, isMobile: true, hasTouch: true }
      : { width: 1280, height: 900 },
  );
  const consoleErrors = [];
  const apiErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(`PAGEERROR: ${err.message}`));
  page.on("response", (r) => {
    if (r.url().includes("/api/") && r.status() >= 300) {
      apiErrors.push(`${r.status()} ${r.url().replace(/^https?:\/\/[^/]+/, "")}`);
    }
  });

  const text = async () => (await page.$eval("body", (el) => el.innerText)).replace(/\s+/g, " ");
  const see = async (s) => (await text()).toLowerCase().includes(s.toLowerCase());

  return { name, context, page, consoleErrors, apiErrors, text, see, isImposterFlag: false };
}

async function clickButton(page, label) {
  const clicked = await page.evaluate((lbl) => {
    const want = lbl.toLowerCase();
    const btns = [...document.querySelectorAll("button")];
    const b = btns.find((el) => el.innerText.trim().toLowerCase() === want) ??
      btns.find((el) => el.innerText.trim().toLowerCase().startsWith(want));
    if (!b) return false;
    b.click();
    return true;
  }, label);
  if (!clicked) throw new Error(`button "${label}" not found`);
}

async function clickContaining(page, label) {
  const clicked = await page.evaluate((lbl) => {
    const want = lbl.toLowerCase();
    const btns = [...document.querySelectorAll("button")];
    const b = btns.find((el) => el.innerText.trim().toLowerCase().includes(want));
    if (!b) return false;
    b.click();
    return true;
  }, label);
  if (!clicked) throw new Error(`button containing "${label}" not found`);
}

async function typeInto(page, placeholder, value) {
  await page.waitForSelector(`input[placeholder="${placeholder}"]`, { timeout: 8000 });
  await page.click(`input[placeholder="${placeholder}"]`, { clickCount: 3 });
  await page.type(`input[placeholder="${placeholder}"]`, value, { delay: 5 });
}

async function homeJoin(browser, name, code, opts = {}) {
  const p = await makePlayer(browser, name, opts);
  await p.page.goto(`${BASE}/?room=${code}`, { waitUntil: "networkidle2" });
  await typeInto(p.page, "e.g. Ravi", name);
  await clickButton(p.page, "Join");
  await until(() => p.see("Lobby"), 10000, `${name} lobby`);
  return p;
}

/* ---------- Secret word reveal ---------- */

// Every player taps the card, sees their own secret word, is never told they
// are the imposter. Returns { mainWord, imposterWord } per game.
async function doRoleReveal(players) {
  for (const p of players) {
    await until(() => p.see("Tap to reveal your word"), 10000, `${p.name} secret-word card`);
  }
  const capturedWords = [];
  for (const p of players) {
    await p.page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((el) =>
        el.innerText.trim().toLowerCase().includes("tap to reveal"),
      );
      if (b) b.click();
    });
    await until(() => p.see("Keep your word secret."), 10000, `${p.name} word reveal`);
    const t = (await p.text()).replace(/\s+/g, " ");
    const m =
      t.match(/your secret word\s+([\p{L}\w' ]+?)\s+keep your word secret/iu) ??
      t.match(/your secret word\s+([\p{L}\w' ]+)/iu);
    const word = m ? m[1].trim() : "";
    check(`${p.name} sees a secret word`,
      word.length >= 3 && /^[\p{L}][\p{L}\w' ]*$/u.test(word) && !/secret|word|your/i.test(word),
      t.slice(0, 100));
    const body = t.toLowerCase();
    check(`${p.name} is not told they are the imposter`,
      !body.includes("the imposter") && !body.includes("you are the imposter") && !body.includes("odd one") &&
      !body.includes("different word"), t.slice(0, 100));
    capturedWords.push(word);
    check(`${p.name} sees privacy notice`, await p.see("Don't show this screen to other players"));
    await p.page.evaluate(() => {
      const btns = [...document.querySelectorAll("button")];
      const b = btns.find((el) => el.innerText.trim().startsWith("I've seen my word"));
      if (b && !b.disabled) b.click();
    });
    await sleep(400);
  }
  const unique = [...new Set(capturedWords.map((w) => w.toLowerCase()))];
  check("everyone sees exactly two distinct words in play", unique.length === 2, `words=${unique.join("|")}`);
  const counts = new Map();
  for (const w of capturedWords) counts.set(w.toLowerCase(), (counts.get(w.toLowerCase()) ?? 0) + 1);
  const [mainW, mainC] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const imposterW = [...counts.keys()].find((w) => w !== mainW) ?? "";
  const mainOf = capturedWords.find((w) => w.toLowerCase() === mainW) ?? "";
  const oddOf = capturedWords.find((w) => w.toLowerCase() === imposterW) ?? "";
  check("exactly one player has a different word", mainC === players.length - 1, `main=${mainC}/${players.length}`);
  for (const p of players) {
    await until(() => p.see("Clue phase"), 12000, `${p.name} clue phase`);
  }
  return { mainWord: mainOf, imposterWord: oddOf };
}

/* ---------- Clue round ---------- */

async function submitClueRound(players, round) {
  for (let turn = 0; turn < players.length; turn++) {
    const current = await until(async () => {
      for (const p of players) if (await p.see("(you)")) return p;
      return null;
    }, 15000, `round ${round} current player`);
    await typeInto(current.page, "Your clue…", `r${round}-${current.name}`);
    await clickButton(current.page, "Submit Clue");
    await until(
      async () => !(await current.page.$('input[placeholder="Your clue…"]')),
      8000,
      `${current.name} r${round} clue locked`,
    );
  }
  // Every player's input is gone: either locked in or the round advanced.
  for (const p of players) {
    await until(async () => !(await p.page.$('input[placeholder="Your clue…"]')), 10000, `${p.name} no clue input`);
  }
}

/* ---------- Decision phase ---------- */

async function decidePhase(players, choices, opts = {}) {
  for (const p of players) {
    await until(() => p.see("decision") || p.see("complete"), 12000, `${p.name} sees decision phase`);
  }
  if (opts.watchProgress) {
    await until(async () => (await players[0].text()).includes("0/4 decided"), 10000, "0/4 decided visible");
    check("decision shows 0/4 decided initially", true);
  }
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    const label = choices[i] === "vote" ? "VOTE NOW" : "PLAY ANOTHER ROUND";
    await clickContaining(p.page, label);
    await until(
      async () => (await p.see("decision locked")) || (await p.see("Voting")) || (await p.see("Clue phase")),
      8000,
      `${p.name} decision locked`,
    );
    if (opts.watchProgress && i === 0) {
      const other = players[1];
      await until(async () => /[1-3]\/4 decided/.test(await other.text()), 10000, `${other.name} progress after first lock`);
      check("other players see decided progress after first lock", true);
    }
  }
  // Everyone must have left the decision screen (room advanced).
  for (const p of players) {
    await until(async () => (await p.see("Voting")) || (await p.see("Clue phase")), 12000, `${p.name} left decision`);
  }
}

/* ---------- Voting ---------- */

async function voteAll(players) {
  for (const p of players) {
    const voted = await p.page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((el) => el.innerText.trim() === "Vote");
      if (!b) return false;
      b.click();
      return true;
    });
    check(`${p.name} voted`, voted);
    await until(async () => (await p.see("vote locked")) || (await p.see("Round over")), 8000, `${p.name} vote lock`);
  }
  for (const p of players) await until(() => p.see("Round over"), 15000, `${p.name} reveal`);
}

/* ---------- Score summary ---------- */

function totalScore(revealText) {
  const nums = revealText.match(/Scores(.+)$/s);
  if (!nums) return 0;
  return (nums[1].match(/\b(\d+)\b/g) ?? []).reduce((a, b) => a + Number(b), 0);
}

/* ================================================================= main */

async function run() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    // ---- Host creates a room through the UI ----
    const host = await makePlayer(browser, "Alice");
    await host.page.goto(BASE, { waitUntil: "networkidle2" });
    await clickButton(host.page, "Create Room");
    await typeInto(host.page, "e.g. Ravi", "Alice");
    await clickButton(host.page, "Create");
    await until(() => host.see("Lobby"), 10000, "host lobby");
    const body = await host.text();
    const codeMatch = body.match(/\b([A-HJ-NP-Z2-9]{5})\b/);
    check("host sees lobby with room code", !!codeMatch, body.slice(0, 120));
    const CODE = codeMatch[1];

    const bob = await homeJoin(browser, "Bob", CODE);
    const carol = await homeJoin(browser, "Carol", CODE, { mobile: true });
    const dave = await homeJoin(browser, "Dave", CODE);

    await until(() => host.see("Players: 4"), 10000, "4 players in lobby");
    check("host crown shown", await host.see("👑"));
    check("non-host has no start button", !(await bob.see("Start Game")));
    const players = [host, bob, carol, dave];

    // ==================================================================
    // SCENARIO A: round 1 PLAY -> round 2 PLAY -> round 3 auto-votes
    // ==================================================================
    console.log("\n== SCENARIO A: 3-round full game ==");

    await clickButton(host.page, "Start Game");
    await until(() => host.see("THE GAME IS STARTING"), 6000, "start overlay");
    await until(async () => !(await host.see("THE GAME IS STARTING")), 6000, "overlay auto-dismiss");
    check("transition overlay shown and auto-dismissed", true);

    const revealWords = await doRoleReveal(players);

    // ---- Round 1 ----
    check("shows ROUND 1 OF 3", await host.see("round 1 of 3"));
    await submitClueRound(players, 1);
    await until(() => host.see("ROUND 1 COMPLETE"), 12000, "host sees decision");
    check("round 1 auto-advances to decision phase", true);
    await decidePhase(players, ["play", "play", "play", "play"], { watchProgress: true });

    // ---- Round 2 ----
    await until(() => host.see("round 2 of 3"), 12000, "round 2 of 3");
    check("shows ROUND 2 OF 3", true);
    check("round 1 clues remain visible during round 2", (await host.text()).includes("r1-Alice"), (await host.text()).slice(0, 200));
    await submitClueRound(players, 2);
    await until(() => host.see("ROUND 2 COMPLETE"), 12000, "round 2 decision");
    check("round 2 auto-advances to decision phase", true);
    await decidePhase(players, ["play", "play", "play", "play"]);

    // ---- Round 3 ----
    await until(() => host.see("round 3 of 3"), 12000, "round 3 of 3");
    check("shows ROUND 3 OF 3", true);
    await submitClueRound(players, 3);
    await until(() => host.see("Voting"), 12000, "auto voting after round 3");
    check("round 3 auto-starts voting (no decision phase)", true);
    check("no decision buttons after round 3", !(await host.see("PLAY ANOTHER ROUND")) && !(await host.see("VOTE NOW")));

    await voteAll(players);
    check("scenario A reached reveal", await host.see("Round over"));
    const revealText1 = await host.text();
    check("scenario A shows imposter", revealText1.includes("The Imposter was"), revealText1.slice(0, 200));
    check("scenario A shows the different-word reveal", revealText1.includes("The Imposter had a different word"));
    check("scenario A reveals main word", revealText1.toLowerCase().includes(revealWords.mainWord.toLowerCase()), revealWords.mainWord);
    check("scenario A reveals imposter word", revealText1.toLowerCase().includes(revealWords.imposterWord.toLowerCase()), revealWords.imposterWord);
    const sum1 = totalScore(revealText1);
    check("scenario A awarded points", sum1 >= 2, `sum=${sum1}`);

    // Refresh mid-reveal.
    for (const p of players) await p.page.reload({ waitUntil: "networkidle2" });
    await until(() => host.see("Round over"), 10000, "host still in room after refresh");
    check("all players survive refresh", true);

    // ==================================================================
    // SCENARIO B: majority VOTE -> straight to voting
    // ==================================================================
    console.log("\n== SCENARIO B: majority-vote shortcut ==");
    await clickButton(host.page, "Play Again");
    for (const p of players) await until(() => p.see("Lobby"), 10000, `${p.name} back to lobby`);
    check("play again returns everyone to lobby", true);

    await clickButton(host.page, "Start Game");
    await until(() => host.see("THE GAME IS STARTING"), 6000, "scenario B start");
    await until(async () => !(await host.see("THE GAME IS STARTING")), 6000, "scenario B overlay dismiss");
    await doRoleReveal(players);

    check("shows ROUND 1 OF 3", await host.see("round 1 of 3"));
    await submitClueRound(players, 1);
    await until(() => host.see("ROUND 1 COMPLETE"), 12000, "scenario B decision");
    await decidePhase(players, ["vote", "vote", "vote", "play"]);
    await until(() => host.see("Voting"), 12000, "scenario B voting");
    check("majority VOTE jumps straight to voting (no round 2)", !(await host.see("round 2 of 3")));
    await voteAll(players);
    check("scenario B reached reveal", await host.see("Round over"));
    const sum2 = totalScore(await host.text());
    check("scenario B scores grew", sum2 > sum1, `sum1=${sum1} sum2=${sum2}`);

    // ==================================================================
    // SCENARIO C: exact tie -> next round
    // ==================================================================
    console.log("\n== SCENARIO C: tie triggers next round ==");
    await clickButton(host.page, "Play Again");
    for (const p of players) await until(() => p.see("Lobby"), 10000, `${p.name} lobby`);
    await clickButton(host.page, "Start Game");
    await until(() => host.see("THE GAME IS STARTING"), 6000, "scenario C start");
    await until(async () => !(await host.see("THE GAME IS STARTING")), 6000, "scenario C overlay dismiss");
    await doRoleReveal(players);

    check("shows ROUND 1 OF 3", await host.see("round 1 of 3"));
    await submitClueRound(players, 1);
    await until(() => host.see("ROUND 1 COMPLETE"), 12000, "scenario C decision");
    await decidePhase(players, ["vote", "vote", "play", "play"]);
    await until(() => host.see("round 2 of 3"), 12000, "scenario C round 2");
    check("exact tie -> ROUND 2 OF 3", true);
    check("all browser clients synchronized on round 2",
      (await bob.see("round 2 of 3")) && (await carol.see("round 2 of 3")) && (await dave.see("round 2 of 3")));

    // Finish the game so the room can be closed cleanly.
    await submitClueRound(players, 2);
    await until(() => host.see("ROUND 2 COMPLETE"), 12000, "scenario C round 2 decision");
    await decidePhase(players, ["play", "play", "play", "play"]);
    await submitClueRound(players, 3);
    await until(() => host.see("Voting"), 12000, "scenario C auto voting");
    await voteAll(players);
    check("scenario C reached reveal", await host.see("Round over"));

    // ---- Late join must be rejected while a round is running ----
    const eve = await makePlayer(browser, "Eve");
    await eve.page.goto(`${BASE}/?room=${CODE}`, { waitUntil: "networkidle2" });
    await typeInto(eve.page, "e.g. Ravi", "Eve");
    await clickButton(eve.page, "Join");
    await until(() => eve.see("already in progress"), 8000, "late join rejected");
    check("late join rejected with clear error", true);

    // ---- Close the room ----
    await clickButton(host.page, "Play Again");
    for (const p of players) await until(() => p.see("Lobby"), 10000, `${p.name} lobby again`);
    await clickButton(host.page, "Close Room");
    await until(() => host.see("Guess the Imposter"), 8000, "host back home");
    check("host closed room and returned home", true);
    await until(async () => {
      const t = await bob.text();
      return (
        t.includes("no longer exists") || t.includes("Enter name to join") || t.includes("Guess the Imposter")
      );
    }, 12000, "bob sees closed-room state");
    check("remaining players see room-gone state", true);

    // ---- Console error scan ----
    const benign = [/favicon/i, /Third-party cookie/i, /Autofill/i, /net::ERR_ABORTED/i];
    for (const p of [...players, eve]) {
      const statuses = new Set(p.apiErrors.map((e) => e.match(/^(\d+)/)?.[1]));
      const real = p.consoleErrors.filter((e) => {
        if (benign.some((re) => re.test(e))) return false;
        const m = e.match(/status of (\d+)/);
        if (m && statuses.has(m[1])) return false; // expected API error path, asserted via UI
        return true;
      });
      check(`${p.name} console clean`, real.length === 0, real.join(" | ").slice(0, 200));
    }

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    await browser.close().catch(() => undefined);
  }
}

run().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});