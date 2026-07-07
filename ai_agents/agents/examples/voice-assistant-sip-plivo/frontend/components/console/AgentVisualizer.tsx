"use client";

// Canvas port of LiveKit Agents UI `AgentAudioVisualizerCustom`
// (docs.livekit.io/frontends/agents-ui/audio-visualizer/custom).
// Identical particle math: 100 hash-seeded particles orbiting a ring;
// `intensity` drives ring radius + alpha, `speed` drives orbit rate,
// `complexity` drives wobble. State mapping mirrors `useCustomVisualizer`.
//
// Props match the agents-ui component interface (minus `audioTrack` — there
// is no browser audio track over Plivo SIP), so this can be swapped for the
// real shader component if the app ever joins a LiveKit room.

import { useEffect, useRef } from "react";
import type { AgentVisualState } from "@/hooks/useAgentSession";

const TAU = Math.PI * 2;
const NUM_PARTICLES = 100;

function hash(n: number): number {
  const x = Math.sin(n) * 43758.5453123;
  return x - Math.floor(x);
}

interface StateTargets {
  pulse: { min: number; max: number; period: number } | null;
  intensity: number | null;
  speed: number;
}

// Mirrors the motion-value mapping in use-agent-audio-visualizer-custom.
const STATE_MAP: Record<AgentVisualState, StateTargets> = {
  idle: { pulse: null, intensity: 0.3, speed: 1.0 },
  listening: {
    pulse: { min: 0.5, max: 0.8, period: 2.8 },
    intensity: null,
    speed: 2.5,
  },
  thinking: {
    pulse: { min: 0.25, max: 0.5, period: 1.1 },
    intensity: null,
    speed: 4.0,
  },
  speaking: { pulse: null, intensity: null, speed: 2.5 }, // volume-driven
};

export interface AgentVisualizerProps {
  state: AgentVisualState;
  /** Hex color of the particles. */
  color?: string;
  /** Wobble amount, 0..1. */
  complexity?: number;
  className?: string;
}

export default function AgentVisualizer({
  state,
  color = "#EF1400",
  complexity = 0.5,
  className,
}: AgentVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rgb = (() => {
      const m = color.trim().match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
      if (!m) return [239, 20, 0];
      return [
        parseInt(m[1], 16),
        parseInt(m[2], 16),
        parseInt(m[3], 16),
      ];
    })();

    let width = 0;
    let height = 0;
    const fit = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = parent.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    fit();
    window.addEventListener("resize", fit);

    // Lerped uniforms (equivalent of the motion hook's animated values).
    let intensity = 0.3;
    let speed = 1.0;
    let angleAcc = 0;
    let lastT = 0;
    let simVol = 0;
    let raf = 0;

    const draw = (ms: number) => {
      const t = ms / 1000;
      const dt = Math.min(t - lastT, 0.05);
      lastT = t;

      const targets = STATE_MAP[stateRef.current] ?? STATE_MAP.idle;
      let targetIntensity: number;
      if (stateRef.current === "speaking") {
        // Simulated speaking volume (no browser audio track over SIP).
        simVol +=
          (0.35 +
            0.65 * Math.abs(Math.sin(t * 2.1) * Math.sin(t * 3.7 + 1.3)) -
            simVol) *
          0.12;
        targetIntensity = 0.3 + 0.7 * simVol;
      } else if (targets.pulse) {
        const p = targets.pulse;
        targetIntensity =
          p.min +
          (p.max - p.min) * (0.5 + 0.5 * Math.sin((t * TAU) / p.period));
      } else {
        targetIntensity = targets.intensity ?? 0.3;
      }

      intensity += (targetIntensity - intensity) * 0.08;
      speed += (targets.speed - speed) * 0.08;
      angleAcc += dt * speed * 0.25;

      ctx.clearRect(0, 0, width, height);
      const S = Math.min(width, height);
      const cx = width / 2;
      const cy = height / 2;
      const radius = (0.15 + 0.25 * intensity) * S;
      const pr = Math.max(S / 200, 1.6);
      const alpha = Math.min(0.4 + intensity * 0.65, 1);

      // Faint ambient wash behind the ring.
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 1.5);
      g.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${0.05 * intensity})`);
      g.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);

      ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
      for (let i = 0; i < NUM_PARTICLES; i++) {
        const speedVar = 0.7 + 0.6 * hash(i * 2.3) * (0.5 + complexity);
        const wobble = (0.04 + 0.12 * complexity) * Math.sin(t * 1.5 + i * 4.1);
        const angle = hash(i * 1.1) * TAU - angleAcc * speedVar + wobble;
        const rBob = 1.0 + (0.02 + 0.06 * complexity) * Math.sin(t * 2.2 + i * 3.7);
        const x = cx + radius * rBob * Math.cos(angle);
        const y = cy + radius * rBob * Math.sin(angle);
        ctx.beginPath();
        ctx.arc(x, y, pr, 0, TAU);
        ctx.fill();
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", fit);
    };
  }, [color, complexity]);

  return (
    <div className={className} aria-hidden="true">
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}
