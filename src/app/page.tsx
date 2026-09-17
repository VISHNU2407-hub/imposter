"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useRoom } from "@/lib/useRoom";
import { friendlyError } from "@/lib/client";
import { Button, ErrorBanner, Input, SoundToggle, Spinner } from "@/components/ui";

export default function Home() {
  return (
    <Suspense fallback={null}>
      <HomeInner />
    </Suspense>
  );
}

function HomeInner() {
  const searchParams = useSearchParams();
  const { createRoom, joinRoom } = useRoom(null);

  // An invite link (?room=CODE) should land directly on the join form.
  const [mode, setMode] = useState<"none" | "create" | "join">(
    searchParams.get("room") ? "join" : "none",
  );
  const [name, setName] = useState("");
  const [code, setCode] = useState(searchParams.get("room") ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void>, fallback: string) {
    setError(null);
    setBusy(true);
    try {
      await fn();
      // Navigation happens on success; keep the busy state mounted.
    } catch (e) {
      setError(friendlyError(e) ?? fallback);
      setBusy(false);
    }
  }

  const handleCreate = () => {
    if (!name.trim()) return setError("Enter your name first");
    void run(() => createRoom(name), "Could not create room");
  };

  const handleJoin = () => {
    if (!name.trim()) return setError("Enter your name first");
    if (!code.trim()) return setError("Enter a room code");
    void run(() => joinRoom(code, name), "Could not join room");
  };

  return (
    <main className="relative flex flex-1 flex-col items-center justify-center gap-10 px-6 py-10">
      <div className="absolute right-4 top-4">
        <SoundToggle />
      </div>

      {/* Hero */}
      <div className="text-center">
        <p className="animate-rise mb-3 inline-block rounded-full border border-amber-400/30 bg-amber-500/10 px-4 py-1 text-xs font-semibold uppercase tracking-[0.25em] text-amber-300">
          Party game
        </p>
        <h1 className="title-glow bg-gradient-to-r from-amber-200 via-yellow-100 to-amber-200 bg-clip-text text-5xl font-black leading-tight tracking-tight text-transparent sm:text-6xl">
          GUESS THE IMPOSTER
        </h1>
        <p className="mt-3 text-lg text-zinc-400 sm:text-xl">Can you spot who&apos;s lying?</p>
      </div>

      {/* Actions */}
      <div className="flex w-full max-w-sm flex-col gap-3">
        <Button
          onClick={() => setMode(mode === "create" ? "none" : "create")}
          className="w-full py-4 text-lg"
          disabled={busy}
        >
          Create Room
        </Button>
        <Button
          variant="ghost"
          onClick={() => setMode(mode === "join" ? "none" : "join")}
          className="w-full py-4 text-lg"
          disabled={busy}
        >
          Join Room
        </Button>
      </div>

      {/* Form */}
      {mode !== "none" && (
        <form
          className="card-elevated animate-rise flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (mode === "create") handleCreate();
            else handleJoin();
          }}
        >
          <div>
            <label htmlFor="player-name" className="mb-1.5 block text-sm font-medium text-zinc-300">
              Your name
            </label>
            <Input
              id="player-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Ravi"
              maxLength={20}
              autoComplete="name"
              autoFocus
            />
          </div>
          {mode === "join" && (
            <div>
              <label htmlFor="room-code" className="mb-1.5 block text-sm font-medium text-zinc-300">
                Room code
              </label>
              <Input
                id="room-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="ABCDE"
                maxLength={5}
                autoCapitalize="characters"
                className="text-center font-mono text-xl tracking-[0.4em]"
              />
            </div>
          )}
          {error && <ErrorBanner message={error} />}
          <Button type="submit" busy={busy} className="mt-1 w-full">
            {busy ? (mode === "create" ? "Creating room…" : "Joining room…") : mode === "create" ? "Create" : "Join"}
          </Button>
        </form>
      )}

      {busy && mode === "none" && <Spinner />}

      {/* How to play */}
      <section className="w-full max-w-md text-center text-sm text-zinc-500">
        <p>
          Everyone gets the same secret word — except one imposter, who gets nothing. Give one-word-ish
          clues, discuss nothing, vote. Catch the liar to win.
        </p>
      </section>
    </main>
  );
}
