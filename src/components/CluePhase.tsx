"use client";

import { useEffect, useState } from "react";
import type { UseRoom } from "@/lib/useRoom";
import { TURN_TIME_SECONDS } from "@/lib/gameTypes";
import { Button, Card, ErrorBanner, PhaseBadge } from "@/components/ui";
import ClueRounds from "@/components/ClueRounds";

export default function CluePhase({ room }: { room: UseRoom }) {
  const { state, act, error } = room;
  if (!state || !state.you) return null;
  const { clueRound, currentTurnPlayerId, players, clues, currentTurnNumber, turnEndsAt } = state;
  const myId = state.you.id;
  const isMyTurn = currentTurnPlayerId === myId;
  const me = players.find((p) => p.id === myId);
  const myClueGiven = !!me && clues.some((c) => c.playerId === myId && c.round === clueRound);
  const currentTurnName = players.find((p) => p.id === currentTurnPlayerId)?.name ?? "…";
  // Clues already given in ANY round of this game (lowercased) — used for
  // instant client-side duplicate feedback; the server enforces the real rule.
  const givenThisRound = new Set(clues.map((c) => c.text.toLowerCase()));

  return (
    <Card className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <PhaseBadge>Clue phase</PhaseBadge>
        <span
          role="status"
          className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm font-semibold text-zinc-200"
        >
          ROUND {clueRound} OF 3
        </span>
      </div>

      <h2 className="sr-only">Clue phase — round {clueRound} of 3</h2>
      <div className="rounded-2xl border border-amber-400/40 bg-amber-500/10 p-5 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-amber-300">
          Current player · Clue {currentTurnNumber} of {players.length}
        </p>
        <p className="mt-1 text-2xl font-bold text-amber-100">
          {currentTurnName}
          {isMyTurn ? " (you)" : ""}
        </p>

        {turnEndsAt !== null && <TurnTimer key={turnEndsAt} endsAtMs={turnEndsAt} />}

        {isMyTurn && !myClueGiven ? (
          // Keyed by game round + clue round: a fresh round remounts a clean draft.
          <ClueForm
            key={`${state.roundNumber}:${clueRound}`}
            onSubmit={(text) => act("clue", { clue: text })}
            givenClues={givenThisRound}
          />
        ) : (
          <p className="mt-3 text-sm text-zinc-400">
            {myClueGiven ? "You already gave your clue this round." : "Waiting for their clue…"}
          </p>
        )}
        <p className="mt-3 text-xs text-zinc-500">
          Everyone gives exactly one clue per round · {TURN_TIME_SECONDS}s per turn
        </p>
      </div>

      <ErrorBanner message={error} onDismiss={room.clearError} />

      <ClueRounds clues={clues} />
    </Card>
  );
}

/**
 * Clues already given this game (lowercased) for instant duplicate feedback.
 */
function ClueForm({
  onSubmit,
  givenClues,
}: {
  onSubmit: (text: string) => Promise<boolean>;
  /** Clues already given this game, any round (lowercased) for instant duplicate feedback. */
  givenClues: Set<string>;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);

  async function submit() {
    const t = text.trim();
    if (!t || busy) return;
    setInlineError(null);
    setBusy(true);
    const ok = await onSubmit(t);
    if (ok) {
      setText("");
    } else {
      // The hook surfaces most failures in the shared banner; duplicates are
      // expected gameplay friction, so keep the message beside the input.
      // This mirrors the server check in submitClue (gameStore.ts).
      const lower = t.toLowerCase();
      setInlineError(
        givenClues.has(lower) ? "Someone already said that — give a different clue" : null,
      );
    }
    setBusy(false);
  }

  return (
    <div className="mt-4 flex flex-col gap-2">
      <input
        autoFocus
        value={text}
        maxLength={120}
        inputMode="text"
        autoComplete="off"
        placeholder="Your clue…"
        aria-label="Your clue"
        className="w-full rounded-xl border border-white/15 bg-black/30 px-4 py-3 text-base text-white placeholder:text-zinc-500 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/30"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void submit();
        }}
      />
      {inlineError ? (
        <p role="alert" className="text-sm text-red-300">
          {inlineError}
        </p>
      ) : null}
      <Button onClick={() => void submit()} disabled={!text.trim()} busy={busy} className="w-full">
        Submit Clue
      </Button>
    </div>
  );
}

/**
 * Client countdown to the server-set turn deadline. Purely cosmetic — the
 * server auto-passes at `endsAtMs` regardless of what this shows. Remounts
 * on every new deadline via the key prop.
 */
function TurnTimer({ endsAtMs }: { endsAtMs: number }) {
  const [remaining, setRemaining] = useState(() => Math.max(0, Math.ceil((endsAtMs - Date.now()) / 1000)));

  useEffect(() => {
    // Poll Date.now() rather than decrementing a counter: background tabs
    // throttle timers, so an interval tick can be late — recomputing from the
    // wall clock keeps the display honest, and the room state syncs the truth.
    const id = setInterval(() => {
      setRemaining(Math.max(0, Math.ceil((endsAtMs - Date.now()) / 1000)));
    }, 250);
    return () => clearInterval(id);
  }, [endsAtMs]);

  const urgent = remaining <= 10;
  const expired = remaining <= 0;

  return (
    <p
      role="timer"
      aria-live="off"
      className={`mt-2 text-3xl font-bold tabular-nums ${
        expired ? "text-zinc-500" : urgent ? "animate-pulse text-red-400" : "text-amber-200"
      }`}
    >
      {expired ? "Passing…" : `${remaining}s`}
    </p>
 );
}