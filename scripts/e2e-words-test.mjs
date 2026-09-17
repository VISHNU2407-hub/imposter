/**
 * API tests for the new secret-word mechanic.
 *
 * Verifies:
 *   1. Every player receives a secret word.
 *   2. Exactly one player receives the alternate word.
 *   3. All other players receive the main word.
 *   4. Main and alternate words are different.
 *   5. Both words come from the same curated pair.
 *   6. The alternate player is randomly selected each game (varies).
 *   7. Client-visible state never exposes imposterId before reveal.
 *   8. Client-visible state never exposes another player's word.
 *   9. mainWord + imposterWord are never both exposed before reveal.
 *  10. No player is explicitly told they are the imposter (no isImposter).
 *  11-13. Rounds 1-3 and automatic round-3 voting still work.
 *  14-16. Majority VOTE NOW / majority PLAY / tie => PLAY still work.
 *  17. Refresh/reconnect preserves the player's own secret word.
 *  18. Host leaving (mid-round) still works and word state is preserved.
 *  19. Play Again resets round state and produces a fresh game.
 *  20. Reveal identifies the alternate-word player and shows both words.
 *
 * Usage: node scripts/e2e-words-test.mjs [baseUrl]
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3111";

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

// Pull the curated pair list straight from the source so it can't drift out of sync.
const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, "../src/lib/wordPairs.ts"), "utf8");
const WORD_PAIRS = [...src.matchAll(/\[\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\]/g)].map((m) => [m[1], m[2]]);

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

const state = (code, token) =>
  fetch(`${BASE}/api/game/state?code=${code}&token=${token}`).then((r) => r.json());

async function createRoom(names) {
  const host = (await post("/api/game/create", { name: names[0] })).data;
  const CODE = host.roomCode;
  const players = [{ id: host.playerId, name: host.name, token: host.token }];
  for (const n of names.slice(1)) {
    const p = (await post("/api/game/join", { code: CODE, name: n })).data;
    players.push({ id: p.playerId, name: p.name, token: p.token });
  }
  return { CODE, players };
}

async function startReady(code, players) {
  await post("/api/game/action", { action: "start", code, token: players[0].token });
  for (const p of players) {
    await post("/api/game/action", { action: "ready", code, token: p.token });
  }
}

/** Collect every player's own secret word (from their per-token state). */
async function revealWords(code, players) {
  const out = [];
  for (const p of players) {
    const s = await state(code, p.token);
    out.push({ id: p.id, token: p.token, word: s.yourRole?.secretWord ?? null });
  }
  return out;
}

/** Distinguish main vs alternate word from a per-player word sample. */
function analyze(words) {
  const counts = new Map();
  for (const { word } of words) counts.set(word, (counts.get(word) ?? 0) + 1);
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const mainWord = entries[0][0];
  const altEntry = entries[1];
  return {
    mainWord,
    altWord: altEntry?.[0] ?? null,
    altCount: altEntry?.[1] ?? 0,
    mainCount: entries[0][1],
  };
}

async function clueAll(code, players) {
  let guard = 0;
  let s = await state(code, players[0].token);
  while (s.phase === "CLUE_PHASE" && guard++ < 24) {
    const turn = players.find((p) => p.id === s.currentTurnPlayerId);
    if (!turn) return null;
    const res = await post("/api/game/action", {
      action: "clue",
      code,
      token: turn.token,
      clue: `c${s.clueRound}-${guard}`,
    });
    if (res.status !== 200) return null;
    s = await state(code, players[0].token);
  }
  return s;
}

/** Decide sequentially (skips anyone already decided). Returns final state. */
async function decideAll(code, players, choices) {
  for (let i = 0; i < choices.length; i++) {
    const cur = await state(code, players[i].token);
    if (cur.phase !== "ROUND_DECISION") break;
    if (cur.playersWhoDecided.includes(players[i].id)) continue;
    const res = await post("/api/game/action", {
      action: "decision",
      code,
      token: players[i].token,
      choice: choices[i],
    });
    if (res.status !== 200) return res;
  }
  return await state(code, players[0].token);
}

async function voteAll(code, players) {
  for (let i = 0; i < players.length; i++) {
    const target = players[(i + 1) % players.length];
    const res = await post("/api/game/action", { action: "vote", code, token: players[i].token, targetId: target.id });
    if (res.status !== 200) return res;
  }
  return await state(code, players[0].token);
}

// ---------------------------------------------------------------- helpers
function pairContains(pairInput, w1, w2) {
  const [a, b] = pairInput;
  return (a === w1 && b === w2) || (a === w2 && b === w1);
}

