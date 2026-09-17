"use client";

import { use } from "react";
import { useRoom } from "@/lib/useRoom";
import { ConnectionDot, ErrorBanner, Spinner, ToastStack } from "@/components/ui";
import TransitionOverlay from "@/components/TransitionOverlay";
import Lobby from "@/components/Lobby";
import RoleReveal from "@/components/RoleReveal";
import CluePhase from "@/components/CluePhase";
import DecisionPhase from "@/components/DecisionPhase";
import Voting from "@/components/Voting";
import Reveal from "@/components/Reveal";

export default function RoomPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: urlCode } = use(params);
  const room = useRoom(urlCode.toUpperCase());
  const { state, error, identity, events, dismissEvent, connection } = room;

  if (!identity) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-lg text-zinc-400">You are not in this room yet.</p>
        <a
          href={`/?room=${urlCode.toUpperCase()}`}
          className="inline-flex min-h-11 items-center rounded-xl bg-amber-600 px-4 py-2.5 font-semibold text-white hover:bg-amber-500"
        >
          Enter name to join
        </a>
      </main>
    );
  }

  if (!state) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 p-6" role="status">
        <Spinner />
        <p className="text-sm text-zinc-400">Loading game…</p>
        <ErrorBanner message={error} />
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-4 p-4">
      <ToastStack events={events} onDismiss={dismissEvent} />
      <TransitionOverlay phase={state.phase} clueRound={state.clueRound} />

      <header className="flex items-center justify-between gap-3">
        <ConnectionDot status={connection} />
        <span className="truncate text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
          Room {state.roomCode}
        </span>
      </header>

      {/* Persistent secret-word reminder (hidden during reveal flip so the
          tap-to-see surprise is preserved). Shown for the rest of the game. */}
      {state.phase !== "ROLE_REVEAL" && state.yourRole?.secretWord && (
        <div className="flex justify-center">
          <span
            aria-label={`Your secret word: ${state.yourRole.secretWord}`}
            className="inline-flex items-center gap-2 rounded-full border border-amber-400/40 bg-amber-500/10 px-4 py-1.5 text-sm font-bold tracking-wide text-amber-100"
          >
            <span aria-hidden="true">🎴</span>
            {state.yourRole.secretWord}
          </span>
        </div>
      )}

      <ErrorBanner message={error} onDismiss={room.clearError} />
      {state.phase === "LOBBY" && <Lobby room={room} />}
      {state.phase === "ROLE_REVEAL" && <RoleReveal key={state.roundNumber} room={room} />}
      {state.phase === "CLUE_PHASE" && <CluePhase room={room} />}
      {state.phase === "ROUND_DECISION" && <DecisionPhase room={room} />}
      {state.phase === "VOTING" && <Voting room={room} />}
      {state.phase === "REVEAL" && <Reveal room={room} />}
    </main>
  );
}
