"use client";

import { useEffect, useState } from "react";
import type { UseRoom } from "@/lib/useRoom";
import { sounds } from "@/lib/sound";
import { Button, Card, ErrorBanner, PhaseBadge, PlayerChip } from "@/components/ui";

/**
 * Secret-word reveal. The experience is IDENTICAL for every player: nobody
 * is told they are the imposter or that their word differs from anyone
 * else's — everyone just sees their own secret word after tapping to flip.
 */
export default function RoleReveal({ room }: { room: UseRoom }) {
  const { state, act, error } = room;
  const [revealed, setRevealed] = useState(false);

  // Reveal sting on first flip per round (only after user opted into sound).
  useEffect(() => {
    if (revealed) sounds.role();
  }, [revealed]);

  if (!state || !state.yourRole) return null;
  const readyCount = state.playersReady.length;
  const youReady = state.you ? state.playersReady.includes(state.you.id) : false;
  const secretWord = state.yourRole.secretWord;

  return (
    <Card className="flex flex-col gap-5">
      <h2 className="sr-only">Your secret word</h2>
      <div className="flex items-center justify-between">
        <PhaseBadge>Round {state.roundNumber}</PhaseBadge>
        <span className="text-sm text-zinc-400">
          {readyCount}/{state.players.length} ready
        </span>
      </div>

      {/* Secret-word card — tap to flip so nobody nearby sees it accidentally. */}
      <button
        type="button"
        onClick={() => setRevealed(true)}
        aria-label={revealed ? "Your secret word" : "Tap to reveal your secret word"}
        className="group relative w-full overflow-hidden rounded-2xl border border-violet-400/40 bg-violet-500/10 p-6 text-center transition-colors hover:bg-violet-500/15"
      >
        {!revealed ? (
          <span className="flex min-h-32 flex-col items-center justify-center gap-2">
            <span className="text-4xl" aria-hidden="true">
              🎴
            </span>
            <span className="text-sm font-semibold uppercase tracking-widest text-violet-200">
              Tap to reveal your word
            </span>
          </span>
        ) : (
          <span className="animate-pop block">
            <span className="block text-sm font-semibold uppercase tracking-widest text-violet-300">
              Your secret word
            </span>
            <span className="mt-2 block text-4xl font-black tracking-tight text-white">
              {secretWord}
            </span>
            <span className="mt-4 block text-sm text-violet-200">
              Keep your word secret.
            </span>
          </span>
        )}
      </button>

      <p className="text-center text-xs text-zinc-500">
        🤫 Don&apos;t show this screen to other players.
      </p>

      <ErrorBanner message={error} onDismiss={room.clearError} />

      <div className="flex flex-wrap justify-center gap-2">
        {state.players.map((p) => (
          <PlayerChip
            key={p.id}
            name={p.name}
            isHost={p.isHost}
            connected={p.connected}
            highlight={p.id === state.you?.id}
            badge={state.playersReady.includes(p.id) ? "ready" : undefined}
          />
        ))}
      </div>

      <Button
        onClick={() => void act("ready")}
        disabled={youReady || !revealed}
        variant={youReady || !revealed ? "ghost" : "primary"}
        className="w-full py-4 text-lg"
      >
        {youReady ? "Waiting for others…" : !revealed ? "Reveal your word first" : "I've seen my word — Ready"}
      </Button>
    </Card>
  );
}