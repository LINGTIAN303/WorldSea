/** 时间线视图快捷键：撤销/重做、翻页/切页、方向键焦点、缩放与适配、Esc。 */
import { onBeforeUnmount, onMounted, type Ref } from 'vue'
import { useShortcuts } from '@worldsea/ui-kit'

export interface TimelineKeyboardOptions {
  viewRoot: Ref<HTMLElement | undefined>
  chartRef: Ref<{ zoomIn: () => void; zoomOut: () => void; fitAll: () => void } | null>
  actions: {
    undo: () => void
    redo: () => void
    close: () => void
    pagePrev: () => void
    pageNext: () => void
    switchTabBy: (delta: number) => void
  }
}

export function useTimelineKeyboard(options: TimelineKeyboardOptions) {
  const { register, unregister } = useShortcuts()
  const ids: string[] = []

  function reg(def: Parameters<typeof register>[0]): void {
    register(def)
    ids.push(def.id)
  }

  /** 方向键在可见事件元素间移动真实焦点（Enter 由元素自身打开） */
  function moveFocus(delta: number) {
    const root = options.viewRoot.value
    if (!root) return
    const nodes = [...root.querySelectorAll<HTMLElement>('[data-event-id]')]
    if (!nodes.length) return
    const active = document.activeElement as HTMLElement | null
    const index = active ? nodes.indexOf(active) : -1
    const next = index < 0
      ? (delta > 0 ? 0 : nodes.length - 1)
      : Math.min(nodes.length - 1, Math.max(0, index + delta))
    nodes[next]?.focus()
  }

  onMounted(() => {
    const actions = options.actions
    reg({ id: 'timeline.undo', keys: ['ctrl', 'z'], scope: 'view', description: '时间轴：撤销', handler: actions.undo })
    reg({ id: 'timeline.redo', keys: ['ctrl', 'y'], scope: 'view', description: '时间轴：重做', handler: actions.redo })
    reg({
      id: 'timeline.close', keys: ['escape'], scope: 'view', description: '关闭详情 / 退出批量选择',
      // 详情优先：有详情先关详情，否则退批量态（与 GEV 同规则）
      handler: actions.close,
    })
    reg({ id: 'timeline.page-prev', keys: ['ctrl', 'left'], scope: 'view', description: '时间轴：上一页', preventDefault: true, handler: actions.pagePrev })
    reg({ id: 'timeline.page-next', keys: ['ctrl', 'right'], scope: 'view', description: '时间轴：下一页', preventDefault: true, handler: actions.pageNext })
    reg({ id: 'timeline.tab-prev', keys: ['alt', 'left'], scope: 'view', description: '时间轴：上一个标签页', preventDefault: true, handler: () => actions.switchTabBy(-1) })
    reg({ id: 'timeline.tab-next', keys: ['alt', 'right'], scope: 'view', description: '时间轴：下一个标签页', preventDefault: true, handler: () => actions.switchTabBy(1) })
    // 方向键在事件之间移动焦点（Enter 打开、Esc 关闭由元素/既有快捷键承担）
    reg({ id: 'timeline.focus-prev', keys: ['left'], scope: 'view', description: '时间轴：上一个事件', preventDefault: true, handler: () => moveFocus(-1) })
    reg({ id: 'timeline.focus-prev-up', keys: ['up'], scope: 'view', description: '时间轴：上一个事件', preventDefault: true, handler: () => moveFocus(-1) })
    reg({ id: 'timeline.focus-next', keys: ['right'], scope: 'view', description: '时间轴：下一个事件', preventDefault: true, handler: () => moveFocus(1) })
    reg({ id: 'timeline.focus-next-down', keys: ['down'], scope: 'view', description: '时间轴：下一个事件', preventDefault: true, handler: () => moveFocus(1) })
    reg({ id: 'timeline.zoom-in', keys: ['+'], scope: 'view', description: '时间轴：放大', preventDefault: true, handler: () => options.chartRef.value?.zoomIn() })
    reg({ id: 'timeline.zoom-out', keys: ['-'], scope: 'view', description: '时间轴：缩小', preventDefault: true, handler: () => options.chartRef.value?.zoomOut() })
    reg({ id: 'timeline.fit', keys: ['home'], scope: 'view', description: '时间轴：适配全部', preventDefault: true, handler: () => options.chartRef.value?.fitAll() })
  })

  onBeforeUnmount(() => {
    for (const id of ids) unregister(id)
  })
}
