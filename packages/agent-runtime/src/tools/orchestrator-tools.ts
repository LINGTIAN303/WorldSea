/** Agent 调度器工具集：CustomEvent 调度 9 种子 Agent，详细见 docs/details/注释/packages/agent-runtime/tools-orchestrator-tools.md */

import type { ToolDefinition } from '../bridge-types'
import type { ToolMeta } from '@worldsea/agent-core'
import type { IToolContext } from '../toolbus/types'
import type { AgentType } from '../orchestrator/types'
import { AGENT_TYPE_CONFIG } from '../orchestrator/types'

/** 子 Agent 类型的中文描述 */
const SUB_AGENT_TYPE_DESCRIPTIONS: Record<AgentType, string> = {
  'terminal-worker': '终端执行 Agent — 在终端中执行命令、脚本、系统操作。适合需要终端交互的任务。',
  'review-worker': '代码审查 Agent — 审查代码质量、安全漏洞、最佳实践。适合代码审查和安全扫描任务。',
  'research-worker': '研究 Agent — 联网搜索、资料收集、技术调研。适合需要联网查询的任务。',
  'test-worker': '测试 Agent — 生成测试用例、运行测试、分析覆盖率。适合测试相关任务。',
  'doc-worker': '文档 Agent — 生成 API 文档、README、变更日志。适合文档生成任务。',
  'git-worker': 'Git Agent — 版本控制操作、分支管理、提交代码。适合 Git 相关任务。',
  'creation-worker': '创作 Agent — 执行世界观创作任务，如设计地理、构建文化、生成角色等。拥有 worldbuilding 和 content-craft 技能。',
  'consistency-worker': '校验 Agent — 执行世界观一致性校验，检查实体间的逻辑矛盾、属性合理性、关系完整性。拥有 worldbuilding 技能。',
  'batch-creation-worker': '批量创作 Agent — 批量创建实体，如角色、物品、区域等。拥有 content-craft 技能。',
}

/** list_sub_agent_types — 列出所有可用子 Agent 类型及能力描述 */
const listSubAgentTypesTool: ToolDefinition = {
  name: 'list_sub_agent_types',
  description: '列出所有可用的子 Agent 类型及其能力描述。在调度子 Agent 之前，先调用此工具了解可用的子 Agent 类型。',
  parameters: {},
  meta: {
    permission: 'safe',
    category: 'orchestrator',
    displayName: '列出子Agent类型',
  } satisfies ToolMeta,
  execute: async (_args: Record<string, unknown>, _ctx: IToolContext): Promise<string> => {
    const types = Object.entries(AGENT_TYPE_CONFIG).map(([type, config]) => ({
      type,
      icon: config.icon,
      name: config.name,
      skills: config.skillIds,
      description: SUB_AGENT_TYPE_DESCRIPTIONS[type as AgentType] || '',
    }))

    return JSON.stringify({
      ok: true,
      agentTypes: types,
      hint: '使用 dispatch_sub_agent 工具调度子 Agent 执行任务',
    })
  },
}

/**
 * dispatch_sub_agent — 调度子 Agent
 * 通过 window.dispatchEvent('worldsea:dispatch-sub-agent') 通知前端编排器,
 * 前端编排器负责创建子 Agent 实例并管理其生命周期。
 */
