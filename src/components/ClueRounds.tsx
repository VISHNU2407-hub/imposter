"use client";

import type { ClueEntry } from "@/lib/gameTypes";

/**
 * Public clue recap grouped by clue round, in submission order. Used by the
 * clue and decision phases so round 1 clues are never overwritten by round 2.
 */
export default function ClueRounds({ clues }: { clues: ClueEntry[] }) {
  const byRound = new Map<number, ClueEntry[]>();
  for (const c of clues) {
    const arr = byRound.get(c.round) ?? [];
    arr.push(c);
    byRound.set(c.round, arr);
  }
  const rounds = [...byRound.entries()].sort((a, b) => a[0] - b[0]);

  if (rounds.length === 0) {
    return (
      <div>
        <p className="mb-2 text-sm font-semibold text-zinc-300">Clues so far</p>
        <p className="text-sm text-zinc-500">No clues yet.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {rounds.map(([round, entries]) => (
        <div key={round}>
          <p className="mb-2 text-sm font-semibold text-zinc-300">Round {round}</p>
          <ul className="flex flex-col gap-1.5">
            {entries.map((c) => (
              <li
                key={`${c.round}-${c.playerId}-${c.turnNumber}`}
                className="animate-rise flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm"
              >
                <span className="font-medium text-zinc-100">{c.playerName}</span>
                <span className="truncate text-right text-zinc-300">“{c.text}”</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}