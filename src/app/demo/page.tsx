"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import GameTable, {
  type TableMessage,
  type TablePlayer,
} from "@/components/GameTable";

/**
 * Standalone preview of the table UI with mock data — no game state wired.
 * Delete or gate this page whenever; the real integration point is the
 * GameTable component itself (see its props for the wiring contract).
 */

const INITIAL_PLAYERS: TablePlayer[] = [
  { id: "p1", name: "Ravi", emoji: "🦊" },
  { id: "p2", name: "Aisha", emoji: "🐼" },
  { id: "p3", name: "Diego", emoji: "🐸" },
  { id: "p4", name: "Mei", emoji: "🦉" },
  { id: "p5", name: "Sam" },
  { id: "p6", name: "Noor", emoji: "🐝" },
];

const t0 = Date.now() - 9 * 60_000;

const INITIAL_MESSAGES: TableMessage[] = [
  { id: "m1", playerId: "p1", text: "sunset", at: t0 },
  { id: "m2", playerId: "p2", text: "beach", at: t0 + 45_000 },
  { id: "m3", playerId: "p3", text: "vacation", at: t0 + 90_000 },
  { id: "m4", playerId: "p4", text: "holiday", at: t0 + 135_000 },
  { id: "m5", playerId: "p5", text: "summer", at: t0 + 180_000 },
  { id: "m6", playerId: "p6", text: "sunscreen", at: t0 + 225_000 },
];

export default function DemoPage() {
  const [messages, setMessages] = useState<TableMessage[]>(INITIAL_MESSAGES);

  const handleSubmit = useCallback((text: string) => {
    setMessages((prev) => [
      ...prev,
      { id: `demo-${Date.now()}`, playerId: "p5", text, at: Date.now() },
    ]);
  }, []);

  return (
    <main className="mx-auto flex h-[100dvh] max-w-5xl flex-col p-4">
      <h1 className="sr-only">Table UI demo</h1>
      <header className="mb-3 flex shrink-0 items-center justify-between">
        <p className="text-sm text-zinc-400">
          Demo · Mei&apos;s turn · your message shows as Sam (p5)
        </p>
        <Link href="/" className="text-sm text-amber-300 hover:text-amber-200">
          ← Home
        </Link>
      </header>
      <div className="card-elevated min-h-0 flex-1 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
        <GameTable
          players={INITIAL_PLAYERS}
          messages={messages}
          currentTurnPlayerId="p4"
          myPlayerId="p5"
          onSubmitMessage={handleSubmit}
        />
      </div>
    </main>
  );
}
