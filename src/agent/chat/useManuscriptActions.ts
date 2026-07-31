/**
 * useManuscriptActions — 文境（Manuscript）Block 本地操作
 *
 * 从 AgentChat.vue 拆分而来，负责：
 *   - 文境 block 的本地状态变更（resize / layout / shadow / animation）
 *   - 仅持久化到内存中的 block 数据，不发送到 Agent
 *   - formatBlockActionDisplay：格式化 block 动作的展示文本
 *
 * 与 useAgent.messages 直接交互（修改 block 字段）。
 */
import type { Ref } from 'vue'
import type { AgentMessage } from '@agent/index'

/** Block 动作事件（与 AgentMessageList 的 emits.blockAction 一致） */
export interface BlockActionEvent {
  blockId: string
  action: string
  data?: Record<string, unknown>
}

export interface UseManuscriptActionsOptions {
  /** useAgent 的 messages ref */
  messages: Ref<AgentMessage[]>
}

export function useManuscriptActions(options: UseManuscriptActionsOptions) {
  const { messages } = options

  /** 文境本地操作：仅持久化到 block 数据，不发送到 Agent */
  function onManuscriptLocalAction(event: BlockActionEvent): void {
    if (event.action === 'resize' && event.data) {
      persistManuscriptResize(event.blockId, event.data)
    } else if (event.action === 'layout_change' && event.data) {
      persistManuscriptLayout(event.blockId, event.data)
    } else if (event.action === 'shadow_cycle' && event.data) {
      persistManuscriptShadow(event.blockId, event.data)
    } else if (event.action === 'animation_cycle' && event.data) {
      persistManuscriptAnimation(event.blockId, event.data)
    }
  }

  function persistManuscriptResize(blockId: string, data: Record<string, unknown>): void {
    for (const msg of messages.value) {
      if (!msg.blocks) continue
      const block = msg.blocks.find(b => b.id === blockId && b.type === 'manuscript')
      if (block && block.type === 'manuscript') {
        if (typeof data.width === 'number') block.width = data.width
        if (typeof data.height === 'number') block.height = data.height
        break
      }
    }
  }

  function persistManuscriptLayout(blockId: string, data: Record<string, unknown>): void {
    for (const msg of messages.value) {
      if (!msg.blocks) continue
      const block = msg.blocks.find(b => b.id === blockId && b.type === 'manuscript')
      if (block && block.type === 'manuscript') {
        if (typeof data.layout === 'string') block.layout = data.layout as 'horizontal' | 'vertical'
        break
      }
    }
  }

  function persistManuscriptShadow(blockId: string, data: Record<string, unknown>): void {
    for (const msg of messages.value) {
      if (!msg.blocks) continue
      const block = msg.blocks.find(b => b.id === blockId && b.type === 'manuscript')
      if (block && block.type === 'manuscript') {
        if (typeof data.shadow === 'string') block.shadow = data.shadow as 'sunlight' | 'soft' | 'none'
        break
      }
    }
  }

  function persistManuscriptAnimation(blockId: string, data: Record<string, unknown>): void {
    for (const msg of messages.value) {
      if (!msg.blocks) continue
      const block = msg.blocks.find(b => b.id === blockId && b.type === 'manuscript')
      if (block && block.type === 'manuscript') {
        if (typeof data.animation === 'string') {
          block.animation = data.animation as 'ink-drop' | 'brush-stroke' | 'fade-in' | 'float-up'
        }
        break
      }
    }
  }

  /** 级联删除：源会话删除时，移除当前会话中从该会话复制的文境副本 */
  function cascadeDeleteManuscriptClones(sourceSessionId: string): void {
    for (const msg of messages.value) {
      if (!msg.blocks) continue
      const hadClone = msg.blocks.some(
        b => b.type === 'manuscript' && (b as unknown as { sourceSessionId?: string }).sourceSessionId === sourceSessionId,
      )
      if (hadClone) {
        msg.blocks = msg.blocks.filter(
          b => !(b.type === 'manuscript' && (b as unknown as { sourceSessionId?: string }).sourceSessionId === sourceSessionId),
        )
      }
    }
  }

  return {
    onManuscriptLocalAction,
    cascadeDeleteManuscriptClones,
  }
}

/**
 * 格式化 block 动作的展示文本
 * - choice_select：显示"选择了: xxx"
 * - 其他动作：直接返回 action 名
 */
export function formatBlockActionDisplay(event: BlockActionEvent): string {
  if (event.action === 'choice_select' && event.data) {
    const mode = event.data.mode as string
    if (mode === 'multi' && event.data.labels) {
      return `选择了: ${(event.data.labels as string[]).join(', ')}`
    }
    if (mode === 'multi' && event.data.values) {
      return `选择了: ${(event.data.values as string[]).join(', ')}`
    }
    const displayVal = (event.data.label as string) || (event.data.value as string) || ''
    return `选择了: ${displayVal}`
  }
  return event.action
}

export type UseManuscriptActionsReturn = ReturnType<typeof useManuscriptActions>
