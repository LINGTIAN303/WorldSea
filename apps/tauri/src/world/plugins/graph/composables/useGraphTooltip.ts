/**
 * 悬浮提示：把画布指针坐标换算成面板内坐标，并产出节点/星座提示文本。
 */
import { computed, ref, type Ref } from 'vue'
import type { HoverPayload } from '../view/GraphCanvas.vue'
import type { Overview, OverviewNode } from '../model/types'
import { tooltipPosition } from '../policy/tooltip'

export function useGraphTooltip(options: {
  viewRef: Ref<HTMLElement | null>
  overview: Ref<Overview>
  nodeMap: Ref<Map<string, OverviewNode>>
}) {
  const hover = ref<HoverPayload | null>(null)

  const tooltipText = computed(() => {
    const current = hover.value
    if (!current) return ''
    if (current.kind === 'node') {
      const node = options.nodeMap.value.get(current.id)
      if (!node) return ''
      return `${node.name} · ${node.typeLabel} · ${node.degree} 关系${node.isolated ? ' · 未连接' : ''}`
    }
    const group = options.overview.value.groups.find(item => item.id === current.id)
    return group ? `${group.label} · ${group.count} 个未连接实体 · 点击展开` : ''
  })

  const tooltipStyle = computed(() => {
    const current = hover.value
    if (!current) return {}
    const width = options.viewRef.value?.clientWidth ?? 800
    const height = options.viewRef.value?.clientHeight ?? 600
    const position = tooltipPosition(current.x, current.y, width, height)
    return { left: `${position.x}px`, top: `${position.y}px` }
  })

  function onHover(payload: HoverPayload | null): void {
    hover.value = payload
  }

  function clearHover(): void {
    hover.value = null
  }

  return { hover, tooltipText, tooltipStyle, onHover, clearHover }
}
