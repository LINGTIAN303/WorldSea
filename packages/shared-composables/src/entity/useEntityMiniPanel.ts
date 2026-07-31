/**
 * useEntityMiniPanel — 实体卡片小窗状态管理（模块级单例）
 *
 * 职责：
 * - 封装 FloatingPanel 的 visible/triggerRect 状态
 * - 维护当前打开的 entityId
 * - 提供 open(entityId, triggerRect) / close() API
 *
 * 设计说明：
 * - 模块级单例：与 useAgent 一致，全局共享同一份浮窗状态
 * - 单实例：同时只打开一个实体小窗（useFloatingPanel 是单例式 composable）
 * - triggerRect 来自触发元素（BlockEntityCard 按钮 / 消息内 mention），用于浮窗定位
 *
 * 端分离 Phase 3：迁移至 @worldsmith/shared-composables，三端共用。
 */
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
 * @param trigger 触发元素位置（用于浮窗锚点定位）
 * @param meta 可选的实体元信息（entityType/name），用于浮窗标题
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
