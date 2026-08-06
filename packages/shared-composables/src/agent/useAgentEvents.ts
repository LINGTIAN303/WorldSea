/** Agent 事件处理（端无关：事件流 → toolCalls/进度/计划状态同步），详细见 docs/details/注释/packages/shared-composables/agent/useAgentEvents.md */

import { ref, readonly } from 'vue'
import type { AgentEvent } from '@agent/index'
import { useShallowArray } from '@worldsmith/perf-kit/reactive'
import { usePlanStore } from './usePlanStore'
import { useGenerationProgress } from './useGenerationProgress'
import type { ToolCallView } from './useAgent'

// 重新导出 ToolCallView 以保持向后兼容（原 useAgentEvents.ts 也导出了此类型）
export type { ToolCallView }

const { items: toolCallsArr, setAll: setToolCalls, push: pushToolCall, updateById: updateToolCall } = useShallowArray<ToolCallView>('id')
const toolCalls = toolCallsArr
const isProcessing = ref(false)
const currentThinking = ref('')

export function useAgentEvents() {
  function handleEvent(event: AgentEvent): void {
    switch (event.type) {
      case 'agent_start':
        isProcessing.value = true
        currentThinking.value = ''
        setToolCalls([])
        break
      case 'agent_end':
        isProcessing.value = false
        currentThinking.value = ''
        break
      case 'message_update':
        if (event.thinking) {
          currentThinking.value = event.thinking
        }
        break
      case 'message_end':
        currentThinking.value = ''
        break
      case 'tool_execution_start':
        currentThinking.value = ''
        const dupIdx = toolCalls.value.findIndex(tc => tc.id === event.toolCall.id)
        if (dupIdx !== -1) {
          updateToolCall(event.toolCall.id, { status: 'running', startedAt: Date.now(), progress: 0 })
        } else {
          pushToolCall({
            id: event.toolCall.id,
            name: event.toolCall.name,
            args: event.toolCall.args,
            status: 'running',
            startedAt: Date.now(),
            progress: 0,
          })
        }
        break
      case 'tool_execution_update': {
        const updateIdx = toolCalls.value.findIndex(tc => tc.id === event.toolCallId)
        if (updateIdx !== -1) {
          updateToolCall(event.toolCallId, { progress: event.progress })

          // Handle generation progress for image_generate / video_generate
          const tc = toolCalls.value[updateIdx]
          if (tc.name === 'image_generate' || tc.name === 'video_generate') {
            const genProgress = useGenerationProgress()
            const progress = event.progress
            const status = event.status
            const taskId = tc.id
            const taskType = tc.name === 'image_generate' ? 'image' as const : 'video' as const

            if (progress === 0 && (status === 'generating' || status === 'pending')) {
              genProgress.startTask({
                id: taskId,
                type: taskType,
                label: taskType === 'image' ? '图片生成' : '视频生成',
                status: 'generating',
                progress: 0,
                prompt: (tc.args.prompt as string) || '',
                model: (tc.args.model as string) || (taskType === 'image' ? 'DALL-E' : 'Video'),
                provider: (tc.args.provider as string) || '',
              })
            } else if (progress === 100 && status === 'completed') {
              genProgress.completeTask(taskId)
            } else if (progress === -1 && status === 'failed') {
              genProgress.failTask(taskId, 'Generation failed')
            } else {
              genProgress.updateProgress(taskId, progress, status)
            }
          }
        }
        break
      }
      case 'tool_execution_end': {
        const endIdx = toolCalls.value.findIndex(tc => tc.id === event.toolCallId)
        if (endIdx !== -1) {
          updateToolCall(event.toolCallId, {
            status: event.success ? 'completed' : 'failed',
            result: event.result,
            endedAt: Date.now(),
            progress: 100,
          })

          // Handle plan tool results
          const tc = toolCalls.value[endIdx]
          if (event.success && event.result) {
            if (tc.name === 'plan_create') {
              try {
                const planData = JSON.parse(event.result)
                if (Array.isArray(planData.items)) {
                  usePlanStore().createPlan(planData.items)
                } else if (Array.isArray(planData)) {
                  usePlanStore().createPlan(planData)
                }
              } catch { /* ignore parse errors */ }
            } else if (tc.name === 'plan_update') {
              try {
                const updateData = JSON.parse(event.result)
                if (updateData.item_id && updateData.status) {
                  usePlanStore().updateItem(updateData.item_id, updateData.status)
                }
              } catch { /* ignore parse errors */ }
            }
          }
        }
        break
      }
    }
  }

  function removeEntityFromResults(entityId: string): void {
    for (let i = 0; i < toolCalls.value.length; i++) {
      const tc = toolCalls.value[i]
      if (tc.name !== 'entity_list' || !tc.result) continue
      try {
        const obj = JSON.parse(tc.result)
        if (!obj || !Array.isArray(obj.entities)) continue
        const filtered = obj.entities.filter((e: any) => e.id !== entityId)
        if (filtered.length === obj.entities.length) continue
        const newObj = { ...obj, entities: filtered }
        if (typeof newObj.total === 'number') newObj.total = Math.max(0, newObj.total - 1)
        if (typeof newObj.showing === 'number') newObj.showing = filtered.length
        updateToolCall(tc.id, { result: JSON.stringify(newObj) })
      } catch {
        continue
      }
    }
  }

  function clearToolCalls(): void {
    setToolCalls([])
  }

  return {
    toolCalls: readonly(toolCalls),
    isProcessing: readonly(isProcessing),
    currentThinking: readonly(currentThinking),
    handleEvent,
    clearToolCalls,
    removeEntityFromResults,
  }
}
