export type KeyframeName =
  | 'ws-pulse'
  | 'ws-spin'
  | 'ws-msg-in'
  | 'ws-blink'
  | 'ws-bounce'
  | 'ws-fade-in'
  | 'ws-slide-in'
  | 'ws-cursor-arrive'
  | 'ws-focus-slide-in'
  | 'ws-card-pulse'
  | 'ws-indeterminate'
  | 'ws-staircase'
  | 'ws-caret-pulse'
  | 'ws-caret-typing'
  | 'ws-skeleton-pulse'
  | 'ws-ripple-expand'
  | 'ws-loader-spin-ring'
  | 'ws-loader-pulse-dot'
  | 'ws-loader-bounce-bar'
  | 'ws-loader-ripple-ring'
  | 'ws-loader-conic-spin'
  | 'ws-loader-typing-dot'
  | 'ws-loader-shimmer'
  | 'ws-loader-dna-rotate'

interface KeyframeDefinition {
  name: KeyframeName
  css: string
}

const KEYFRAME_DEFS: KeyframeDefinition[] = [
  {
    name: 'ws-pulse',
    css: `@keyframes ws-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}`,
  },
  {
    name: 'ws-spin',
    css: `@keyframes ws-spin {
  to { transform: rotate(360deg); }
}`,
  },
  {
    name: 'ws-msg-in',
    css: `@keyframes ws-msg-in {
  from { opacity: 0; transform: translateY(8px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}`,
  },
  {
    name: 'ws-blink',
    css: `@keyframes ws-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}`,
  },
  {
    name: 'ws-bounce',
    css: `@keyframes ws-bounce {
  0% { transform: scale(1); }
  50% { transform: scale(1.05); }
  100% { transform: scale(1); }
}`,
  },
  {
    name: 'ws-fade-in',
    css: `@keyframes ws-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}`,
  },
  {
    name: 'ws-slide-in',
    css: `@keyframes ws-slide-in {
  from { transform: translateX(24px); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}`,
  },
  {
    name: 'ws-cursor-arrive',
    css: `@keyframes ws-cursor-arrive {
  from { background-size: 0% 2px; }
  to { background-size: 100% 2px; }
}`,
  },
  {
    name: 'ws-focus-slide-in',
    css: `@keyframes ws-focus-slide-in {
  from { opacity: 0.6; transform: scaleX(0.95); }
  to { opacity: 1; transform: scaleX(1); }
}`,
  },
  {
    name: 'ws-card-pulse',
    css: `@keyframes ws-card-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.01); opacity: 0.85; }
}`,
  },
  {
    name: 'ws-indeterminate',
    css: `@keyframes ws-indeterminate {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(400%); }
}`,
  },
  {
    name: 'ws-staircase',
    css: `@keyframes ws-staircase {
  from { opacity: 0; transform: translateX(-6px); }
  to { opacity: 1; transform: translateX(0); }
}`,
  },
  {
    name: 'ws-caret-pulse',
    css: `@keyframes ws-caret-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}`,
  },
  {
    name: 'ws-caret-typing',
    css: `@keyframes ws-caret-typing {
  0% { transform: var(--caret-transform, none) scaleX(1.8); }
  100% { transform: var(--caret-transform, none) scaleX(1); }
}`,
  },
  {
    name: 'ws-skeleton-pulse',
    css: `@keyframes ws-skeleton-pulse {
  0% { opacity: 1; }
  50% { opacity: 0.4; }
  100% { opacity: 1; }
}`,
  },
  {
    name: 'ws-ripple-expand',
    css: `@keyframes ws-ripple-expand {
  to { transform: scale(4); opacity: 0; }
}`,
  },
  // ─── Loading Animations (8 types) ───

  // 1. 旋转圆环 — border + gradient classic spinner
  {
    name: 'ws-loader-spin-ring',
    css: `@keyframes ws-loader-spin-ring {
  to { transform: rotate(360deg); }
}`,
  },

  // 2. 脉冲圆点 — single dot scale pulse (stagger via animation-delay on each dot)
  {
    name: 'ws-loader-pulse-dot',
    css: `@keyframes ws-loader-pulse-dot {
  0%, 80%, 100% { transform: scale(0); opacity: 0.5; }
  40% { transform: scale(1); opacity: 1; }
}`,
  },

  // 3. 弹跳柱条 — bar stretch bounce (stagger via animation-delay on each bar)
  {
    name: 'ws-loader-bounce-bar',
    css: `@keyframes ws-loader-bounce-bar {
  0%, 100% { transform: scaleY(0.4); }
  50% { transform: scaleY(1); }
}`,
  },

  // 4. 波纹圆圈 — concentric ripple expand
  {
    name: 'ws-loader-ripple-ring',
    css: `@keyframes ws-loader-ripple-ring {
  0% { transform: scale(0.2); opacity: 1; }
  100% { transform: scale(1); opacity: 0; }
}`,
  },

  // 5. 渐变旋转器 — conic-gradient spin
  {
    name: 'ws-loader-conic-spin',
    css: `@keyframes ws-loader-conic-spin {
  to { transform: rotate(360deg); }
}`,
  },

  // 6. 打字指示器 — typing dot bounce (stagger via animation-delay)
  {
    name: 'ws-loader-typing-dot',
    css: `@keyframes ws-loader-typing-dot {
  0%, 60%, 100% { transform: translateY(0); }
  30% { transform: translateY(-6px); }
}`,
  },

  // 7. 骨架屏微光 — shimmer sweep
  {
    name: 'ws-loader-shimmer',
    css: `@keyframes ws-loader-shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}`,
  },

  // 8. DNA 双螺旋 — helix rotate
  {
    name: 'ws-loader-dna-rotate',
    css: `@keyframes ws-loader-dna-rotate {
  0% { transform: rotateY(0deg); }
  100% { transform: rotateY(360deg); }
}`,
  },
]

const _injected = new Set<KeyframeName>()
let _styleEl: HTMLStyleElement | null = null

function getStyleEl(): HTMLStyleElement | null {
  if (typeof document === 'undefined') return null
  if (!_styleEl) {
    _styleEl = document.createElement('style')
    _styleEl.setAttribute('data-ws-motion', 'keyframes')
    document.head.appendChild(_styleEl)
  }
  return _styleEl
}

export function injectKeyframe(name: KeyframeName): void {
  if (_injected.has(name)) return
  const def = KEYFRAME_DEFS.find(d => d.name === name)
  if (!def) return
  const el = getStyleEl()
  if (!el) return
  el.textContent = (el.textContent || '') + '\n' + def.css
  _injected.add(name)
}

export function injectKeyframes(names: KeyframeName[]): void {
  for (const name of names) injectKeyframe(name)
}

export function injectAllKeyframes(): void {
  for (const def of KEYFRAME_DEFS) injectKeyframe(def.name)
}

export function getKeyframeCss(name: KeyframeName): string | undefined {
  return KEYFRAME_DEFS.find(d => d.name === name)?.css
}

export function getAllKeyframeNames(): KeyframeName[] {
  return KEYFRAME_DEFS.map(d => d.name)
}

export const KEYFRAMES = Object.fromEntries(
  KEYFRAME_DEFS.map(d => [d.name, d.css]),
) as Record<KeyframeName, string>
