"use client";

import { useEffect, useRef, useState } from "react";
import type { Phase } from "@/lib/gameTypes";

function copyFor(phase: Phase, clueRound?: number): string {
  switch (phase) {
    case "LOBBY":
      return "BACK IN THE LOBBY";
    case "ROLE_REVEAL":
      return "THE GAME IS STARTING…";
    case "CLUE_PHASE":
      return clueRound === 1 ? "CLUE TIME" : `ROUND ${clueRound ?? 2} OF 3 · CLUE TIME`;
    case "ROUND_DECISION":
      return "TIME TO DECIDE";
    case "VOTING":
      return "WHO IS THE IMPOSTER?";
    case "REVEAL":
      return "THE REVEAL";
  }
}

const DURATION_MS = 1600;

/**
 * Brief non-blocking interstitial on phase changes. Sits above the content
 * with pointer-events disabled so it can never trap taps or block the poll
 * loop; auto-dismisses on a timer. Respects prefers-reduced-motion via CSS
 * (the animation class is inert; the overlay simply fades out).
 *
 * The clue phase reuses a single phase for all three clue rounds, so the
 * round number is folded into the transition key: entering round 2/3 still
 * plays a short "ROUND N OF 3" transition.
 */
export default function TransitionOverlay({ phase, clueRound }: { phase: Phase; clueRound?: number }) {
  const [show, setShow] = useState<string | null>(null);
  const prev = useRef<string | null>(null);
  const key = phase === "CLUE_PHASE" ? `${phase}:${clueRound ?? 1}` : phase;

  useEffect(() => {
    if (prev.current !== null && prev.current !== key) {
      setShow(copyFor(phase, clueRound));
      const t = setTimeout(() => setShow(null), DURATION_MS);
      prev.current = key;
      return () => clearTimeout(t);
    }
    prev.current = key;
  }, [key, phase, clueRound]);

  if (!show) return null;
  return (
    <div
      aria-hidden="true"
      className="animate-overlay pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-gradient-to-b from-black/60 via-black/40 to-black/60"
    >
      <p className="animate-pop text-center text-2xl font-extrabold tracking-widest text-white drop-shadow-lg sm:text-3xl">
        {show}
      </p>
    </div>
  );
}