import { NextResponse } from "next/server";
import { GameError } from "./gameStore";

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof GameError) {
    const status =
      err.code === "NOT_FOUND"
        ? 404
        : err.code === "FORBIDDEN" || err.code === "NOT_YOUR_TURN"
          ? 403
        : err.code === "VALIDATION" ||
            err.code === "ALREADY_SUBMITTED" ||
            err.code === "ALREADY_VOTED" ||
            err.code === "ALREADY_DECIDED" ||
            err.code === "SELF_VOTE" ||
            err.code === "DUPLICATE_CLUE" ||
            err.code === "BAD_STATE"
            ? 400
            : 409; // GAME_STARTED, ROOM_FULL, NOT_ENOUGH_PLAYERS
    return NextResponse.json({ error: err.message, code: err.code }, { status });
  }
  console.error("[api] unexpected error:", err);
  return NextResponse.json({ error: "Internal server error", code: "INTERNAL" }, { status: 500 });
}
