# Quorum: the agent council that knows when a vote isn't enough

> **Global AI Hackathon Series with Qwen Cloud · Track: Agent Society (multi-agent) · built solo with Claude Code.**

Most "multi-agent" demos let a swarm of agents talk themselves into an action. The dangerous failure mode of an agent *society* is **collective overconfidence**: three agents agreeing is not the same as authorization, and a fluent consensus can still be catastrophically wrong about something irreversible.

**Quorum is a council of Qwen agents that deliberates every consequential action, and a deterministic guardrail that refuses to execute without consensus and refuses to let any consensus authorize the irreversible.** It executes the clearly-safe, auto-denies the clearly-bad, and escalates the rest to a human.

## What it does

For each proposed action, three Qwen agents each cast an independent vote:

- **Proposer** argues the strongest good-faith case *for* executing.
- **Skeptic** hunts for what could go wrong: irreversibility, missing authorization, fraud, disproportionate stakes.
- **Referee** weighs both and casts a deciding vote.

Then a **deterministic quorum guardrail** turns the three votes into one outcome:

- **execute** — the council *unanimously* approves AND the action is safe enough to run autonomously,
- **reject** — the council agrees it should not happen (auto-denied, no human needed),
- **escalate** — the agents disagree, or the action is high-stakes / irreversible and no vote can authorize it.

A human only ever sees the escalation queue.

## The differentiator: consensus is necessary, never sufficient

The votes are advisory. Trust comes from a **deterministic guardrail** (`lib/policy.ts` + `applyQuorum` in `lib/agent.ts`) layered on top of the council. It is a **one-way ratchet**: it can only ever make the outcome *safer*.

- It **never executes without unanimity** — even a 2-of-3 majority on a perfectly safe action is escalated, not run.
- It **never lets unanimity override caution** — even a 3-of-3 approval is **held back** when the action is high-stakes, irreversible, below the confidence floor, or carries a blocking risk flag.
- It **never turns** an escalate or reject **into** an execute.

Stakes and reversibility are read from the **trusted action record**, not from anything the models said, so a confidently-wrong agent cannot talk the guardrail into running an irreversible action.

**The money moment:** a $12,000 contractor payment that two managers and finance have *already approved*. All three agents vote to execute (95% each). The guardrail **holds it back anyway** and escalates: a fully-authorized, unanimous council still does not get to pull an irreversible trigger without a human. The UI shows it: *"All 3 agents voted to approve, but the quorum guardrail held the action back."*

## How it's built

- **Qwen (`qwen-max`) on Qwen Cloud**, called through the OpenAI-compatible Alibaba Cloud DashScope endpoint with structured JSON and `temperature: 0`. Proof: [`lib/qwen.ts`](lib/qwen.ts) + the three live agent calls in [`lib/agent.ts`](lib/agent.ts).
- **A real society of agents:** three independent Qwen calls with distinct role charters deliberate in parallel; the outcome is the *aggregate*, not any single model's say-so.
- **The quorum guardrail** (`lib/policy.ts`) is the deterministic safety net that guarantees the invariants above.
- **Next.js (App Router) + TypeScript + Tailwind**, deployed on Vercel. The UI shows every agent's vote, confidence, and reasoning, plus the held-back escalations.
- **A key-free deterministic fallback** runs the same deliberation logic so the app never crashes before the Qwen credits land or if the API is down.

## Tests

The safety property is unit-tested: **14 Vitest tests** (`npm test`) pin the quorum invariants — no execution without unanimity; a split vote escalates; a unanimous approval of a high-stakes, irreversible, low-confidence, or flagged action is **held back**; a unanimous rejection is auto-denied; and an escalate/reject is never upgraded to an execute (the one-way ratchet). See [`tests/quorum.test.ts`](tests/quorum.test.ts).

## Run it locally

```bash
npm install
cp .env.example .env     # add your Qwen Cloud (DASHSCOPE) API key
npm run dev              # http://localhost:3000
```

Click **Run the council on the queue**. With a valid key it convenes three live Qwen agents per action; without one it runs the deterministic fallback so you can still see the full flow.

## What's next

- Weighted / domain-expert councils (e.g. a legal agent whose veto is binding for legal-risk actions).
- A confidence-calibrated quorum size: more agents convened as stakes rise.
- A one-click human-approval path for escalated actions, with the council's full transcript attached.

Built solo with **Claude Code**.
