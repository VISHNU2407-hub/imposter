import { NextRequest, NextResponse } from "next/server";
import { getState } from "@/lib/gameStore";
import { errorResponse } from "@/lib/apiHelpers";

export async function GET(req: NextRequest) {
  try {
    const code = req.nextUrl.searchParams.get("code") ?? "";
    const token = req.nextUrl.searchParams.get("token") ?? "";
    const state = getState(code, token || null);
    return NextResponse.json(state, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
