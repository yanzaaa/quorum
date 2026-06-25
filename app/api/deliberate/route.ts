import { NextResponse } from "next/server";
import { deliberate } from "@/lib/agent";
import type { ProposedAction } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { action?: ProposedAction };
    if (!body?.action?.id) {
      return NextResponse.json({ error: "missing action" }, { status: 400 });
    }
    const decision = await deliberate(body.action);
    return NextResponse.json({ decision });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
