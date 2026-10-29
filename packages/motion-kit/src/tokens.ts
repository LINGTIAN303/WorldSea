export type DurationToken =
  | 'instant'
  | 'fast'
  | 'normal'
  | 'slow'
  | 'view'
  | 'surface'

export type EasingToken = 'default' | 'in' | 'out' | 'spring'

export const DURATION_VALUES: Record<DurationToken, number> = {
  instant: 80,
  fast: 150,
  normal: 220,
  slow: 320,
  view: 160,
  surface: 180,
}

export const EASING_VALUES: Record<EasingToken, string> = {
  default: 'cubic-bezier(0.4, 0, 0.2, 1)',
  in: 'cubic-bezier(0.4, 0, 1, 1)',
  out: 'cubic-bezier(0, 0, 0.2, 1)',
  spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
}

export const CSS_VAR_DURATION: Record<DurationToken, string> = {
  instant: 'var(--dur-instant)',
  fast: 'var(--dur-fast)',
  normal: 'var(--dur-base)',
  slow: 'var(--dur-lg)',
  view: 'var(--dur-view)',
  surface: 'var(--dur-surface)',
}

export const CSS_VAR_EASING: Record<EasingToken, string> = {
  default: 'var(--ease)',
  in: 'var(--ease-in)',
  out: 'var(--ease-out)',
  spring: 'var(--ease-spring)',
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
  modal: { duration: 'normal', easing: 'out' },
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
