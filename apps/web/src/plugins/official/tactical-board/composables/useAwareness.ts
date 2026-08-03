import { ref, computed, type Ref } from 'vue'
import type { TacticalEngineAPI } from './useTacticalEngine'
import type { AwarenessCell } from './boardDraw'

export type AwarenessMode = 'none' | 'influence' | 'threat' | 'supply'

export function useAwareness(engine: Ref<TacticalEngineAPI | null>) {
  const mode = ref<AwarenessMode>('none')
  const cells = ref<AwarenessCell[]>([])

  const awarenessModes: { value: AwarenessMode; label: string; icon: string }[] = [
    { value: 'none', label: '关闭', icon: 'minus' },
    { value: 'influence', label: '势力范围', icon: 'target' },
    { value: 'threat', label: '威胁区域', icon: 'warning' },
    { value: 'supply', label: '补给线', icon: 'arrow-left-right' },
  ]

  function setMode(m: AwarenessMode) {
    mode.value = m
    if (m !== 'none') {
      refresh()
    } else {
      cells.value = []
    }
  }

  function refresh() {
    if (!engine.value || mode.value === 'none') {
      cells.value = []
      return
    }
    try {
      const result = engine.value.calculate_awareness() as { cells: AwarenessCell[] }
      cells.value = result?.cells || []
    } catch (e) {
      console.warn('[Awareness] calculate failed', e)
      cells.value = []
    }
  }

  function toggleMode(m: AwarenessMode) {
    if (mode.value === m) {
      setMode('none')
    } else {
      setMode(m)
    }
  }

  const isActive = computed(() => mode.value !== 'none')

  return {
    mode,
    cells,
    awarenessModes,
    isActive,
    setMode,
    toggleMode,
    refresh,
  }
}
