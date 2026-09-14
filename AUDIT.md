# MVP Audit — Guess the Imposter

Audit performed after the MVP was complete, per the project brief. Issues were classified,
all **CRITICAL** and **HIGH** issues were fixed, and the audit was then re-run (typecheck +
lint + production build + 55 automated end-to-end assertions across two suites, repeated
runs with random imposter/turn-order).

Legend: ✅ fixed · ⚠️ accepted limitation (documented, simplest-safe behavior)

---

## 1. Game flow
- ✅ **HIGH — Reveal phase could orphan the room.** The host's "Return to Lobby" called
  `leaveRoom` instead of resetting the round, so a host following the obvious button
  destroyed their own room and everyone else was stranded in REVEAL.
  *Where:* `src/components/Reveal.tsx`. *Fix:* removed the host-leave button; REVEAL now
  offers "Play Again" (host) and "Leave Room" (anyone); the round flows REVEAL → LOBBY
  only via Play Again.

## 2. Room creation
- ✅ Code generation uses `crypto.getRandomValues` with an ambiguity-free alphabet
  (no 0/O/1/I/L), collision-checked against live rooms. Room codes are 5 chars
  (within the required 4–6 range).
- ✅ Empty host names rejected server-side (`VALIDATION`, 400).

## 3. Room joining
- ✅ **HIGH — ambiguous failure for join-after-restart.** After a server restart every
  stored identity would dead-end on a room that no longer exists. *Where:*
  `src/lib/useRoom.ts`. *Fix:* the polling loop detects `NOT_FOUND`, clears the stale
  identity, and shows "This room no longer exists."; the room page offers a join link.
- ✅ Nonexistent codes → 404 with a clear message; codes are case-insensitive and
  whitespace-trimmed.
- ⚠️ Duplicate names: joining with an existing name **reclaims that seat** (this is what
  makes refresh-recovery work). In LOBBY a *different* person typing an existing name takes
  over that seat. Accepted for an MVP party game (documented in README); robustness would
  require real auth.

## 4. Multiplayer synchronization
- ✅ Single polling loop per mounted view; one request doubles as state sync + heartbeat.
  Backoff 1.5 s → 8 s on failures; **instant wake on tab visibility change** (background
  tabs throttle timers, which previously stalled sync for up to a minute).
- ⚠️ Polling, not websockets: worst-case ~1.5 s update latency. Acceptable for turn-based
  play; deliberately simple.

## 5. Game-state transitions
- ✅ **HIGH — clue turn pointer desync after a departure.** If the player whose turn it was
  left mid-CLUE_PHASE, `currentTurnIndex` pointed at the wrong slot and the phase could
  never complete. *Where:* `gameStore.ts → removePlayerInternal`. *Fix:* on any departure
  the turn pointer is re-anchored to the first unclued remaining player, and phase-advance
  is re-evaluated (a departure can also legitimately complete the round in VOTING).
- ✅ LOBBY → ROLE_REVEAL → CLUE_PHASE → VOTING → REVEAL → LOBBY all server-authoritative;
  every action validates the current phase (`BAD_STATE` otherwise).
- ✅ **HIGH — rounds with < 2 remaining players** (mass leave) previously soft-locked.
  *Fix:* round bails back to LOBBY, host retains the room (covered by e2e test).

## 6. Role assignment
- ✅ Exactly one imposter, uniformly random among players present at start; verified
  by test (`exactly one imposter`).
- ✅ Turn order used `sort(() => Math.random() - 0.5)` (biased shuffle). *Fix:* proper
  Fisher–Yates shuffle.

## 7. Secret-word protection
- ✅ The word and roles are **never** in the shared state payload; `GET /state` returns
  `yourRole` computed per request token. Imposter gets `secretWord: null`. A test asserts
  the string `imposterId` never appears in any state response.
- ⚠️ Obvious caveat: `/state` with *someone else's token* returns *their* role. Tokens are
  192-bit random, stored only in the owner's localStorage, never broadcast — you cannot
  obtain another player's token through the normal UI.

