import type { AgentOpinion, AgentRole, ProposedAction, QuorumAction, QuorumDecision, Vote } from "./types";
import { QUORUM_POLICY, QUORUM_RESTRAINT } from "./policy";
import { qwenClient, QWEN_MODEL } from "./qwen";

// Role-specific charge for each of the three deliberating agents.
const ROLE: Record<AgentRole, string> = {
  proposer:
    "You are the PROPOSER. Make the strongest good-faith case FOR executing this action. Vote 'approve' if it is justified and the benefit outweighs the cost of being wrong; otherwise 'reject'.",
  skeptic:
    "You are the SKEPTIC. Your job is to surface what could go wrong: irreversibility, missing authorization, fraud, or stakes out of proportion to the benefit. Vote 'reject' if there is material unmitigated risk; 'approve' only if the action is clearly safe and justified.",
  referee:
    "You are the REFEREE. Weigh the case for and against impartially and cast a deciding vote. Vote 'approve' only when you are genuinely confident the action should run now without a human.",
};

const JSON_SHAPE =
  'Return STRICT JSON only, no prose: {"vote":"approve"|"reject","confidence":<number 0..1>,"reasoning":"one or two sentences","riskFlags":["zero or more of: irreversible-harm, legal-risk, safety-risk, unauthorized, suspected-fraud, disproportionate, insufficient-justification"]}';

function actionPrompt(a: ProposedAction): string {
  return `Proposed action under deliberation:
- id: ${a.id}
- title: "${a.title}"
- description: ${a.description}
- domain: ${a.domain}
- stakes if it goes wrong: ${a.stakes}
- reversible after it runs: ${a.reversible ? "yes" : "NO — irreversible"}

Cast your vote and return the JSON.`;
}

const clamp = (n: unknown) => Math.max(0, Math.min(1, Number(n) || 0));

// The deterministic quorum guardrail. It sits on TOP of the three agents: even unanimous approval
// can be HELD BACK here. One-way ratchet: it only ever makes the outcome SAFER, never authorizes an
// action the council didn't, and never turns an escalate/reject into an execute. Stakes and
// reversibility are read from the TRUSTED action record, not from anything the models said, so a
// confidently-wrong agent cannot talk the guardrail into running an irreversible action.
export function applyQuorum(
  action: ProposedAction,
  opinions: AgentOpinion[],
  modelFlags: string[] = [],
): {
  outcome: QuorumAction;
  rawOutcome: QuorumAction;
  heldBack: boolean;
  approvals: number;
  consensus: boolean;
  flags: string[];
} {
  const approvals = opinions.filter((o) => o.vote === "approve").length;
  const total = opinions.length;
  const unanimousApprove = total > 0 && approvals === total;
  const unanimousReject = approvals === 0;
  const approveConfs = opinions.filter((o) => o.vote === "approve").map((o) => o.confidence);
  const minApproveConf = approveConfs.length ? Math.min(...approveConfs) : 0;

  const flags = new Set(modelFlags);
  if (action.stakes === "high") flags.add("high-stakes");
  if (!action.reversible) flags.add("irreversible");

  // Outcome implied by the votes ALONE, before any restraint.
  let rawOutcome: QuorumAction;
  if (unanimousApprove) rawOutcome = "execute";
  else if (unanimousReject) rawOutcome = "reject";
  else {
    rawOutcome = "escalate";
    flags.add("no-consensus");
  }

  // Rejecting an action harms nothing, so the council can auto-deny without a human.
  if (rawOutcome === "reject") {
    return { outcome: "reject", rawOutcome, heldBack: false, approvals, consensus: true, flags: [...flags] };
  }
  // A split vote escalates as-is. It is not "held back" — the votes themselves never authorized it.
  if (rawOutcome === "escalate") {
    return { outcome: "escalate", rawOutcome, heldBack: false, approvals, consensus: false, flags: [...flags] };
  }

  // rawOutcome === "execute": the agents were unanimous. Now the ratchet decides if that's enough.
  const lowConfidence = minApproveConf < QUORUM_RESTRAINT.minConfidence;
  const highStakes = action.stakes === QUORUM_RESTRAINT.alwaysEscalateStakes;
  const irreversible = !action.reversible && QUORUM_RESTRAINT.escalateIfIrreversible;
  const blocking = [...flags].some((f) => (QUORUM_RESTRAINT.blockingFlags as readonly string[]).includes(f));

  if (lowConfidence || highStakes || irreversible || blocking) {
    if (lowConfidence) flags.add("low-confidence");
    return { outcome: "escalate", rawOutcome, heldBack: true, approvals, consensus: true, flags: [...flags] };
  }
  return { outcome: "execute", rawOutcome, heldBack: false, approvals, consensus: true, flags: [...flags] };
}

