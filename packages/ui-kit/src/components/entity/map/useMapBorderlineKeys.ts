// 区域地图的边境线持续态键：keydown 置位 / keyup 复位。
// 键值匹配读注册表当前键值（region.borderline）——用户改键后按住新键即生效，
// 不写死 e.altKey / e.key === 'Alt'（双路径会致注册表登记形同虚设）。
import type { Ref } from 'vue'
import type { MapMode } from './types'

interface BorderlineKeysDeps {
  mode: Ref<MapMode>
  borderlineActive: Ref<boolean>
  borderlineMode: Ref<unknown>
  getRegisteredKeys: (id: string) => string[] | undefined | null
  normalizeKeys: (e: KeyboardEvent) => string[]
  scheduleDraw: () => void
}

export function useMapBorderlineKeys(deps: BorderlineKeysDeps) {
  const { mode, borderlineActive, borderlineMode, getRegisteredKeys, normalizeKeys, scheduleDraw } = deps

  function sameKeySet(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every(k => b.includes(k))
  }

  function matchesBorderlineKeys(e: KeyboardEvent): boolean {
    const keys = getRegisteredKeys('region.borderline')
    if (!keys) return false
    if (e.type === 'keydown') return sameKeySet(normalizeKeys(e), keys)
    // keyup：e.key 已回到单键本体（修饰键 = 'Alt'；单键 = 键名本身），别名归一后比对
    const raw = e.key === ' ' ? 'space' : e.key.toLowerCase()
    const aliases: Record<string, string> = { arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right', escape: 'escape' }
    return keys.includes(aliases[raw] ?? raw)
  }

  function onBorderlineKeyDown(e: KeyboardEvent) {
    if (mode.value !== 'draw') return
    if (matchesBorderlineKeys(e)) {
      e.preventDefault()
      borderlineActive.value = true
      scheduleDraw()
    }
  }

  function onBorderlineKeyUp(e: KeyboardEvent) {
    if (matchesBorderlineKeys(e)) {
      borderlineActive.value = false
      borderlineMode.value = null
      scheduleDraw()
    }
  }

  return { onBorderlineKeyDown, onBorderlineKeyUp }
}
