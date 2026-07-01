import { NextResponse } from "next/server";
import { deliberate } from "@/lib/agent";
import type { ProposedAction } from "@/lib/types";

export const runtime = "nodejs";

// Production hygiene for a public demo endpoint: a fixed-window per-IP rate limit (per serverless
// instance) plus strict payload validation, so a stray script can't drain the DashScope quota
// (each council convenes 4-5 qwen-max calls) or feed the agents unbounded junk. The demo queue
// (7 actions/run) fits comfortably under the limit.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;
const hits = new Map<string, { count: number; windowStart: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  if (hits.size > 10_000) hits.clear();
  const h = hits.get(ip);
  if (!h || now - h.windowStart > WINDOW_MS) {
    hits.set(ip, { count: 1, windowStart: now });
    return false;
  }
  h.count += 1;
  return h.count > MAX_PER_WINDOW;
}

// Free-text fields may be empty (the propose-your-own panel allows it) but are length-capped.
const text = (v: unknown, max: number) => typeof v === "string" && v.length <= max;
const nonEmpty = (v: unknown, max: number) => typeof v === "string" && v.length > 0 && v.length <= max;

function validAction(a: unknown): a is ProposedAction {
  if (!a || typeof a !== "object") return false;
  const q = a as Record<string, unknown>;
  return (
    nonEmpty(q.id, 40) &&
    text(q.title, 200) &&
    text(q.description, 1500) &&
    (q.stakes === "low" || q.stakes === "medium" || q.stakes === "high") &&
    typeof q.reversible === "boolean" &&
    text(q.domain, 60) &&
    typeof q.justified === "boolean"
  );
}

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (rateLimited(ip)) {
    return NextResponse.json({ error: "rate limit exceeded; try again in a minute" }, { status: 429 });
  }
  try {
    const body = (await req.json().catch(() => null)) as { action?: unknown } | null;
    if (!body || !validAction(body.action)) {
      return NextResponse.json({ error: "invalid action payload" }, { status: 400 });
    }
    const decision = await deliberate(body.action);
    return NextResponse.json({ decision });
  } catch (e) {
    console.error("deliberation failed:", e);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
