import { computed } from 'vue'

/** 侧边栏 HTML5 拖拽处理（拖视图到看板，drop 在 DashboardView），详细见 docs/details/注释/web/ui/layout/sidebar/useSidebarDragHandler.md */
export interface DragViewInfo {
  id: string
  label: string
  icon: string
}

export function useSidebarDragHandler(isDragMode: () => boolean) {
  /** 当前是否处于拖拽模式(自定义视图模式) */
  const isDraggable = computed(() => isDragMode())

  /**
   * 判断指定视图是否可拖拽(自定义视图本身不可拖拽)
   * 模板中 :draggable="getDraggable(item.view)"
   */
  function getDraggable(view: { id: string }): boolean {
    return isDraggable.value && view.id !== 'custom'
  }

  /**
   * dragstart 事件处理(绑定到 .sidebar-btn 的 @dragstart)
   * 设置 dataTransfer,DashboardView 的 onExternalDrop 会读取
   */
  function onDragStart(view: DragViewInfo, e: DragEvent) {
    if (!isDraggable.value) return
    if (!e.dataTransfer) return
    e.dataTransfer.setData('application/worldsea-view-id', view.id)
    e.dataTransfer.setData('application/worldsea-view-label', view.label)
    e.dataTransfer.setData('application/worldsea-view-icon', view.icon)
    e.dataTransfer.effectAllowed = 'copy'
  }

  return {
    isDraggable,
    getDraggable,
    onDragStart,
  }
}
