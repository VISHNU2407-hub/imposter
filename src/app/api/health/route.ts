import { NextResponse } from "next/server";

/** Liveness probe for the hosting platform. Returns no game state or secrets. */
export function GET() {
  return NextResponse.json({
    ok: true,
    service: "guess-the-imposter",
    state: "in-memory",
    singleInstance: true,
  });
}