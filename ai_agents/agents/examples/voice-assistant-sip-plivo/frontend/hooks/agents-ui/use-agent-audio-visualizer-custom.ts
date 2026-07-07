import { useCallback, useEffect, useRef, useState } from "react";
import { type LocalAudioTrack, type RemoteAudioTrack } from "livekit-client";
import {
  type AnimationPlaybackControlsWithThen,
  type ValueAnimationTransition,
  animate,
  useMotionValue,
  useMotionValueEvent,
} from "motion/react";
import {
  type AgentState,
  type TrackReference,
  type TrackReferenceOrPlaceholder,
  useTrackVolume,
} from "@livekit/components-react";

// Animation hook for the custom particle-ring visualizer, built per the
// LiveKit Agents UI custom visualizer guide
// (docs.livekit.io/frontends/agents-ui/audio-visualizer/custom).
// State -> animation value mapping follows the guide's `useCustomVisualizer`.

const DEFAULT_INTENSITY = 0.3;
const DEFAULT_SPEED = 1.0;
const DEFAULT_TRANSITION: ValueAnimationTransition = {
  duration: 0.5,
  ease: "easeOut",
};
const GENTLE_PULSE: ValueAnimationTransition = {
  duration: 1.4,
  ease: "easeInOut",
  repeat: Infinity,
  repeatType: "mirror",
};
const RAPID_PULSE: ValueAnimationTransition = {
  duration: 0.55,
  ease: "easeInOut",
  repeat: Infinity,
  repeatType: "mirror",
};

function useAnimatedValue<T>(initialValue: T) {
  const [value, setValue] = useState(initialValue);
  const motionValue = useMotionValue(initialValue);
  const controlsRef = useRef<AnimationPlaybackControlsWithThen | null>(null);
  useMotionValueEvent(motionValue, "change", (value) => setValue(value as T));

  const animateFn = useCallback(
    (targetValue: T | T[], transition: ValueAnimationTransition) => {
      controlsRef.current = animate(motionValue, targetValue, transition);
    },
    [motionValue],
  );

  return { value, motionValue, controls: controlsRef, animate: animateFn };
}

export function useAgentAudioVisualizerCustom(
  state: AgentState | undefined,
  audioTrack?: LocalAudioTrack | RemoteAudioTrack | TrackReferenceOrPlaceholder,
) {
  const {
    value: intensity,
    animate: animateIntensity,
    motionValue: intensityMotionValue,
  } = useAnimatedValue(DEFAULT_INTENSITY);
  const { value: speed, animate: animateSpeed } =
    useAnimatedValue(DEFAULT_SPEED);

  const volume = useTrackVolume(audioTrack as TrackReference, {
    fftSize: 512,
    smoothingTimeConstant: 0.55,
  });

  useEffect(() => {
    switch (state) {
      case "idle":
      case "failed":
      case "disconnected":
        animateIntensity(0.3, DEFAULT_TRANSITION);
        animateSpeed(1.0, DEFAULT_TRANSITION);
        return;
      case "listening":
      case "pre-connect-buffering":
        // Gentle pulsing
        animateIntensity([0.5, 0.8], GENTLE_PULSE);
        animateSpeed(2.5, DEFAULT_TRANSITION);
        return;
      case "thinking":
      case "connecting":
      case "initializing":
        // Rapid pulsing
        animateIntensity([0.25, 0.5], RAPID_PULSE);
        animateSpeed(4.0, DEFAULT_TRANSITION);
        return;
      case "speaking":
        animateIntensity(0.65, DEFAULT_TRANSITION);
        animateSpeed(2.5, DEFAULT_TRANSITION);
        return;
    }
  }, [state, animateIntensity, animateSpeed]);

  // Respond to audio volume with instant updates while speaking.
  useEffect(() => {
    if (state === "speaking" && volume > 0) {
      animateIntensity(0.3 + 0.7 * volume, { duration: 0 });
    }
  }, [state, volume, animateIntensity, intensityMotionValue]);

  return { intensity, speed, volume };
}
