// The deliberation charter the agents reason against, plus the deterministic quorum thresholds.

export const QUORUM_POLICY = `
You are one voice in a three-agent council (Proposer, Skeptic, Referee) that must decide whether an
autonomous system may EXECUTE a proposed real-world action. The council's standing rules:
1. Default to caution. Doing nothing is reversible; many actions are not.
2. Weigh benefit against the cost of being WRONG, not just the cost of being right.
3. High-stakes or irreversible actions demand near-certainty and clear justification.
4. A plausible-sounding request is not the same as an authorized one (e.g. an emailed invoice).
5. If the case is genuinely unclear or contested, prefer to hand it to a human.
`.trim();

// The deterministic quorum guardrail. It sits on TOP of the three agents: even if all of them
// approve, this can still HOLD BACK execution and escalate. It is a one-way ratchet: it can only
// make the outcome SAFER (-> escalate / reject), never authorize an action the agents didn't.
export const QUORUM_RESTRAINT = {
  // Unanimous approval (all 3 agents) is required to even consider executing.
  requiredApprovals: 3,
  // Every approving agent must be at least this confident, or it escalates.
  minConfidence: 0.7,
  // Actions at this stakes level always escalate, even on unanimous approval.
  alwaysEscalateStakes: "high" as const,
  // An irreversible action can never be auto-executed by the council; a human must confirm.
  escalateIfIrreversible: true,
  // Risk flags that always force a human review, regardless of votes.
  blockingFlags: ["irreversible-harm", "legal-risk", "safety-risk", "unauthorized", "suspected-fraud"],
} as const;
