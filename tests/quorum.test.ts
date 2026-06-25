import { describe, it, expect } from "vitest";
import { applyQuorum, fallbackDeliberate } from "../lib/agent";
import { QUEUE } from "../lib/data";
import type { AgentOpinion, AgentRole, ProposedAction } from "../lib/types";

const unanimous = (vote: "approve" | "reject", confidence = 0.9): AgentOpinion[] =>
  (["proposer", "skeptic", "referee"] as AgentRole[]).map((role) => ({ role, vote, confidence, reasoning: "t" }));

const split: AgentOpinion[] = [
  { role: "proposer", vote: "approve", confidence: 0.9, reasoning: "" },
  { role: "skeptic", vote: "reject", confidence: 0.9, reasoning: "" },
  { role: "referee", vote: "approve", confidence: 0.9, reasoning: "" },
];

const action = (over: Partial<ProposedAction> = {}): ProposedAction => ({
  id: "T", title: "t", description: "d", stakes: "low", reversible: true, domain: "x", justified: true, ...over,
});

describe("applyQuorum — the deterministic quorum guardrail", () => {
  it("executes a unanimous, low-stakes, reversible, confident action", () => {
    const q = applyQuorum(action(), unanimous("approve", 0.9));
    expect(q.outcome).toBe("execute");
    expect(q.heldBack).toBe(false);
    expect(q.consensus).toBe(true);
    expect(q.approvals).toBe(3);
  });

  it("HOLDS BACK a unanimously-approved HIGH-STAKES action (one-way ratchet)", () => {
    const q = applyQuorum(action({ stakes: "high" }), unanimous("approve", 0.95));
    expect(q.rawOutcome).toBe("execute");
    expect(q.outcome).toBe("escalate");
    expect(q.heldBack).toBe(true);
    expect(q.flags).toContain("high-stakes");
  });

  it("HOLDS BACK a unanimously-approved IRREVERSIBLE action", () => {
    const q = applyQuorum(action({ reversible: false }), unanimous("approve", 0.95));
    expect(q.outcome).toBe("escalate");
    expect(q.heldBack).toBe(true);
    expect(q.flags).toContain("irreversible");
  });

  it("HOLDS BACK when an approving agent is below the confidence floor", () => {
    const q = applyQuorum(action(), unanimous("approve", 0.5));
    expect(q.outcome).toBe("escalate");
    expect(q.heldBack).toBe(true);
    expect(q.flags).toContain("low-confidence");
  });

  it("escalates a split vote (no consensus) and does not call it held back", () => {
    const q = applyQuorum(action(), split);
    expect(q.outcome).toBe("escalate");
    expect(q.heldBack).toBe(false);
    expect(q.consensus).toBe(false);
    expect(q.flags).toContain("no-consensus");
  });

  it("auto-rejects a unanimously-rejected action without a human", () => {
    const q = applyQuorum(action(), unanimous("reject", 0.9));
    expect(q.outcome).toBe("reject");
    expect(q.heldBack).toBe(false);
  });

  it("never executes without unanimous approval, even when perfectly safe (one-way ratchet)", () => {
    const twoOfThree: AgentOpinion[] = [
      { role: "proposer", vote: "approve", confidence: 0.99, reasoning: "" },
      { role: "skeptic", vote: "approve", confidence: 0.99, reasoning: "" },
      { role: "referee", vote: "reject", confidence: 0.99, reasoning: "" },
    ];
    expect(applyQuorum(action(), twoOfThree).outcome).not.toBe("execute");
  });

  it("escalates a unanimous approval that carries a blocking risk flag", () => {
    const q = applyQuorum(action(), unanimous("approve", 0.95), ["suspected-fraud"]);
    expect(q.outcome).toBe("escalate");
    expect(q.heldBack).toBe(true);
  });
});

describe("fallbackDeliberate — end-to-end over the demo queue", () => {
  const byId = (id: string) => fallbackDeliberate(QUEUE.find((a) => a.id === id)!);

  it("executes the clear, low-stakes, justified actions", () => {
    expect(byId("A-01").outcome).toBe("execute");
    expect(byId("A-06").outcome).toBe("execute");
  });

  it("escalates the contested loyalty discount (split vote)", () => {
    const d = byId("A-02");
    expect(d.outcome).toBe("escalate");
    expect(d.consensus).toBe(false);
  });

  it("escalates the suspicious $50k wire", () => {
    expect(byId("A-03").outcome).toBe("escalate");
  });

  it("auto-rejects the database deletion", () => {
    expect(byId("A-04").outcome).toBe("reject");
  });

  it("HOLDS BACK the justified-but-irreversible $12k milestone payment (the money moment)", () => {
    const d = byId("A-05");
    expect(d.rawOutcome).toBe("execute");
    expect(d.outcome).toBe("escalate");
    expect(d.heldBack).toBe(true);
    expect(d.approvals).toBe(3);
  });

  it("always returns exactly three agent opinions", () => {
    for (const a of QUEUE) expect(fallbackDeliberate(a).opinions).toHaveLength(3);
  });
});
