import { ref, computed, readonly } from 'vue'

export interface PlanItem {
  id: string
  title: string
  status: 'pending' | 'in_progress' | 'completed' | 'skipped' | 'failed'
  description?: string
  order: number
  /** 步骤执行产出（后端 PlanStepUpdate.output；内联计划卡展示用） */
  output?: string | null
  /** 验收未通过的原因（failed 状态时） */
  reason?: string | null
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

  function createPlan(newItems: Array<{ id?: string; title: string; description?: string; status?: string; output?: string | null; reason?: string | null }>): void {
    const ts = Date.now()
    items.value = newItems.map((item, idx) => ({
      id: item.id || `plan-${ts}-${idx}`,
      title: item.title,
      status: (item.status || 'pending') as PlanItem['status'],
      description: item.description,
      order: idx,
      output: item.output ?? null,
      reason: item.reason ?? null,
    }))
  }

  function updateItem(id: string, status: PlanItem['status'], extras?: { output?: string | null; reason?: string | null }): void {
    const idx = items.value.findIndex(i => i.id === id)
    if (idx === -1) return
    const updated = [...items.value]
    updated[idx] = {
      ...updated[idx],
      status,
      ...(extras?.output !== undefined ? { output: extras.output } : {}),
      ...(extras?.reason !== undefined ? { reason: extras.reason } : {}),
    }
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
