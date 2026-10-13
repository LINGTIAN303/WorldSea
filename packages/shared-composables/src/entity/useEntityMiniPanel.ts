/** 实体卡片小窗状态管理（模块级单例：visible/triggerRect/entityId），详细见 docs/details/注释/packages/shared-composables/entity/useEntityMiniPanel.md */
import { ref } from 'vue'

/** 触发元素的位置信息（兼容 DOMRect 和简化对象） */
export type TriggerRect = DOMRect | { left: number; top: number; right: number; bottom: number; width: number; height: number }

/** 当前打开的实体信息 */
export interface MiniPanelState {
  entityId: string
  entityType: string
  name: string
}

// ===== 模块级单例状态 =====
const visible = ref(false)
const triggerRect = ref<TriggerRect | null>(null)
const currentState = ref<MiniPanelState | null>(null)

/**
 * 打开实体卡片小窗
 * @param entityId 实体 ID
 * @param trigger 触发元素位置（用于浮窗锚点定位）；meta 可选实体元信息（entityType/name），用于浮窗标题
 */
function open(entityId: string, trigger: TriggerRect, meta?: { entityType?: string; name?: string }): void {
  currentState.value = {
    entityId,
    entityType: meta?.entityType || '',
    name: meta?.name || '',
  }
  triggerRect.value = trigger
  visible.value = true
}

/** 关闭实体卡片小窗 */
function close(): void {
  visible.value = false
  triggerRect.value = null
  currentState.value = null
}

export function useEntityMiniPanel() {
  return {
    visible,
    triggerRect,
    currentState,
    open,
    close,
  }
}