function summarize(
  q: { outcome: QuorumAction; heldBack: boolean; approvals: number },
  total: number,
): string {
  if (q.heldBack)
    return `All ${total} agents approved, but the quorum guardrail held the action back: it is high-stakes or irreversible, so no council vote can authorize it without a human.`;
  if (q.outcome === "execute")
    return `Unanimous approval (${q.approvals}/${total}) on a low-stakes, reversible action; safe to execute autonomously.`;
  if (q.outcome === "reject")
    return `The council unanimously rejected the action; it is auto-denied without troubling a human.`;
  return `The agents split (${q.approvals}/${total} in favor); without consensus the action is escalated to a human.`;
}

// Deterministic, key-free deliberation so the app runs before the Qwen credits land (and as a
// fallback if the API is unavailable). Mirrors how cautious agents would reason about each action.
function fallbackVote(role: AgentRole, action: ProposedAction): AgentOpinion {
  const harmful = /\b(delete|wipe|destroy|erase|purge)\b/i.test(`${action.title} ${action.description}`);
  if (harmful)
    return { role, vote: "reject", confidence: 0.92, reasoning: "Proposes irreversible destruction of data or assets; the cost of being wrong is catastrophic." };
  if (action.justified)
    return { role, vote: "approve", confidence: 0.86, reasoning: "Well-documented and justified on the merits; the benefit clearly outweighs the bounded risk." };
  if (role === "proposer")
    return { role, vote: "approve", confidence: 0.7, reasoning: "On its face the action advances a legitimate goal, so I make the case for it." };
  const safe = action.stakes === "low" && action.reversible;
  if (safe)
    return { role, vote: "approve", confidence: 0.8, reasoning: "Low-stakes and reversible, so the cost of being wrong is small." };
  return { role, vote: "reject", confidence: 0.78, reasoning: "Material stakes or irreversibility without clear justification; the safe move is to withhold." };
}

export function fallbackDeliberate(action: ProposedAction): QuorumDecision {
  const opinions = (["proposer", "skeptic", "referee"] as AgentRole[]).map((r) => fallbackVote(r, action));
  const q = applyQuorum(action, opinions, []);
  return {
    actionId: action.id,
    outcome: q.outcome,
    rawOutcome: q.rawOutcome,
    heldBack: q.heldBack,
    approvals: q.approvals,
    consensus: q.consensus,
    opinions,
    riskFlags: q.flags,
    reasoning: summarize(q, opinions.length),
    engine: "fallback",
  };
}

async function askAgent(
  client: NonNullable<ReturnType<typeof qwenClient>>,
  role: AgentRole,
  action: ProposedAction,
): Promise<{ opinion: AgentOpinion; flags: string[] }> {
  const completion = await client.chat.completions.create({
    model: QWEN_MODEL,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: `${QUORUM_POLICY}\n\n${ROLE[role]}\n\n${JSON_SHAPE}` },
      { role: "user", content: actionPrompt(action) },
    ],
  });
  const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as {
    vote?: string;
    confidence?: number;
    reasoning?: string;
    riskFlags?: string[];
  };
  const vote: Vote = parsed.vote === "approve" ? "approve" : "reject";
  return {
    opinion: { role, vote, confidence: clamp(parsed.confidence), reasoning: parsed.reasoning || "(no reasoning returned)" },
    flags: Array.isArray(parsed.riskFlags) ? parsed.riskFlags : [],
  };
}

// Run the full council: three Qwen agents deliberate in parallel, then the deterministic quorum
// guardrail decides. Falls back to the key-free deliberation if Qwen is unavailable.
export async function deliberate(action: ProposedAction): Promise<QuorumDecision> {
  const client = qwenClient();
  if (!client) return fallbackDeliberate(action);

  try {
    const results = await Promise.all(
      (["proposer", "skeptic", "referee"] as AgentRole[]).map((r) => askAgent(client, r, action)),
    );
    const opinions = results.map((r) => r.opinion);
    const modelFlags = results.flatMap((r) => r.flags);
    const q = applyQuorum(action, opinions, modelFlags);
    return {
      actionId: action.id,
      outcome: q.outcome,
      rawOutcome: q.rawOutcome,
      heldBack: q.heldBack,
      approvals: q.approvals,
      consensus: q.consensus,
      opinions,
      riskFlags: q.flags,
      reasoning: summarize(q, opinions.length),
      engine: "qwen",
      model: QWEN_MODEL,
    };
  } catch {
    const fb = fallbackDeliberate(action);
    return { ...fb, reasoning: fb.reasoning + " (Qwen unavailable; deterministic fallback used.)" };
  }
}
