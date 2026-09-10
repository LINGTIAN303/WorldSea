import { ref, computed } from 'vue'
import type { ModuleLayoutSchema } from '../types/layoutSchema'

interface HistoryEntry {
  schema: ModuleLayoutSchema
  label: string
}

const MAX_HISTORY = 50

export function useUndoRedo(initialSchema: ModuleLayoutSchema) {
  const history = ref<HistoryEntry[]>([{ schema: JSON.parse(JSON.stringify(initialSchema)), label: '初始状态' }])
  const currentIndex = ref(0)

  const canUndo = computed(() => currentIndex.value > 0)
  const canRedo = computed(() => currentIndex.value < history.value.length - 1)

  function push(schema: ModuleLayoutSchema, label: string) {
    const snapshot = JSON.parse(JSON.stringify(schema))
    if (currentIndex.value < history.value.length - 1) {
      history.value = history.value.slice(0, currentIndex.value + 1)
    }
    if (history.value.length >= MAX_HISTORY) {
      history.value.shift()
    } else {
      currentIndex.value++
    }
    history.value.push({ schema: snapshot, label })
  }

  function undo(): ModuleLayoutSchema | null {
    if (currentIndex.value <= 0) return null
    currentIndex.value--
    return JSON.parse(JSON.stringify(history.value[currentIndex.value].schema))
  }

  function redo(): ModuleLayoutSchema | null {
    if (currentIndex.value >= history.value.length - 1) return null
    currentIndex.value++
    return JSON.parse(JSON.stringify(history.value[currentIndex.value].schema))
  }

  function getCurrentLabel(): string {
    return history.value[currentIndex.value]?.label || ''
  }

  return { canUndo, canRedo, push, undo, redo, getCurrentLabel }
}