const dispatchSubAgentTool: ToolDefinition = {
  name: 'dispatch_sub_agent',
  description: '调度一个子 Agent 执行任务。子 Agent 会独立运行，拥有自己的上下文和工具集。返回子 Agent 的 ID，可用于后续查询结果。',
  parameters: {
    type: {
      type: 'string',
      description: '子 Agent 类型',
      enum: [
        'terminal-worker', 'review-worker', 'research-worker', 'test-worker', 'doc-worker', 'git-worker',
        'creation-worker', 'consistency-worker', 'batch-creation-worker',
      ],
      required: true,
    },
    prompt: {
      type: 'string',
      description: '给子 Agent 的任务描述（越详细越好，子 Agent 会根据此描述独立执行）',
      required: true,
    },
    task_id: {
      type: 'string',
      description: '任务 ID（可选，不提供则自动生成）',
    },
    timeout: {
      type: 'number',
      description: '超时时间（毫秒，默认 120000）',
    },
  },
  meta: {
    permission: 'moderate',
    category: 'orchestrator',
    displayName: '调度子Agent',
  } satisfies ToolMeta,
  execute: async (args: Record<string, unknown>, _ctx: IToolContext): Promise<string> => {
    const agentType = String(args.type) as AgentType
    const prompt = String(args.prompt)
    const taskId = (args.task_id as string) || `sub-${agentType}-${Date.now()}`
    const timeout = (args.timeout as number) || 120000

    if (!AGENT_TYPE_CONFIG[agentType]) {
      return JSON.stringify({
        ok: false,
        error: `未知的子 Agent 类型: ${agentType}`,
        availableTypes: Object.keys(AGENT_TYPE_CONFIG),
      })
    }

    if (!prompt.trim()) {
      return JSON.stringify({ ok: false, error: '任务描述不能为空' })
    }

    const typeConfig = AGENT_TYPE_CONFIG[agentType]

    try {
      const event = new CustomEvent('worldsea:dispatch-sub-agent', {
        detail: {
          taskId,
          type: agentType,
          prompt,
          timeout,
          icon: typeConfig.icon,
          name: typeConfig.name,
          skillIds: typeConfig.skillIds,
        },
      })
      window.dispatchEvent(event)

      return JSON.stringify({
        ok: true,
        taskId,
        type: agentType,
        name: typeConfig.name,
        icon: typeConfig.icon,
        status: 'dispatched',
        hint: `子 Agent ${typeConfig.name} 已调度。使用 get_sub_agent_status(task_id="${taskId}") 查询执行状态和结果。`,
      })
    } catch (err) {
      return JSON.stringify({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  },
}

/**
 * get_sub_agent_status — 查询子 Agent 状态
 * 从全局 window.__worldsea_sub_agents Map 中读取状态。
 * 终端状态：completed / failed / timeout / cancelled
 */
const getSubAgentStatusTool: ToolDefinition = {
  name: 'get_sub_agent_status',
  description: '查询子 Agent 的执行状态和结果。如果子 Agent 已完成，返回执行结果。',
  parameters: {
    task_id: {
      type: 'string',
      description: '子 Agent 的任务 ID（由 dispatch_sub_agent 返回）',
      required: true,
    },
  },
  meta: {
    permission: 'safe',
    category: 'orchestrator',
    displayName: '查询子Agent状态',
  } satisfies ToolMeta,
  execute: async (args: Record<string, unknown>, _ctx: IToolContext): Promise<string> => {
    const taskId = String(args.task_id)

    const sharedAgents = (window as any).__worldsea_sub_agents as Map<string, {
      id: string; type: string; icon: string; name: string; status: string
      result: string | null; startedAt: number | null; completedAt: number | null
      duration: number | null; error: string | null
    }> | undefined

    if (!sharedAgents) {
      return JSON.stringify({
        ok: false,
        error: '前端编排器未就绪，无法查询子 Agent 状态',
        hint: '请确保前端应用已加载且 useOrchestrator 已初始化',
      })
    }

    const agent = sharedAgents.get(taskId)
    if (!agent) {
      return JSON.stringify({
        ok: false,
        error: `未找到任务 ID "${taskId}" 对应的子 Agent`,
        hint: '请确认 task_id 正确，或子 Agent 可能已被清理',
      })
    }

    const isTerminal = agent.status === 'completed' || agent.status === 'failed' || agent.status === 'timeout' || agent.status === 'cancelled'

    return JSON.stringify({
      ok: true,
      taskId: agent.id, type: agent.type, name: agent.name, icon: agent.icon,
      status: agent.status, startedAt: agent.startedAt,
      completedAt: agent.completedAt, duration: agent.duration, error: agent.error,
      result: isTerminal ? agent.result : undefined,
      hint: isTerminal
        ? `子 Agent 已${agent.status === 'completed' ? '完成' : agent.status === 'failed' ? '失败' : agent.status === 'timeout' ? '超时' : '取消'}`
        : '子 Agent 仍在运行中，请稍后再次查询',
    })
  },
}

/** cancel_sub_agent — 通过 CustomEvent 通知前端取消子 Agent */
const cancelSubAgentTool: ToolDefinition = {
  name: 'cancel_sub_agent',
  description: '取消正在运行的子 Agent。',
  parameters: {
    task_id: {
      type: 'string',
      description: '要取消的子 Agent 任务 ID',
      required: true,
    },
  },
  meta: {
    permission: 'moderate',
    category: 'orchestrator',
    displayName: '取消子Agent',
  } satisfies ToolMeta,
  execute: async (args: Record<string, unknown>, _ctx: IToolContext): Promise<string> => {
    const taskId = String(args.task_id)

    try {
      const event = new CustomEvent('worldsea:cancel-sub-agent', {
        detail: { taskId },
      })
      window.dispatchEvent(event)

      return JSON.stringify({
        ok: true,
        taskId,
        message: '取消请求已发送',
      })
    } catch (err) {
      return JSON.stringify({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  },
}

export const orchestratorTools = [
  listSubAgentTypesTool,
  dispatchSubAgentTool,
  getSubAgentStatusTool,
  cancelSubAgentTool,
]