## 8. Clue submission
- ✅ Server enforces: your turn only (`NOT_YOUR_TURN`), once only (`ALREADY_SUBMITTED`),
  non-empty, length ≤ 120, control characters stripped. Skip counts as a played turn so one
  idle player cannot stall the round.
- ✅ Client disables submit-after-submit and shows other players "waiting for their clue".

## 9. Voting
- ✅ One vote per player, self-vote rejected, target must exist, phase must be VOTING —
  all server-side. Tally shown only in REVEAL.
- ✅ **CRITICAL — ghost votes.** If a player who had *cast* a vote left before the round
  completed, their vote stayed in the tally while `turnOrder`-based completion ignored
  them — the tally could disagree with the phase logic. *Where:* `removePlayerInternal`.
  *Fix:* votes **cast by** a departed player are removed (votes *against* them remain —
  they may have been the imposter). Covered by a dedicated e2e test.

## 10. Score calculation
- ✅ Correct identification: +1 per crew voter who voted the imposter. Wrong **or tied**
  outcome: imposter +2. Scores persist in the room across rounds (Play Again does not reset
  scores; verified by test).
- ✅ Results resolve departed players' names via a `departed` map (no "Unknown" ghosts).

## 11. Refresh / reconnect behavior
- ✅ Identity (code + token + name) in `localStorage`; refresh re-attaches silently.
- ✅ If the server lost the seat (restart, 10-min stale kick), the client auto-rejoins once
  with the stored name and continues the round.
- ⚠️ Auto-rejoin is name-based (see §3). Grace: disconnected badge at ~45 s, removal at
  10 min — a closed laptop doesn't lose a seat during a round.

## 12. Host behavior
- ✅ **HIGH — host leaving the lobby** previously left a room with no host forever.
  *Fix:* host flag deterministically reassigns to the first remaining player. Covered by
  e2e test ("reassigned host can start the game").
- ✅ Only the host can start / Play Again; double-start returns `BAD_STATE`.

## 13. Database schema
- ⚠️ **N/A by decision.** User explicitly requested no Supabase; state is in-memory on the
  Node server with a strict `RoomStateView` contract (the "schema"). Rooms are pinned to a
  single process.

## 14. Permissions / RLS
- ✅ Every mutation validates: room exists → token maps to a seat → phase is valid →
  ownership (host-only actions) / turn / duplicate-submission rules. Invalid token on an
  action → 403 (verified by test).

## 15. Realtime subscriptions
- ✅ No subscriptions to leak: the only recurring handle is one `setTimeout` per mounted
  room view plus one `visibilitychange` listener — both cleaned up on unmount
  (`stopped` flag + `clearTimeout` + `removeEventListener`).

## 16. Race conditions
- ✅ Node executes request handlers on one thread; each store operation runs atomically
  between awaits, so phase checks and mutations cannot interleave (the classic
  "two voters both think they're last" race cannot happen within one process).
- ✅ Double-click protection: client disables submit on first press; the server's
  once-only checks make the second request a no-op error anyway.

## 17. Duplicate submissions
- ✅ Clue: once per round, enforced by `player.clue !== null`. Vote: once, enforced by
  `player.votedFor !== null`. Start/again: host-only + phase-gated. All verified by tests.

## 18. Security vulnerabilities
- ✅ All user text sanitized server-side (control chars + `<>` stripped, length-capped);
  React escapes the rest — no XSS sink found.
- ✅ No `dangerouslySetInnerHTML`, no `eval`, no secrets in client bundles (no env vars at
  all). Room enumeration needs a 5-char code from a 30-symbol alphabet.
- ⚠️ Seat takeover by name (§3) and no rate limiting are accepted MVP trade-offs.

## 19. TypeScript / runtime errors
- ✅ `tsc --noEmit` clean; `next lint` clean (0 errors, 0 warnings); `next build`
  production build succeeds; unused scaffold assets and dead code removed
  (`heartbeat` action, `ROOM_TTL_MS` orphan, unused imports/vars).

