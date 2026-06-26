import type { AgentOpinion, AgentRole, ProposedAction, QuorumAction, QuorumDecision, SoloBaseline, Vote } from "./types";
import { QUORUM_POLICY, QUORUM_RESTRAINT } from "./policy";
import { qwenClient, QWEN_MODEL } from "./qwen";

// Role-specific charge for each of the three deliberating agents.
const ROLE: Record<AgentRole, string> = {
  proposer:
    "You are the PROPOSER. Make the strongest good-faith case FOR executing this action. Vote 'approve' if it is justified and the benefit outweighs the cost of being wrong; otherwise 'reject'.",
  skeptic:
    "You are the SKEPTIC. Surface what is wrong with the action ITSELF: fraud or suspicious patterns, missing or invalid authorization, abuse, or harm out of proportion to the benefit. Vote 'reject' only if the action is illegitimate, unauthorized, fraudulent, or its risk is unmitigated. If it is legitimate and properly authorized, vote 'approve' — even when it is high-value or irreversible, because a separate deterministic guardrail (not you) handles reversibility and stakes.",
  referee:
    "You are the REFEREE. Cast the deciding vote AFTER hearing the Proposer and the Skeptic; weigh their actual arguments. Vote 'approve' when the action is sound, legitimate, and properly authorized. Do NOT reject merely because it is irreversible or high-value — a separate deterministic guardrail holds those back on its own. Reject only if the action itself is illegitimate, unauthorized, fraudulent, or harmful.",
};

const JSON_SHAPE =
  'Return STRICT JSON only, no prose: {"vote":"approve"|"reject","confidence":<number 0..1>,"reasoning":"one or two sentences","riskFlags":["zero or more of: irreversible-harm, legal-risk, safety-risk, unauthorized, suspected-fraud, abuse-pattern, disproportionate, insufficient-justification"]}';

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
// confidently-wrong agent cannot talk the guardrail into running an irreversible action — and the
// model's risk flags can only ADD restraint to the set, never remove it.
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

// ---------------------------------------------------------------------------
// Deterministic, key-free deliberation so the app runs before the Qwen credits land (and as a
// fallback if the API is unavailable). Mirrors how cautious agents would reason about each action.
const HARMFUL = /\b(delete|wipe|destroy|erase|purge)\b/i;
const ABUSE = /\b(\d+\s+refunds|serial|chargeback|abuse|repeatedly)\b/i;

function fallbackVote(role: AgentRole, action: ProposedAction): AgentOpinion {
  const text = `${action.title} ${action.description}`;
  if (HARMFUL.test(text))
    return { role, vote: "reject", confidence: 0.92, reasoning: "Proposes irreversible destruction of data or assets; the cost of being wrong is catastrophic." };
  // An abuse/fraud PATTERN is caught by the agents' reasoning even when stakes are low and the
  // action is reversible — exactly where a stakes-only guardrail would wave it through.
  if (ABUSE.test(text) && role !== "proposer")
    return { role, vote: "reject", confidence: 0.82, reasoning: "The history shows an abuse/fraud pattern; approving it would reward gaming, regardless of the small amount." };
  if (action.justified)
    return { role, vote: "approve", confidence: 0.86, reasoning: "Well-documented and justified on the merits; the benefit clearly outweighs the bounded risk." };
  if (role === "proposer")
    return { role, vote: "approve", confidence: 0.7, reasoning: "On its face the action advances a legitimate goal, so I make the case for it." };
  const safe = action.stakes === "low" && action.reversible;
  if (safe)
    return { role, vote: "approve", confidence: 0.8, reasoning: "Low-stakes and reversible, so the cost of being wrong is small." };
  return { role, vote: "reject", confidence: 0.78, reasoning: "Material stakes or irreversibility without clear justification; the safe move is to withhold." };
}

