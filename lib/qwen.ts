// ---------------------------------------------------------------------------
// Alibaba Cloud DashScope (Qwen Cloud) — the single, self-contained proof of Qwen usage.
//
// Every live model call in this project (all three council agents + the single-agent baseline in
// lib/agent.ts) goes through the client this file returns. Auth AND endpoint live here together:
//   • MODEL:    qwen-max  — Alibaba Cloud's flagship Qwen model.
//   • ENDPOINT: DashScope's OpenAI-compatible gateway, so the standard `openai` SDK talks to Qwen
//               with no bespoke transport. Default is the international (…-intl) DashScope host.
//   • AUTH:     the DASHSCOPE_API_KEY issued in the Alibaba Cloud / DashScope console.
// Nothing about the Qwen integration is defined anywhere else — this is the whole seam.
// ---------------------------------------------------------------------------
import OpenAI from "openai";

// Qwen model id (Alibaba Cloud). Overridable via env, defaults to the flagship qwen-max.
export const QWEN_MODEL = process.env.QWEN_MODEL || "qwen-max";

// Alibaba Cloud DashScope OpenAI-compatible base URL (international region by default).
export const QWEN_BASE_URL =
  process.env.QWEN_BASE_URL || "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";

// Returns an OpenAI-compatible client authenticated to Alibaba Cloud DashScope (Qwen Cloud),
// or null if no DASHSCOPE_API_KEY is set — in which case the app runs the deterministic fallback,
// so it never crashes before the hackathon credits land or if the API is temporarily unavailable.
export function qwenClient(): OpenAI | null {
  const apiKey = process.env.DASHSCOPE_API_KEY; // Alibaba Cloud DashScope credential
  if (!apiKey) return null;
  return new OpenAI({ apiKey, baseURL: QWEN_BASE_URL });
}
