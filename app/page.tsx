"use client";

import { useEffect, useState } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import dynamic from "next/dynamic";
import { QUEUE } from "@/lib/data";
import type { ProposedAction, QuorumDecision } from "@/lib/types";

const Hero3D = dynamic(() => import("@/components/Hero3D"), { ssr: false });

const EASE = [0.32, 0.72, 0, 1] as const;

const META: Record<string, { label: string; tag: string; edge: string }> = {
  execute: { label: "Executed", tag: "tag-approve", edge: "edge-approve" },
  reject: { label: "Auto-denied", tag: "tag-deny", edge: "edge-deny" },
  escalate: { label: "Escalated to human", tag: "tag-escalate", edge: "edge-escalate" },
};

type Cell = QuorumDecision | "loading" | undefined;

const container = { hidden: {}, show: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } } };
const item = {
  hidden: { opacity: 0, y: 18, filter: "blur(6px)" },
  show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.7, ease: EASE } },
};

function Reveal({ children, className, delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 22, filter: "blur(8px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, margin: "-50px" }}
      transition={{ duration: 0.75, ease: EASE, delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

function Tilt({ children, className }: { children: React.ReactNode; className?: string }) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotateX = useSpring(useTransform(y, [-0.5, 0.5], [4.5, -4.5]), { stiffness: 220, damping: 18 });
  const rotateY = useSpring(useTransform(x, [-0.5, 0.5], [-4.5, 4.5]), { stiffness: 220, damping: 18 });
  return (
    <motion.div
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        x.set((e.clientX - r.left) / r.width - 0.5);
        y.set((e.clientY - r.top) / r.height - 0.5);
      }}
      onMouseLeave={() => { x.set(0); y.set(0); }}
      style={{ rotateX, rotateY, transformPerspective: 900 }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

function DecisionBody({ d }: { d: QuorumDecision }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: EASE }}
      className="mt-3 pt-3"
      style={{ borderTop: "1px solid var(--hair)" }}
    >
      {/* The three-agent council */}
      <div className="flex flex-col gap-2">
        {d.opinions.map((o) => (
          <div key={o.role} className="flex items-start gap-2.5">
            <span className="qm-role">{o.role}</span>
            <span className={`qm-vote ${o.vote === "approve" ? "v-approve" : "v-reject"}`}>
              {o.vote === "approve" ? "approve" : "reject"}
            </span>
            <span className="gk-num text-[11px] text-[var(--mut)] w-[30px] shrink-0">{Math.round(o.confidence * 100)}%</span>
            <span className="text-[12.5px] text-[#cdd6e3] flex-1">{o.reasoning}</span>
          </div>
        ))}
      </div>

      {/* The quorum verdict */}
      <div className="mt-3 text-[13.5px] text-[#dbe3ee]">{d.reasoning}</div>

      {d.riskFlags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {d.riskFlags.map((f) => (<span key={f} className="gk-flag">{f}</span>))}
        </div>
      )}

      {d.heldBack && (
        <div className="gk-held mt-2.5">
          ⚠ All {d.opinions.length} agents voted to approve, but the quorum guardrail held the action back and escalated. A unanimous council still cannot authorize a high-stakes or irreversible action without a human.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-2.5 text-[11px] text-[var(--mut)]">
        <span className="inline-flex items-center gap-1.5">
          <span className="gk-engine-dot" data-engine={d.engine} />
          {d.engine === "qwen" ? `Deliberated by 3× ${d.model ?? "qwen-max"}` : "deterministic fallback"}
        </span>
        <span>· quorum: <span className="gk-num">{d.approvals}/{d.opinions.length}</span> approve</span>
      </div>
    </motion.div>
  );
}

export default function Page() {
  const [cells, setCells] = useState<Record<string, Cell>>({});
  const [running, setRunning] = useState(false);
  const [engine, setEngine] = useState<string>();
  const [form, setForm] = useState({
    title: "Wire $20,000 to a vendor from a new bank account",
    description: "An email asks to redirect this month's $20,000 vendor payment to a new account number. Proposal: pay it now.",
    stakes: "high",
    reversible: false,
    justified: false,
  });
  const [custom, setCustom] = useState<Cell>();

  async function send(action: ProposedAction): Promise<QuorumDecision | undefined> {
    const res = await fetch("/api/deliberate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const { decision } = (await res.json()) as { decision: QuorumDecision };
    if (decision?.engine) setEngine(decision.engine);
    return decision;
  }

  async function run() {
    setRunning(true);
    setCells({});
    for (const a of QUEUE) {
      setCells((c) => ({ ...c, [a.id]: "loading" }));
      try {
        const d = await send(a);
        setCells((c) => ({ ...c, [a.id]: d }));
      } catch {
        setCells((c) => ({ ...c, [a.id]: undefined }));
      }
    }
    setRunning(false);
  }

  async function runCustom() {
    setCustom("loading");
    const a: ProposedAction = {
      id: "CUSTOM",
      title: form.title,
      description: form.description,
      stakes: (["low", "medium", "high"].includes(form.stakes) ? form.stakes : "high") as ProposedAction["stakes"],
      reversible: form.reversible,
      domain: "custom",
      justified: form.justified,
    };
    try { setCustom((await send(a)) ?? undefined); } catch { setCustom(undefined); }
  }

  const done = Object.values(cells).filter((d): d is QuorumDecision => !!d && d !== "loading");
  const executed = done.filter((d) => d.outcome === "execute").length;
  const esc = done.filter((d) => d.outcome === "escalate").length;
  const held = done.filter((d) => d.heldBack).length;
  const escalated = done.filter((d) => d.outcome === "escalate");
  const customDec = custom && custom !== "loading" ? custom : null;
  const customMeta = customDec ? META[customDec.outcome] : null;

  return (
    <main className="max-w-[1120px] mx-auto px-6 py-20 md:py-28">
      {/* Hero */}
      <div className="relative">
        <div className="pointer-events-none absolute right-[-90px] top-[-140px] hidden md:block w-[380px] h-[380px] lg:w-[460px] lg:h-[460px] z-0 opacity-[0.92]" aria-hidden>
          <Hero3D />
        </div>
        <motion.div variants={container} initial="hidden" animate="show" className="relative z-10">
          <motion.div variants={item}>
            <span className="gk-eyebrow"><span className="dot" /> Qwen Cloud · Agent Society</span>
          </motion.div>
          <motion.h1 variants={item} className="gk-title text-[clamp(52px,9vw,104px)] leading-[0.95] mt-5">
            Quorum
          </motion.h1>
          <motion.p variants={item} className="text-[clamp(18px,2.2vw,23px)] text-[#d3cee0] mt-4 max-w-[46rem] leading-[1.5]" style={{ textShadow: "0 1px 16px rgba(8,4,20,0.55)" }}>
            A council of agents that knows when a vote is not <span className="text-[#e9b3ff] font-semibold">enough</span>.
            Three Qwen agents debate every consequential action, and a deterministic guardrail refuses to execute without consensus, escalating the irreversible to a human.
          </motion.p>
          <motion.div variants={item} className="flex flex-wrap items-center gap-3 mt-9">
            <button className="gk-btn" onClick={run} disabled={running}>
              <span>{running ? "Convening the council" : "Run the council on the queue"}</span>
              <span className="ico">{running ? <span className="spin" /> : "▶"}</span>
            </button>
            <span className="gk-pill">{QUEUE.length} actions in queue</span>
            {engine && (
              <span className="gk-pill">engine: <b className="text-[var(--ink)]">{engine === "qwen" ? "Qwen (live)" : "fallback"}</b></span>
            )}
          </motion.div>
          <motion.div variants={item} className="mt-7 gk-lockup">
            <span className="gk-mark"><span className="gk-glyph" /> Qwen<span className="sub">Cloud</span></span>
            <span className="gk-x">×</span>
            <span className="gk-mark gk-mark-dev">Devpost</span>
            <span className="gk-lockup-label">Agent Society Hackathon</span>
          </motion.div>
        </motion.div>
      </div>

      {/* Stats */}
      {done.length > 0 && (
        <div className="grid grid-cols-3 gap-3.5 mt-12">
          <Stat n={executed} label="auto-executed by consensus" color="var(--acc)" i={0} />
          <Stat n={esc} label="escalated to a human" color="var(--amber)" i={1} />
          <Stat n={held} label="approved actions the guardrail held back" color="var(--acc2)" i={2} />
        </div>
      )}

      {/* Queue */}
      <Reveal className="gk-kicker mt-20 mb-4">The queue</Reveal>
      <div className="grid md:grid-cols-2 gap-3.5" style={{ perspective: 1200 }}>
        {QUEUE.map((a, idx) => {
          const cell = cells[a.id];
          const d = cell && cell !== "loading" ? cell : null;
          const m = d ? META[d.outcome] : null;
          return (
            <Reveal key={a.id} delay={Math.min(idx * 0.04, 0.3)}>
              <Tilt className={`glass p-5 ${m ? m.edge : ""}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[15px] font-semibold">
                      {a.title} <span className="text-[var(--mut)] font-normal">· {a.id}</span>
                    </div>
                    <div className="gk-num text-[13px] text-[var(--mut)] mt-0.5">
                      {a.domain} · {a.stakes} stakes · {a.reversible ? "reversible" : "irreversible"}
                    </div>
                  </div>
                  {cell === "loading" ? <div className="spin mt-1" /> : m ? <span className={`gk-tag ${m.tag}`}>{m.label}</span> : null}
                </div>
                <div className="text-[13.5px] text-[#cdd6e3] mt-2.5">{a.description}</div>
                {d && <DecisionBody d={d} />}
              </Tilt>
            </Reveal>
          );
        })}
      </div>

      {/* Human review */}
      {escalated.length > 0 && (
        <>
          <Reveal className="gk-kicker mt-20 mb-4">Human review queue ({escalated.length})</Reveal>
          <Reveal>
            <div className="glass p-5">
              <p className="text-[13.5px] text-[var(--mut)] mb-3">
                This is all a human ever has to look at. Everything else was executed or denied by the council automatically.
              </p>
              <div className="flex flex-col gap-2">
                {escalated.map((d) => {
                  const a = QUEUE.find((q) => q.id === d.actionId);
                  return (
                    <div key={d.actionId} className="flex items-start justify-between gap-3 py-2.5" style={{ borderBottom: "1px solid var(--hair)" }}>
                      <div>
                        <div className="gk-num text-[14px] font-medium">{a?.title ?? d.actionId} · {d.actionId}</div>
                        <div className="text-[12.5px] text-[var(--mut)]">{d.reasoning}</div>
                      </div>
                      <div className="flex gap-1.5 shrink-0">{d.riskFlags.slice(0, 2).map((f) => <span key={f} className="gk-flag">{f}</span>)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </Reveal>
        </>
      )}

      {/* Try your own */}
      <Reveal className="gk-kicker mt-20 mb-4">Propose your own action</Reveal>
      <Reveal>
        <div className="gk-shell">
          <div className={`gk-core p-5 ${customMeta ? customMeta.edge : ""}`}>
            <p className="text-[13px] text-[var(--mut)] mb-3.5">
              Not a canned demo. Describe any action and send it to the live three-agent council.
            </p>
            <div className="grid md:grid-cols-4 gap-2.5">
              <div className="md:col-span-2"><label className="gk-label">Action title</label><input className="gk-input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
              <div>
                <label className="gk-label">Stakes</label>
                <select className="gk-input" value={form.stakes} onChange={(e) => setForm({ ...form, stakes: e.target.value })}>
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                </select>
              </div>
              <div className="flex items-end gap-3">
                <label className="gk-label flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={form.reversible} onChange={(e) => setForm({ ...form, reversible: e.target.checked })} /> reversible</label>
                <label className="gk-label flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={form.justified} onChange={(e) => setForm({ ...form, justified: e.target.checked })} /> justified</label>
              </div>
              <div className="md:col-span-4"><label className="gk-label">Description</label><input className="gk-input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            </div>
            <div className="flex items-center gap-3 mt-4">
              <button className="gk-btn" onClick={runCustom} disabled={custom === "loading"}>
                <span>{custom === "loading" ? "Deliberating" : "Convene the council"}</span>
                <span className="ico">{custom === "loading" ? <span className="spin" /> : "▶"}</span>
              </button>
              {customMeta && <span className={`gk-tag ${customMeta.tag}`}>{customMeta.label}</span>}
            </div>
            {customDec && <DecisionBody d={customDec} />}
          </div>
        </div>
      </Reveal>

      <footer className="mt-20 pt-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between" style={{ borderTop: "1px solid var(--hair)" }}>
        <div className="text-[12.5px] text-[var(--mut)] max-w-[40rem]">
          Quorum · built on Qwen Cloud for the Qwen × Devpost Agent Society Hackathon · a society of agents that is safe because no single vote, and no unanimous one, can authorize the irreversible.
          <span className="block mt-1.5">Designed &amp; built by <span className="gk-sig">Anthony Yanza</span>.</span>
        </div>
        <div className="gk-lockup self-start md:self-auto">
          <span className="gk-mark"><span className="gk-glyph" /> Qwen<span className="sub">Cloud</span></span>
          <span className="gk-x">×</span>
          <span className="gk-mark gk-mark-dev">Devpost</span>
        </div>
      </footer>
    </main>
  );
}

function Stat({ n, label, color, i }: { n: number; label: string; color: string; i: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16, filter: "blur(6px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ duration: 0.6, ease: EASE, delay: i * 0.08 }}
      className="glass px-5 py-5"
    >
      <div className="gk-num text-[40px] font-extrabold leading-none" style={{ color }}><CountUp n={n} /></div>
      <div className="text-[12.5px] text-[var(--mut)] mt-2">{label}</div>
    </motion.div>
  );
}

function CountUp({ n }: { n: number }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 520);
      setV(Math.round(p * n));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [n]);
  return <>{v}</>;
}
