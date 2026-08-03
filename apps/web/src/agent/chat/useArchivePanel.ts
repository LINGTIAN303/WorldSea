/**
 * useArchivePanel — 记忆库面板 + 记忆片段查看器状态管理
 *
 * 从 AgentChat.vue 拆分而来，负责：
 *   - ArchivePanel 的 open/position/dragged 状态
 *   - ChunkViewer 的 open/position/hookId/chunkId 状态
 *   - 两者的定位计算（updateArchivePanelPosition / onOpenChunk）
 *   - usePanelDrag 集成
 */
import { ref, computed, nextTick } from 'vue'
import { usePanelDrag } from '../composables/usePanelDrag'

export function useArchivePanel() {
  /* ── 记忆库面板状态 ── */
  const archivePanelOpen = ref(false)
  const archivePanelPos = ref({ x: 0, y: 0 })
  const archivePanelDragged = ref(false)
  const { onDragStart: onArchiveDragStart } = usePanelDrag({
    x: computed({
      get: () => archivePanelPos.value.x,
      set: v => { archivePanelPos.value = { ...archivePanelPos.value, x: v } },
    }),
    y: computed({
      get: () => archivePanelPos.value.y,
      set: v => { archivePanelPos.value = { ...archivePanelPos.value, y: v } },
    }),
    onDragEnd: () => { archivePanelDragged.value = true },
    excludeSelector: '.ap-body,.ap-close-btn,.ap-back-btn'
  })

  /* ── 记忆片段查看器状态 ── */
  const chunkViewerOpen = ref(false)
  const chunkViewerHookId = ref('')
  const chunkViewerChunkId = ref('')
  const chunkViewerPos = ref({ x: 0, y: 0 })
  const chunkViewerDragged = ref(false)
  const { onDragStart: onChunkViewerDragStart } = usePanelDrag({
    x: computed({
      get: () => chunkViewerPos.value.x,
      set: v => { chunkViewerPos.value = { ...chunkViewerPos.value, x: v } },
    }),
    y: computed({
      get: () => chunkViewerPos.value.y,
      set: v => { chunkViewerPos.value = { ...chunkViewerPos.value, y: v } },
    }),
    onDragEnd: () => { chunkViewerDragged.value = true },
    excludeSelector: '.cv-body,.cv-close-btn'
  })

  /** 定位到面板右侧偏上位置 */
  function updateArchivePanelPosition(): void {
    const panelEl = document.querySelector('.agent-chat') as HTMLElement | null
    if (panelEl) {
      const rect = panelEl.getBoundingClientRect()
      archivePanelPos.value = {
        x: rect.right + 8,
        y: Math.max(8, rect.top),
      }
    } else {
      archivePanelPos.value = { x: window.innerWidth - 440, y: 80 }
    }
    archivePanelDragged.value = false
  }

  function toggleArchivePanel(): void {
    if (archivePanelOpen.value) {
      archivePanelOpen.value = false
    } else {
      archivePanelOpen.value = true
      nextTick(updateArchivePanelPosition)
    }
  }

  function onOpenChunk(hookId: string, chunkId: string): void {
    chunkViewerHookId.value = hookId
    chunkViewerChunkId.value = chunkId
    // 片段查看器定位在记忆库面板右侧
    chunkViewerPos.value = {
      x: archivePanelPos.value.x + 440,
      y: archivePanelPos.value.y,
    }
    chunkViewerDragged.value = false
    chunkViewerOpen.value = true
  }

  return {
    archivePanelOpen, archivePanelPos, archivePanelDragged,
    onArchiveDragStart,
    chunkViewerOpen, chunkViewerHookId, chunkViewerChunkId, chunkViewerPos, chunkViewerDragged,
    onChunkViewerDragStart,
    updateArchivePanelPosition, toggleArchivePanel, onOpenChunk,
  }
}

export type UseArchivePanelReturn = ReturnType<typeof useArchivePanel>
