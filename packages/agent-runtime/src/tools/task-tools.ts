import type { ToolDefinition } from '../bridge-types'
import type { IToolContext } from '../toolbus/types'
import type { ToolMeta } from '@worldsea/agent-core'

/** task 模式专用控制工具 task_complete：显式声明任务完成并停止自主循环，详细见 docs/details/注释/packages/agent-runtime/tools-task-tools.md */
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
