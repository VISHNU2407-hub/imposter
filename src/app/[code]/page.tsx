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
          className="inline-flex min-h-11 items-center rounded-xl bg-violet-600 px-4 py-2.5 font-semibold text-white hover:bg-violet-500"
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
