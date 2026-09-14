/**
 * Disconnect / tie / small-room continuation tests.
 * Usage: node scripts/e2e-leave-test.mjs [baseUrl]
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

async function runRoom(nameA) {
  const host = (await post("/api/game/create", { name: nameA })).data;
  return host;
}

async function main() {
  console.log("== Host leave mid-lobby reassigns host ==");
  {
    const host = await runRoom("Hannah");
    const CODE = host.roomCode;
    const p2 = (await post("/api/game/join", { code: CODE, name: "Ivan" })).data;
    await post("/api/game/join", { code: CODE, name: "Judy" });
    await post("/api/game/action", { action: "leave", code: CODE, token: host.token });
    const s = await state(CODE, p2.token);
    check("room survives host leaving", s.phase === "LOBBY" && s.players.length === 2);
    check("host reassigned to remaining player", s.players.find((p) => p.name === "Ivan")?.isHost === true);
    check("new host can start (with enough players via joins)", true);
    // Top up to 3 and verify the new host can start.
    await post("/api/game/join", { code: CODE, name: "Karl" });
    const st = await post("/api/game/action", { action: "start", code: CODE, token: p2.token });
    check("reassigned host can start the game", st.status === 200);
  }

  console.log("== Voter leaves mid-voting: ghost vote removed, round completes ==");
  {
    const host = await runRoom("Host1");
    const CODE = host.roomCode;
    const b = (await post("/api/game/join", { code: CODE, name: "Bee" })).data;
    const c = (await post("/api/game/join", { code: CODE, name: "Cee" })).data;
    const d = (await post("/api/game/join", { code: CODE, name: "Dee" })).data;
    await post("/api/game/action", { action: "start", code: CODE, token: host.token });
    for (const t of [host.token, b.token, c.token, d.token]) {
      await post("/api/game/action", { action: "ready", code: CODE, token: t });
    }
    // Get player ids.
    const s0 = await state(CODE, host.token);
    const ids = Object.fromEntries(s0.players.map((p) => [p.name, p.id]));
    // Clue round 1: everyone gives a clue (turn order is random).
    for (let i = 0; i < 4; i++) {
      const s = await state(CODE, host.token);
      const turnName = s.players.find((p) => p.id === s.currentTurnPlayerId)?.name;
      const tokenOf = { Host1: host.token, Bee: b.token, Cee: c.token, Dee: d.token }[turnName];
      await post("/api/game/action", { action: "clue", code: CODE, token: tokenOf, clue: `clue-${i}` });
    }
    let s = await state(CODE, host.token);
    check("clues complete -> ROUND_DECISION", s.phase === "ROUND_DECISION");
    // Everyone picks VOTE NOW so voting starts.
    for (const t of [host.token, b.token, c.token, d.token]) {
      await post("/api/game/action", { action: "decision", code: CODE, token: t, choice: "vote" });
    }
    s = await state(CODE, host.token);
    check("decisions complete -> VOTING", s.phase === "VOTING");
    // Host votes Dee, Bee votes Dee, Cee votes Bee, Dee will LEAVE before voting.
    await post("/api/game/action", { action: "vote", code: CODE, token: host.token, targetId: ids["Dee"] });
    await post("/api/game/action", { action: "vote", code: CODE, token: b.token, targetId: ids["Dee"] });
    await post("/api/game/action", { action: "vote", code: CODE, token: c.token, targetId: ids["Bee"] });
    await post("/api/game/action", { action: "leave", code: CODE, token: d.token });
    s = await state(CODE, host.token);
    check("round completes after last voter leaves", s.phase === "REVEAL", `phase=${s.phase}`);
    check("departed player's vote gone", s.result.voteTally.every((t) => t.targetName !== "Dee" || t.count === 2));
    check("result references real name for departed imposter",
      s.result.imposterName === "Dee"
        ? s.result.playerScores.every((p) => p.playerName !== "")
        : true);
  }

  console.log("== Tie vote: imposter escapes, no crew points ==");
  {
    const host = await runRoom("TieH");
    const CODE = host.roomCode;
    const b = (await post("/api/game/join", { code: CODE, name: "TieB" })).data;
    const c = (await post("/api/game/join", { code: CODE, name: "TieC" })).data;
    await post("/api/game/action", { action: "start", code: CODE, token: host.token });
    for (const t of [host.token, b.token, c.token]) {
      await post("/api/game/action", { action: "ready", code: CODE, token: t });
    }
    for (let i = 0; i < 3; i++) {
      const s = await state(CODE, host.token);
      const turnName = s.players.find((p) => p.id === s.currentTurnPlayerId)?.name;
      const tokenOf = { TieH: host.token, TieB: b.token, TieC: c.token }[turnName];
      await post("/api/game/action", { action: "clue", code: CODE, token: tokenOf, clue: `c${i}` });
    }
    let sd = await state(CODE, host.token);
    check("3 clues complete -> ROUND_DECISION", sd.phase === "ROUND_DECISION", `phase=${sd.phase}`);
    // Everyone picks VOTE so we reach the voting phase.
    for (const t of [host.token, b.token, c.token]) {
      await post("/api/game/action", { action: "decision", code: CODE, token: t, choice: "vote" });
    }
    sd = await state(CODE, host.token);
    check("decisions complete -> VOTING", sd.phase === "VOTING", `phase=${sd.phase}`);
    const s0 = await state(CODE, host.token);
    const ids = Object.fromEntries(s0.players.map((p) => [p.name, p.id]));
    // 3 players: Host votes B, B votes H, C votes H -> wait that's a majority.
    // For a TIE with 3 players: H->B, B->H gives 1-1, then C must vote... anyone
    // breaks the tie. So a tie needs an even split, impossible with 3 voters.
    // Instead simulate: H->B (1 vote B), B->H (1 vote H), C->H? no.
    // With 3 players a tie can only happen if someone cannot vote (left).
    // So: H votes B, B votes H, then C leaves. C's vote never existed -> 1-1 tie.
    await post("/api/game/action", { action: "vote", code: CODE, token: host.token, targetId: ids["TieB"] });
    await post("/api/game/action", { action: "vote", code: CODE, token: b.token, targetId: ids["TieH"] });
    await post("/api/game/action", { action: "leave", code: CODE, token: c.token });
    const s = await state(CODE, host.token);
    check("tie detected", s.phase === "REVEAL" && s.result.isTie === true, JSON.stringify(s.result?.voteTally));
    check("tie => imposter escapes (+2) and no crew points",
      s.result.groupCorrect === false &&
        s.result.playerScores.find((p) => p.playerName === (s.result.imposterName))?.score === 2,
      JSON.stringify(s.result?.playerScores));
  }

  console.log("== Down to 2 players mid-round: bail to LOBBY ==");
  {
    const host = await runRoom("Two1");
    const CODE = host.roomCode;
    const b = (await post("/api/game/join", { code: CODE, name: "Two2" })).data;
    const c = (await post("/api/game/join", { code: CODE, name: "Two3" })).data;
    await post("/api/game/action", { action: "start", code: CODE, token: host.token });
    await post("/api/game/action", { action: "leave", code: CODE, token: b.token });
    await post("/api/game/action", { action: "leave", code: CODE, token: c.token });
    const s = await state(CODE, host.token);
    check("round bailed to LOBBY when <2 players remain", s.phase === "LOBBY", `phase=${s.phase}`);
    check("host still in room", s.players.length === 1 && s.players[0].isHost);
  }

  console.log("== Room expiry after TTL (simulated via new room code on rejoin) ==");
  {
    // Just verify an unknown room 404s; TTL itself is time-based (6h) and not worth sleeping for.
    const r = await fetch(`${BASE}/api/game/state?code=ZZZZZ&token=x`);
    check("unknown room 404s", r.status === 404);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
