"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

// Quorum, visualized: three voices — proposer (mint), referee (cyan), skeptic (rose) — deliberate
// around a central verdict core. They lean in to converge and the core pulses green when the
// council rules; on a contested case the skeptic pulls away and the core flares gold — held back.
// "Three voices, one ruling — and the ruling that can't be made alone" IS the animation.

const VOICES = [
  { color: new THREE.Color("#4ee6b0"), angle: -Math.PI / 2 }, // proposer (mint), top
  { color: new THREE.Color("#5fe6ff"), angle: -Math.PI / 2 + (2 * Math.PI) / 3 }, // referee (cyan)
  { color: new THREE.Color("#ff7a8c"), angle: -Math.PI / 2 + (4 * Math.PI) / 3 }, // skeptic (rose)
];
const GOLD = new THREE.Color("#f4b942");
const GREEN = new THREE.Color("#4ee6b0");
const CORE_BASE = new THREE.Color("#cfe2ff");

function Council() {
  const group = useRef<THREE.Group>(null!);
  const core = useRef<THREE.Mesh>(null!);
  const coreMat = useRef<THREE.MeshStandardMaterial>(null!);
  const ring = useRef<THREE.Mesh>(null!);
  const ringMat = useRef<THREE.MeshBasicMaterial>(null!);
  const voiceRefs = useRef<THREE.Mesh[]>([]);
  const linkRefs = useRef<THREE.Mesh[]>([]);
  const tmp = useMemo(() => new THREE.Color(), []);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (group.current) group.current.rotation.z = t * 0.1; // slow council rotation

    // Deliberation cycle (~6s): disperse -> converge -> rule -> disperse. Every 3rd case is contested.
    const cycle = (t % 6) / 6;
    const converge = Math.sin(cycle * Math.PI); // 0 at ends, 1 mid
    const ruling = Math.max(0, converge - 0.62) / 0.38; // ramps near full convergence
    const contested = Math.floor(t / 6) % 3 === 2;

    VOICES.forEach((v, i) => {
      const m = voiceRefs.current[i];
      if (!m) return;
      // on a contested case, the skeptic (i=2) pulls AWAY instead of leaning in
      const dissenting = contested && i === 2;
      const r = dissenting ? 1.55 + converge * 0.35 : 1.55 - converge * 0.6;
      const x = Math.cos(v.angle) * r;
      const y = Math.sin(v.angle) * r;
      m.position.set(x, y, 0);
      m.scale.setScalar(0.15 + (dissenting ? 0 : converge * 0.05) + Math.sin(t * 2 + i) * 0.008);

      const link = linkRefs.current[i];
      if (link) {
        link.position.set(x / 2, y / 2, 0);
        link.scale.set(1, r, 1);
        link.rotation.z = v.angle - Math.PI / 2;
        (link.material as THREE.MeshBasicMaterial).opacity = dissenting ? 0.14 : 0.3 + converge * 0.42;
      }
    });

    if (core.current && coreMat.current) {
      core.current.rotation.x = t * 0.28;
      core.current.rotation.y = t * 0.2;
      tmp.copy(CORE_BASE).lerp(contested ? GOLD : GREEN, ruling * 0.85).lerp(GOLD, 0.08);
      coreMat.current.emissive.copy(tmp);
      coreMat.current.emissiveIntensity = 0.5 + ruling * 1.7;
      core.current.scale.setScalar(0.4 + ruling * 0.07);
    }
    if (ring.current && ringMat.current) {
      ringMat.current.opacity = ruling * (contested ? 0.85 : 0.5);
      ringMat.current.color.copy(contested ? GOLD : GREEN);
      const rs = 1 + ruling * 0.6;
      ring.current.scale.set(rs, rs, rs);
    }
  });

  return (
    <group ref={group}>
      {/* the verdict core */}
      <mesh ref={core}>
        <icosahedronGeometry args={[1, 0]} />
        <meshStandardMaterial ref={coreMat} color="#0c1430" emissive="#cfe2ff" emissiveIntensity={0.6} metalness={0.45} roughness={0.22} flatShading />
      </mesh>
      {/* verdict flare ring */}
      <mesh ref={ring}>
        <torusGeometry args={[0.62, 0.014, 12, 80]} />
        <meshBasicMaterial ref={ringMat} color="#4ee6b0" transparent opacity={0} toneMapped={false} />
      </mesh>
      {/* always-on gold verdict under-glow (anchors the core between rulings) */}
      <mesh scale={1.25}>
        <sphereGeometry args={[1, 18, 18]} />
        <meshBasicMaterial color="#f4b942" transparent opacity={0.06} toneMapped={false} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      {/* faint outer council ring */}
      <mesh>
        <torusGeometry args={[1.62, 0.007, 10, 96]} />
        <meshBasicMaterial color="#aebeff" transparent opacity={0.26} toneMapped={false} />
      </mesh>
      {/* three voices + their links to the core */}
      {VOICES.map((v, i) => (
        <group key={i}>
          <mesh ref={(el) => { if (el) voiceRefs.current[i] = el; }}>
            <sphereGeometry args={[1, 24, 24]} />
            <meshBasicMaterial color={v.color} toneMapped={false} />
          </mesh>
          <mesh ref={(el) => { if (el) linkRefs.current[i] = el; }}>
            <cylinderGeometry args={[0.006, 0.006, 1, 6]} />
            <meshBasicMaterial color={v.color} transparent opacity={0.3} toneMapped={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

export default function Hero3D() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(true);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    // pause the WebGL loop when scrolled offscreen (keeps scroll smooth)
    const io = new IntersectionObserver(([e]) => setActive(e.isIntersecting), { threshold: 0.01 });
    io.observe(el);
    const t = setTimeout(() => window.dispatchEvent(new Event("resize")), 140);
    return () => { io.disconnect(); clearTimeout(t); };
  }, []);

  return (
    <div ref={wrapRef} style={{ width: "100%", height: "100%" }}>
      <Canvas
        frameloop={active ? "always" : "never"}
        dpr={[1, 1.5]}
        camera={{ position: [0, 0, 5], fov: 42 }}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        style={{ pointerEvents: "none", background: "transparent" }}
      >
        <ambientLight intensity={0.7} />
        <directionalLight position={[4, 5, 4]} intensity={1.1} />
        <pointLight position={[-4, -2, 3]} intensity={1.0} color="#5fe6ff" />
        <pointLight position={[4, 3, 2]} intensity={0.7} color="#8aa0ff" />
        <Council />
      </Canvas>
    </div>
  );
}
