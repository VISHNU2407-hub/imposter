import type { RoomStateView } from "./gameTypes";

/**
 * Friendly, non-technical message for unexpected failures. Known error codes
 * already carry good copy from the server; anything else gets a generic line.
 */
export function friendlyError(e: unknown): string {
  if (e instanceof ApiError) {
    return e.code === "INTERNAL" ? "Something went wrong. Please try again." : e.message;
  }
  if (e instanceof Error && e.message) return "Something went wrong. Please try again.";
  return "Something went wrong. Please try again.";
}

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface Identity {
  code: string;
  playerId: string;
  token: string;
  name: string;
}

/** Shape returned by /api/game/create and /api/game/join. */
export interface ServerAuthResponse {
  roomCode: string;
  playerId: string;
  token: string;
  name: string;
}

/** The server uses `roomCode`; the client identity uses `code`. */
export function toIdentity(res: ServerAuthResponse): Identity {
  return { code: res.roomCode, playerId: res.playerId, token: res.token, name: res.name };
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ApiError(
      typeof data.code === "string" ? data.code : "INTERNAL",
      typeof data.error === "string" ? data.error : `Request failed (${res.status})`,
    );
  }
  return data as T;
}

export const api = {
  create: (name: string) => post<ServerAuthResponse>("/api/game/create", { name }),
  join: (code: string, name: string) => post<ServerAuthResponse>("/api/game/join", { code, name }),
  action: (body: { action: string; code: string; token: string } & Record<string, unknown>) =>
    post<{ ok: boolean }>("/api/game/action", body),
};

export async function fetchState(code: string, token: string): Promise<RoomStateView> {
  const res = await fetch(
    `/api/game/state?code=${encodeURIComponent(code)}&token=${encodeURIComponent(token ?? "")}`,
    { cache: "no-store" },
  );
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ApiError(
      typeof data.code === "string" ? data.code : "INTERNAL",
      typeof data.error === "string" ? data.error : `Request failed (${res.status})`,
    );
  }
  return data as unknown as RoomStateView;
}