## 20. Mobile responsiveness
- ✅ Single-column max-width layout, ≥ 44 px touch targets, `viewport` meta, fluid type
  via Tailwind; the room view is one scrollable card stack on phones. No horizontal
  overflow by construction (no fixed-width elements).

---

## Re-run results after fixes

- `tsc --noEmit`: **0 errors**
- `next lint`: **0 problems**
- `next build`: **succeeds**
- `scripts/e2e-test.mjs` (full game, guards, scoring, rejoin): **42/42** — 6 consecutive
  runs, varying random imposter/turn order
- `scripts/e2e-leave-test.mjs` (host leave, ghost votes, tie, small-room bail): **13/13**
- `scripts/ui-playtest.mjs` (4 real Chrome players, 2 full rounds, phone viewport): **46/46**

### UI play-test findings (post-audit hardening)

Driving the real UI with four headless-Chrome players surfaced bugs that API-level tests
could not see. All were fixed and the suite re-run to green:

| # | Severity | Problem | Where |
|---|---|---|---|
| 1 | **CRITICAL** | Create/Join stored the server's `roomCode` as identity `code` mismatch → every create/join redirected to `/undefined`; the game was unplayable from the UI despite passing API tests | `client.ts` |
| 2 | HIGH | Invite links (`/?room=CODE`) landed on the home screen with no join form open | `page.tsx` |
| 3 | MEDIUM | Vote buttons stayed clickable for a moment after voting (double-click race); server rejects the second vote but the UI showed an error | `Voting.tsx` |
| 4 | MEDIUM | Clipboard write could reject on insecure contexts (non-HTTPS LAN play) → unhandled rejection | `ui.tsx` |
| 5 | MEDIUM | Stale clue draft persisted into the next round | `CluePhase.tsx` |
| 6 | LOW | "Close Room" actually just left the room, leaving an orphan someone else could inherit | `Lobby.tsx`, `gameStore.ts` |
| 7 | LOW | Room code not visible during clue/voting phases | `Voting.tsx` |
| 8 | **CRITICAL** | A departed **imposter** was silently dropped from scoring: the `else if (imposter)` branch only matched players still present, so no one got the +2 and the reveal showed a scores list without the imposter | `gameStore.ts` |
| 9 | MEDIUM | Departed players were missing from the reveal scores entirely (departed ledger added, shown with their name) | `gameStore.ts` |

## What was fixed (CRITICAL/HIGH summary)

| # | Severity | Problem | Where |
|---|---|---|---|
| 1 | CRITICAL | Ghost votes from departed players corrupting the tally | `gameStore.ts` |
| 2 | HIGH | Host "Return to Lobby" destroyed the room instead of resetting | `Reveal.tsx` |
| 3 | HIGH | Clue turn pointer desync when the turn player left | `gameStore.ts` |
| 4 | HIGH | Hostless room after host left the lobby | `gameStore.ts` |
| 5 | HIGH | Round soft-lock when < 2 players remained mid-round | `gameStore.ts` |
| 6 | HIGH | Stale identity after server restart dead-ended clients | `useRoom.ts` |
| 7 | HIGH | Background-tab timer throttling stalled sync | `useRoom.ts` |
| 8 | LOW | Biased turn-order shuffle; room TTL GC missing; dead code | `gameStore.ts` |

## Remaining known limitations

