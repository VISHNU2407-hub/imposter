"use client";

import { useMemo, useState } from "react";
import type { UseRoom } from "@/lib/useRoom";
import { sounds } from "@/lib/sound";
import { Button, Card, ErrorBanner, PhaseBadge, PlayerChip } from "@/components/ui";

export default function Voting({ room }: { room: UseRoom }) {
  const { state, act, error } = room;
  const [voted, setVoted] = useState<string | null>(null);
  const me = state?.you;

  // Map of clue texts (all clue rounds) by player for quick display.
  const cluesByPlayer = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const c of state?.clues ?? []) {
      const arr = map.get(c.playerId) ?? [];
      arr.push(c.text);
      map.set(c.playerId, arr);
    }
    return map;
  }, [state?.clues]);

  if (!state || !me) return null;
  const { yourVoteTargetId, players } = state;
  const myVote = yourVoteTargetId ?? voted;
  const myId = me.id;
  const votedCount = state.playersWhoVoted.length;

  const vote = (targetId: string) => {
    if (targetId === myId) return;
    if (yourVoteTargetId !== null || voted !== null) return; // already locked (server enforces too)
    setVoted(targetId); // optimistic lock; server confirms via yourVoteTargetId
    sounds.vote();
    void act("vote", { targetId });
  };

  return (
    <Card className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <PhaseBadge>Voting</PhaseBadge>
        <span role="status" className="text-sm text-zinc-400">
          {votedCount}/{players.length} voted
        </span>
      </div>

      <h2 className="text-center text-3xl font-black tracking-tight text-white">WHO IS THE IMPOSTER?</h2>
      <p className="-mt-3 text-center text-sm text-zinc-400">Pick who you think the Imposter is.</p>

      <ErrorBanner message={error} onDismiss={room.clearError} />

      <div className="flex flex-col gap-2">
        {players.map((p) => (
          <div
            key={p.id}
            className={`animate-rise rounded-2xl border p-3 transition-colors ${
              myVote === p.id ? "border-amber-400/60 bg-amber-500/15" : "border-white/10 bg-white/[0.03]"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 flex-col gap-0.5">
                <PlayerChip name={p.name} isHost={p.isHost} connected={p.connected} highlight={p.id === me.id} />
                <span className="flex flex-col gap-0.5">
                  {(cluesByPlayer.get(p.id) ?? []).map((c, i) => (
                    <span key={i} className="truncate text-sm text-zinc-400">
                      “{c}”
                    </span>
                  ))}
                  {(cluesByPlayer.get(p.id) ?? []).length === 0 && (
                    <span className="text-sm text-zinc-500">—</span>
                  )}
                </span>
              </div>
              {p.id === me.id ? (
                <span className="shrink-0 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-zinc-500">You</span>
              ) : myVote === p.id ? (
                <span className="animate-pop flex shrink-0 items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white">
                  <span aria-hidden="true">✓</span> YOUR VOTE
                </span>
              ) : (
                <Button
                  onClick={() => vote(p.id)}
                  disabled={myVote !== null}
                  className="shrink-0 px-4 py-2 text-sm"
                >
                  Vote
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      {yourVoteTargetId !== null && (
        <p role="status" className="animate-rise text-center text-sm font-medium text-emerald-300">
          ✓ Vote locked. Waiting for the rest…
        </p>
      )}
    </Card>
  );
}
