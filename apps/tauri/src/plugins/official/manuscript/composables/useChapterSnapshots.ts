import { ref, type Ref } from 'vue'
import { useEntityStore } from '@worldsmith/entity-core'
import type { Entity } from '@worldsmith/entity-core'

export interface ChapterSnapshot {
  time: string
  wordCount: number
  content: string
  label: string
}

const MAX_SNAPSHOTS = 20

export function useChapterSnapshots(currentChapter: Ref<Entity | null>) {
  const es = useEntityStore()
  const snapshots = ref<ChapterSnapshot[]>([])
  const showHistory = ref(false)

  function loadSnapshots(entity: Entity | null) {
    if (!entity) {
      snapshots.value = []
      return
    }
    try {
      const raw = entity.properties.snapshots as string
      snapshots.value = raw ? JSON.parse(raw) : []
    } catch {
      snapshots.value = []
    }
  }

  async function createSnapshot(content: string, wordCount: number, label?: string) {
    if (!currentChapter.value) return
    const snap: ChapterSnapshot = {
      time: new Date().toISOString(),
      wordCount,
      content,
      label: label || '',
    }
    const updated = [snap, ...snapshots.value].slice(0, MAX_SNAPSHOTS)
    snapshots.value = updated
    await es.update(currentChapter.value.id, {
      properties: {
        ...currentChapter.value.properties,
        snapshots: JSON.stringify(updated),
      },
    })
  }

  async function restoreSnapshot(index: number): Promise<string | null> {
    if (index < 0 || index >= snapshots.value.length) return null
    return snapshots.value[index].content
  }

  async function deleteSnapshot(index: number) {
    if (!currentChapter.value) return
    const updated = snapshots.value.filter((_, i) => i !== index)
    snapshots.value = updated
    await es.update(currentChapter.value.id, {
      properties: {
        ...currentChapter.value.properties,
        snapshots: JSON.stringify(updated),
      },
    })
  }

  return {
    snapshots,
    showHistory,
    loadSnapshots,
    createSnapshot,
    restoreSnapshot,
    deleteSnapshot,
  }
}
