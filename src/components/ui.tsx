"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { isSoundMuted, setSoundMuted } from "@/lib/sound";
import type { ConnectionStatus, RoomEvent } from "@/lib/useRoom";

/* ------------------------------------------------------------------ Card */

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`card-elevated rounded-2xl border border-white/10 bg-white/[0.04] p-5 ${className}`}>
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------- Button */

export function Button({
  children,
  onClick,
  disabled = false,
  variant = "primary",
  type = "button",
  className = "",
  busy = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "ghost" | "danger" | "success";
  type?: "button" | "submit";
  className?: string;
  /** Shows a spinner and prevents double-fire while an async action runs. */
  busy?: boolean;
}) {
  const base =
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 font-semibold transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-40";
  const styles = {
    primary:
      "bg-amber-600 text-zinc-950 shadow-lg shadow-amber-950/40 hover:bg-amber-500 hover:shadow-amber-900/40 active:scale-[0.98]",
    success:
      "bg-emerald-700 text-white shadow-lg shadow-emerald-950/40 hover:bg-emerald-600 active:scale-[0.98]",
    ghost: "border border-white/15 text-zinc-200 hover:bg-white/10 active:scale-[0.98]",
    danger: "border border-red-500/40 text-red-300 hover:bg-red-500/10 active:scale-[0.98]",
  } as const;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`${base} ${styles[variant]} ${className}`}
    >
      {busy && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
}

export function Spinner({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <span
      className={`inline-block animate-spin rounded-full border-2 border-amber-400 border-t-transparent ${className}`}
      aria-hidden="true"
    />
  );
}

/* ----------------------------------------------------------------- Input */

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className = "", ...rest } = props;
  return (
    <input
      {...rest}
      className={`w-full rounded-xl border border-white/15 bg-black/30 px-4 py-2.5 text-base text-white placeholder:text-zinc-500 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/30 ${className}`}
    />
  );
}

/* ------------------------------------------------------------ PlayerChip */

export function PlayerChip({
  name,
  isHost,
  connected = true,
  highlight = false,
  badge,
}: {
  name: string;
  isHost?: boolean;
  connected?: boolean;
  highlight?: boolean;
  badge?: string;
}) {
  return (
    <span
      className={`chip inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${
        highlight ? "border-amber-400/60 bg-amber-500/20 text-amber-100" : "border-white/10 bg-white/5 text-zinc-200"
      } ${connected ? "" : "opacity-40"}`}
      title={connected ? undefined : "disconnected"}
    >
      {isHost ? (
        <span title="Host" aria-label="Host">
          👑
        </span>
        ) : null}
      {name}
      {badge ? <span className="text-xs text-zinc-400">({badge})</span> : null}
    </span>
  );
}

/* ------------------------------------------------------------ PhaseBadge */

export function PhaseBadge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-amber-400/40 bg-amber-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-amber-200">
      {children}
    </span>
  );
}

/* ----------------------------------------------------------- ErrorBanner */

export function ErrorBanner({ message, onDismiss }: { message: string | null; onDismiss?: () => void }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="animate-rise flex items-center justify-between gap-3 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200"
    >
      <span>{message}</span>
      {onDismiss ? (
        <button onClick={onDismiss} className="text-red-300 hover:text-white" aria-label="Dismiss error">
          ✕
        </button>
      ) : null}
    </div>
  );
}

/* ----------------------------------------------------------- CodeDisplay */

export function CodeDisplay({ code, large = false }: { code: string; large?: boolean }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard unavailable (insecure context) — silently ignore.
    }
  }, [code]);

  return (
    <button
      onClick={() => void copy()}
      title="Click to copy"
      aria-label={`Copy room code ${code.split("").join(" ")}`}
      className={`group relative inline-flex items-center gap-2 rounded-xl border border-dashed border-amber-400/50 bg-amber-500/10 font-mono font-bold tracking-[0.3em] text-amber-200 transition-colors hover:bg-amber-500/20 ${
        large ? "px-6 py-4 text-4xl" : "px-4 py-2 text-2xl"
      }`}
    >
      {code}
      <span
        aria-live="polite"
        className={`absolute -top-2 right-0 -translate-y-full rounded-md bg-emerald-600 px-2 py-0.5 text-xs font-semibold normal-case tracking-normal text-white transition-opacity duration-200 ${
          copied ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        Copied!
      </span>
    </button>
  );
}

/* ------------------------------------------------------- ConnectionDot */

export function ConnectionDot({ status }: { status: ConnectionStatus }) {
  if (status === "connecting") return null; // initial mount — no noise
  const online = status === "online";
  return (
    <span
      role="status"
      aria-live="polite"
      className={`inline-flex items-center gap-1.5 text-xs ${online ? "text-zinc-500" : "text-amber-300"}`}
    >
      <span className={`h-2 w-2 rounded-full ${online ? "bg-emerald-400" : "animate-pulse bg-amber-400"}`} />
      {online ? "Connected" : "Reconnecting…"}
    </span>
  );
}

/* ---------------------------------------------------------------- Toasts */

export function ToastStack({ events, onDismiss }: { events: RoomEvent[]; onDismiss: (id: number) => void }) {
  if (events.length === 0) return null;
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 top-3 z-50 flex flex-col items-center gap-2 px-3">
      {events.map((e) => (
        <div
          key={e.id}
          className="animate-rise pointer-events-auto flex max-w-sm items-center gap-2 rounded-full border border-white/10 bg-zinc-900/95 px-4 py-2 text-sm text-zinc-100 shadow-xl shadow-black/40"
        >
          <span aria-hidden="true">{e.kind === "joined" ? "👋" : e.kind === "left" ? "🚪" : "🎬"}</span>
          <span>{e.text}</span>
          <button
            onClick={() => onDismiss(e.id)}
            aria-label="Dismiss notification"
            className="ml-1 text-zinc-500 hover:text-white"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ SoundToggle */

export function SoundToggle() {
  const [muted, setMuted] = useState(true);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration of the persisted preference
    setMuted(isSoundMuted());
  }, []);

  const toggle = () => {
    const next = !muted;
    setMuted(next);
    setSoundMuted(next);
  };

  return (
    <button
      onClick={toggle}
      aria-pressed={!muted}
      aria-label={muted ? "Turn sound on" : "Turn sound off"}
      title={muted ? "Sound off" : "Sound on"}
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
    >
      {muted ? "🔇" : "🔊"}
    </button>
  );
}

/* -------------------------------------------------------- ShareControls */

function shareUrl(code: string) {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}/?room=${code}`;
}

/** Copy + (where supported) native share for inviting friends. */
export function ShareControls({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl(code));
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      // Insecure context (plain http LAN) — clipboard may be blocked; ignore.
    }
  };

  const share = async () => {
    const url = shareUrl(code);
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: "Guess the Imposter", text: `Join my room: ${code}`, url });
        return;
      } catch {
        // User cancelled or share failed — fall back to copy below.
      }
    }
    void copy();
  };

  const canShare = typeof navigator !== "undefined" && !!navigator.share;

  return (
    <div className="flex items-center gap-2">
      <Button variant="ghost" className="px-3 py-2 text-sm" onClick={() => void copy()}>
        {copied ? "Link copied!" : "Copy link"}
      </Button>
      <Button variant="primary" className="px-3 py-2 text-sm" onClick={() => void share()}>
        {canShare ? "Share room" : "Copy code"}
      </Button>
    </div>
  );
}
