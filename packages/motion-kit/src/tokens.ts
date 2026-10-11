export type DurationToken =
  | 'instant'
  | 'fast'
  | 'normal'
  | 'slow'
  | 'slower'

export type EasingToken =
  | 'default'
  | 'in'
  | 'out'
  | 'spring'
  | 'bounce'

export const DURATION_VALUES: Record<DurationToken, number> = {
  instant: 50,
  fast: 120,
  normal: 200,
  slow: 350,
  slower: 500,
}

export const EASING_VALUES: Record<EasingToken, string> = {
  default: 'cubic-bezier(0.4, 0, 0.2, 1)',
  in: 'cubic-bezier(0.4, 0, 1, 1)',
  out: 'cubic-bezier(0, 0, 0.2, 1)',
  spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  bounce: 'cubic-bezier(0.68, -0.55, 0.27, 1.55)',
}

export const CSS_VAR_DURATION: Record<DurationToken, string> = {
  instant: 'var(--duration-instant)',
  fast: 'var(--duration-fast)',
  normal: 'var(--duration-normal)',
  slow: 'var(--duration-slow)',
  slower: 'var(--duration-slower)',
}

export const CSS_VAR_EASING: Record<EasingToken, string> = {
  default: 'var(--ease-default)',
  in: 'var(--ease-in)',
  out: 'var(--ease-out)',
  spring: 'var(--ease-spring)',
  bounce: 'var(--ease-bounce)',
}

export interface MotionTokens {
  duration: DurationToken
  easing: EasingToken
}

export interface SemanticMotionTokens {
  enter: { duration: DurationToken; easing: EasingToken }
  exit: { duration: DurationToken; easing: EasingToken }
  modal: { duration: DurationToken; easing: EasingToken }
  overlay: { duration: DurationToken; easing: EasingToken }
  toast: { duration: DurationToken; easing: EasingToken }
  list: { duration: DurationToken; easing: EasingToken }
  skeleton: number
  ripple: { duration: DurationToken; easing: EasingToken }
  motionScale: number
}

export const COSMIC_MOTION_TOKENS: SemanticMotionTokens = {
  enter: { duration: 'normal', easing: 'out' },
  exit: { duration: 'fast', easing: 'in' },
  modal: { duration: 'slow', easing: 'out' },
  overlay: { duration: 'fast', easing: 'out' },
  toast: { duration: 'normal', easing: 'spring' },
  list: { duration: 'fast', easing: 'out' },
  skeleton: 1500,
  ripple: { duration: 'normal', easing: 'out' },
  motionScale: 1,
}

export function cssDuration(token: DurationToken): string {
  return CSS_VAR_DURATION[token]
}

export function cssEasing(token: EasingToken): string {
  return CSS_VAR_EASING[token]
}

export function msDuration(token: DurationToken): number {
  return DURATION_VALUES[token]
}

export function cssTransition(
  property: string,
  duration: DurationToken = 'normal',
  easing: EasingToken = 'default',
): string {
  return `${property} ${cssDuration(duration)} ${cssEasing(easing)}`
}