// A lone autonomous agent with no council and no guardrail: helpful and task-completing, it executes
// any action that looks legitimate and isn't obviously destructive. This is the baseline.
function fallbackSolo(action: ProposedAction): SoloBaseline {
  const text = `${action.title} ${action.description}`;
  if (HARMFUL.test(text))
    return { wouldExecute: false, reasoning: "Even acting alone, an agent would balk at outright data destruction." };
  return { wouldExecute: true, reasoning: "Acting alone to get the task done, the agent would just execute this — no skeptic, no human, no second look." };
}

export function fallbackDeliberate(action: ProposedAction): QuorumDecision {
  const opinions = (["proposer", "skeptic", "referee"] as AgentRole[]).map((r) => fallbackVote(r, action));
  opinions[2].sawCouncil = true;

  // Deterministic rebuttal (mirrors the live path so emergent negotiation is visible without a key):
  // if the Proposer approved but the Skeptic rejected on a DECISIVE objection, the Proposer concedes.
  // On a genuinely contested-but-not-dangerous call the Proposer holds its ground, so the split stands.
  if (opinions[0].vote === "approve" && opinions[1].vote === "reject") {
    const text = `${action.title} ${action.description}`;
    const decisive = HARMFUL.test(text) || ABUSE.test(text) || !action.reversible || action.stakes === "high";
    if (decisive) {
      opinions[0] = {
        ...opinions[0],
        vote: "reject",
        confidence: 0.8,
        reasoning: "On reflection, the Skeptic's objection is decisive; I withdraw my approval.",
        revisedFrom: "approve",
      };
    }
  }

  const solo = fallbackSolo(action);
  const q = applyQuorum(action, opinions, []);
  return {
    actionId: action.id,
    outcome: q.outcome,
    rawOutcome: q.rawOutcome,
    heldBack: q.heldBack,
    approvals: q.approvals,
    consensus: q.consensus,
    opinions,
    solo,
    caughtBySociety: solo.wouldExecute && q.outcome !== "execute",
    riskFlags: q.flags,
    reasoning: summarize(q, opinions.length),
    engine: "fallback",
  };
}

// ---------------------------------------------------------------------------
type Client = NonNullable<ReturnType<typeof qwenClient>>;

function parseVote(content: string | null | undefined, role: AgentRole, sawCouncil = false): { opinion: AgentOpinion; flags: string[] } {
  const parsed = JSON.parse(content ?? "{}") as { vote?: string; confidence?: number; reasoning?: string; riskFlags?: string[] };
  const vote: Vote = parsed.vote === "approve" ? "approve" : "reject"; // fail-closed: anything but a clear approve is a reject
  return {
    opinion: { role, vote, confidence: clamp(parsed.confidence), reasoning: parsed.reasoning || "(no reasoning returned)", sawCouncil },
    flags: Array.isArray(parsed.riskFlags) ? parsed.riskFlags : [],
  };
}

async function askAgent(client: Client, role: AgentRole, action: ProposedAction): Promise<{ opinion: AgentOpinion; flags: string[] }> {
  const completion = await client.chat.completions.create({
    model: QWEN_MODEL,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: `${QUORUM_POLICY}\n\n${ROLE[role]}\n\n${JSON_SHAPE}` },
      { role: "user", content: actionPrompt(action) },
    ],
  });
  return parseVote(completion.choices[0]?.message?.content, role);
}

// Rebuttal round: when the Proposer and Skeptic disagree, the Proposer hears the Skeptic's
// objection and may CHANGE its vote. This is where the society negotiates rather than just polls.
async function askRebuttal(client: Client, action: ProposedAction, proposer: AgentOpinion, skeptic: AgentOpinion): Promise<{ opinion: AgentOpinion; flags: string[] }> {
  const completion = await client.chat.completions.create({
    model: QWEN_MODEL,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: `${QUORUM_POLICY}\n\n${ROLE.proposer}\n\nThe Skeptic has challenged your position. Reconsider honestly: if the Skeptic's objection is decisive, CHANGE your vote; if not, hold your ground and rebut.\n\n${JSON_SHAPE}` },
      { role: "user", content: `${actionPrompt(action)}\n\nYour initial vote was ${proposer.vote} (confidence ${proposer.confidence.toFixed(2)}): "${proposer.reasoning}"\nThe SKEPTIC objects (${skeptic.vote}): "${skeptic.reasoning}"\n\nGive your final vote.` },
    ],
  });
  const r = parseVote(completion.choices[0]?.message?.content, "proposer");
  if (r.opinion.vote !== proposer.vote) r.opinion.revisedFrom = proposer.vote;
  return r;
}