1. **Single-process, in-memory** — restart loses games; horizontal scaling needs a real
   datastore (out of MVP scope, per user's "no Supabase" decision).
2. **Polling latency ~1.5 s** — no push channel.
3. **Name-based seat reclaim** — knowing a code + a name can take over a seat; fine for
   friends, not a security boundary.
4. **No rate limiting / profanity filtering** on names and clues.

## Verdict

The MVP **is playable end-to-end**, verified three ways: API-level game-flow tests
(42 assertions), disconnect/tie/host-handover tests (13 assertions), and a real-browser
play-test driving four headless-Chrome players (one on a phone viewport) through two full
rounds including refresh, late-join rejection, score persistence, and room close
(46 assertions). All suites pass across repeated runs with randomized imposter/turn order.

It is **not** production-ready in the deployment sense — see limitations 1–4.

---

# Polish Pass Audit (premium UX + reliability upgrade)

Second audit, after the polish pass (game feel, social feedback, sound, a11y, reliability
fills). Scope honored: **no database, no auth, no websockets, no new runtime dependencies,
core rules unchanged** (no turn timer, no imposter final guess — declined/deferred by user
decision). Server remains the sole authority over phases, scores, and secret information.

## 1. What changed (grouped)

**Game feel / polish**
- Home screen rebuilt: hero typography ("GUESS THE IMPOSTER" / "Can you spot who's lying?"),
  party-game badge, refined form with labeled inputs, inline busy states
  ("Creating room…" / "Joining room…"), friendly errors, how-to-play footer.
- Phase transition overlay: brief (1.6 s), non-blocking, pointer-events-none interstitials
  ("THE GAME IS STARTING…", "CLUE TIME", "WHO IS THE IMPOSTER?", "THE REVEAL", "BACK IN THE
  LOBBY"). Cannot trap input or stall the poll loop.
- Role reveal is now a **tap-to-flip private role card** (nobody nearby sees it
  accidentally), with drama copy and an explicit "Don't show this screen to other players."
  privacy note. Ready flow unchanged (server gates on `ready` as before).
- Voting: "WHO IS THE IMPOSTER?" heading, per-player clue display, explicit "✓ YOUR VOTE"
  selected state, "✓ Vote locked. Waiting for the rest…" status, live N/N progress.
- Reveal: verdict banner ("GROUP CAUGHT THE IMPOSTER" / "IMPOSTER ESCAPED"), imposter name +
  word, tie handling, per-player **round score deltas (+1/+2)** alongside totals (deltas are
  computed server-side in `buildResult`, REVEAL-only payload — public info only).
- Lobby: large room code, Copy ("Copied!" feedback), Copy link, Web Share API when
  available (graceful fallback to copy), "Ready to play" positive state, prominent Start
  button; join/leave toasts make room activity visible.

**Social feedback**
- Client diffs consecutive state snapshots (public fields only) and emits toasts:
  "Ravi joined the room", "X left the room", plus phase-change toasts. Auto-expire after
  4.5 s, capped at 3, dismissible, `aria-live=polite`.

**Connection awareness**
- `ConnectionDot` in the room header: "● Connected" / "○ Reconnecting…" (amber, pulsing),
  derived from poll-failure tracking; hidden during initial connect. Temporary network
  loss keeps the seat (existing 45 s connected window / 10-min stale kick unchanged).

**Sound (optional, zero-dependency)**
- `src/lib/sound.ts`: WebAudio-synthesized blips (join, transition, role, vote, reveal,
  error). **Off by default**, opt-in toggle persisted in localStorage, respects autoplay
  policies (context created on the enabling click), never required for gameplay.

**Reliability fills**
- Global room TTL sweep (opportunistic, on create/state) in addition to the per-room sweep.
- Client-side in-flight guards on Start Game / Close Room / Play Again close the
  double-click window between action and poll confirmation (server still enforces;
  this only avoids a confusing BAD_STATE banner).
- `INTERNAL` server errors render as "Something went wrong. Please try again." everywhere.
- Sound preference hydration fixed: refresh keeps the opt-in (module state re-reads
  localStorage at init).

**Accessibility**
- Visible focus ring (`:focus-visible`) site-wide; `role=alert` errors, `role=status` for
  ready/vote/progress states, `aria-live` toasts, `aria-label`s on icon-only controls
  (copy code, sound toggle, dismiss), labeled form inputs, semantic `h2` per phase screen
  (incl. `sr-only` where the visual design has no heading), `aria-pressed` on the sound
  toggle, ≥44 px touch targets, `min-h-11` buttons, 16 px inputs (no iOS zoom-on-focus),
  `prefers-reduced-motion` collapses all animation durations to ~0.

**Visual system**
- Single `globals.css` token set: fixed radial-gradient backdrop, elevated cards (inset
  edge light + soft shadow), restrained hero glow, one motion vocabulary (rise/pop/overlay).
  No neon, no glassmorphism, no fixed-width elements (mobile-safe by construction).

## 2. Privacy audit (secret information)

Re-verified end to end:
- Roles/word never in shared payloads; `yourRole` is computed **per token** in `getState`;
  imposter gets `secretWord: null`; `imposterId` appears only inside the REVEAL result.
  The e2e test asserting `imposterId` never appears in state responses still passes.
- New fields/events leak nothing: join/leave toasts use `players[]` names (public),
  phase toasts use `phase` (public), score deltas are inside the REVEAL-only result.
- The role card hides content until tapped — purely presentational; the underlying state
  was already per-player private, and the flip changes nothing server-side.
- No tokens/secrets in client bundles; input sanitization unchanged.

## 3. Bugs found during the polish pass (fixed)

| # | Severity | Problem | Where |
|---|---|---|---|
| 1 | **HIGH (build)** | Duplicated scoring block during refactor double-awarded points | `gameStore.ts` (caught by self-review before running tests) |
| 2 | MEDIUM | Role-card tap used case/emoji-sensitive matching — playwright of the UI test clicked nothing | `ui-playtest.mjs` (test fix, component was fine) |
| 3 | MEDIUM | Phase toast text collided with overlay copy and never auto-dismissed; toasts had no expiry | `useRoom.ts` (event ids + 4.5 s TTL) |
| 4 | LOW | Sound mute state not hydrated from storage on module init | `sound.ts` |
| 5 | LOW | Host double-click on Start/Again within one poll cycle produced a spurious BAD_STATE banner | `Lobby.tsx`, `Reveal.tsx` |
| 6 | LOW | Stray `btn` class referenced but never defined | `ui.tsx`, `[code]/page.tsx` |
| 7 | LOW | Missing `h2` headings on phase screens | all phase components |

## 4. Test results (final build)

- `tsc --noEmit`: **0 errors**
- `eslint`: **0 problems** (0 errors, 0 warnings)
- `next build`: **succeeds** (8 routes)
- `scripts/e2e-test.mjs`: **42/42** (multiple runs, randomized imposter/turn order)
- `scripts/e2e-leave-test.mjs`: **13/13** (multiple runs)
- `scripts/ui-playtest.mjs`: **55/55** — four real Chrome players (one on a 390×844 phone
  viewport), two full rounds, now also asserting: transition overlay appears and
  auto-dismisses, tap-to-flip role card, privacy notice, per-turn clue-input exclusivity,
  vote locking, refresh recovery, late-join rejection, score persistence, room close,
  and console-error-free sessions for all five participants.

## 5. Remaining known limitations (unchanged by design)

1. **Single process, in-memory** — restart loses rooms; not horizontally scalable.
2. **Polling latency ~1.5 s** — no push channel.
3. **Name-based seat reclaim** — knowing a code + a name can take over a seat (party-game
   trade-off, documented; not a security boundary).
4. **No rate limiting / profanity filtering** on names and clues.
5. No turn timer and no imposter final-guess round — declined for this pass (rule changes).

## Verdict (polish pass)

**Production-quality MVP within the intentional no-database/single-process constraints** —
verified end-to-end (API + real-browser UI) with randomized game parameters. Not
claiming deployment-grade production readiness for the reasons listed in §5.

---

# Rounds Rework Audit (3 clue rounds + majority/tie decisions)

Third audit, after the game was reworked from a single round of clues into up to three
clue rounds joined by **decision phases**: after each clue round everyone picks either
**VOTE NOW** (jump to voting) or **PLAY ANOTHER ROUND** (play the next clue round).

Scope honored: no new dependencies, no DB/auth/websockets, no rule changes beyond the
rounds/decision mechanic (in particular the `skip` turn option was **removed** — the
user disallowed skipping, so every turn is a real clue), server remains authoritative,
and all premium UX / sound / a11y / privacy behavior is preserved.

## 1. The new state machine

`ROLE_REVEAL → CLUE_PHASE(clueRound 1) → ROUND_DECISION → CLUE_PHASE(clueRound 2) →
ROUND_DECISION → CLUE_PHASE(clueRound 3) → VOTING → REVEAL → LOBBY`

- **Decision resolution** (`resolveDecision` in `gameStore.ts`):
  - **VOTE** absolute majority → `VOTING`.
  - **PLAY** majority **or** exact tie → next clue round; a tie **always** means play.
  - **Round 3** decision phase is skipped entirely — after all round-3 clues the game
    auto-starts `VOTING`; there are no decision buttons after round 3.
- Decisions are per-player (`Player.decision`), counted only for players still present,
  counts stay hidden while deciding, and the aggregated outcome is published only once
  everyone decides (`playersWhoDecided` is gated to `ROUND_DECISION`). `yourDecision` is
  echoed per token so a refresh mid-decision keeps the player's choice and lets the
  client re-assert it.
- Clues accumulate server-side per player, each tagged with its `round`; everything is
  reset to a fresh state on Play Again (round 1, clues, decisions, decision result,
  votes) while scores persist. Clue rules are unchanged: your turn only, exactly one
  clue per round, no duplicates, no out-of-turn, no post-round submits.

## 2. Bugs found during this audit (fixed)

| # | Severity | Problem | Where |
|---|---|---|---|
| 1 | **CRITICAL** | Stale decisions were never cleared after a decision resolved. Round 2/3 decision phases auto-resolved with leftover round-1 choices, and the first player to decide at round 2/3 was rejected with `ALREADY_DECIDED`. | `gameStore.ts` (cleared in `resolveDecision` and defensively when entering `ROUND_DECISION` in `maybeAdvance`) |

Deeper re-review of the full flow (state machine, API layer, `useRoom` event keying,
every phase component, `[code]/page.tsx` gates, all test suites, privacy/leak surface)
found no remaining CRITICAL/HIGH issues.

## 3. Test results (final build)

- `tsc --noEmit`: **0 errors**
- `eslint`: **0 problems** (0 errors, 0 warnings)
- `next build`: **succeeds** (6 routes)
- `scripts/e2e-test.mjs`: **52/52** (full game, guards, scoring, rejoin, privacy)
- `scripts/e2e-leave-test.mjs`: **16/16** (host leave, ghost votes, ties, small-room bail)
- `scripts/e2e-rounds-test.mjs` (new): **66/66** — scenario A (all-PLAY → all-PLAY →
  round-3 auto-vote), majority rules (3- and 4-player rooms: all-vote → voting,
  majority-play → next round, majority-vote → voting, tie → next round), refresh
  recovery (clue round, own decision, hidden counts, no double-decide), disconnect
  during decision (departed player's decision dropped, undecided-player leave, host
  leaves mid-decision → host reassigned + tie → round 2), and privacy (no choice
  strings/counts leak, watcher can't decide, no `imposterId` in state).
- `scripts/ui-playtest.mjs` (4 real Chrome players, one phone viewport): **71/71** —
  scenario A (3-round full game incl. round indicators, round-2 clue retention,
  round-3 auto-vote, scoring), scenario B (majority-vote shortcut), scenario C (tie →
  round 2), refresh survival, late-join rejection, room close, console-error-free.
- Two failures encountered during the run were **test-logic bugs, not product bugs**:
  the departure tests posted every decision before leaving, so the phase had already
  resolved (tie → next round) before the `leave` arrived. Rewritten to genuinely leave
  mid-decision (i.e. with another player still undecided); both now pass and still
  assert the correct server behavior.

## 4. Remaining known limitations (unchanged by design)

Same as §5 of the polish pass: single-process in-memory store, ~1.5 s polling latency,
name-based seat reclaim, no rate limiting/profanity filtering, no turn timer / imposter
final guess.

## Verdict (rounds rework)

**The reworked round/decision flow is correct and complete.** All 205 automated
assertions pass across the four suites (API flows + departures/ghosts + rounds
state machine + real-browser play-test), including the removed-skip and round-3
auto-vote rules and all privacy/leak checks. Remaining limitations are the same
documented single-process/polling MVP trade-offs; the game remains playable
end-to-end from the UI on desktop and phone viewports.
