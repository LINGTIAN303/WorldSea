import type { ToolDefinition } from '../bridge-types'
import type { ToolMeta } from '@worldsmith/agent-core'
import type { IToolContext } from '../toolbus/types'

const planCreateTool: ToolDefinition = {
  name: 'plan_create',
  description: '创建任务计划面板，向用户展示任务步骤和待办清单。会替换当前已有的计划。适用于需要分步骤完成的复杂任务，让用户清晰了解进度。',
  parameters: {
    items: {
      type: 'array',
      description: '任务列表。每项包含 title（标题）和可选的 description（描述）、status（状态：pending/in_progress/completed/skipped，默认 pending）',
      required: true,
      items: {
        type: 'object',
        description: '任务项',
        properties: {
          title: { type: 'string', description: '任务标题' },
          description: { type: 'string', description: '详细描述（可选）' },
          status: { type: 'string', description: '任务状态：pending、in_progress、completed、skipped', enum: ['pending', 'in_progress', 'completed', 'skipped'] },
        },
      },
    },
  },
  meta: {
    permission: 'moderate',
    category: 'plan',
    displayName: '创建计划',
  } satisfies ToolMeta,
  execute: async (args: Record<string, unknown>, _ctx: IToolContext): Promise<string> => {
    const rawItems = args.items
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      return JSON.stringify({ ok: false, error: 'items 不能为空' })
    }

    const ts = Date.now()
    const items = rawItems.map((item: any, idx: number) => ({
      id: `plan-${ts}-${idx}`,
      title: String(item.title || ''),
      description: item.description ? String(item.description) : undefined,
      status: item.status || 'pending',
    })).filter((item: any) => item.title)

    if (items.length === 0) {
      return JSON.stringify({ ok: false, error: '至少需要一个有效的任务项' })
    }

    return JSON.stringify({
      ok: true,
      action: 'plan_create',
      count: items.length,
      items,
      message: `已创建 ${items.length} 项任务计划。使用 plan_update 更新任务状态。每项的 id 可用于 plan_update。`,
    })
  },
}

const planUpdateTool: ToolDefinition = {
  name: 'plan_update',
  description: '更新任务计划中某项的状态。完成任务后标记为 completed，开始任务时标记为 in_progress，跳过任务时标记为 skipped。',
  parameters: {
    item_id: {
      type: 'string',
      description: '任务 ID（从 plan_create 返回的列表中获取）',
      required: true,
    },
    status: {
      type: 'string',
      description: '新状态：pending、in_progress、completed、skipped',
      required: true,
      enum: ['pending', 'in_progress', 'completed', 'skipped'],
    },
  },
  meta: {
    permission: 'moderate',
    category: 'plan',
    displayName: '更新计划',
  } satisfies ToolMeta,
  execute: async (args: Record<string, unknown>, _ctx: IToolContext): Promise<string> => {
    const itemId = String(args.item_id || '').trim()
    const status = String(args.status || '').trim()

    if (!itemId) {
      return JSON.stringify({ ok: false, error: '请提供 item_id' })
    }

    const validStatuses = ['pending', 'in_progress', 'completed', 'skipped']
    if (!validStatuses.includes(status)) {
      return JSON.stringify({ ok: false, error: `无效的状态: ${status}。可选: ${validStatuses.join(', ')}` })
    }

    return JSON.stringify({
      ok: true,
      action: 'plan_update',
      item_id: itemId,
      status,
      message: `任务 ${itemId} 已更新为 ${status}`,
    })
  },
}

export const planTools = [planCreateTool, planUpdateTool]
