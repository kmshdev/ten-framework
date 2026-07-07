"use client";

// Custom particle-ring audio visualizer, built per the LiveKit Agents UI
// custom visualizer guide
// (docs.livekit.io/frontends/agents-ui/audio-visualizer/custom).
// The shader source is the guide's particle-ring example, rendered with the
// vendored `ReactShaderToy` from the @agents-ui registry. It follows the
// Agents UI standard visualizer props (state / audioTrack / size / color),
// so it is interchangeable with the other @agents-ui visualizers.

import React, { type ComponentProps } from "react";
import { type VariantProps, cva } from "class-variance-authority";
import { type LocalAudioTrack, type RemoteAudioTrack } from "livekit-client";
import {
  type AgentState,
  type TrackReferenceOrPlaceholder,
} from "@livekit/components-react";

import { ReactShaderToy } from "@/components/agents-ui/react-shader-toy";
import { useAgentAudioVisualizerCustom } from "@/hooks/agents-ui/use-agent-audio-visualizer-custom";
import { cn } from "@/lib/utils";

function hexToRgb(hexColor: string): [number, number, number] {
  const rgbColor = hexColor
    .trim()
    .match(/^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/);

  if (rgbColor) {
    const [, r, g, b] = rgbColor;
    return [r, g, b].map((c) => parseInt(c ?? "0", 16) / 255) as [
      number,
      number,
      number,
    ];
  }

  return [0, 0.7, 1]; // Default cyan
}

const shaderSource = `
const float TAU = 6.28318;
const int NUM_PARTICLES = 100;

float hash(float n) {
  return fract(sin(n) * 43758.5453123);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  float aspect = iResolution.x / iResolution.y;

  vec2 pos = uv - 0.5;
  pos.x *= aspect;

  float radius = 0.15 + 0.25 * uIntensity;

  float particleRadius = 2.0 / iResolution.y;
  float blur = 1.0 / iResolution.y;

  float minDist = 1e6;
  for (int i = 0; i < NUM_PARTICLES; i++) {
    float fi = float(i);
    float speedVar = 0.7 + 0.6 * hash(fi * 2.3) * (0.5 + uComplexity);
    float wobble = (0.04 + 0.12 * uComplexity) * sin(iTime * 1.5 + fi * 4.1);
    float angle = hash(fi * 1.1) * TAU - iTime * uSpeed * 0.25 * speedVar + wobble;
    float rBob = 1.0 + (0.02 + 0.06 * uComplexity) * sin(iTime * 2.2 + fi * 3.7);
    vec2 pPos = radius * rBob * vec2(cos(angle), sin(angle));
    float d = length(pos - pPos);
    minDist = min(minDist, d);
  }

  float particle = 1.0 - smoothstep(particleRadius - blur, particleRadius + blur, minDist);

  vec3 color = uColor * particle * uIntensity;
  fragColor = vec4(color, particle * uIntensity);
}`;

interface CustomShaderProps {
  color: string;
  speed: number;
  intensity: number;
  complexity: number;
}

function CustomShader({
  color,
  speed = 5.0,
  intensity = 1.0,
  complexity = 0.5,
  ref,
  className,
  ...props
}: CustomShaderProps & ComponentProps<"div">) {
  return (
    <div ref={ref} className={className} {...props}>
      <ReactShaderToy
        fs={shaderSource}
        uniforms={{
          uColor: { type: "3fv", value: hexToRgb(color) },
          uSpeed: { type: "1f", value: speed },
          uIntensity: { type: "1f", value: intensity },
          uComplexity: { type: "1f", value: complexity },
        }}
        onError={(error) => {
          console.error("Shader error:", error);
        }}
        onWarning={(warning) => {
          console.warn("Shader warning:", warning);
        }}
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}

export const AgentAudioVisualizerCustomVariants = cva(["aspect-square"], {
  variants: {
    size: {
      icon: "size-[24px]",
      sm: "size-[56px]",
      md: "size-[112px]",
      lg: "size-[224px]",
      xl: "size-[448px]",
    },
  },
  defaultVariants: {
    size: "lg",
  },
});

export interface AgentAudioVisualizerCustomProps
  extends VariantProps<typeof AgentAudioVisualizerCustomVariants> {
  /**
   * The size of the visualizer.
   *
   * @defaultValue 'lg'
   */
  size?: "icon" | "sm" | "md" | "lg" | "xl";
  /**
   * Agent state
   *
   * @default 'connecting'
   */
  state?: AgentState;
  /** The color of the visualizer in hexadecimal format. */
  color?: `#${string}`;
  /** The complexity of the visualizer. */
  complexity?: number;
  /** The audio track to visualize. Can be a local/remote audio track or a track reference. */
  audioTrack?: LocalAudioTrack | RemoteAudioTrack | TrackReferenceOrPlaceholder;
}

/**
 * A shader-based audio visualizer that responds to agent state and audio
 * levels. Displays an animated ring of orbiting particles that reacts to the
 * current agent state (listening, thinking, speaking, etc.) and audio volume
 * when speaking.
 *
 * @example
 *
 * ```tsx
 * <AgentAudioVisualizerCustom size="md" state="speaking" audioTrack={agentAudioTrack} />;
 * ```
 *
 * @extends ComponentProps<'div'>
 */
export function AgentAudioVisualizerCustom({
  size = "lg",
  state = "connecting",
  color = "#000000",
  complexity = 0.5,
  audioTrack,
  className,
  ref,
  ...props
}: AgentAudioVisualizerCustomProps & ComponentProps<"div">) {
  const { intensity, speed } = useAgentAudioVisualizerCustom(
    state,
    audioTrack as LocalAudioTrack | RemoteAudioTrack | undefined,
  );

  return (
    <CustomShader
      ref={ref}
      color={color}
      speed={speed}
      intensity={intensity}
      complexity={complexity}
      className={cn(AgentAudioVisualizerCustomVariants({ size }), className)}
      {...props}
    />
  );
}
