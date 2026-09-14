"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { RoomStateView } from "./gameTypes";
import { api, ApiError, fetchState, friendlyError, toIdentity, type Identity } from "./client";
import { sounds } from "./sound";

const IDENTITY_KEY = "imposter_identity_v1";

function readIdentity(): Identity | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(IDENTITY_KEY);
    if (!raw) return null;
    const id = JSON.parse(raw) as Identity;
    if (typeof id.code === "string" && typeof id.token === "string" && typeof id.name === "string") {
      return id;
    }
  } catch {
    // corrupt storage -> ignore
  }
  return null;
}

function writeIdentity(id: Identity | null) {
  if (typeof window === "undefined") return;
  if (id) window.localStorage.setItem(IDENTITY_KEY, JSON.stringify(id));
  else window.localStorage.removeItem(IDENTITY_KEY);
}

export type ConnectionStatus = "connecting" | "online" | "offline";

/** A social event derived from state diffs; consumed for toasts/sounds. */
export interface RoomEvent {
  id: number;
  kind: "joined" | "left" | "phase";
  text: string;
  /** Wall-clock ms when the event was observed (for auto-expiry). */
  bornMs: number;
}

let eventSeq = 0;
function makeEvent(kind: RoomEvent["kind"], text: string): RoomEvent {
  eventSeq += 1;
  return { id: eventSeq, kind, text, bornMs: Date.now() };
}

export interface UseRoom {
  identity: Identity | null;
  state: RoomStateView | null;
  error: string | null;
  clearError: () => void;
  syncing: boolean;
  /** Connection health of OUR client, derived from the polling loop. */
  connection: ConnectionStatus;
  /** Social/phase events observed from state diffs (join/leave/phase changes). */
  events: RoomEvent[];
  dismissEvent: (id: number) => void;
  createRoom: (name: string) => Promise<void>;
  joinRoom: (code: string, name: string) => Promise<void>;
  act: (action: string, extra?: Record<string, unknown>) => Promise<boolean>;
  leaveRoom: () => void;
}

/**
 * Single source of client game sync: holds the player identity (localStorage),
 * polls /api/game/state (which doubles as the server-side heartbeat), and
 * exposes game actions. One polling loop per mounted room view.
 */
