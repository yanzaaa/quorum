// Aggregate evidence for Track 3's "measurable efficiency gain over single-agent baselines":
// run the deterministic deliberation over the whole demo queue and write a committed summary
// comparing the council + quorum guardrail against the lone-agent baseline, action by action.
// No API key needed — this uses the deterministic path so the artifact is reproducible; the live
// Qwen path runs through the exact same guardrail. Regenerate with: npx tsx scripts/aggregate.ts
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { QUEUE } from "../lib/data";
import { fallbackDeliberate } from "../lib/agent";
import { QUORUM_RESTRAINT } from "../lib/policy";

const decisions = QUEUE.map(fallbackDeliberate);

// Pull a dollar figure out of an action's text where one exists, so the stopped
// exposure can be totalled ("$50,000 wire" -> 50000). Percent-only actions return null.
const dollars = (a: { title: string; description: string }): number | null => {
  const m = `${a.title} ${a.description}`.match(/\$([\d,]+)/);
  return m ? Number(m[1].replace(/,/g, "")) : null;
};

const rows = QUEUE.map((a, i) => {
  const d = decisions[i];
  return {
    id: a.id,
    title: a.title,
    stakes: a.stakes,
    reversible: a.reversible,
    votes: d.opinions.map((o) => o.vote),
    rawOutcome: d.rawOutcome,
    outcome: d.outcome,
    heldBack: d.heldBack,
    soloWouldExecute: d.solo.wouldExecute,
    caughtBySociety: d.caughtBySociety,
    amount: dollars(a),
  };
});

const caught = rows.filter((r) => r.caughtBySociety);
const summary = {
  note: "Deterministic aggregate over the demo queue (no API key needed; the live Qwen path follows the same quorum guardrail). Quantifies the multi-agent layer's measurable gain over the single-agent baseline: what a lone, oversight-free agent would have executed vs. what the council + guardrail actually allowed.",
  restraint: {
    requiredApprovals: QUORUM_RESTRAINT.requiredApprovals,
    minConfidence: QUORUM_RESTRAINT.minConfidence,
    alwaysEscalateStakes: QUORUM_RESTRAINT.alwaysEscalateStakes,
    escalateIfIrreversible: QUORUM_RESTRAINT.escalateIfIrreversible,
    blockingFlags: [...QUORUM_RESTRAINT.blockingFlags],
  },
  actions: QUEUE.length,
  council: {
    executed: rows.filter((r) => r.outcome === "execute").length,
    auto_denied: rows.filter((r) => r.outcome === "reject").length,
    escalated: rows.filter((r) => r.outcome === "escalate").length,
    held_back_by_guardrail: rows.filter((r) => r.heldBack).length,
  },
  lone_agent: {
    would_execute: rows.filter((r) => r.soloWouldExecute).length,
  },
  gain_over_single_agent: {
    unsafe_executions_stopped: caught.length,
    dollar_exposure_stopped: caught.reduce((sum, r) => sum + (r.amount ?? 0), 0),
    unpriced_actions_stopped: caught.filter((r) => r.amount === null).length,
    human_reviews_needed: rows.filter((r) => r.outcome === "escalate").length,
    api_calls: "4-5 qwen-max calls per council verdict (Proposer + Skeptic in parallel, a rebuttal round on disagreement, the Referee, plus the lone-agent baseline) vs 1 for the lone agent",
  },
  rows,
};

const out = fileURLToPath(new URL("../public/benchmark.json", import.meta.url));
writeFileSync(out, JSON.stringify(summary, null, 2) + "\n");

console.log(`Queue: ${summary.actions} actions`);
console.log(`  lone agent would execute: ${summary.lone_agent.would_execute}/${summary.actions}`);
console.log(`  council: ${summary.council.executed} executed, ${summary.council.auto_denied} auto-denied, ${summary.council.escalated} escalated (${summary.council.held_back_by_guardrail} held back by the guardrail)`);
console.log(`  unsafe lone-agent executions stopped: ${summary.gain_over_single_agent.unsafe_executions_stopped} ($${summary.gain_over_single_agent.dollar_exposure_stopped.toLocaleString()} of priced exposure)`);
console.log(`Wrote ${out}`);
