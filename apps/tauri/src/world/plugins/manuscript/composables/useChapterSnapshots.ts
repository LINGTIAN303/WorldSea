import { ref, type Ref } from 'vue'
import type { Entity } from '@worldsea/entity-core'
import { entitiesSvc } from '../serviceAccess'

export interface ChapterSnapshot {
  time: string
  wordCount: number
  content: string
  label: string
  /** 快照来源（批1 双配额）：'auto' = 自动快照，占用独立配额；缺省 = 手动 */
  kind?: 'auto'
}

/** 手动/自动双配额：自动快照不挤占手动位；总池另设上限防 properties 膨胀 */
export const MAX_MANUAL_SNAPSHOTS = 20
export const MAX_AUTO_SNAPSHOTS = 10
export const MAX_TOTAL_SNAPSHOTS = 30

/** 数组中最后一个满足谓词的下标（配额挤出找「最旧」用） */
function findLastIndex<T>(list: T[], pred: (item: T) => boolean): number {
  for (let i = list.length - 1; i >= 0; i--) {
    if (pred(list[i])) return i
  }
  return -1
}

export function useChapterSnapshots(currentChapter: Ref<Entity | null>) {
  const es = entitiesSvc()
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

  async function createSnapshot(content: string, wordCount: number, label?: string, kind: 'manual' | 'auto' = 'manual') {
    if (!currentChapter.value) return
    let list = snapshots.value
    if (kind === 'auto') {
      // 内容与最近一次快照一致（含手动拍的）不重复落自动快照
      if (list[0]?.content === content) return
      const oldestAuto = findLastIndex(list, s => s.kind === 'auto')
      if (list.filter(s => s.kind === 'auto').length >= MAX_AUTO_SNAPSHOTS && oldestAuto !== -1) {
        list = list.filter((_, i) => i !== oldestAuto)
      }
    } else {
      const oldestManual = findLastIndex(list, s => s.kind !== 'auto')
      if (list.filter(s => s.kind !== 'auto').length >= MAX_MANUAL_SNAPSHOTS && oldestManual !== -1) {
        list = list.filter((_, i) => i !== oldestManual)
      }
    }
    const snap: ChapterSnapshot = {
      time: new Date().toISOString(),
      wordCount,
      content,
      label: label || (kind === 'auto' ? '自动' : ''),
      ...(kind === 'auto' ? { kind: 'auto' as const } : {}),
    }
    const updated = [snap, ...list].slice(0, MAX_TOTAL_SNAPSHOTS)
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
