import { NextRequest, NextResponse } from "next/server";
import {
  GameError,
  closeRoom,
  leaveRoom,
  playAgain,
  setReady,
  startGame,
  submitClue,
  submitDecision,
  submitVote,
} from "@/lib/gameStore";
import { errorResponse } from "@/lib/apiHelpers";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body.action !== "string") {
      throw new GameError("VALIDATION", "Missing action");
    }
    const code: string = typeof body.code === "string" ? body.code : "";
    const token: string = typeof body.token === "string" ? body.token : "";

    switch (body.action) {
      case "start":
        startGame(code, token);
        break;
      case "ready":
        setReady(code, token);
        break;
      case "clue":
        submitClue(code, token, body.clue);
        break;
      case "decision":
        submitDecision(code, token, body.choice);
        break;
      case "vote":
        if (typeof body.targetId !== "string") throw new GameError("VALIDATION", "Missing vote target");
        submitVote(code, token, body.targetId);
        break;
      case "again":
        playAgain(code, token);
        break;
      case "leave":
        leaveRoom(code, token);
        break;
      case "close":
        closeRoom(code, token);
        break;
      default:
        throw new GameError("VALIDATION", `Unknown action: ${body.action}`);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
