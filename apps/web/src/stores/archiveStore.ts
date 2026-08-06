/** archiveStore：归档边界状态管理（Pinia + sessionStorage，H1.1 累计语义），详细见 docs/details/注释/web/stores/archiveStore.md */
import { defineStore } from 'pinia'
import { ref } from 'vue'

const STORAGE_KEY = 'archive:boundary'

function loadFromStorage(): number {
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY)
    if (saved !== null) {
      const n = parseInt(saved, 10)
      return Number.isFinite(n) && n >= 0 ? n : 0
    }
  } catch {
    // sessionStorage 不可用时降级为内存态
  }
  return 0
}

function saveToStorage(index: number): void {
  try {
    if (index > 0) {
      sessionStorage.setItem(STORAGE_KEY, String(index))
    } else {
      sessionStorage.removeItem(STORAGE_KEY)
    }
  } catch {
    // 忽略写入失败（隐私模式等）
  }
}

export const useArchiveStore = defineStore('archive', () => {
  /** 已归档消息的边界索引（此索引之前的消息已被归档，Agent 不可见） */
  const archivedBoundaryIndex = ref<number>(loadFromStorage())

  /**
   * 设置边界索引（归档完成时调用）
   *
   * H1.1 修复：累加语义。传入"本次归档的消息数"，累加到已有值。
   * 这样多次归档后 archivedBoundaryIndex 表示累计已归档消息数，
   * AgentMessageList 据此显示"已归档 N 条"。
   *
   * @param archivedCount 本次归档的消息数（非累计值）
   */
  function setBoundary(archivedCount: number): void {
    const safe = Number.isFinite(archivedCount) && archivedCount >= 0 ? Math.floor(archivedCount) : 0
    archivedBoundaryIndex.value += safe
    saveToStorage(archivedBoundaryIndex.value)
  }

  /** 重置边界（clearHistory 时调用） */
  function resetBoundary(): void {
    archivedBoundaryIndex.value = 0
    saveToStorage(0)
  }

  /** 恢复边界（abort 重建 agent / ensureInitialized 后调用） */
  function restoreBoundary(): void {
    archivedBoundaryIndex.value = loadFromStorage()
  }

  return {
    archivedBoundaryIndex,
    setBoundary,
    resetBoundary,
    restoreBoundary,
  }
})
