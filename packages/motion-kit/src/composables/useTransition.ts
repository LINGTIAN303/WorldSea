import { computed, type ComputedRef } from 'vue'
import { type TransitionPresetName, type TransitionPreset, TRANSITION_PRESETS } from '../transitions'
import { type DurationToken, type EasingToken, cssDuration, cssEasing } from '../tokens'
import { useReducedMotion } from './useReducedMotion'

export interface UseTransitionReturn {
  transitionName: ComputedRef<string>
  preset: TransitionPreset
  mode: 'in-out' | 'out-in' | undefined
  transitionProps: { name: ComputedRef<string>; mode?: 'in-out' | 'out-in' }
}

export function useTransition(
  presetName: TransitionPresetName,
  options?: { mode?: 'in-out' | 'out-in' },
): UseTransitionReturn {
  const { prefersReducedMotion } = useReducedMotion()
  const preset = TRANSITION_PRESETS[presetName]
  const mode = options?.mode

  const transitionName = computed(() => {
    if (prefersReducedMotion.value) return 'ws-fade'
    return preset.name
  })

  const transitionProps = {
    name: transitionName,
    ...(mode ? { mode } : {}),
  }

  return {
    transitionName,
    preset,
    mode,
    transitionProps,
  }
}

export function useTransitionStyle(
  properties: string[],
  enterDuration?: DurationToken,
  enterEasing?: EasingToken,
  exitDuration?: DurationToken,
  exitEasing?: EasingToken,
): {
  enterStyle: string
  leaveStyle: string
} {
  const eDur = enterDuration ?? 'normal'
  const eEase = enterEasing ?? 'out'
  const xDur = exitDuration ?? 'fast'
  const xEase = exitEasing ?? 'in'

  const enterTransition = properties
    .map(p => `${p} ${cssDuration(eDur)} ${cssEasing(eEase)}`)
    .join(', ')

  const leaveTransition = properties
    .map(p => `${p} ${cssDuration(xDur)} ${cssEasing(xEase)}`)
    .join(', ')

  return {
    enterStyle: enterTransition,
    leaveStyle: leaveTransition,
  }
}
