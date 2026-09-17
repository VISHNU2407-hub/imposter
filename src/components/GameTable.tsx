"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* ------------------------------------------------------------------ types */

export interface TablePlayer {
  /** Unique id — matches TableMessage.playerId. */
  id: string;
  name: string;
  /** Any CSS color; falls back to a palette pick by seat index. */
  color?: string;
  /** Optional emoji shown instead of initials, e.g. "🦊". */
  emoji?: string;
}

export interface TableMessage {
  id: string;
  playerId: string;
  text: string;
  /** Epoch ms; shown as HH:MM in the chat log. */
  at: number;
}

/* ---------------------------------------------------------------- palette */

const PALETTE = [
  "#d4b483", // champagne
  "#c08497", // dusty rose
  "#7fb69e", // sage
  "#d9a066", // warm bronze
  "#8fa8c8", // slate blue
  "#c98d6b", // terracotta
  "#a3b18a", // olive
  "#b8a1c9", // muted plum
];

function playerColor(p: TablePlayer, seat: number): string {
  return p.color ?? PALETTE[seat % PALETTE.length];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? "?").toUpperCase() + (parts[1]?.[0] ?? "").toUpperCase();
}

/** Deterministic across server/client so SSR hydration never mismatches. */
function hhmm(at: number): string {
  return new Date(at).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/* ------------------------------------------------------------- geometry */

/**
 * Seat positions around an oval table (percent of the table box), dealt
 * clockwise starting at 12 o'clock: 360 / playerCount degrees apart.
 * `bubbleAbove` says which way that seat's speech bubble should open —
 * bubbles always open AWAY from the table center, so bottom seats flip
 * theirs (and their tail) to sit below the avatar.
 */
function seatLayout(count: number) {
  return Array.from({ length: count }, (_, i) => {
    const angle = -90 + (360 / count) * i;
    const rad = (angle * Math.PI) / 180;
    // Oval radii: wider than deep reads as a top-down table.
    const x = 50 + 44 * Math.cos(rad);
    const y = 50 + 34 * Math.sin(rad);
    return { x, y, bubbleAbove: y <= 55 };
  });
}

/* ============================================================== component */

export interface GameTableProps {
  players: TablePlayer[];
  /** Player whose turn it is — gets the glowing ring. */
  currentTurnPlayerId?: string | null;
  /** Full chat log, chronological (oldest first). */
  messages: TableMessage[];
  /**
   * Called with the trimmed text when the local player submits a clue.
   * Fully controlled: render the bubble + chat entry from your own state
   * update — this component never invents messages.
   */
  onSubmitMessage?: (text: string) => void | Promise<void>;
  /** Which player the input belongs to (defaults to the first player). */
  myPlayerId?: string;
  /** Bubble lifetime in ms (default 4500). */
  bubbleMs?: number;
  className?: string;
}

/**
 * "Around the table" game view: an oval table with seated avatars, speech
 * bubbles that pop over the speaker for a few seconds, and a live side chat.
 * Self-contained and mock-friendly — wire real game state via the props.
 *
 * Responsive: chat is a fixed right panel on desktop (lg), a toggleable
 * bottom sheet on mobile.
 */
export default function GameTable({
  players,
  currentTurnPlayerId = null,
  messages,
  onSubmitMessage,
  myPlayerId,
  bubbleMs = 4500,
  className = "",
}: GameTableProps) {
  const seats = useMemo(() => seatLayout(players.length), [players.length]);
  const seatOf = useCallback(
    (p: TablePlayer) => players.findIndex((x) => x.id === p.id),
    [players],
  );

  /* ------------------------------------------------ speech bubble logic */
  // Latest message per player — a new message from the same player simply
  // replaces their bubble. Purely derived from props; no sync-state effects.
  const latestByPlayer = useMemo(() => {
    const map = new Map<string, TableMessage>();
    for (const m of messages) map.set(m.playerId, m); // last (newest) wins
    return map;
  }, [messages]);

  // Wall-clock "now", refreshed by an interval ONLY while it matters. It
  // starts at 0 (nothing visible) so SSR and first client render agree —
  // no hydration mismatch. setState happens in the timer callback, never
  // synchronously in an effect body.
  const [nowMs, setNowMs] = useState(0);
  const somethingCouldBeLive = useMemo(() => {
    if (nowMs === 0) return true; // clock not started yet — keep ticking
    for (const m of latestByPlayer.values()) {
      if (nowMs - m.at < bubbleMs) return true;
    }
    return false;
  }, [nowMs, latestByPlayer, bubbleMs]);

  useEffect(() => {
    if (!somethingCouldBeLive) return;
    const t = setInterval(() => setNowMs(Date.now()), 500);
    return () => clearInterval(t);
  }, [somethingCouldBeLive]);

  /* --------------------------------------------------------- chat input */
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const myId = myPlayerId ?? players[0]?.id;

  const send = async () => {
    const text = draft.trim();
    if (!text || sending || !onSubmitMessage) return;
    setSending(true);
    try {
      await onSubmitMessage(text);
      setDraft("");
    } finally {
      setSending(false);
    }
  };

  /* ------------------------------------------------------ chat autoscroll */
  const chatRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);

  /* --------------------------------------------------------- mobile sheet */
  const [chatOpen, setChatOpen] = useState(false);

  return (
    <div className={`flex h-full min-h-0 w-full flex-col lg:flex-row ${className}`}>
      {/* ------------------------------------------------------- the table */}
      <section
        aria-label="Game table"
        className="relative flex min-h-0 flex-1 flex-col items-center justify-center p-3"
      >
        <div className="relative aspect-[4/3] w-full max-w-xl">
          {/* Soft floor shadow under the table for the top-down feel. */}
          <div
            className="absolute inset-[12%_8%_18%_8%] rounded-[50%] bg-black/50 blur-2xl"
            aria-hidden="true"
          />

          {/* The table: slight rotateX tilt reads as viewed from above. */}
          <div
            className="card-elevated absolute inset-[12%_8%_18%_8%] rounded-[50%] border-2 border-amber-900/60 bg-gradient-to-b from-emerald-800/80 to-emerald-950/90"
            style={{ transform: "perspective(900px) rotateX(24deg)" }}
            aria-hidden="true"
          />

          {/* Center medallion */}
          <div
            className="pointer-events-none absolute left-1/2 top-[46%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-amber-200/20 px-4 py-1 text-center text-[10px] font-bold uppercase tracking-[0.3em] text-amber-100/50"
            aria-hidden="true"
          >
            guess the imposter
          </div>

          {/* Seats */}
          {players.map((p, i) => {
            const s = seats[i];
            const isTurn = p.id === currentTurnPlayerId;
            const bubbleMsg = latestByPlayer.get(p.id);
            const bubbleLive =
              bubbleMsg !== undefined && nowMs > 0 && nowMs - bubbleMsg.at < bubbleMs;
            const color = playerColor(p, i);
            return (
              <div
                key={p.id}
                className="absolute flex w-24 -translate-x-1/2 -translate-y-1/2 flex-col items-center"
                style={{ left: `${s.x}%`, top: `${s.y}%` }}
              >
                {/* Speech bubble — opens away from the table center, tail
                    pointing at the speaker's head. */}
                {bubbleLive && bubbleMsg && (
                  <div
                    className={`animate-pop absolute left-1/2 z-20 w-max max-w-[9.5rem] -translate-x-1/2 ${
                      s.bubbleAbove ? "bottom-full mb-2" : "top-full mt-2"
                    }`}
                  >
                    <div className="relative rounded-2xl border border-white/15 bg-zinc-900/95 px-3 py-2 text-left shadow-xl shadow-black/50">
                      <p className="break-words text-sm leading-snug text-zinc-100">
                        {bubbleMsg.text}
                      </p>
                      {/* Tail */}
                      <span
                        aria-hidden="true"
                        className={`absolute left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-white/15 bg-zinc-900/95 ${
                          s.bubbleAbove
                            ? "-bottom-1.5 border-b border-r"
                            : "-top-1.5 border-l border-t"
                        }`}
                      />
                    </div>
                  </div>
                )}

                {/* Avatar */}
                <div
                  className={`relative z-10 flex h-12 w-12 items-center justify-center rounded-full text-sm font-black text-zinc-950 ring-2 transition-shadow sm:h-14 sm:w-14 ${
                    isTurn ? "ring-white" : "ring-transparent"
                  }`}
                  style={{
                    backgroundColor: color,
                    boxShadow: isTurn ? `0 0 0 3px ${color}66, 0 0 24px ${color}88` : undefined,
                  }}
                  title={p.name}
                >
                  {p.emoji ?? initials(p.name)}
                  {isTurn && (
                    <span
                      className="absolute -inset-1 -z-10 animate-ping rounded-full opacity-30"
                      style={{ backgroundColor: color }}
                      aria-hidden="true"
                    />
                  )}
                </div>

                <span
                  className={`mt-1 max-w-full truncate rounded-full px-2 py-0.5 text-xs font-semibold ${
                    isTurn ? "bg-white/15 text-white" : "text-zinc-300"
                  }`}
                >
                  {p.name}
                  {p.id === myId ? " (you)" : ""}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* ------------------------------------------------------ mobile bar */}
      <button
        onClick={() => setChatOpen((o) => !o)}
        className="mx-auto mb-2 flex w-[calc(100%-1.5rem)] shrink-0 items-center justify-between rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-semibold text-zinc-200 lg:hidden"
        aria-expanded={chatOpen}
      >
        <span>💬 Chat{messages.length > 0 ? ` · ${messages.length}` : ""}</span>
        <span aria-hidden="true">{chatOpen ? "▾" : "▴"}</span>
      </button>

      {/* ------------------------------------------------------ chat panel */}
      <aside
        aria-label="Chat"
        className={`${
          chatOpen ? "flex" : "hidden"
        } min-h-0 flex-1 flex-col bg-black/30 lg:flex lg:h-full lg:w-80 lg:flex-none lg:border-l lg:border-white/10`}
      >
        <div
          ref={chatRef}
          role="log"
          aria-label="Message log"
          className="min-h-40 flex-1 space-y-3 overflow-y-auto p-4"
        >
          {messages.length === 0 && (
            <p className="mt-6 text-center text-sm text-zinc-500">No clues yet — break the ice!</p>
          )}
          {messages.map((m) => {
            const sender = byId.get(m.playerId);
            const color = sender ? playerColor(sender, seatOf(sender)) : "#71717a";
            return (
              <div key={m.id} className="flex items-start gap-2.5">
                <span
                  className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-black text-zinc-950"
                  style={{ backgroundColor: color }}
                  aria-hidden="true"
                >
                  {sender?.emoji ?? initials(sender?.name ?? "?")}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-baseline gap-2 text-xs">
                    <span className="font-bold" style={{ color }}>
                      {sender?.name ?? "Unknown"}
                    </span>
                    <span className="text-zinc-500">{hhmm(m.at)}</span>
                  </p>
                  <p className="break-words text-sm leading-snug text-zinc-200">{m.text}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Input */}
        <form
          className="flex items-center gap-2 border-t border-white/10 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={onSubmitMessage ? "Type your clue…" : "Read-only demo"}
            aria-label="Type your clue"
            maxLength={120}
            autoComplete="off"
            disabled={!onSubmitMessage}
            className="min-w-0 flex-1 rounded-xl border border-white/15 bg-black/40 px-3 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/30"
          />
          <button
            type="submit"
            disabled={!draft.trim() || sending || !onSubmitMessage}
            aria-label="Send"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-600 text-white transition-colors hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            ➤
          </button>
        </form>
      </aside>
    </div>
  );
}
