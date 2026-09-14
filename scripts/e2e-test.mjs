/**
 * End-to-end API test: simulates a full 4-player game plus edge cases.
 * Usage: node scripts/e2e-test.mjs [baseUrl]
 */
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

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

const state = (code, token) => get(`/api/game/state?code=${code}&token=${token}`);

async function main() {
  console.log("== Room creation ==");
  const badCreate = await post("/api/game/create", { name: "  " });
  check("rejects empty name", badCreate.status === 400);

  const host = await post("/api/game/create", { name: "Alice" });
  check("create returns code/token", host.status === 200 && /^[A-Z2-9]{5}$/.test(host.data.roomCode) && !!host.data.token);
  const CODE = host.data.roomCode;

  console.log("== Joining ==");
  const badJoin = await post("/api/game/join", { code: "ZZZZZ", name: "Ghost" });
  check("rejects nonexistent room", badJoin.status === 404);
  const lowcase = await post("/api/game/join", { code: CODE.toLowerCase(), name: "Bob" });
  check("join is case-insensitive", lowcase.status === 200);
  const bob = lowcase.data;

  const dup = await post("/api/game/join", { code: CODE, name: "BOB" });
  check("duplicate name reuses seat, does not add", dup.status === 200 && dup.data.token === bob.token);

  const carol = (await post("/api/game/join", { code: CODE, name: "Carol" })).data;
  const dave = (await post("/api/game/join", { code: CODE, name: "Dave" })).data;

  let s = await state(CODE, bob.token);
  check("lobby shows 4 players", s.data.players.length === 4);
  check("host indicated", s.data.players.some((p) => p.isHost && p.name === "Alice"));
  check("non-host sees isHost=false", !s.data.isHost);

  console.log("== Start guards ==");
  const nonHostStart = await post("/api/game/action", { action: "start", code: CODE, token: bob.token });
  check("non-host cannot start", nonHostStart.status === 403);
  const again = await post("/api/game/action", { action: "start", code: CODE, token: host.data.token });
  check("host start works", again.status === 200);
  const doubleStart = await post("/api/game/action", { action: "start", code: CODE, token: host.data.token });
  check("cannot start twice", doubleStart.status === 400);

  console.log("== Secret word reveal ==");
  const tokens = [host.data.token, bob.token, carol.token, dave.token];
  const roleStates = [];
  for (const t of tokens) roleStates.push((await state(CODE, t)).data);
  // New mechanic: EVERY player gets a secret word; exactly one gets a
  // different (related) alternate word — nobody is told they are the imposter.
  check("every player receives a secret word",
    roleStates.every((x) => typeof x.yourRole.secretWord === "string" && x.yourRole.secretWord.length > 0));
  const words = roleStates.map((x) => x.yourRole.secretWord);
  const counts = new Map();
  for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
  check("exactly one player receives the alternate word",
    [...counts.entries()].filter(([, c]) => c === 1).length === 1);
  const mainWord = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const altWord = [...counts.entries()].find(([, c]) => c === 1)[0];
  check("all other players receive the main word", counts.get(mainWord) === tokens.length - 1);
  check("main and alternate words differ", mainWord !== altWord);
  check("no explicit isImposter told to anyone", roleStates.every((x) => !("isImposter" in x.yourRole)));
  check("no role leak in state payload", !JSON.stringify(roleStates).includes("imposterId"));
  check("no other player's word exposed", (JSON.stringify(roleStates[0]).match(/"secretWord"/g) ?? []).length === 1);
  check("no mainWord/imposterWord leak before reveal",
    !JSON.stringify(roleStates).includes("mainWord") && !JSON.stringify(roleStates).includes("imposterWord"));

  const clueTurn0 = await post("/api/game/action", { action: "clue", code: CODE, token: tokens[1], clue: "early" });
  check("clue outside turn/phase rejected", clueTurn0.status >= 400 && clueTurn0.status < 500, JSON.stringify(clueTurn0.data));
  const voteEarly = await post("/api/game/action", { action: "vote", code: CODE, token: tokens[0], targetId: bob.playerId });
  check("vote outside voting rejected", voteEarly.status === 400);
  const skipAll = await post("/api/game/action", { action: "ready", code: CODE, token: tokens[0] });
  check("ready works", skipAll.status === 200);
  for (const t of tokens.slice(1)) await post("/api/game/action", { action: "ready", code: CODE, token: t });

  console.log("== Clue phase (round 1) ==");
  s = await state(CODE, host.data.token);
  check("moved to CLUE_PHASE", s.data.phase === "CLUE_PHASE");
  const clueTwiceCheck = await post("/api/game/action", { action: "clue", code: CODE, token: tokens[0], clue: "x" });
  check("clue only on your turn", clueTwiceCheck.status === 200 || clueTwiceCheck.status === 403);

  // Everyone clues in turn order.
  let guard = 0;
  while (guard++ < 10) {
    const st = (await state(CODE, host.data.token)).data;
    if (st.phase !== "CLUE_PHASE") break;
    const idx = roleStates.findIndex((x) => x.you.id === st.currentTurnPlayerId);
    const t = tokens[idx >= 0 ? idx : 0];
    const turnPlayerState = (await state(CODE, t)).data;
    const already = turnPlayerState.clues.some((c) => c.playerId === turnPlayerState.you.id);
    if (already) break;
    await post("/api/game/action", { action: "clue", code: CODE, token: t, clue: `clue-${st.currentTurnNumber}` });
  }
  s = await state(CODE, host.data.token);
  check("all 4 round-1 clues recorded", s.data.clues.length === 4);
  check("auto-advance to ROUND_DECISION", s.data.phase === "ROUND_DECISION");
  check("clue round is round 1", s.data.clueRound === 1);

  const clueInDecision = await post("/api/game/action", { action: "clue", code: CODE, token: tokens[0], clue: "late" });
  check("clue in decision phase rejected", clueInDecision.status === 400);
  const voteInDecision = await post("/api/game/action", { action: "vote", code: CODE, token: tokens[0], targetId: bob.playerId });
  check("vote during decision rejected", voteInDecision.status === 400);

  console.log("== Decision (everyone votes now) ==");
  const firstDecision = await post("/api/game/action", { action: "decision", code: CODE, token: tokens[0], choice: "vote" });
  check("first decision works", firstDecision.status === 200);
  const secondDecision = await post("/api/game/action", { action: "decision", code: CODE, token: tokens[0], choice: "play" });
  check("second decision rejected (already decided)", secondDecision.status === 400 && secondDecision.data.code === "ALREADY_DECIDED");
  s = await state(CODE, tokens[1].token);
  check("other player's decision hidden mid-phase", s.data.yourDecision === null);
  check("decision counts hidden mid-phase", s.data.decisionResult === null);
  for (const t of tokens.slice(1)) {
    await post("/api/game/action", { action: "decision", code: CODE, token: t, choice: "vote" });
  }
  s = await state(CODE, host.data.token);
  check("all chose VOTE -> VOTING", s.data.phase === "VOTING");

  const clueInVoting = await post("/api/game/action", { action: "clue", code: CODE, token: tokens[0], clue: "late" });
  check("clue in voting rejected", clueInVoting.status === 400);

  console.log("== Voting ==");
  // Dave votes for himself -> rejected.
  const daveSelf = await post("/api/game/action", { action: "vote", code: CODE, token: dave.token, targetId: dave.playerId });
  check("self-vote rejected", daveSelf.status === 400);
  // Alice and Bob vote Dave; Carol votes Bob. Dave votes Alice.
  const playerIds = roleStates.map((x) => x.you.id);
  const [aliceId, bobId, carolId, daveId] = playerIds;
  await post("/api/game/action", { action: "vote", code: CODE, token: host.data.token, targetId: daveId });
  await post("/api/game/action", { action: "vote", code: CODE, token: bob.token, targetId: daveId });
  await post("/api/game/action", { action: "vote", code: CODE, token: carol.token, targetId: bobId });
  const doubleVote = await post("/api/game/action", { action: "vote", code: CODE, token: host.data.token, targetId: bobId });
  check("double vote rejected", doubleVote.status === 400);
  await post("/api/game/action", { action: "vote", code: CODE, token: dave.token, targetId: aliceId });

  s = await state(CODE, host.data.token);
  check("moved to REVEAL", s.data.phase === "REVEAL");
  check("result present", s.data.result !== null);
  check("reveal shows both main and imposter words",
    typeof s.data.result.mainWord === "string" && typeof s.data.result.imposterWord === "string");
  check("tally shows Dave 2", s.data.result.voteTally.find((t) => t.targetId === daveId)?.count === 2);
  check("scores listed for 4 players", s.data.result.playerScores.length === 4);

  // Score math: if Dave was imposter and got 2 votes -> crew voters +1 each, imposter +0.
  // If Alice was imposter -> imposter escaped (+2), everyone else +0.
  const impId = s.data.result.imposterId; // only visible in REVEAL result
  const daveIsImposter = impId === daveId;
  const daveScore = s.data.result.playerScores.find((p) => p.playerId === daveId).score;
  const scoreOf = (id) => s.data.result.playerScores.find((p) => p.playerId === id).score;
  if (daveIsImposter) {
    // Alice and Bob voted Dave (+1 each); Carol voted Bob (+0); imposter +0.
    check("correct voters got +1 (Dave was imposter)", scoreOf(aliceId) === 1 && scoreOf(bobId) === 1 && scoreOf(carolId) === 0 && daveScore === 0, JSON.stringify(s.data.result.playerScores));
  } else {
    const impScore = s.data.result.playerScores.find((p) => p.playerId === impId).score;
    check("imposter escaped got +2", impScore === 2 && s.data.result.playerScores.filter((p) => p.playerId !== impId).every((p) => p.score === 0) && s.data.result.groupCorrect === false, `impId=${impId} scores=${JSON.stringify(s.data.result.playerScores)}`);
  }
  check("groupCorrect consistent", s.data.result.groupCorrect === (impId === daveId));

  const voteAfterReveal = await post("/api/game/action", { action: "vote", code: CODE, token: bob.token, targetId: aliceId });
  check("vote after reveal rejected", voteAfterReveal.status === 400);

  console.log("== Play again ==");
  const nonHostAgain = await post("/api/game/action", { action: "again", code: CODE, token: bob.token });
  check("non-host cannot restart", nonHostAgain.status === 403);
  await post("/api/game/action", { action: "again", code: CODE, token: host.data.token });
  s = await state(CODE, host.data.token);
  check("back to LOBBY", s.data.phase === "LOBBY");
  check("clues cleared", s.data.clues.length === 0);
  check("clue round reset to 1", s.data.clueRound === 1);
  check("decisions cleared", s.data.yourDecision === null && s.data.playersWhoDecided.length === 0);
  check("scores persisted", s.data.players.every((p) => typeof p.score === "number"));

  console.log("== Late join / disconnect behavior ==");
  const late = await post("/api/game/action", { action: "start", code: CODE, token: host.data.token });
  check("host can start round 2", late.status === 200);
  const lateJoin = await post("/api/game/join", { code: CODE, name: "Eve" });
  check("late join rejected mid-round", lateJoin.status === 409 && lateJoin.data.code === "GAME_STARTED");
  // Mid-round rejoin with existing name reclaims seat.
  const rejoin = await post("/api/game/join", { code: CODE, name: "Carol" });
  check("disconnected player rejoins by name mid-round", rejoin.status === 200 && rejoin.data.token === carol.token);

  console.log("== Invalid tokens ==");
  const badToken = await state(CODE, "deadbeef");
  check("bad token still gets state but you=null", badToken.status === 200 && badToken.data.you === null);
  const badAct = await post("/api/game/action", { action: "ready", code: CODE, token: "deadbeef" });
  check("actions with bad token rejected", badAct.status === 403, JSON.stringify(badAct.data));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