// Round 2: the referee deliberates over the council's actual arguments before casting the deciding vote.
async function askReferee(client: Client, action: ProposedAction, proposer: AgentOpinion, skeptic: AgentOpinion): Promise<{ opinion: AgentOpinion; flags: string[] }> {
  const transcript = `The PROPOSER voted ${proposer.vote} (confidence ${proposer.confidence.toFixed(2)}): "${proposer.reasoning}"
The SKEPTIC voted ${skeptic.vote} (confidence ${skeptic.confidence.toFixed(2)}): "${skeptic.reasoning}"`;
  const completion = await client.chat.completions.create({
    model: QWEN_MODEL,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: `${QUORUM_POLICY}\n\n${ROLE.referee}\n\n${JSON_SHAPE}` },
      { role: "user", content: `${actionPrompt(action)}\n\nThe council has deliberated:\n${transcript}\n\nNow cast the deciding vote, weighing their arguments.` },
    ],
  });
  return parseVote(completion.choices[0]?.message?.content, "referee", true);
}

// The single-agent baseline: one lone, oversight-free Qwen agent that just decides whether to run it.
async function askSolo(client: Client, action: ProposedAction): Promise<SoloBaseline> {
  const completion = await client.chat.completions.create({
    model: QWEN_MODEL,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a single autonomous back-office agent acting ALONE, with no reviewer and no human in the loop. Your job is to get tasks done efficiently. Decide whether to execute the proposed action. Return STRICT JSON: {\"execute\": true|false, \"reasoning\":\"one sentence\"}.",
      },
      { role: "user", content: actionPrompt(action) },
    ],
  });
  const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as { execute?: boolean; reasoning?: string };
  return { wouldExecute: parsed.execute === true, reasoning: parsed.reasoning || "(no reasoning returned)" };
}

// Run the full council: Proposer and Skeptic deliberate in parallel, then the Referee casts the
// deciding vote having heard both; a single-agent baseline runs alongside for comparison. The
// deterministic quorum guardrail then decides. Falls back to key-free deliberation if Qwen is down.
export async function deliberate(action: ProposedAction): Promise<QuorumDecision> {
  const client = qwenClient();
  if (!client) return fallbackDeliberate(action);

  try {
    const [solo, round1] = await Promise.all([
      askSolo(client, action),
      Promise.all([askAgent(client, "proposer", action), askAgent(client, "skeptic", action)]),
    ]);
    const [proposer, skeptic] = round1;

    // Negotiation: if the Proposer and Skeptic disagree, the Proposer rebuts and may revise its vote.
    let proposerFinal = proposer;
    if (proposer.opinion.vote !== skeptic.opinion.vote) {
      proposerFinal = await askRebuttal(client, action, proposer.opinion, skeptic.opinion);
    }

    const referee = await askReferee(client, action, proposerFinal.opinion, skeptic.opinion);

    const opinions = [proposerFinal.opinion, skeptic.opinion, referee.opinion];
    const modelFlags = [...proposerFinal.flags, ...skeptic.flags, ...referee.flags];
    const q = applyQuorum(action, opinions, modelFlags);
    return {
      actionId: action.id,
      outcome: q.outcome,
      rawOutcome: q.rawOutcome,
      heldBack: q.heldBack,
      approvals: q.approvals,
      consensus: q.consensus,
      opinions,
      solo,
      caughtBySociety: solo.wouldExecute && q.outcome !== "execute",
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