export function useRoom(urlCode: string | null): UseRoom {
  const router = useRouter();
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [state, setState] = useState<RoomStateView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<ConnectionStatus>("connecting");
  const [events, setEvents] = useState<RoomEvent[]>([]);
  const identityRef = useRef<Identity | null>(null);
  // Mirror of `events` for use inside the polling effect without re-subscribing.
  const eventsRef = useRef<RoomEvent[]>([]);
  useEffect(() => {
    eventsRef.current = events;
  }, [events]);

  // Keep identityRef in sync for use inside callbacks.
  useEffect(() => {
    identityRef.current = identity;
  }, [identity]);

  // Load persisted identity once on mount.
  useEffect(() => {
    const id = readIdentity();
    if (id) {
      // If we opened a different room URL than the stored identity, follow the URL.
      if (urlCode && id.code !== urlCode) {
        writeIdentity(null);
      } else {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration from localStorage
        setIdentity(id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const code = identity?.code ?? null;
  const token = identity?.token ?? null;

  // Polling loop: state sync + heartbeat in one request.
  useEffect(() => {
    if (!code || !token) return;
    let stopped = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejoined = false; // single auto-rejoin attempt per loop

    // Derive join/leave/phase events by comparing consecutive snapshots.
    // All inputs are already-public fields of the per-token state view.
    // CLUE_PHASE rounds share a phase, so the round number is part of the key:
    // entering round 2/3 is a transition clients should notice.
    const viewKey = (s: RoomStateView) =>
      s.phase === "CLUE_PHASE" ? `${s.phase}:${s.clueRound}` : s.phase;
    const viewCopy = (s: RoomStateView): string => {
      switch (s.phase) {
        case "LOBBY":
          return "Back in the lobby";
        case "ROLE_REVEAL":
          return "The game is starting — check your role!";
        case "CLUE_PHASE":
          return `Clue time — round ${s.clueRound} of 3`;
        case "ROUND_DECISION":
          return "Round complete — time to decide";
        case "VOTING":
          return "Voting has begun";
        case "REVEAL":
          return "The votes are in";
      }
    };
    let prevState: RoomStateView | null = null;
    const diffEvents = (s: RoomStateView): RoomEvent[] => {
      const prev = prevState;
      prevState = s;
      if (!prev || prev.roomCode !== s.roomCode) return [];
      const out: RoomEvent[] = [];
      for (const p of s.players) {
        if (!prev.players.some((q) => q.id === p.id))
          out.push(makeEvent("joined", `${p.name} joined the room`));
      }
      for (const p of prev.players) {
        if (!s.players.some((q) => q.id === p.id)) out.push(makeEvent("left", `${p.name} left the room`));
      }
      if (viewKey(prev) !== viewKey(s)) {
        out.push(makeEvent("phase", viewCopy(s)));
        sounds.transition();
      }
      return out;
    };

    // Wake immediately when the tab becomes visible again (setTimeout in
    // background tabs can be throttled to once per minute).
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        if (timer) clearTimeout(timer);
        void tick();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    const tick = async () => {
      try {
        const s = await fetchState(code, token);
        if (stopped) return;
        failures = 0;
        setState(s);
        setError(null);
        setConnection("online");
        const evts = diffEvents(s);
        if (evts.length > 0 || eventsRef.current.length > 0) {
          setEvents((cur) => {
            const nowMs = Date.now();
            const kept = cur.filter((e) => nowMs - e.bornMs < 4500);
            const next = [...kept, ...evts.map((e) => ({ ...e, bornMs: nowMs }))];
            return next.slice(-3);
          });
        }

        // Server lost our seat (e.g. restart, kicked for inactivity): try to
        // reclaim our seat once by re-joining with the same name.
        if (!s.you && !rejoined) {
          rejoined = true;
          const id = identityRef.current;
          if (id) {
            try {
              const next = toIdentity(await api.join(code, id.name));
              if (stopped) return;
              writeIdentity(next);
              setIdentity(next); // new token -> effect re-runs with new token
              return;
            } catch {
              // fall through: shown as error on next cycle
            }
          }
        }
      } catch (e) {
        if (stopped) return;
        failures++;
        setConnection("offline");
        if (e instanceof ApiError && e.code === "NOT_FOUND") {
          setError("This room no longer exists.");
          writeIdentity(null);
          setIdentity(null);
          setState(null);
          return;
        }
        if (failures >= 3) {
          setError("Connection lost. Reconnecting…");
        }
        if (failures >= 3) sounds.error();
      }
      if (!stopped) {
        const delay = failures === 0 ? 1500 : Math.min(1500 * 2 * failures, 8000);
        timer = setTimeout(tick, delay);
      }
    };
    void tick();
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisible);
      if (timer) clearTimeout(timer);
    };
  }, [code, token]);

  const dismissEvent = useCallback((id: number) => {
    setEvents((cur) => cur.filter((e) => e.id !== id));
  }, []);

  const createRoom = useCallback(
    async (name: string) => {
      const fresh = toIdentity(await api.create(name));
      writeIdentity(fresh);
      setIdentity(fresh);
      router.push(`/${fresh.code}`);
    },
    [router],
  );

  const joinRoom = useCallback(
    async (joinCode: string, name: string) => {
      const fresh = toIdentity(await api.join(joinCode, name));
      writeIdentity(fresh);
      setIdentity(fresh);
      router.push(`/${fresh.code}`);
    },
    [router],
  );

  const act = useCallback(async (action: string, extra?: Record<string, unknown>) => {
    const id = identityRef.current;
    if (!id) return false;
    try {
      await api.action({ action, code: id.code, token: id.token, ...extra });
      return true;
    } catch (e) {
      if (e instanceof ApiError) {
        if (
          e.code !== "NOT_YOUR_TURN" &&
          e.code !== "ALREADY_SUBMITTED" &&
          e.code !== "ALREADY_VOTED" &&
          e.code !== "ALREADY_DECIDED"
        ) {
          setError(e.message);
          sounds.error();
        }
      } else {
        setError(friendlyError(e));
        sounds.error();
      }
      return false;
    }
  }, []);

  const leaveRoom = useCallback(() => {
    const id = identityRef.current;
    identityRef.current = null;
    // Clear local identity first so a leave-pinged page unload cannot rejoin.
    writeIdentity(null);
    setIdentity(null);
    setState(null);
    if (id) {
      // Best-effort; the page may be unloading so use keepalive.
      void fetch("/api/game/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "leave", code: id.code, token: id.token }),
        keepalive: true,
      }).catch(() => undefined);
    }
    router.push("/");
  }, [router]);

  return {
    identity,
    state,
    error,
    clearError: () => setError(null),
    syncing: !error && state === null && code !== null,
    connection,
    events,
    dismissEvent,
    createRoom,
    joinRoom,
    act,
    leaveRoom,
  };
}
