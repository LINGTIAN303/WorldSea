import { ref } from 'vue'
import { useEntityStore } from '../stores'
import { useFileStore } from '../stores'
import { storage } from '../core'
import { getToastApi, getConfirmApi } from '../core/serviceProvider'

export interface OrphanFile {
  id: string
  name: string
  path: string
  sizeEstimate: number
  createdAt: string
  entityId: string | null
}

export function useOrphanCleanup() {
  const orphans = ref<OrphanFile[]>([])
  const selectedIds = ref<Set<string>>(new Set())
  const isScanning = ref(false)
  const isCleaning = ref(false)
  const scanProgress = ref(0)

  async function scan(): Promise<void> {
    isScanning.value = true
    scanProgress.value = 0
    orphans.value = []
    selectedIds.value = new Set()

    try {
      const entityStore = useEntityStore()
      const fileStore = useFileStore()

      if (!entityStore.entities.length) {
        await entityStore.loadAll()
      }
      if (!fileStore.files.length) {
        await fileStore.loadAll()
      }

      const entityIds = new Set(entityStore.entities.map(e => e.id))
      const filesWithEntity = fileStore.files.filter(f => f.entityId)
      const found: OrphanFile[] = []

      for (let i = 0; i < filesWithEntity.length; i++) {
        const f = filesWithEntity[i]
        if (!entityIds.has(f.entityId!)) {
          let sizeEstimate = f.size || 0
          try {
            const content = await storage.getFileContent(f.id)
            if (content) {
              sizeEstimate = (content.textContent?.length || 0) + (content.binaryData?.length || 0)
            }
          } catch {}
          found.push({
            id: f.id,
            name: f.name,
            path: f.path,
            sizeEstimate,
            createdAt: f.createdAt,
            entityId: f.entityId!,
          })
        }
        scanProgress.value = Math.round(((i + 1) / filesWithEntity.length) * 100)
      }

      orphans.value = found
    } catch (e) {
      console.warn('[useOrphanCleanup] scan failed:', e)
      getToastApi().error('孤立文件扫描失败')
    } finally {
      isScanning.value = false
    }
  }

  async function cleanSelected(ids: string[]): Promise<number> {
    const { confirm } = getConfirmApi()
    const selected = orphans.value.filter(o => ids.includes(o.id))
    if (selected.length === 0) return 0

    const totalSize = selected.reduce((s, o) => s + o.sizeEstimate, 0)
    const sizeStr = totalSize > 1024 * 1024
      ? `${(totalSize / (1024 * 1024)).toFixed(1)} MB`
      : `${(totalSize / 1024).toFixed(1)} KB`

    const ok = await confirm({
      type: 'danger',
      title: '清理孤立文件',
      description: `将清理 ${selected.length} 个孤立文件（约 ${sizeStr}），此操作不可撤销。`,
      confirmText: '清理',
    })
    if (!ok) return 0

    isCleaning.value = true
    let cleaned = 0
    let failed = 0
    const fileStore = useFileStore()

    for (const orphan of selected) {
      try {
        await fileStore.remove(orphan.id)
        cleaned++
      } catch {
        failed++
      }
    }

    orphans.value = orphans.value.filter(o => !ids.includes(o.id))
    selectedIds.value = new Set()
    isCleaning.value = false

    if (failed > 0) {
      getToastApi().warn(`已清理 ${cleaned} 个文件，${failed} 个失败`)
    } else {
      getToastApi().success(`已清理 ${cleaned} 个孤立文件`)
    }

    return cleaned
  }

  async function cleanAll(): Promise<number> {
    return cleanSelected(orphans.value.map(o => o.id))
  }

  function selectAll(): void {
    selectedIds.value = new Set(orphans.value.map(o => o.id))
  }

  function deselectAll(): void {
    selectedIds.value = new Set()
  }

  function toggleSelect(id: string): void {
    const next = new Set(selectedIds.value)
    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }
    selectedIds.value = next
  }

  return {
    orphans,
    selectedIds,
    isScanning,
    isCleaning,
    scanProgress,
    scan,
    cleanSelected,
    cleanAll,
    selectAll,
    deselectAll,
    toggleSelect,
  }
}
