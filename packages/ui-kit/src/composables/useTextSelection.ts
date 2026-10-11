/**
 * useTextSelection — 全局文本选择监听器
 *
 * 检测用户在实体视图中划选文本，在选区旁弹出"与 AI 聊聊？"触发按钮。
 * 仅在实体相关元素内触发（.ws-entity-content 或 [data-entity-id]）。
 *
 * Phase 7：从 src/composables/ 下沉到 ui-kit/composables/（纯 vue，无业务依赖）
 */

import { ref, onMounted, onUnmounted, readonly } from 'vue'

export interface TextSelectionInfo {
  text: string
  entityId?: string
  entityType?: string
  fieldKey?: string
  rect: DOMRect
}

export function useTextSelection() {
  const selection = ref<TextSelectionInfo | null>(null)
  const triggerVisible = ref(false)
  const triggerRect = ref<DOMRect | null>(null)

  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  function onSelectionChange() {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(handleSelection, 150)
  }

  function handleSelection() {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      hideTrigger()
      return
    }

    const text = sel.toString().trim()
    if (text.length < 3) {
      hideTrigger()
      return
    }

    // 检查是否在实体内容区域内
    const range = sel.getRangeAt(0)
    const container = range.commonAncestorContainer instanceof Element
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement

    if (!container) {
      hideTrigger()
      return
    }

    const entityEl = container.closest('[data-entity-id], .ws-entity-content, .efm-field')
    if (!entityEl) {
      hideTrigger()
      return
    }

    const entityId = entityEl.getAttribute('data-entity-id') || undefined
    const entityType = entityEl.getAttribute('data-entity-type') || undefined
    const fieldKey = entityEl.closest('[data-field-key]')?.getAttribute('data-field-key') || undefined

    const rect = range.getBoundingClientRect()

    selection.value = {
      text,
      entityId,
      entityType,
      fieldKey,
      rect,
    }
    triggerRect.value = rect
    triggerVisible.value = true
  }

  function hideTrigger() {
    triggerVisible.value = false
    selection.value = null
    triggerRect.value = null
  }

  function dismissTrigger() {
    hideTrigger()
    // 清除选区
    const sel = window.getSelection()
    if (sel) sel.removeAllRanges()
  }

  onMounted(() => {
    document.addEventListener('selectionchange', onSelectionChange)
    document.addEventListener('mousedown', onDocumentMouseDown)
  })

  onUnmounted(() => {
    document.removeEventListener('selectionchange', onSelectionChange)
    document.removeEventListener('mousedown', onDocumentMouseDown)
    if (debounceTimer) clearTimeout(debounceTimer)
  })

  function onDocumentMouseDown(e: MouseEvent) {
    // 点击触发按钮时不隐藏
    const target = e.target as Element
    if (target.closest('.sf-chat-trigger')) return
    // 点击其他区域时隐藏触发按钮
    if (triggerVisible.value) {
      hideTrigger()
    }
  }

  return {
    selection: readonly(selection),
    triggerVisible: readonly(triggerVisible),
    triggerRect: readonly(triggerRect),
    dismissTrigger,
  }
}
