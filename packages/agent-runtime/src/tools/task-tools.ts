import type { ToolDefinition } from '../bridge-types'
import type { IToolContext } from '../toolbus/types'
import type { ToolMeta } from '@worldsmith/agent-core'

/**
 * task 模式专用控制工具：task_complete
 *
 * 作用：Agent 显式声明任务已完成。调用后前端停止自主执行循环（方向 B），
 * 向用户展示任务总结。
 *
 * 设计依据（Anthropic agentic 三原则）：
 *   - 保持简单：一个工具，一个参数（总结文本）
 *   - 优先透明：Agent 必须给出完成总结，用户明确知道做了什么
 *   - ACI：Agent 通过调用此工具明确表达"完成"意图，区别于"中途停下问用户"
 *
 * 与"无 tool call 兜底停止"的关系：
 *   - 调用 task_complete → 显式完成（首选）
 *   - 纯文本回复无 tool call → 隐式交还控制权（兜底）
 *   - 两者都会停止自主循环
 */
const taskCompleteTool: ToolDefinition = {
  name: 'task_complete',
  description: '声明任务已完成并停止自主执行。仅在任务目标完全达成时调用，同时给出完成总结（完成了什么、修改了哪些内容、有无未完成项）。调用后 Agent 将停止自主继续，把控制权交还给用户。如果任务未完成，不要调用此工具，应继续调用其他工具执行下一步。',
  parameters: {
    summary: {
      type: 'string',
      description: '任务完成总结：完成了什么目标、修改/创建了哪些内容、有无未完成项或风险提示',
      required: true,
    },
  },
  meta: {
    permission: 'safe',
    category: 'plan',
    displayName: '完成任务',
  } satisfies ToolMeta,
  execute: async (args: Record<string, unknown>, _ctx: IToolContext): Promise<string> => {
    const summary = String(args.summary || '').trim()
    if (!summary) {
      return JSON.stringify({ ok: false, error: '请提供任务完成总结' })
    }
    return JSON.stringify({
      ok: true,
      action: 'task_complete',
      summary,
      message: '任务已标记为完成，自主执行循环将停止。',
    })
  },
}

export const taskTools: ToolDefinition[] = [taskCompleteTool]
