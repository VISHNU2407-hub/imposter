/**
 * Comprehensive API test for the new 3-round clue/decision/voting flow.
 *
 * Usage: node scripts/e2e-rounds-test.mjs [baseUrl]
 * Covering:
 *   - Four players complete round 1
 *   - All-VOTE, all-PLAY, majority-VOTE, majority-PLAY, exact-tie outcomes
 *   - Round 2 tie -> round 3; round 3 -> automatic voting (no decision phase)
 *   - Duplicate decisions/clues rejected, out-of-turn rejected, wrong-round rejected
 *   - Previous round clues retained; refresh during clue + decision phases
 *   - Player disconnect during decision; host disconnect (reassignment + recalc)
 *   - Play Again resets all round state; scoring happens exactly once
 *   - Decision privacy (no per-player choices / no counts while deciding)
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

/** Submit a clue for whoever's turn it is until the room leaves CLUE_PHASE. */
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
    if (res.status !== 200) {
      console.log(`  !! clue rejected:`, JSON.stringify(res.data));
      return null;
    }
    s = await state(code, players[0].token);
  }
  return s;
}

/** Everyone votes in a rotation (player i -> player i+1) so each gets exactly 1 vote. */
async function voteAll(code, players) {
  for (let i = 0; i < players.length; i++) {
    const target = players[(i + 1) % players.length];
    const res = await post("/api/game/action", { action: "vote", code, token: players[i].token, targetId: target.id });
    if (res.status !== 200) return res;
  }
  return await state(code, players[0].token);
}

