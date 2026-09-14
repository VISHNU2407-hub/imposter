"use client";

import { useState } from "react";
import type { DecisionChoice } from "@/lib/gameTypes";
import type { UseRoom } from "@/lib/useRoom";
import { sounds } from "@/lib/sound";
import { Button, Card, ErrorBanner, PhaseBadge } from "@/components/ui";
import ClueRounds from "@/components/ClueRounds";

const ORDINALS = ["first", "second", "third"] as const;

export default function DecisionPhase({ room }: { room: UseRoom }) {
  const { state, act, error } = room;
  const [choice, setChoice] = useState<DecisionChoice | null>(null);
  const [busy, setBusy] = useState<DecisionChoice | null>(null);

  if (!state || !state.you) return null;
  const { clueRound, players, playersWhoDecided, yourDecision, clues } = state;
  const decidedCount = playersWhoDecided.length;
  const myChoice = yourDecision ?? choice;
  const roundOrdinal = ORDINALS[clueRound - 1] ?? "next";

  const decide = async (c: DecisionChoice) => {
    if (myChoice !== null || busy !== null) return;
    setBusy(c);
    const ok = await act("decision", { choice: c });
    if (ok) {
      setChoice(c);
      sounds.vote();
    } else {
      setBusy(null);
    }
  };

  return (
    <Card className="animate-rise flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <PhaseBadge>Decision</PhaseBadge>
        <span role="status" className="text-sm text-zinc-400">
          {decidedCount}/{players.length} decided
        </span>
      </div>

      <h2 className="sr-only">Round {clueRound} complete — decision</h2>
      <div className="text-center">
        <p className="text-3xl font-black tracking-tight text-white">ROUND {clueRound} COMPLETE</p>
        <p className="mt-1 text-sm text-zinc-400">
          You&apos;ve heard everyone&apos;s {roundOrdinal} clue.
        </p>
        <p className="text-sm text-zinc-400">Do you have enough information to make your decision?</p>
      </div>

      <ErrorBanner message={error} onDismiss={room.clearError} />

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button
          onClick={() => void decide("vote")}
          disabled={myChoice !== null}
          busy={busy === "vote"}
          className="flex-1 py-5 text-base"
        >
          🗳️ VOTE NOW
        </Button>
        <Button
          variant="ghost"
          onClick={() => void decide("play")}
          disabled={myChoice !== null}
          busy={busy === "play"}
          className="flex-1 py-5 text-base"
        >
          🔥 PLAY ANOTHER ROUND
        </Button>
      </div>

      {myChoice !== null && (
        <p role="status" className="animate-rise text-center text-sm font-medium text-emerald-300">
          ✓ Decision locked. Waiting for the rest…
        </p>
      )}

      <ClueRounds clues={clues} />
    </Card>
  );
}