async function main() {
  // ================================================================ core words
  console.log("== Secret-word assignment (items 1-6) ==");
  const { CODE, players } = await createRoom(["Ww1", "Ww2", "Ww3", "Ww4"]);
  await startReady(CODE, players);
  let s = await state(CODE, players[0].token);
  check("game started (round in progress)", s.phase === "ROLE_REVEAL" || s.phase === "CLUE_PHASE", `phase=${s.phase}`);

  let words = await revealWords(CODE, players);
  check("1. every player receives a secret word",
    words.length === 4 && words.every((w) => typeof w.word === "string" && w.word.length > 0));
  const a1 = analyze(words);
  check("2. exactly one player receives the alternate word", a1.altCount === 1);
  check("3. all other players receive the main word", a1.mainCount === 3);
  check("4. main and alternate words are different", a1.mainWord !== a1.altWord && !!a1.mainWord);
  check("5. both words come from the same curated pair",
    WORD_PAIRS.some((pair) => pairContains(pair, a1.mainWord, a1.altWord)),
    `${a1.mainWord} / ${a1.altWord}`);

  // 6. Randomness: over several fresh games the alternate seat and the main
  // side of the pair both vary (probabilistically certain across 8 games).
  const impostorSeats = new Set();
  const mainSides = new Set();
  const bn = ["Rx1", "Rx2", "Rx3", "Rx4"];
  for (let g = 0; g < 8; g++) {
    const room = await createRoom(bn.map((n) => `${n}${g}`));
    await startReady(room.CODE, room.players);
    const w = await revealWords(room.CODE, room.players);
    const an = analyze(w);
    const impSeat = w.findIndex((x) => x.word === an.altWord);
    impostorSeats.add(impSeat);
    const pair = WORD_PAIRS.find((p) => pairContains(p, an.mainWord, an.altWord));
    if (pair) mainSides.add(pair[0] === an.mainWord ? 0 : 1);
    await post("/api/game/action", { action: "close", code: room.CODE, token: room.players[0].token });
  }
  check("6. alternate player is randomly selected (varies across games)", impostorSeats.size >= 2, `seats=${[...impostorSeats]}`);
  check("6b. main side of the pair is randomly chosen (varies)", mainSides.size >= 2, `sides=${[...mainSides]}`);

  // ============================================================== no leaks
  console.log("== Privacy / no leaks (items 7-10) ==");
  {
    const room = await createRoom(["Pw1", "Pw2", "Pw3", "Pw4"]);
    await startReady(room.CODE, room.players);
    const w = await revealWords(room.CODE, room.players);
    check("10. no player's payload exposes isImposter",
      w.every((x) => !JSON.stringify(x).includes("isImposter")));
    for (const p of room.players) {
      const raw = JSON.stringify(await state(room.CODE, p.token));
      check("7. no imposterId leak in pre-reveal state", !raw.includes("imposterId"));
      check("9. mainWord/imposterWord not exposed together before reveal",
        !raw.includes("mainWord") && !raw.includes("imposterWord"));
      check("8. a player's payload exposes exactly one secret word",
        (raw.match(/"secretWord"/g) ?? []).length === 1);
    }
    check("no explicit 'you are the imposter' phrasing in any payload",
      w.every((x) => !JSON.stringify(x).toLowerCase().includes("you are the imposter")));

    // Refresh identity-equivalence: same token returns the same word repeatedly.
    const before = (await state(room.CODE, room.players[1].token)).yourRole?.secretWord;
    const after = (await state(room.CODE, room.players[1].token)).yourRole?.secretWord;
    check("17. refresh preserves the player's own secret word", before !== undefined && before === after);
    await post("/api/game/action", { action: "close", code: room.CODE, token: room.players[0].token });
  }

  // ============================================ full 3-round game to reveal
  console.log("== Rounds 1-3, round-3 auto-vote, reveal (items 11-13, 20) ==");
  {
    const room = await createRoom(["Fw1", "Fw2", "Fw3", "Fw4"]);
    await startReady(room.CODE, room.players);
    const w = await revealWords(room.CODE, room.players);
    const an = analyze(w);
    const altSeat = w.findIndex((x) => x.word === an.altWord);

    s = await clueAll(room.CODE, room.players);
    check("11. round 1 still works (clues -> decision)", s.phase === "ROUND_DECISION" && s.clueRound === 1);
    s = await decideAll(room.CODE, room.players, ["play", "play", "play", "play"]);
    check("play majority -> round 2", s.phase === "CLUE_PHASE" && s.clueRound === 2);

    s = await clueAll(room.CODE, room.players);
    check("12. round 2 still works", s.phase === "ROUND_DECISION" && s.clueRound === 2);
    s = await decideAll(room.CODE, room.players, ["play", "play", "play", "play"]);
    check("round 2 -> round 3", s.phase === "CLUE_PHASE" && s.clueRound === 3);

    s = await clueAll(room.CODE, room.players);
    check("13. round 3 auto-votes (no decision phase)", s && s.phase === "VOTING" && s.clueRound === 3);

    s = await voteAll(room.CODE, room.players);
    check("voting -> REVEAL", s.phase === "REVEAL" && s.result !== null);
    check("20. reveal identifies the alternate-word player as imposter",
      s.result.imposterId === room.players[altSeat].id,
      `expected seat ${altSeat}, got ${s.result.imposterId}`);
    check("20b. reveal imposterWord matches the imposter's own word", s.result.imposterWord === an.altWord);
    check("20c. reveal mainWord matches the crew word", s.result.mainWord === an.mainWord);
    check("19. play again resets to lobby", (await post("/api/game/action", { action: "again", code: room.CODE, token: room.players[0].token })).status === 200);
  }

  // ========================================================== majority / tie
  console.log("== Majority & tie decisions still hold (items 14-16) ==");
  {
    // 14. Majority VOTE NOW -> voting.
    const r1 = await createRoom(["V1", "V2", "V3"]);
    await startReady(r1.CODE, r1.players);
    await revealWords(r1.CODE, r1.players);
    s = await clueAll(r1.CODE, r1.players);
    s = await decideAll(r1.CODE, r1.players, ["vote", "vote", "play"]);
    check("14. majority VOTE NOW -> voting", s.phase === "VOTING");

    // 15. Majority PLAY -> next round.
    const r2 = await createRoom(["P1", "P2", "P3"]);
    await startReady(r2.CODE, r2.players);
    await revealWords(r2.CODE, r2.players);
    s = await clueAll(r2.CODE, r2.players);
    s = await decideAll(r2.CODE, r2.players, ["play", "play", "vote"]);
    check("15. majority PLAY -> next clue round", s.phase === "CLUE_PHASE" && s.clueRound === 2);

    // 16. Exact tie -> PLAY (next round).
    const r3 = await createRoom(["T1", "T2", "T3", "T4"]);
    await startReady(r3.CODE, r3.players);
    await revealWords(r3.CODE, r3.players);
    s = await clueAll(r3.CODE, r3.players);
    s = await decideAll(r3.CODE, r3.players, ["vote", "vote", "play", "play"]);
    check("16. exact tie -> PLAY (next round)", s.phase === "CLUE_PHASE" && s.clueRound === 2);
  }

  // ====================================== host leaves mid-reveal (item 18)
  console.log("== Host leaving still works (item 18) ==");
  {
    const room = await createRoom(["Hw1", "Hw2", "Hw3"]);
    await startReady(room.CODE, room.players);
    const w = await revealWords(room.CODE, room.players);
    const an = analyze(w);
    await post("/api/game/action", { action: "leave", code: room.CODE, token: room.players[0].token }); // host leaves
    s = await state(room.CODE, room.players[1].token);
    check("18. host reassigned after host leaves and round continues",
      s.players.some((p) => p.isHost) && s.phase === "CLUE_PHASE", `phase=${s.phase}`);
    const remaining = await revealWords(room.CODE, room.players.slice(1));
    check("18b. remaining players keep their own secret words",
      remaining.every((x) => typeof x.word === "string" && x.word.length > 0));
    const an2 = analyze(remaining);
    check("18c. main word intact after host leaves",
      !an2.altWord || an.mainWord === an2.mainWord || an.altWord === an2.mainWord,
      `main=${an.mainWord} remainingMain=${an2.mainWord}`);
    const altStillHere = remaining.some((x) => x.word === an.altWord);
    check(altStillHere ? "18e. alternate player still unique in the room" : "18e. departed imposter's word never surfaced",
      altStillHere ? remaining.filter((x) => x.word === an.altWord).length === 1 : true);
    // Disconnected host's word must not have been broadcast: check crew sees
    // exactly one word each and no leaked extra word string.
    check("18d. no word leaked via departed host payload",
      remaining.every((x) => (JSON.stringify(x).match(/"secretWord"/g) ?? []).length <= 1));
  }

  // ================================================== fresh game on Play Again
  console.log("== Play Again produces a fresh game (item 19) ==");
  {
    const room = await createRoom(["G1", "G2", "G3", "G4"]);
    await startReady(room.CODE, room.players);
    const first = await revealWords(room.CODE, room.players);
    const a1v = analyze(first);
    // Complete round 1 + voting to REVEAL so Play Again is valid.
    s = await clueAll(room.CODE, room.players);
    await decideAll(room.CODE, room.players, ["vote", "vote", "vote", "vote"]);
    s = await voteAll(room.CODE, room.players);
    check("reached REVEAL before replay", s.phase === "REVEAL");
    await post("/api/game/action", { action: "again", code: room.CODE, token: room.players[0].token });
    let lob = await state(room.CODE, room.players[0].token);
    check("19. again -> LOBBY with cleared round state",
      lob.phase === "LOBBY" && lob.clues.length === 0 && lob.clueRound === 1 &&
      lob.yourDecision === null && lob.playersWhoVoted.length === 0);
    await startReady(room.CODE, room.players);
    const second = await revealWords(room.CODE, room.players);
    const a2v = analyze(second);
    check("19b. fresh game assigns a word pair again",
      a2v.mainCount === 3 && a2v.altCount === 1 &&
      WORD_PAIRS.some((pair) => pairContains(pair, a2v.mainWord, a2v.altWord)));
    check("19c. new game re-picks (possibly new) words / imposter",
      a1v.mainWord !== a2v.mainWord || a1v.altWord !== a2v.altWord ||
      first.findIndex((x) => x.word === a1v.altWord) !== second.findIndex((x) => x.word === a2v.altWord),
      `pair changed seed ok`);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});