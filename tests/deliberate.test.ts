import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Qwen client so we can drive the model-facing parsing/coercion seam directly.
const h = vi.hoisted(() => ({ content: "" }));
vi.mock("../lib/qwen", () => ({
  QWEN_MODEL: "qwen-max",
  qwenClient: () => ({
    chat: { completions: { create: async () => ({ choices: [{ message: { content: h.content } }] }) } },
  }),
}));

import { deliberate } from "../lib/agent";
import type { ProposedAction } from "../lib/types";

const action: ProposedAction = {
  id: "T", title: "t", description: "d", stakes: "low", reversible: true, domain: "x", justified: true,
};

beforeEach(() => { h.content = ""; });

describe("deliberate — model-parsing seam (fail-closed)", () => {
  it("coerces malformed-but-valid-JSON fields safely and still runs the live path", async () => {
    // Every agent returns junk fields: a non-'approve' vote, an out-of-range confidence, a non-array riskFlags.
    h.content = JSON.stringify({ vote: "maybe", confidence: 5, riskFlags: "nope", execute: "yes" });
    const d = await deliberate(action);
    expect(d.engine).toBe("qwen");
    expect(d.opinions).toHaveLength(3);
    // vote 'maybe' is not a clear approve -> fail closed to reject
    expect(d.opinions.every((o) => o.vote === "reject")).toBe(true);
    // confidence is clamped into [0,1]
    expect(d.opinions.every((o) => o.confidence >= 0 && o.confidence <= 1)).toBe(true);
    // a non-array riskFlags must not crash anything
    expect(Array.isArray(d.riskFlags)).toBe(true);
    // unanimous reject -> auto-denied
    expect(d.outcome).toBe("reject");
    // solo 'execute' was the string "yes", not boolean true -> treated as not executing
    expect(d.solo.wouldExecute).toBe(false);
  });

  it("degrades gracefully to the deterministic fallback when the model returns unparseable garbage", async () => {
    h.content = "not json at all {{{";
    const d = await deliberate(action);
    expect(d.engine).toBe("fallback");
    expect(d.opinions).toHaveLength(3);
  });
});
