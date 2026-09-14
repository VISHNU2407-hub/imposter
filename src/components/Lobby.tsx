"use client";

import { useState } from "react";
import type { UseRoom } from "@/lib/useRoom";
import { Button, Card, CodeDisplay, ErrorBanner, PhaseBadge, PlayerChip, ShareControls } from "@/components/ui";

export default function Lobby({ room }: { room: UseRoom }) {
  const { state, act, leaveRoom, error } = room;
  // Client-side in-flight guards close the double-click window between the
  // action and the next poll confirming the phase change (server still
  // enforces everything; this just avoids a confusing BAD_STATE banner).
  const [starting, setStarting] = useState(false);
  const [closing, setClosing] = useState(false);
  if (!state) return null;
  const canStart = state.players.length >= state.minPlayers;
  const missing = state.minPlayers - state.players.length;

  return (
    <Card className="flex flex-col gap-5">
      <h2 className="sr-only">Lobby</h2>
      <div className="flex items-center justify-between">
        <PhaseBadge>Lobby</PhaseBadge>
      </div>
      <div className="text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-zinc-500">Room code</p>
        <div className="mt-2 flex justify-center">
          <CodeDisplay code={state.roomCode} large />
        </div>
      </div>

      <div className="flex flex-col items-center gap-2">
        <ShareControls code={state.roomCode} />
        <p className="text-xs text-zinc-500">Players: {state.players.length} (min {state.minPlayers})</p>
      </div>

      <div className="flex flex-wrap justify-center gap-2">
        {state.players.map((p) => (
          <PlayerChip
            key={p.id}
            name={p.name}
            isHost={p.isHost}
            connected={p.connected}
            highlight={p.id === state.you?.id}
          />
        ))}
      </div>

      {canStart ? (
        <p role="status" className="animate-rise text-center text-sm font-semibold text-emerald-300">
          ✓ Ready to play
        </p>
      ) : (
        <p className="text-center text-sm text-zinc-400">
          Waiting for {missing} more player{missing === 1 ? "" : "s"}…
        </p>
      )}

      <ErrorBanner message={error} onDismiss={room.clearError} />

      {state.isHost ? (
        <div className="flex flex-col gap-2">
          <Button
            onClick={() => {
              if (starting) return;
              setStarting(true);
              void act("start").finally(() => setStarting(false));
            }}
            disabled={!canStart}
            busy={starting}
            variant={canStart ? "primary" : "ghost"}
            className="w-full py-4 text-lg"
          >
            {canStart ? "Start Game" : `Need ${missing} more player${missing === 1 ? "" : "s"}`}
          </Button>
          <Button
            variant="danger"
            busy={closing}
            onClick={() => {
              if (closing) return;
              setClosing(true);
              void act("close").finally(() => room.leaveRoom());
            }}
          >
            Close Room
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="self-center text-sm text-zinc-500">Waiting for the host to start…</p>
          <Button variant="ghost" onClick={leaveRoom}>
            Leave
          </Button>
        </div>
      )}
    </Card>
  );
}
