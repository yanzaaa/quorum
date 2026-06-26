"use client";

import { useEffect, useRef } from "react";

// Quietly falling green glyphs — the "matrix" atmosphere behind the council. Calm framerate +
// low opacity so it sets a mood without fighting the cards. Fixed, non-interactive.
export default function MatrixRain() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;

    const GLYPHS = "アイウエオカキクケコサシスセソ0123456789QUORM<>/{}=+*·".split("");
    const FS = 16;
    let w = 0, h = 0, cols = 0, drops: number[] = [];

    function resize() {
      w = c!.width = window.innerWidth;
      h = c!.height = window.innerHeight;
      cols = Math.ceil(w / FS);
      drops = Array.from({ length: cols }, () => Math.floor((Math.random() * -h) / FS));
    }
    resize();

    let raf = 0;
    let last = 0;
    function draw(t: number) {
      raf = requestAnimationFrame(draw);
      if (t - last < 52) return; // ~19fps — calm, not frantic
      last = t;
      ctx!.fillStyle = "rgba(3, 7, 9, 0.16)"; // fade trail
      ctx!.fillRect(0, 0, w, h);
      ctx!.font = `${FS}px ui-monospace, monospace`;
      for (let i = 0; i < cols; i++) {
        const ch = GLYPHS[(Math.random() * GLYPHS.length) | 0];
        const x = i * FS;
        const y = drops[i] * FS;
        // occasional bright "head", otherwise phosphor green
        ctx!.fillStyle = Math.random() < 0.035 ? "rgba(200,255,225,0.95)" : "rgba(54,255,156,0.5)";
        ctx!.fillText(ch, x, y);
        if (y > h && Math.random() > 0.972) drops[i] = 0;
        drops[i]++;
      }
    }
    raf = requestAnimationFrame(draw);

    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={ref} className="qr-matrix" aria-hidden />;
}
