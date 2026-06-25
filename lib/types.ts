// Quorum — a multi-agent deliberation system. Three Qwen agents (Proposer, Skeptic, Referee)
// debate a proposed consequential action; a deterministic quorum guardrail decides the outcome.

export type Vote = "approve" | "reject";
export type AgentRole = "proposer" | "skeptic" | "referee";

// The final, guardrail-enforced outcome.
//  execute  — quorum approved AND the guardrail allows it (safe, reversible, confident)
//  reject   — the agents agree it should NOT happen (auto-denied, no human needed)
//  escalate — disagreement, or a high-stakes/irreversible action no consensus can authorize
export type QuorumAction = "execute" | "reject" | "escalate";

export interface ProposedAction {
  id: string;
  title: string; // short label, e.g. "Wire $50,000 to a new supplier"
  description: string; // the full proposal text the agents deliberate on
  stakes: "low" | "medium" | "high";
  reversible: boolean; // can the action be undone after it runs?
  domain: string; // e.g. "finance", "ops", "comms", "sales"
  justified: boolean; // is there clear, documented justification? (used by the key-free fallback)
}

export interface AgentOpinion {
  role: AgentRole;
  vote: Vote;
  confidence: number; // 0..1
  reasoning: string;
  sawCouncil?: boolean; // true for an agent that deliberated AFTER hearing the others (the referee)
}

// What a single autonomous agent, acting ALONE with no council and no guardrail, would do.
// This is the baseline the council is measured against.
export interface SoloBaseline {
  wouldExecute: boolean;
  reasoning: string;
}

export interface QuorumDecision {
  actionId: string;
  outcome: QuorumAction; // after the deterministic guardrail (the one-way ratchet)
  rawOutcome: QuorumAction; // what the votes alone implied, BEFORE restraint
  heldBack: boolean; // true when the guardrail downgraded an approved action to escalate
  approvals: number; // count of "approve" votes among the agents
  consensus: boolean; // did the agents reach a unanimous verdict (either way)?
  opinions: AgentOpinion[];
  solo: SoloBaseline; // what a lone agent (no council, no guardrail) would have done
  caughtBySociety: boolean; // solo would have executed, but the council/guardrail did not
  riskFlags: string[];
  reasoning: string; // plain-English summary of why this outcome
  engine: "qwen" | "fallback";
  model?: string;
}
