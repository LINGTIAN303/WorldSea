import { ref, computed, readonly } from 'vue'

export interface GenerationTask {
  id: string
  type: 'image' | 'video'
  label: string
  status: 'pending' | 'generating' | 'polling' | 'completed' | 'failed'
  progress: number
  prompt: string
  model: string
  provider: string
  startedAt: number
  endedAt?: number
  resultId?: string
  error?: string
}

const tasks = ref<GenerationTask[]>([])

export function useGenerationProgress() {
  const activeTasks = computed(() =>
    tasks.value.filter(t => t.status !== 'completed' && t.status !== 'failed')
  )

  const hasActive = computed(() => activeTasks.value.length > 0)

  function startTask(task: Omit<GenerationTask, 'startedAt'>): string {
    const newTask: GenerationTask = { ...task, startedAt: Date.now() }
    tasks.value = [...tasks.value, newTask]
    return task.id
  }

  function updateProgress(id: string, progress: number, status?: string): void {
    const idx = tasks.value.findIndex(t => t.id === id)
    if (idx === -1) return
    const updated = [...tasks.value]
    updated[idx] = { ...updated[idx], progress: Math.min(100, Math.max(0, progress)) }
    if (status) updated[idx].status = status as GenerationTask['status']
    tasks.value = updated
  }

  function completeTask(id: string, resultId?: string): void {
    const idx = tasks.value.findIndex(t => t.id === id)
    if (idx === -1) return
    const updated = [...tasks.value]
    updated[idx] = { ...updated[idx], status: 'completed', progress: 100, endedAt: Date.now(), resultId }
    tasks.value = updated
  }

  function failTask(id: string, error: string): void {
    const idx = tasks.value.findIndex(t => t.id === id)
    if (idx === -1) return
    const updated = [...tasks.value]
    updated[idx] = { ...updated[idx], status: 'failed', endedAt: Date.now(), error }
    tasks.value = updated
  }

  function clearFinished(): void {
    tasks.value = tasks.value.filter(t => t.status !== 'completed' && t.status !== 'failed')
  }

  return {
    tasks: readonly(tasks),
    activeTasks,
    hasActive,
    startTask,
    updateProgress,
    completeTask,
    failTask,
    clearFinished,
  }
}
