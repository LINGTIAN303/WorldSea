import { ref, shallowRef } from 'vue'

export type AnimType = 'move' | 'attack_flash' | 'hit_shake' | 'death' | 'damage_number'

export interface BoardAnimation {
  type: AnimType
  fromX: number
  fromY: number
  toX: number
  toY: number
  duration: number
  elapsed: number
  /** Unit id if applicable */
  unitId?: string
  /** Extra data (e.g. damage amount for floating number) */
  extra?: any
}

export interface AnimUnitOverride {
  /** Visual offset from actual grid position */
  offsetX: number
  offsetY: number
  /** Alpha override (0..1) */
  alpha: number
  /** Scale factor (1 = normal) */
  scale: number
  /** Flash white overlay (0..1) */
  flash: number
  /** Shake offset in pixels */
  shakeX: number
  shakeY: number
}

const DEFAULT_OVERRIDE: AnimUnitOverride = {
  offsetX: 0, offsetY: 0, alpha: 1, scale: 1, flash: 0, shakeX: 0, shakeY: 0,
}

export function useBoardAnimation() {
  const animations = shallowRef<BoardAnimation[]>([])
  const unitOverrides = ref<Map<string, AnimUnitOverride>>(new Map())
  const floatingNumbers = ref<{ x: number; y: number; text: string; alpha: number; elapsed: number; duration: number }[]>([])

  let animating = false
  let pendingResolves: (() => void)[] = []

  function tick(dt: number, cellSize: number) {
    const overrides = new Map<string, AnimUnitOverride>()
    const newAnims: BoardAnimation[] = []

    for (const anim of animations.value) {
      anim.elapsed += dt
      const t = Math.min(1, anim.elapsed / anim.duration)

      if (anim.type === 'move') {
        const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
        if (anim.unitId) {
          overrides.set(anim.unitId, {
            ...DEFAULT_OVERRIDE,
            offsetX: (anim.toX - anim.fromX) * cellSize * (1 - ease),
            offsetY: (anim.toY - anim.fromY) * cellSize * (1 - ease),
          })
        }
      }

      if (anim.type === 'attack_flash') {
        if (anim.unitId) {
          const flash = t < 0.5 ? t * 2 : (1 - t) * 2
          overrides.set(anim.unitId, {
            ...DEFAULT_OVERRIDE,
            flash: flash * 0.6,
          })
        }
      }

      if (anim.type === 'hit_shake') {
        if (anim.unitId) {
          const intensity = (1 - t) * 4
          overrides.set(anim.unitId, {
            ...DEFAULT_OVERRIDE,
            shakeX: Math.sin(t * Math.PI * 8) * intensity,
            shakeY: Math.cos(t * Math.PI * 6) * intensity * 0.5,
          })
        }
      }

      if (anim.type === 'death') {
        if (anim.unitId) {
          overrides.set(anim.unitId, {
            ...DEFAULT_OVERRIDE,
            alpha: 1 - t,
            scale: 1 - t * 0.3,
          })
        }
      }

      if (t < 1) {
        newAnims.push(anim)
      }
    }

    // Update floating numbers
    const newFloats = floatingNumbers.value.filter(f => {
      f.elapsed += dt
      f.alpha = Math.max(0, 1 - f.elapsed / f.duration)
      f.y -= dt * 0.03
      return f.elapsed < f.duration
    })

    unitOverrides.value = overrides
    animations.value = newAnims
    floatingNumbers.value = newFloats

    if (newAnims.length === 0 && newFloats.length === 0 && animating) {
      animating = false
      for (const resolve of pendingResolves) resolve()
      pendingResolves = []
    }

    return newAnims.length > 0 || newFloats.length > 0
  }

  function pushMove(unitId: string, fromX: number, fromY: number, toX: number, toY: number, duration = 300) {
    animations.value = [...animations.value, {
      type: 'move', fromX, fromY, toX, toY, duration, elapsed: 0, unitId,
    }]
    animating = true
  }

  function pushAttackFlash(unitId: string, duration = 200) {
    animations.value = [...animations.value, {
      type: 'attack_flash', fromX: 0, fromY: 0, toX: 0, toY: 0, duration, elapsed: 0, unitId,
    }]
    animating = true
  }

  function pushHitShake(unitId: string, duration = 300) {
    animations.value = [...animations.value, {
      type: 'hit_shake', fromX: 0, fromY: 0, toX: 0, toY: 0, duration, elapsed: 0, unitId,
    }]
    animating = true
  }

  function pushDeath(unitId: string, x: number, y: number, duration = 400) {
    animations.value = [...animations.value, {
      type: 'death', fromX: x, fromY: y, toX: x, toY: y, duration, elapsed: 0, unitId,
    }]
    animating = true
  }

  function pushDamageNumber(x: number, y: number, damage: number, critical: boolean) {
    floatingNumbers.value = [...floatingNumbers.value, {
      x, y, text: critical ? `${damage}!` : `${damage}`, alpha: 1, elapsed: 0, duration: 800,
    }]
    animating = true
  }

  function waitForAnimations(): Promise<void> {
    if (!animating) return Promise.resolve()
    return new Promise(resolve => {
      pendingResolves.push(resolve)
    })
  }

  function getOverride(unitId: string): AnimUnitOverride {
    return unitOverrides.value.get(unitId) || DEFAULT_OVERRIDE
  }

  function clear() {
    animations.value = []
    floatingNumbers.value = []
    unitOverrides.value = new Map()
    animating = false
    for (const resolve of pendingResolves) resolve()
    pendingResolves = []
  }

  function isActive() {
    return animating
  }

  return {
    animations,
    unitOverrides,
    floatingNumbers,
    tick,
    pushMove,
    pushAttackFlash,
    pushHitShake,
    pushDeath,
    pushDamageNumber,
    waitForAnimations,
    getOverride,
    clear,
    isActive,
  }
}
