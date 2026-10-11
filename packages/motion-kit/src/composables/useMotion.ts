import { onUnmounted } from 'vue'
import { type DurationToken, type EasingToken, DURATION_VALUES, EASING_VALUES } from '../tokens'
import { useReducedMotion } from './useReducedMotion'

export interface MotionKeyframe {
  transform?: string
  opacity?: number
  [property: string]: string | number | undefined
}

export interface MotionOptions {
  duration?: DurationToken | number
  easing?: EasingToken | string
  delay?: number
  iterations?: number
  direction?: PlaybackDirection
  fill?: FillMode
}

export interface UseMotionReturn {
  animate: (el: Element, keyframes: MotionKeyframe[], options?: MotionOptions) => Animation | null
  animateFromTo: (
    el: Element,
    from: MotionKeyframe,
    to: MotionKeyframe,
    options?: MotionOptions,
  ) => Animation | null
  stagger: (
    elements: Element[],
    keyframes: MotionKeyframe[],
    options?: MotionOptions & { staggerDelay?: number },
  ) => Animation[]
  stop: (animation: Animation) => void
  stopAll: (animations: Animation[]) => void
}

function resolveDuration(d: DurationToken | number | undefined): number {
  if (d === undefined) return DURATION_VALUES.normal
  if (typeof d === 'number') return d
  return DURATION_VALUES[d]
}

function resolveEasing(e: EasingToken | string | undefined): string {
  if (e === undefined) return EASING_VALUES.default
  if (e in EASING_VALUES) return EASING_VALUES[e as EasingToken]
  return e
}

export function useMotion(): UseMotionReturn {
  const { prefersReducedMotion } = useReducedMotion()
  const activeAnimations = new Set<Animation>()

  function trackAnimation(anim: Animation) {
    activeAnimations.add(anim)
    anim.addEventListener('finish', () => activeAnimations.delete(anim))
    anim.addEventListener('cancel', () => activeAnimations.delete(anim))
  }

  function animate(
    el: Element,
    keyframes: MotionKeyframe[],
    options?: MotionOptions,
  ): Animation | null {
    if (prefersReducedMotion.value) return null
    if (typeof el.animate !== 'function') return null

    const anim = el.animate(keyframes as Keyframe[], {
      duration: resolveDuration(options?.duration),
      easing: resolveEasing(options?.easing),
      delay: options?.delay ?? 0,
      iterations: options?.iterations ?? 1,
      direction: options?.direction ?? 'normal',
      fill: options?.fill ?? 'forwards',
    })

    trackAnimation(anim)
    return anim
  }

  function animateFromTo(
    el: Element,
    from: MotionKeyframe,
    to: MotionKeyframe,
    options?: MotionOptions,
  ): Animation | null {
    return animate(el, [from, to], options)
  }

  function stagger(
    elements: Element[],
    keyframes: MotionKeyframe[],
    options?: MotionOptions & { staggerDelay?: number },
  ): Animation[] {
    const result: Animation[] = []
    const baseDelay = options?.delay ?? 0
    const staggerDelay = options?.staggerDelay ?? 50

    for (let i = 0; i < elements.length; i++) {
      const anim = animate(elements[i], keyframes, {
        ...options,
        delay: baseDelay + i * staggerDelay,
      })
      if (anim) result.push(anim)
    }

    return result
  }

  function stop(animation: Animation) {
    animation.cancel()
    activeAnimations.delete(animation)
  }

  function stopAll(animations: Animation[]) {
    for (const anim of animations) stop(anim)
  }

  onUnmounted(() => {
    for (const anim of activeAnimations) {
      try { anim.cancel() } catch {}
    }
    activeAnimations.clear()
  })

  return { animate, animateFromTo, stagger, stop, stopAll }
}
