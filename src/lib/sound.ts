"use client";

/**
 * Tiny optional sound system — zero dependencies, WebAudio only.
 *
 * Rules (per product brief):
 * - Sound NEVER autoplays: muted by default, the user must opt in.
 * - Never required for gameplay; the UI must work with sound off.
 * - The mute preference persists in localStorage.
 *
 * Browsers block AudioContext output until a user gesture has occurred; the
 * first sound therefore plays only after the user flips the toggle (a click),
 * which satisfies autoplay policies naturally.
 */

const MUTE_KEY = "imposter_sound_off_v1";

function readStoredMuted(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(MUTE_KEY) !== "0";
  } catch {
    return true;
  }
}

let ctx: AudioContext | null = null;
// Hydrate from storage so a refresh keeps the user's opt-in.
let muted = readStoredMuted();

export function isSoundMuted(): boolean {
  return readStoredMuted();
}

export function setSoundMuted(m: boolean) {
  muted = m;
  if (typeof window === "undefined") return;
  try {
    if (m) window.localStorage.removeItem(MUTE_KEY);
    else window.localStorage.setItem(MUTE_KEY, "0");
  } catch {
    // private mode / storage disabled -> session-only preference
  }
  if (!m) void ensureCtx();
}

function ensureCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
  return ctx;
}

/** One short synthesized blip. No samples, no network, no deps. */
function blip(
  freq: number,
  durationMs: number,
  { type = "sine", gain = 0.04, delayMs = 0 }: { type?: OscillatorType; gain?: number; delayMs?: number } = {},
) {
  if (muted) return;
  const ac = ensureCtx();
  if (!ac || ac.state !== "running") return;
  const t0 = ac.currentTime + delayMs / 1000;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + durationMs / 1000);
  osc.connect(g).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + durationMs / 1000 + 0.05);
}

export const sounds = {
  /** Player joined / lobby social ping. */
  join: () => blip(660, 120),
  /** Phase transition — soft two-note rise. */
  transition: () => {
    blip(520, 110);
    blip(780, 140, { delayMs: 110 });
  },
  /** Role card flip. */
  role: () => blip(340, 160, { type: "triangle", gain: 0.05 }),
  /** Vote locked in. */
  vote: () => blip(440, 90, { type: "triangle" }),
  /** Reveal moment — three-note sting. */
  reveal: () => {
    blip(392, 140, { type: "triangle" });
    blip(523, 140, { type: "triangle", delayMs: 130 });
    blip(659, 220, { type: "triangle", delayMs: 260, gain: 0.05 });
  },
  /** Failure / rejected action. */
  error: () => blip(200, 180, { type: "sawtooth", gain: 0.025 }),
};
