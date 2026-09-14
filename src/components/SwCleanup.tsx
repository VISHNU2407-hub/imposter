"use client";

import { useEffect } from "react";

const SW_CLEANUP_KEY = "imposter_sw_cleanup_v1";

/**
 * This app ships no service worker. A leftover service worker from a previous
 * project on the same origin (common in dev on localhost:3000) can intercept
 * fetches — a cache-first handler on /api/game/state freezes the game at its
 * first poll: the host stops seeing players join while the server state is
 * correct. One-time per tab session: unregister any service worker, delete its
 * caches, and reload once so polling reaches the network.
 */
export default function SwCleanup() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (window.sessionStorage.getItem(SW_CLEANUP_KEY)) return;

    void (async () => {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        const cacheNames = "caches" in window ? await caches.keys() : [];
        // Remember we checked even when there is nothing to do, so we only
        // ever attempt this once per tab session.
        window.sessionStorage.setItem(SW_CLEANUP_KEY, "1");
        if (registrations.length === 0 && cacheNames.length === 0) return;

        await Promise.all(registrations.map((r) => r.unregister()));
        if ("caches" in window) {
          await Promise.all(cacheNames.map((c) => caches.delete(c)));
        }
        window.location.reload();
      } catch {
        // Never loop: the marker is already set above.
      }
    })();
  }, []);

  return null;
}
