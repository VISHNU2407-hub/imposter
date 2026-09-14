import { NextRequest, NextResponse } from "next/server";
import { createRoom } from "@/lib/gameStore";
import { errorResponse } from "@/lib/apiHelpers";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const result = createRoom(body?.name);
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
