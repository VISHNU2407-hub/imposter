"use client";

import { useState } from "react";
import type { UseRoom } from "@/lib/useRoom";
import { Button, Card, ErrorBanner, PhaseBadge } from "@/components/ui";
import ClueRounds from "@/components/ClueRounds";

export default function CluePhase({ room }: { room: UseRoom }) {
  const { state, act, error } = room;
  if (!state || !state.you) return null;
  const { clueRound, currentTurnPlayerId, players, clues, currentTurnNumber } = state;
  const myId = state.you.id;
  const isMyTurn = currentTurnPlayerId === myId;
  const me = players.find((p) => p.id === myId);
  const myClueGiven = !!me && clues.some((c) => c.playerId === myId && c.round === clueRound);
  const currentTurnName = players.find((p) => p.id === currentTurnPlayerId)?.name ?? "…";

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
      <div className="rounded-2xl border border-violet-400/40 bg-violet-500/10 p-5 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-violet-300">
          Current player · Clue {currentTurnNumber} of {players.length}
        </p>
        <p className="mt-1 text-2xl font-bold text-violet-100">
          {currentTurnName}
          {isMyTurn ? " (you)" : ""}
        </p>

        {isMyTurn && !myClueGiven ? (
          // Keyed by game round + clue round: a fresh round remounts a clean draft.
          <ClueForm
            key={`${state.roundNumber}:${clueRound}`}
            onSubmit={(text) => act("clue", { clue: text })}
          />
        ) : (
          <p className="mt-3 text-sm text-zinc-400">
            {myClueGiven ? "You already gave your clue this round." : "Waiting for their clue…"}
          </p>
        )}
        <p className="mt-3 text-xs text-zinc-500">Everyone gives exactly one clue per round.</p>
      </div>

      <ErrorBanner message={error} onDismiss={room.clearError} />

      <ClueRounds clues={clues} />
    </Card>
  );
}

function ClueForm({ onSubmit }: { onSubmit: (text: string) => Promise<boolean> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    const ok = await onSubmit(t);
    if (ok) setText("");
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
        className="w-full rounded-xl border border-white/15 bg-black/30 px-4 py-3 text-base text-white placeholder:text-zinc-500 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-400/30"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void submit();
        }}
      />
      <Button onClick={() => void submit()} disabled={!text.trim()} busy={busy} className="w-full">
        Submit Clue
      </Button>
    </div>
  );
}