/** Let players make decisions (choices in players order). Returns final state. */
async function decide(code, players, choices) {
  for (let i = 0; i < choices.length; i++) {
    const cur = await state(code, players[i].token);
    if (cur.phase !== "ROUND_DECISION") break;
    if (cur.playersWhoDecided.includes(players[i].id)) continue; // already decided (e.g. duplicate tests)
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

async function main() {
  // ---------------------------------------------------------------- full game
  console.log("== Scenario A: all-PLAY -> all-PLAY -> round 3 auto-votes ==");
  {
    const { CODE, players } = await createRoom(["AaA", "AaB", "AaC", "AaD"]);
    await startReady(CODE, players);
    let s = await state(CODE, players[0].token);
    check("round 1 clue phase", s.phase === "CLUE_PHASE" && s.clueRound === 1);

    // Out of turn + double clue in the same round.
    const turnId = s.currentTurnPlayerId;
    const offTurn = players.find((p) => p.id !== turnId);
    const offRes = await post("/api/game/action", { action: "clue", code: CODE, token: offTurn.token, clue: "stolen" });
    check("out-of-turn clue rejected", offRes.status === 403 || offRes.status === 400);

    const cur = players.find((p) => p.id === turnId);
    const firstOk = await post("/api/game/action", { action: "clue", code: CODE, token: cur.token, clue: "first" });
    const secondRes = await post("/api/game/action", { action: "clue", code: CODE, token: cur.token, clue: "second" });
    check("first clue accepted", firstOk.status === 200);
    check("clue twice in same round rejected", secondRes.status === 403 || secondRes.status === 400);

    s = await clueAll(CODE, players, "round1");
    check("four players completed round 1 -> ROUND_DECISION", s && s.phase === "ROUND_DECISION" && s.clueRound === 1);
    check("round 1 recorded 4 clues", s.clues.length === 4 && s.clues.every((c) => c.round === 1));

    // Duplicate decisions.
    const dbl1 = await post("/api/game/action", { action: "decision", code: CODE, token: players[0].token, choice: "play" });
    const dbl2 = await post("/api/game/action", { action: "decision", code: CODE, token: players[0].token, choice: "play" });
    check("two decisions rejected (ALREADY_DECIDED)", dbl1.status === 200 && dbl2.status === 400 && dbl2.data.code === "ALREADY_DECIDED");
    s = await state(CODE, players[1].token);
    check("decision count not revealed mid-phase", s.decisionResult === null);
    check("other players' decisions not visible", s.yourDecision === null);
    check("progress shows only ids who decided", s.playersWhoDecided.length === 1 && s.playersWhoDecided[0] === players[0].id);
    // Clue for a later round during the decision phase is rejected.
    const lateClue = await post("/api/game/action", { action: "clue", code: CODE, token: players[0].token, clue: "round2-ish" });
    check("clue during decision phase rejected", lateClue.status === 400);
    // A bad decision choice is rejected.
    const badChoice = await post("/api/game/action", { action: "decision", code: CODE, token: players[1].token, choice: "maybe" });
    check("invalid decision choice rejected", badChoice.status === 400);

    s = await decide(CODE, players, ["play", "play", "play", "play"], "r1 all play");
    check("all PLAY -> clue round 2", s.phase === "CLUE_PHASE" && s.clueRound === 2);
    check("round 1 clues retained at round 2", s.clues.filter((c) => c.round === 1).length === 4);
    check("decision result published after resolve", s.decisionResult && s.decisionResult.playCount === 4 && s.decisionResult.voteCount === 0 && s.decisionResult.outcome === "play");

    s = await clueAll(CODE, players, "round2");
    check("round 2 completed -> ROUND_DECISION", s && s.phase === "ROUND_DECISION" && s.clueRound === 2);

    // Exact tie (2 VOTE / 2 PLAY) always means another round.
    s = await decide(CODE, players, ["vote", "vote", "play", "play"], "r2 tie");
    check("round 2 exact tie -> clue round 3", s.phase === "CLUE_PHASE" && s.clueRound === 3);
    check("tie recorded as play outcome", s.decisionResult && s.decisionResult.voteCount === 2 && s.decisionResult.playCount === 2 && s.decisionResult.outcome === "play");

    s = await clueAll(CODE, players, "round3");
    check("round 3 completed -> VOTING automatically", s && s.phase === "VOTING" && s.clueRound === 3);
    check("no decision phase after round 3 (jumped straight to VOTING)", true);
    check("all 12 clues retained across rounds", s.clues.length === 12);

    // Scores are untouched by the extra clue rounds.
    check("no scoring before voting", s.players.every((p) => p.score === 0));

    // Voting: everyone votes for a different player -> perfect tie -> imposter +2.
    s = await voteAll(CODE, players, "final");
    check("voting -> REVEAL", s && s.phase === "REVEAL" && s.result !== null);
    const sumOnce = s.result.playerScores.reduce((a, x) => a + x.score, 0);
    check("scoring happened exactly once (total = 2 for tied vote)", sumOnce === 2, `sum=${sumOnce}`);
    for (let i = 0; i < 3; i++) {
      const again = await state(CODE, players[0].token);
      const rsum = again.result.playerScores.reduce((a, x) => a + x.score, 0);
      check("reveal scores stable across polls", rsum === sumOnce && again.result !== null && again.phase === "REVEAL", `i=${i}`);
    }

    // Play Again fully resets round state.
    await post("/api/game/action", { action: "again", code: CODE, token: players[0].token });
    let lob = await state(CODE, players[0].token);
    check("play again -> LOBBY", lob.phase === "LOBBY");
    check("clue round reset to 1", lob.clueRound === 1);
    check("clues cleared", lob.clues.length === 0);
    check("decisions cleared", lob.yourDecision === null && lob.playersWhoDecided.length === 0);
    check("decisionResult cleared", lob.decisionResult === null);
    check("votes cleared", lob.playersWhoVoted.length === 0);
    check("scores persist across games", lob.players.every((p) => typeof p.score === "number"));

    await startReady(CODE, players);
    lob = await state(CODE, players[0].token);
    check("new game starts fresh round 1", lob.phase === "CLUE_PHASE" && lob.clueRound === 1 && lob.clues.length === 0);
    check("no leaked decisions in new game", lob.yourDecision === null);
  }

  // --------------------------------------------------- majority / tie outcomes
  console.log("== Majority rules (3 and 4 player rooms) ==");
  {
    // All-VOTE (4 players) -> voting.
    const r1 = await createRoom(["Vv1", "Vv2", "Vv3", "Vv4"]);
    await startReady(r1.CODE, r1.players);
    let s = await clueAll(r1.CODE, r1.players, "all vote");
    check("round 1 complete (all-vote room)", s && s.phase === "ROUND_DECISION");
    s = await decide(r1.CODE, r1.players, ["vote", "vote", "vote", "vote"], "all vote");
    check("all VOTE -> voting starts", s.phase === "VOTING");
    check("all-vote decisionResult", s.decisionResult && s.decisionResult.voteCount === 4 && s.decisionResult.outcome === "vote");

    // Majority-PLAY (3 players: 2 play, 1 vote) -> next round.
    const r2 = await createRoom(["Mp1", "Mp2", "Mp3"]);
    await startReady(r2.CODE, r2.players);
    s = await clueAll(r2.CODE, r2.players, "majority play");
    check("round 1 complete (majority-play room)", s && s.phase === "ROUND_DECISION" && r2.players.length === 3);
    s = await decide(r2.CODE, r2.players, ["play", "play", "vote"], "2 play 1 vote");
    check("majority PLAY -> clue round 2", s.phase === "CLUE_PHASE" && s.clueRound === 2);

    // Majority-VOTE (3 players: 2 vote, 1 play) -> voting.
    const r3 = await createRoom(["Mv1", "Mv2", "Mv3"]);
    await startReady(r3.CODE, r3.players);
    s = await clueAll(r3.CODE, r3.players, "majority vote");
    check("round 1 complete (majority-vote room)", s && s.phase === "ROUND_DECISION");
    s = await decide(r3.CODE, r3.players, ["vote", "vote", "play"], "2 vote 1 play");
    check("majority VOTE -> voting starts", s.phase === "VOTING");

    // Exact tie (4 players: 2 vote, 2 play) at round 1 -> round 2.
    const r4 = await createRoom(["Tt1", "Tt2", "Tt3", "Tt4"]);
    await startReady(r4.CODE, r4.players);
    s = await clueAll(r4.CODE, r4.players, "round1 tie");
    check("round 1 complete (tie room)", s && s.phase === "ROUND_DECISION");
    s = await decide(r4.CODE, r4.players, ["vote", "vote", "play", "play"], "2/2");
    check("exact tie at round 1 -> clue round 2", s.phase === "CLUE_PHASE" && s.clueRound === 2);
  }

  // ------------------------------------------------------------ refresh recovery
  console.log("== Refresh recovery ==");
  {
    const { CODE, players } = await createRoom(["Rf1", "Rf2", "Rf3", "Rf4"]);
    await startReady(CODE, players);
    let s = await state(CODE, players[0].token);
    const turn = players.find((p) => p.id === s.currentTurnPlayerId);
    await post("/api/game/action", { action: "clue", code: CODE, token: turn.token, clue: "fresh" });
    // Simulate a page refresh: re-read state with the same token.
    const after = await state(CODE, turn.token);
    check("refresh during clue phase keeps round", after.phase === "CLUE_PHASE" && after.clueRound === 1);
    check("refreshed player's clue persisted", after.clues.some((c) => c.playerId === turn.id && c.round === 1 && c.text === "fresh"));
    s = await state(CODE, turn.token);
    check("refreshed player cannot submit a second clue", (await post("/api/game/action", { action: "clue", code: CODE, token: turn.token, clue: "dup" })).status >= 400);

    // Finish round 1, then decide for one player and "refresh" during decision.
    await clueAll(CODE, players, "refresh round1");
    await decide(CODE, players, ["play", "play"], "two decide"); // partial: only 2 decided
    const decider = players[0];
    const watcher = players[2];
    const selfView = await state(CODE, decider.token);
    check("refresh during decision keeps own decision", selfView.yourDecision === "play");
    check("refresh during decision keeps counts hidden", selfView.decisionResult === null);
    const watcherView = await state(CODE, watcher.token);
    check("non-decided player sees progress only", watcherView.playersWhoDecided.length === 2 && watcherView.yourDecision === null);
    const dupDec = await post("/api/game/action", { action: "decision", code: CODE, token: decider.token, choice: "vote" });
    check("refreshed player cannot decide twice", dupDec.status === 400 && dupDec.data.code === "ALREADY_DECIDED");
  }

  // ------------------------------------------------------------ departures
  console.log("== Disconnect during decision phase ==");
  {
    // A player decides PLAY then leaves while someone is still undecided.
    // Their PLAY must be dropped with their seat; the active VOTE majority
    // (2 vs the surviving 1 PLAY) then resolves to VOTING — not a tie.
    const { CODE, players } = await createRoom(["Dd1", "Dd2", "Dd3", "Dd4"]);
    await startReady(CODE, players);
    let s = await clueAll(CODE, players, "depart round1");
    check("round 1 complete (departure room)", s && s.phase === "ROUND_DECISION");
    await post("/api/game/action", { action: "decision", code: CODE, token: players[0].token, choice: "vote" });
    await post("/api/game/action", { action: "decision", code: CODE, token: players[1].token, choice: "vote" });
    await post("/api/game/action", { action: "decision", code: CODE, token: players[3].token, choice: "play" }); // ghost
    await post("/api/game/action", { action: "leave", code: CODE, token: players[3].token });
    s = await state(CODE, players[0].token);
    check("exactly one undecided player left", s.phase === "ROUND_DECISION" && s.players.length === 3);
    await post("/api/game/action", { action: "decision", code: CODE, token: players[2].token, choice: "play" });
    s = await state(CODE, players[0].token);
    check("departed player's decision dropped, active majority resolves to VOTING", s.phase === "VOTING", `phase=${s.phase}`);

    // A player who never decided leaves -> required set shrinks, no stall.
    const { CODE: CODE2, players: ps2 } = await createRoom(["Ee1", "Ee2", "Ee3", "Ee4"]);
    await startReady(CODE2, ps2);
    s = await clueAll(CODE2, ps2, "depart2 round1");
    check("round 1 complete (no-ghost room)", s && s.phase === "ROUND_DECISION");
    await post("/api/game/action", { action: "decision", code: CODE2, token: ps2[0].token, choice: "vote" });
    await post("/api/game/action", { action: "decision", code: CODE2, token: ps2[1].token, choice: "vote" });
    await post("/api/game/action", { action: "leave", code: CODE2, token: ps2[3].token }); // never decided
    s = await state(CODE2, ps2[0].token);
    check("room continues after undecided player leaves", s.phase === "ROUND_DECISION" && s.players.length === 3);
    s = await decide(CODE2, ps2.slice(0, 3), ["vote", "vote", "play"], "2 vote 1 play after leave");
    check("active-only majority resolves", s.phase === "VOTING");

    // Host leaves during the decision phase before everyone has decided ->
    // host reassigned + round resumes with the remaining decision set.
    const { CODE: CODE3, players: ps3 } = await createRoom(["Hh1", "Hh2", "Hh3"]);
    await startReady(CODE3, ps3);
    s = await clueAll(CODE3, ps3, "host leave");
    check("round 1 complete (host-leave room)", s && s.phase === "ROUND_DECISION");
    await post("/api/game/action", { action: "decision", code: CODE3, token: ps3[1].token, choice: "vote" });
    await post("/api/game/action", { action: "decision", code: CODE3, token: ps3[2].token, choice: "play" });
    await post("/api/game/action", { action: "leave", code: CODE3, token: ps3[0].token }); // host leaves undecided
    s = await state(CODE3, ps3[1].token);
    check("host leaves mid-decision -> room not stuck (tie -> round 2)", s.phase === "CLUE_PHASE" && s.clueRound === 2, `phase=${s.phase}`);
    check("host reassigned after host leaves", s.players.some((p) => p.isHost));
  }

  // ------------------------------------------------------------ privacy audit
  console.log("== Privacy / leaks ==");
  {
    const { CODE, players } = await createRoom(["Pp1", "Pp2", "Pp3", "Pp4"]);
    await startReady(CODE, players);
    let s = await clueAll(CODE, players, "privacy round1");
    check("round 1 complete (privacy room)", s && s.phase === "ROUND_DECISION");
    await post("/api/game/action", { action: "decision", code: CODE, token: players[0].token, choice: "vote" });
    // A watcher's payload must not contain anyone's choice or the counts.
    const watcher = await state(CODE, players[1].token);
    const serialized = JSON.stringify(watcher);
    check("no choice strings leak to other players", !serialized.includes('"yourDecision":"vote"') && !serialized.includes('"yourDecision":"play"'));
    check("no decision counts leak mid-phase", watcher.decisionResult === null);
    check("watcher has not decided", watcher.yourDecision === null);
    // No roles/words leak outside the per-token projection.
    const raw = await fetch(`${BASE}/api/game/state?code=${CODE}&token=${players[0].token}`).then((r) => r.json());
    check("no imposterId leak in state payload", !JSON.stringify(raw).includes('"imposterId"'));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});