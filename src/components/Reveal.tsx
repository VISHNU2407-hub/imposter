"use client";

import { useEffect, useState } from "react";
import type { UseRoom } from "@/lib/useRoom";
import { sounds } from "@/lib/sound";
import { Button, Card, ErrorBanner, PhaseBadge, PlayerChip } from "@/components/ui";

export default function Reveal({ room }: { room: UseRoom }) {
  const { state, act, error } = room;
  // In-flight guard: avoids a second request before the poll confirms LOBBY.
  const [againBusy, setAgainBusy] = useState(false);

  // Reveal sting (only audible if the player opted into sound).
  useEffect(() => {
    sounds.reveal();
  }, []);

  if (!state || !state.result) return null;
  const r = state.result;
  const imposterIsMe = state.you?.id === r.imposterId;

  return (
    <Card className="flex flex-col gap-5">
      <h2 className="sr-only">Round results</h2>
      <div className="flex items-center justify-between">
        <PhaseBadge>Round over</PhaseBadge>
        <span className="text-sm text-zinc-400">
          {r.isTie ? "Tie vote" : r.mostVotedName ? `${r.topVoteCount} votes` : "No votes"}
        </span>
      </div>

      {/* Verdict banner */}
      <div
        className={`animate-pop rounded-2xl border p-6 text-center ${
          r.groupCorrect ? "border-emerald-500/50 bg-emerald-500/10" : "border-red-500/50 bg-red-500/10"
        }`}
      >
        <p
          className={`text-xs font-bold uppercase tracking-[0.25em] ${
            r.groupCorrect ? "text-emerald-300" : "text-red-300"
          }`}
        >
          {r.groupCorrect ? "GROUP CAUGHT THE IMPOSTER" : "IMPOSTER ESCAPED"}
        </p>
        <p className="mt-2 text-2xl font-black tracking-tight text-white">
          {r.groupCorrect ? "🎉" : "😈"} The Imposter was {r.imposterName}!
        </p>
        {imposterIsMe && (
          <p className="mt-1 text-sm text-zinc-300">That&apos;s you — nice bluff!</p>
        )}
        <p className="mt-3 text-sm text-zinc-400">The Imposter had a different word.</p>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm">
            <span className="block text-xs uppercase tracking-widest text-zinc-400">Main word</span>
            <span className="mt-1 block font-mono text-lg font-bold tracking-widest text-white">{r.mainWord}</span>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm">
            <span className="block text-xs uppercase tracking-widest text-zinc-400">Imposter word</span>
            <span className="mt-1 block font-mono text-lg font-bold tracking-widest text-white">{r.imposterWord}</span>
          </div>
        </div>
        <p className="mt-3 text-sm text-zinc-300">
          {r.isTie
            ? `Voting ended in a tie (${r.topVoteCount} votes each) — the Imposter gets away.`
            : r.mostVotedName
              ? `Most votes: ${r.mostVotedName} (${r.topVoteCount})`
              : "No votes were cast."}
        </p>
      </div>

      <ErrorBanner message={error} onDismiss={room.clearError} />

      <div>
        <p className="mb-2 text-sm font-semibold text-zinc-300">Votes</p>
        {r.voteTally.length === 0 ? (
          <p className="text-sm text-zinc-500">No votes recorded.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {r.voteTally.map((t) => (
              <li
                key={t.targetId ?? t.targetName}
                className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm"
              >
                <span className="font-medium">{t.targetName}</span>
                <span className="text-zinc-300">{t.count} vote{t.count === 1 ? "" : "s"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <p className="mb-2 text-sm font-semibold text-zinc-300">Scores</p>
        <ul className="flex flex-col gap-1.5">
          {r.playerScores.map((s) => (
            <li
              key={s.playerId}
              className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm ${
                s.roundScore > 0 ? "border-violet-400/40 bg-violet-500/10" : "border-white/10 bg-white/5"
              }`}
            >
              <PlayerChip name={s.playerName} highlight={s.playerId === state.you?.id} />
              <span className="flex items-center gap-2 font-mono">
                {s.roundScore > 0 && (
                  <span className="animate-pop text-xs font-bold text-emerald-300">+{s.roundScore}</span>
                )}
                <span className="font-bold text-violet-200">{s.score}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        {state.isHost ? (
          <Button
            busy={againBusy}
            onClick={() => {
              if (againBusy) return;
              setAgainBusy(true);
              void act("again").finally(() => setAgainBusy(false));
            }}
            className="flex-1 py-4 text-lg"
          >
            Play Again
          </Button>
        ) : (
          <p className="self-center text-sm text-zinc-500">Waiting for the host to start the next round…</p>
        )}
        <Button variant="ghost" onClick={room.leaveRoom}>
          Leave Room
        </Button>
      </div>
    </Card>
  );
}
