import { ref, computed, readonly } from 'vue'

export interface PlanItem {
  id: string
  title: string
  status: 'pending' | 'in_progress' | 'completed' | 'skipped'
  description?: string
  order: number
}

const items = ref<PlanItem[]>([])

export function usePlanStore() {
  const hasPlan = computed(() => items.value.length > 0)

  const progress = computed(() => {
    const total = items.value.length
    const completed = items.value.filter(i => i.status === 'completed' || i.status === 'skipped').length
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0
    return { total, completed, pct }
  })

  function createPlan(newItems: Array<{ id?: string; title: string; description?: string; status?: string }>): void {
    const ts = Date.now()
    items.value = newItems.map((item, idx) => ({
      id: item.id || `plan-${ts}-${idx}`,
      title: item.title,
      status: (item.status || 'pending') as PlanItem['status'],
      description: item.description,
      order: idx,
    }))
  }

  function updateItem(id: string, status: PlanItem['status']): void {
    const idx = items.value.findIndex(i => i.id === id)
    if (idx === -1) return
    const updated = [...items.value]
    updated[idx] = { ...updated[idx], status }
    items.value = updated
  }

  function clearPlan(): void {
    items.value = []
  }

  return {
    items: readonly(items),
    hasPlan,
    progress,
    createPlan,
    updateItem,
    clearPlan,
  }
}
