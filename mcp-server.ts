/**
 * Quorum MCP server — exposes the agent council to any MCP client (Claude Desktop, Cursor, or
 * another agent) over stdio. An agent society can call `convene_council` before taking a
 * consequential action: three Qwen agents deliberate and the deterministic quorum guardrail
 * returns execute / reject / escalate. The guardrail runs the same way for an external caller, so
 * a second agent can consult the council but can never talk it into running the irreversible.
 * Run: `npm run mcp`.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, existsSync } from "node:fs";
import { deliberate } from "./lib/agent";
import { QUEUE } from "./lib/data";
import type { ProposedAction } from "./lib/types";

// Minimal .env loader so the same Qwen config powers the MCP server.
if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const server = new Server({ name: "quorum-council", version: "1.0.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "convene_council",
      description:
        "Submit a consequential action to Quorum's three-agent council before taking it. The Proposer, Skeptic, and Referee deliberate (the Referee decides after hearing the others), then a deterministic guardrail returns the outcome: execute (unanimous + safe), reject (the council auto-denies), or escalate (split vote, or a high-stakes/irreversible action no consensus can authorize). Returns every agent's vote and reasoning, the outcome, whether it was held back, and a single-agent baseline.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "short label for the action" },
          description: { type: "string", description: "the full proposal text to deliberate on" },
          stakes: { type: "string", enum: ["low", "medium", "high"], description: "impact if it goes wrong" },
          reversible: { type: "boolean", description: "can the action be undone after it runs?" },
          justified: { type: "boolean", description: "is there clear, documented justification? (optional)" },
        },
        required: ["title", "description", "stakes", "reversible"],
      },
    },
    {
      name: "list_demo_actions",
      description: "List the built-in demo queue of proposed actions (id, title, stakes, reversible) you can convene the council on.",
      inputSchema: { type: "object", properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name } = req.params;
  const args = (req.params.arguments ?? {}) as Record<string, unknown>;

  if (name === "list_demo_actions") {
    const list = QUEUE.map((a) => ({ id: a.id, title: a.title, stakes: a.stakes, reversible: a.reversible }));
    return { content: [{ type: "text", text: JSON.stringify(list, null, 2) }] };
  }

  if (name === "convene_council") {
    const action: ProposedAction = {
      id: "mcp-" + Math.random().toString(36).slice(2, 8),
      title: String(args.title ?? ""),
      description: String(args.description ?? ""),
      stakes: (["low", "medium", "high"].includes(String(args.stakes)) ? String(args.stakes) : "high") as ProposedAction["stakes"],
      reversible: args.reversible === true,
      domain: "mcp",
      justified: args.justified === true,
    };
    const decision = await deliberate(action);
    return { content: [{ type: "text", text: JSON.stringify(decision, null, 2) }] };
  }

  throw new Error(`unknown tool: ${name}`);
});

async function main() {
  await server.connect(new StdioServerTransport());
}
main().catch((e) => {
  console.error("quorum-mcp failed:", e);
  process.exit(1);
});
