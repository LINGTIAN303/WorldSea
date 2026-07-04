import { computed } from 'vue'

/**
 * 侧边栏 HTML5 拖拽处理 composable(自定义视图模式下拖拽视图到看板)
 *
 * 说明:
 *  - 原侧边栏拖拽实际用途:从 Sidebar 拖拽视图到 DashboardView 的看板面板(非侧边栏内部重排)
 *  - drop target 在 DashboardView.vue 的 onExternalDrop,本 composable 只负责 dragstart
 *  - 逻辑极简(5 行设置 dataTransfer),独立成 .vue 子组件会引入包装层破坏 v-for 结构
 *    故采用 composable 实现,同样实现"拖拽逻辑与主交互解耦"的目标
 *
 * 职责:
 *  - 在自定义视图模式下,为 .sidebar-btn 提供 draggable 属性和 dragstart 处理
 *  - dragstart 时设置 dataTransfer(view-id / view-label / view-icon)
 *  - DashboardView 的 onExternalDrop 读取这些数据,把视图添加到看板
 */
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
    e.dataTransfer.setData('application/worldsmith-view-id', view.id)
    e.dataTransfer.setData('application/worldsmith-view-label', view.label)
    e.dataTransfer.setData('application/worldsmith-view-icon', view.icon)
    e.dataTransfer.effectAllowed = 'copy'
  }

  return {
    isDraggable,
    getDraggable,
    onDragStart,
  }
}
