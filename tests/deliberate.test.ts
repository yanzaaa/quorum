import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Qwen client so we can drive the model-facing parsing/coercion seam directly and
// inspect what each agent was actually sent.
const h = vi.hoisted(() => ({ content: "", calls: [] as { content?: string }[][] }));
vi.mock("../lib/qwen", () => ({
  QWEN_MODEL: "qwen-max",
  qwenClient: () => ({
    chat: {
      completions: {
        create: async ({ messages }: { messages: { content?: string }[] }) => {
          h.calls.push(messages);
          // Parsing tests pin a fixed payload; otherwise return role-aware bodies so we can
          // verify the referee receives the others' arguments.
          if (h.content) return { choices: [{ message: { content: h.content } }] };
          const sys = String(messages[0]?.content ?? "");
          let body: Record<string, unknown>;
          if (sys.includes("REFEREE")) body = { vote: "reject", confidence: 0.9, reasoning: "REF_REASON" };
          else if (sys.includes("PROPOSER")) body = { vote: "approve", confidence: 0.9, reasoning: "PROP_REASON" };
          else if (sys.includes("SKEPTIC")) body = { vote: "reject", confidence: 0.9, reasoning: "SKEP_REASON" };
          else body = { execute: true, reasoning: "SOLO_REASON" };
          return { choices: [{ message: { content: JSON.stringify(body) } }] };
        },
      },
    },
  }),
}));

import { deliberate } from "../lib/agent";
import type { ProposedAction } from "../lib/types";

const action: ProposedAction = {
  id: "T", title: "t", description: "d", stakes: "low", reversible: true, domain: "x", justified: true,
};

beforeEach(() => { h.content = ""; h.calls = []; });

describe("deliberate — model-parsing seam (fail-closed)", () => {
  it("coerces malformed-but-valid-JSON fields safely and still runs the live path", async () => {
    h.content = JSON.stringify({ vote: "maybe", confidence: 5, riskFlags: "nope", execute: "yes" });
    const d = await deliberate(action);
    expect(d.engine).toBe("qwen");
    expect(d.opinions).toHaveLength(3);
    expect(d.opinions.every((o) => o.vote === "reject")).toBe(true); // non-'approve' -> fail closed
    expect(d.opinions.every((o) => o.confidence >= 0 && o.confidence <= 1)).toBe(true); // clamped
    expect(Array.isArray(d.riskFlags)).toBe(true); // non-array riskFlags didn't crash
    expect(d.outcome).toBe("reject");
    expect(d.solo.wouldExecute).toBe(false); // string "yes" !== boolean true
  });

  it("degrades gracefully to the deterministic fallback when the model returns unparseable garbage", async () => {
    h.content = "not json at all {{{";
    const d = await deliberate(action);
    expect(d.engine).toBe("fallback");
    expect(d.opinions).toHaveLength(3);
  });
});

describe("deliberate — the referee genuinely deliberates over the council's arguments", () => {
  it("passes the proposer's and skeptic's actual reasoning into the referee's prompt", async () => {
    await deliberate(action); // proposer approves, skeptic rejects -> they disagree -> referee weighs both
    const refCall = h.calls.find((m) => String(m[0]?.content).includes("REFEREE"));
    expect(refCall).toBeTruthy();
    const userMsg = String(refCall![1]?.content);
    expect(userMsg).toContain("PROP_REASON");
    expect(userMsg).toContain("SKEP_REASON");
  });
});
