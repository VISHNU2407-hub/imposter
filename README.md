# Guess the Imposter

A premium-feel multiplayer social-deduction party game: everyone gets the same secret word
except one **Imposter**. Give clues, vote, and find the imposter.

## Stack

- **Next.js 16 (App Router) + TypeScript + Tailwind CSS v4**
- **No database.** Rooms live in memory on the Node server (single-process MVP — see
  limitations below).
- **No auth.** Players are identified by a random seat token kept in `localStorage`.

## Run it

```bash
npm install
npm run dev        # development, http://localhost:3000
```

Production:

```bash
npm run build
npm start
```

Open two or more browser windows (or phones on the same network via your LAN IP) to play.
Minimum 3 players per room.

## How a round works

```
LOBBY → ROLE_REVEAL → CLUE_PHASE (round 1) → ROUND_DECISION → CLUE_PHASE (round 2)
     → ROUND_DECISION → CLUE_PHASE (round 3) → VOTING → REVEAL → (Play Again → LOBBY)
```

1. **Lobby** — host shares the 5-character room code (copy link or Web Share API); players
   join with a name. Host needs ≥ 3 players to start.
2. **Role reveal** — everyone taps to flip their private role card; crew also see the word.
   Round starts when all players press Ready.
3. **Clues (up to 3 rounds)** — random turn order, one clue per player per round, submit only
   on your turn. Round 1 clues stay visible while round 2 (and 3) are given.
4. **Decision** — after rounds 1 and 2 complete, everyone privately picks **VOTE NOW** or
   **PLAY ANOTHER ROUND**. Voting starts only when a strict majority picks VOTE; a tie (or a
   PLAY majority) starts the next clue round. Round 3 never asks: after the third round of
   clues, voting starts automatically.
5. **Voting** — one vote each, self-votes rejected server-side.
6. **Reveal** — verdict banner, vote tally, per-round score deltas and totals; host can
   Play Again.

Scoring: crew members who voted for the imposter get **+1**; if the group is wrong (or ties),
the imposter gets **+2**. Scores persist across rounds while the room lives.

Phase changes play a brief non-blocking transition overlay ("CLUE TIME", "WHO IS THE
IMPOSTER?", …) plus an optional quiet sound (off by default — toggle 🔊 top-right on the
home screen; respects autoplay policies, never required for play).

## Architecture (intentionally small)

| Piece | File | Role |
|---|---|---|
| Game engine | `src/lib/gameStore.ts` | State machine, rooms, validation, scoring (server-only) |
| Shared types | `src/lib/gameTypes.ts` | `RoomStateView` contract between server and client |
| API | `src/app/api/game/*` | `create`, `join`, `state` (GET), single `action` endpoint |
| Client sync | `src/lib/useRoom.ts` | Identity in localStorage + polling loop (doubles as heartbeat), connection status, join/leave/phase events |
| Sound | `src/lib/sound.ts` | Optional zero-dependency WebAudio blips (off by default, persisted mute) |
| UI | `src/app/page.tsx`, `src/app/[code]/page.tsx`, `src/components/*` | Home screen, phase screens, transition overlay, toasts |

Security model: the server holds each player's random token; `GET /state` renders roles,
words, and results **per token**. Roles are never sent in a shared payload, so a player can
only ever see their own role through the UI.

## Tests

With a server running:

```bash
npm run typecheck
npm run lint
npm run build
npx next start -p 3200 &
node scripts/e2e-test.mjs http://localhost:3200        # full 4-player game + edge cases (API)
node scripts/e2e-leave-test.mjs http://localhost:3200  # disconnects, ties, host reassignment (API)
node scripts/e2e-rounds-test.mjs http://localhost:3200 # new 3-round clue/decision/voting flow (API)
node scripts/ui-playtest.mjs http://localhost:3200     # 4 real Chrome players, full 3-round flow via UI
```

The UI play-test uses headless Chrome (puppeteer-core, dev dependency) with your installed
Chrome; set `CHROME_PATH` to override. It drives the real interface — room creation,
joining (including a phone-sized viewport), role reveal, per-turn clue enforcement,
voting, reveal, refresh recovery, late-join rejection, score persistence across rounds,
room close, and console-error scanning for all four players.

## Known limitations (documented MVP trade-offs)

- **Single process, in-memory.** A server restart wipes rooms; a player page refresh
  reclaims the seat by re-joining with the same name. Scaling beyond one instance needs a
  real database/redis — deliberately out of scope.
- **Polling, not websockets.** ~1.5 s state sync latency (backoff to 8 s, instant wake on
  tab focus). Fine for turn-based play; not real-time push.
- **Sound is synthesized in-browser** (WebAudio, no audio files, no dependencies) and off
  by default.
- **Identity is device-local.** A player who switches browser or device rejoins as a new
  seat (they can reclaim their old seat by reusing the same name).
- **Seat reclamation is name-based.** Anyone who knows a room code *and* a seat name can
  reclaim that seat mid-round. Acceptable for a party game among friends; not a security
  boundary.
- **Disconnect grace:** players are marked disconnected after ~45 s without a poll, and
  hard-removed after 10 minutes of silence. Rooms expire after 6 hours.
- **No AI word generation, no auth, no persistence** — per MVP scope.
