/** 创作编排工具集：Agent 管理创作 Pipeline（9 工具），详细见 docs/details/注释/packages/agent-runtime/tools-pipeline-tools.md */

import type { ToolDefinition } from '../bridge-types'
import type { ToolMeta } from '@worldsmith/agent-core'
import type { IToolContext } from '../toolbus/types'
import type { IEntityStore } from '../toolbus/types'
import type { AgentType } from '../orchestrator/types'
import { AGENT_TYPE_CONFIG } from '../orchestrator/types'

// ─── 辅助函数 ───────────────────────────────────────────────────────────

function getEntityStore(ctx: IToolContext): IEntityStore {
  return ctx.stores.entity
}

const PIPELINE_TYPE = 'pipeline'

function buildPipelineEntity(params: {
  id: string
  name: string
  description?: string
  steps?: unknown[]
  connections?: unknown[]
  tags?: string[]
  status?: string
}) {
  const now = new Date().toISOString()
  return {
    id: params.id,
    type: PIPELINE_TYPE,
    name: params.name,
    description: params.description || '',
    properties: {
      steps: JSON.stringify(params.steps || []),
      connections: JSON.stringify(params.connections || []),
      status: params.status || 'draft',
    },
    tags: params.tags || [],
    createdAt: now,
    updatedAt: now,
  }
}

/** 根据步骤类型确定子 Agent 类型和 Skill 集合 */
function resolveStepAgentType(step: Record<string, any>): {
  agentType: AgentType
  skillIds: string[]
  prompt: string
} {
  const config = step.config || {}

  switch (step.type) {
    case 'agent-task': {
      const skillIds = config.skillIds || ['worldbuilding', 'content-craft']
      const promptParts = [
        `[创作编排] 正在执行 Pipeline 步骤「${step.title}」`,
        '',
        '## 任务',
        config.prompt || step.title,
      ]
      if (config.targetEntityType) {
        promptParts.push('', '## 目标实体类型', String(config.targetEntityType))
      }
      if (config.expectedOutput) {
        promptParts.push('', '## 预期输出', String(config.expectedOutput))
      }
      return { agentType: 'creation-worker', skillIds, prompt: promptParts.join('\n') }
    }

    case 'batch-create': {
      const count = config.count || 5
      const entityType = config.entityType || 'character'
      const context = config.context || ''
      const prompt = [
        `[创作编排] 批量创建实体`,
        '',
        `## 任务`,
        `批量创建 ${count} 个「${entityType}」类型的实体。`,
        context ? `\n## 上下文\n${context}` : '',
        '',
        `## 要求`,
        `- 每个实体都要有独特且丰富的属性`,
        `- 实体之间应有合理的关联`,
        `- 确保创建后建立适当的关系`,
      ].join('\n')
      return { agentType: 'batch-creation-worker', skillIds: ['content-craft'], prompt }
    }

    case 'consistency-check': {
      const scope = config.scope || 'all'
      const strictness = config.strictness || 'normal'
      const prompt = [
        `[创作编排] 一致性校验`,
        '',
        `## 任务`,
        `执行世界观一致性校验。`,
        `- 校验范围: ${scope}`,
        `- 严格度: ${strictness}`,
        '',
        `## 要求`,
        `- 检查实体之间的逻辑矛盾`,
        `- 检查属性值的合理性`,
        `- 检查关系的完整性`,
        `- 列出所有发现的问题并给出修复建议`,
      ].join('\n')
      return { agentType: 'consistency-worker', skillIds: ['worldbuilding'], prompt }
    }

    case 'template-apply': {
      const templateId = config.templateId || ''
      const prompt = [
        `[创作编排] 套用模板`,
        '',
        `## 任务`,
        `根据模板「${templateId}」创建相关实体和设定。`,
        config.context ? `\n## 上下文\n${config.context}` : '',
      ].join('\n')
      return { agentType: 'creation-worker', skillIds: config.skillIds || ['worldbuilding', 'content-craft'], prompt }
    }

    case 'transform': {
      const transformType = config.transformType || 'general'
      const prompt = [
        `[创作编排] 数据转换`,
        '',
        `## 任务`,
        `执行数据转换: ${transformType}`,
        config.prompt || step.title,
        '',
        `## 要求`,
        `- 保持数据一致性`,
        `- 转换后的数据应符合 Schema 规范`,
      ].join('\n')
      return { agentType: 'creation-worker', skillIds: config.skillIds || ['worldbuilding'], prompt }
    }

    default: {
      return {
        agentType: 'creation-worker',
        skillIds: config.skillIds || ['worldbuilding', 'content-craft'],
        prompt: `[创作编排] 执行步骤「${step.title}」\n\n${config.prompt || step.title}`,
      }
    }
  }
}

// ─── 内置模板步骤数据 ──────────────────────────────────────────────────

const TEMPLATE_STEPS: Record<string, { name: string; description: string; steps: unknown[]; connections: unknown[] }> = {
  'medieval-kingdom': {
    name: '中世纪王国',
    description: '从零设计中世纪王国：地理→物种→文化→势力→角色',
    steps: [
      { id: 'mk-1', type: 'agent-task', title: '地理与版图设计', config: { prompt: '设计中世纪王国的地理版图，包括主要地形、气候、资源分布', targetEntityType: 'region', skillIds: ['worldbuilding'] }, status: 'pending' },
      { id: 'mk-2', type: 'user-review', title: '审阅地理设定', config: { instruction: '请审阅地理版图设计，确认方向是否正确', skippable: true }, status: 'pending' },
      { id: 'mk-3', type: 'agent-task', title: '物种与种族设计', config: { prompt: '基于已设计的地理环境，创造适合的物种和种族', targetEntityType: 'species', skillIds: ['worldbuilding', 'content-craft'] }, status: 'pending' },
      { id: 'mk-4', type: 'agent-task', title: '文化与习俗构建', config: { prompt: '为各种族设计独特的文化、习俗、节日和禁忌', targetEntityType: 'culture', skillIds: ['worldbuilding', 'content-craft'] }, status: 'pending' },
      { id: 'mk-5', type: 'batch-create', title: '势力与组织创建', config: { entityType: 'organization', count: 5, context: '中世纪王国的势力格局，包括王室、贵族、教会、商会、佣兵团等' }, status: 'pending' },
      { id: 'mk-6', type: 'batch-create', title: '核心角色创建', config: { entityType: 'character', count: 8, context: '中世纪王国的核心人物，包括国王、大臣、将军、主教、商人等' }, status: 'pending' },
      { id: 'mk-7', type: 'consistency-check', title: '一致性校验', config: { scope: 'all', strictness: 'normal' }, status: 'pending' },
    ],
    connections: [
      { from: 'mk-1', to: 'mk-2' },
      { from: 'mk-2', to: 'mk-3' },
      { from: 'mk-3', to: 'mk-4' },
      { from: 'mk-4', to: 'mk-5' },
      { from: 'mk-5', to: 'mk-6' },
      { from: 'mk-6', to: 'mk-7' },
    ],
  },
  'magic-system': {
    name: '魔法体系',
    description: '设计完整的魔法体系：规则→分类→法术→施法者→道具',
    steps: [
      { id: 'ms-1', type: 'agent-task', title: '魔法核心规则设计', config: { prompt: '设计魔法体系的核心规则，包括能量来源、施法限制、代价机制', targetEntityType: 'concept', skillIds: ['worldbuilding'] }, status: 'pending' },
      { id: 'ms-2', type: 'user-review', title: '审阅核心规则', config: { instruction: '请审阅魔法核心规则，确认体系方向', skippable: true }, status: 'pending' },
      { id: 'ms-3', type: 'agent-task', title: '魔法分类与学派', config: { prompt: '基于核心规则，设计魔法的分类体系和各学派特色', skillIds: ['worldbuilding', 'content-craft'] }, status: 'pending' },
      { id: 'ms-4', type: 'batch-create', title: '法术与技能创建', config: { entityType: 'concept', count: 10, context: '各学派的代表性法术和技能' }, status: 'pending' },
      { id: 'ms-5', type: 'batch-create', title: '施法者角色创建', config: { entityType: 'character', count: 6, context: '各学派的代表性施法者角色' }, status: 'pending' },
      { id: 'ms-6', type: 'batch-create', title: '魔法道具创建', config: { entityType: 'item', count: 8, context: '魔法体系中的关键道具、法器和材料' }, status: 'pending' },
      { id: 'ms-7', type: 'consistency-check', title: '一致性校验', config: { scope: 'all', strictness: 'strict' }, status: 'pending' },
    ],
    connections: [
      { from: 'ms-1', to: 'ms-2' },
      { from: 'ms-2', to: 'ms-3' },
      { from: 'ms-3', to: 'ms-4' },
      { from: 'ms-4', to: 'ms-5' },
      { from: 'ms-5', to: 'ms-6' },
      { from: 'ms-6', to: 'ms-7' },
    ],
  },
  'character-network': {
    name: '角色关系网络',
    description: '构建角色关系网络：角色群→性格背景→关系→冲突→势力',
    steps: [
      { id: 'cn-1', type: 'agent-task', title: '角色群设计', config: { prompt: '设计一组核心角色的基本概念，包括身份、动机、性格轮廓', skillIds: ['worldbuilding'] }, status: 'pending' },
      { id: 'cn-2', type: 'user-review', title: '审阅角色概念', config: { instruction: '请审阅角色群设计，确认角色方向和多样性', skippable: true }, status: 'pending' },
      { id: 'cn-3', type: 'batch-create', title: '创建角色实体', config: { entityType: 'character', count: 8, context: '核心角色群，包括主角、对手、导师、盟友等' }, status: 'pending' },
      { id: 'cn-4', type: 'agent-task', title: '关系网络构建', config: { prompt: '为已创建的角色建立关系网络，包括血缘、师徒、盟友、敌对等', skillIds: ['content-craft'] }, status: 'pending' },
      { id: 'cn-5', type: 'agent-task', title: '冲突与矛盾设计', config: { prompt: '基于角色关系，设计核心冲突和矛盾线索', skillIds: ['worldbuilding', 'content-craft'] }, status: 'pending' },
      { id: 'cn-6', type: 'agent-task', title: '势力归属与阵营', config: { prompt: '将角色分配到不同势力和阵营，建立组织关系', skillIds: ['content-craft'] }, status: 'pending' },
      { id: 'cn-7', type: 'consistency-check', title: '一致性校验', config: { scope: 'all', strictness: 'normal' }, status: 'pending' },
    ],
    connections: [
      { from: 'cn-1', to: 'cn-2' },
      { from: 'cn-2', to: 'cn-3' },
      { from: 'cn-3', to: 'cn-4' },
      { from: 'cn-4', to: 'cn-5' },
      { from: 'cn-5', to: 'cn-6' },
      { from: 'cn-6', to: 'cn-7' },
    ],
  },
}

// ─── pipeline_list ──────────────────────────────────────────────────────

const pipelineListTool: ToolDefinition = {
  name: 'pipeline_list',
  description: '列出所有创作 Pipeline（创作计划）。返回名称、状态、步骤数量等摘要信息。',
  parameters: {},
  meta: {
    permission: 'safe',
    category: 'orchestrator',
    displayName: '列出Pipeline',
  } satisfies ToolMeta,
  execute: async (_args: Record<string, unknown>, ctx: IToolContext): Promise<string> => {
    const store = getEntityStore(ctx)
    const entities = await store.getAllEntities()
    const pipelines = entities.filter((e: any) => e.type === PIPELINE_TYPE).map((e: any) => {
      const p = e.properties || {}
      let steps: unknown[] = []
      try { steps = JSON.parse((p.steps as string) || '[]') } catch { /* ignore */ }
      return {
        id: e.id,
        name: e.name,
        description: e.description || '',
        status: p.status || 'draft',
        stepCount: steps.length,
        tags: e.tags || [],
      }
    })
    return JSON.stringify({ ok: true, pipelines, total: pipelines.length })
  },
}

// ─── pipeline_get ───────────────────────────────────────────────────────

const pipelineGetTool: ToolDefinition = {
  name: 'pipeline_get',
  description: '获取单个创作 Pipeline 的详细信息，包括所有步骤和连接。',
  parameters: {
    pipeline_id: { type: 'string', description: 'Pipeline ID', required: true },
  },
  meta: {
    permission: 'safe',
    category: 'orchestrator',
    displayName: '获取Pipeline',
  } satisfies ToolMeta,
  execute: async (args: Record<string, unknown>, ctx: IToolContext): Promise<string> => {
    const store = getEntityStore(ctx)
    const id = String(args.pipeline_id)
    const entity = await store.getById(id)
    if (!entity || entity.type !== PIPELINE_TYPE) {
      return JSON.stringify({ ok: false, error: `Pipeline "${id}" 不存在` })
    }
    const p = entity.properties || {}
    let steps: unknown[] = []
    let connections: unknown[] = []
    try { steps = JSON.parse((p.steps as string) || '[]') } catch { /* ignore */ }
    try { connections = JSON.parse((p.connections as string) || '[]') } catch { /* ignore */ }
    return JSON.stringify({
      ok: true,
      pipeline: {
        id: entity.id, name: entity.name, description: entity.description,
        status: p.status, steps, connections, tags: entity.tags,
      },
    })
  },
}

// ─── pipeline_create ────────────────────────────────────────────────────

const pipelineCreateTool: ToolDefinition = {
  name: 'pipeline_create',
  description: '创建一个新的创作 Pipeline（创作计划）。',
  parameters: {
    name: { type: 'string', description: 'Pipeline 名称', required: true },
    description: { type: 'string', description: 'Pipeline 描述' },
    steps: { type: 'object', description: '步骤数组 (JSON)' },
    connections: { type: 'object', description: '连接数组 (JSON)' },
    tags: { type: 'object', description: '标签数组' },
  },
  meta: {
    permission: 'moderate',
    category: 'orchestrator',
    displayName: '创建Pipeline',
  } satisfies ToolMeta,
  execute: async (args: Record<string, unknown>, ctx: IToolContext): Promise<string> => {
    const store = getEntityStore(ctx)
    const id = `pipeline-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const entity = buildPipelineEntity({
      id,
      name: String(args.name),
      description: args.description as string | undefined,
      steps: args.steps as unknown[] | undefined,
      connections: args.connections as unknown[] | undefined,
      tags: args.tags as string[] | undefined,
    })
    const newId = await store.add(entity, 'agent')
    return JSON.stringify({ ok: true, id: newId, message: `已创建 Pipeline「${args.name}」` })
  },
}

// ─── pipeline_update ────────────────────────────────────────────────────

const pipelineUpdateTool: ToolDefinition = {
  name: 'pipeline_update',
  description: '更新已有的创作 Pipeline（修改名称、步骤、状态等）。',
  parameters: {
    pipeline_id: { type: 'string', description: 'Pipeline ID', required: true },
    name: { type: 'string', description: '新名称' },
    description: { type: 'string', description: '新描述' },
    steps: { type: 'object', description: '新步骤数组 (JSON)' },
    connections: { type: 'object', description: '新连接数组 (JSON)' },
    status: { type: 'string', description: '新状态: draft | ready | running | completed | failed' },
  },
  meta: {
    permission: 'moderate',
    category: 'orchestrator',
    displayName: '更新Pipeline',
  } satisfies ToolMeta,
  execute: async (args: Record<string, unknown>, ctx: IToolContext): Promise<string> => {
    const store = getEntityStore(ctx)
    const id = String(args.pipeline_id)
    const entity = await store.getById(id)
    if (!entity || entity.type !== PIPELINE_TYPE) {
      return JSON.stringify({ ok: false, error: `Pipeline "${id}" 不存在` })
    }
    const update: Record<string, unknown> = {}
    const propsUpdate: Record<string, unknown> = {}
    if (args.name !== undefined) update.name = args.name
    if (args.description !== undefined) update.description = args.description
    if (args.steps !== undefined) propsUpdate.steps = JSON.stringify(args.steps)
    if (args.connections !== undefined) propsUpdate.connections = JSON.stringify(args.connections)
    if (args.status !== undefined) propsUpdate.status = args.status
    if (Object.keys(propsUpdate).length > 0) update.properties = propsUpdate
    await store.update(id, update, 'agent')
    return JSON.stringify({ ok: true, message: `已更新 Pipeline「${args.name || id}」` })
  },
}

// ─── pipeline_delete ────────────────────────────────────────────────────

const pipelineDeleteTool: ToolDefinition = {
  name: 'pipeline_delete',
  description: '删除一个创作 Pipeline。',
  parameters: {
    pipeline_id: { type: 'string', description: 'Pipeline ID', required: true },
  },
  meta: {
    permission: 'dangerous',
    category: 'orchestrator',
    displayName: '删除Pipeline',
  } satisfies ToolMeta,
  execute: async (args: Record<string, unknown>, ctx: IToolContext): Promise<string> => {
    const store = getEntityStore(ctx)
    const id = String(args.pipeline_id)
    await store.remove(id, 'agent')
    return JSON.stringify({ ok: true, message: `已删除 Pipeline「${id}」` })
  },
}

// ─── pipeline_run_step ──────────────────────────────────────────────────

const pipelineRunStepTool: ToolDefinition = {
  name: 'pipeline_run_step',
  description: '执行 Pipeline 中的单个步骤。根据步骤类型自动派发创作子 Agent 执行任务。子 Agent 拥有独立上下文和工具集，自主完成创作。返回子 Agent 的 taskId，可用于查询执行状态。',
  parameters: {
    pipeline_id: { type: 'string', description: 'Pipeline ID', required: true },
    step_id: { type: 'string', description: '步骤 ID', required: true },
  },
  meta: {
    permission: 'moderate',
    category: 'orchestrator',
    displayName: '运行流水线步骤',
  } satisfies ToolMeta,
  execute: async (args: Record<string, unknown>, ctx: IToolContext): Promise<string> => {
    const store = getEntityStore(ctx)
    const pipelineId = String(args.pipeline_id)
    const stepId = String(args.step_id)

    const entity = await store.getById(pipelineId)
    if (!entity || entity.type !== PIPELINE_TYPE) {
      return JSON.stringify({ ok: false, error: `Pipeline "${pipelineId}" 不存在` })
    }

    const p = entity.properties || {}
    let steps: any[] = []
    try { steps = JSON.parse((p.steps as string) || '[]') } catch { /* ignore */ }

    const stepIndex = steps.findIndex((s: any) => s.id === stepId)
    if (stepIndex < 0) {
      return JSON.stringify({ ok: false, error: `步骤 "${stepId}" 不存在` })
    }

    const step = steps[stepIndex]

    // user-review 步骤不派发子 Agent，直接暂停等待用户
    if (step.type === 'user-review') {
      steps[stepIndex] = { ...step, status: 'running' }
      await store.update(pipelineId, {
        properties: { ...p, steps: JSON.stringify(steps), status: 'running', currentStepId: stepId },
      }, 'agent')

      return JSON.stringify({
        ok: true,
        stepId,
        stepTitle: step.title,
        stepType: 'user-review',
        status: 'waiting_for_user',
        instruction: '此步骤需要用户审阅确认。请告知用户当前进度，等待用户确认后继续。',
      })
    }

    // 标记步骤为 running
    steps[stepIndex] = { ...step, status: 'running' }
    await store.update(pipelineId, {
      properties: { ...p, steps: JSON.stringify(steps), status: 'running', currentStepId: stepId },
    }, 'agent')

    // 解析步骤类型 → 子 Agent 配置
    const { agentType, skillIds, prompt } = resolveStepAgentType(step)
    const typeConfig = AGENT_TYPE_CONFIG[agentType]
    if (!typeConfig) {
      return JSON.stringify({ ok: false, error: `未知的子 Agent 类型: ${agentType}` })
    }

    // 派发创作子 Agent
    const taskId = `pipeline-${stepId}-${Date.now()}`
    try {
      const event = new CustomEvent('worldsmith:dispatch-sub-agent', {
        detail: {
          taskId,
          type: agentType,
          prompt,
          timeout: step.config?.timeout || 180000,
          skillIds,
          // 附带 Pipeline 上下文，子 Agent 完成后自动更新步骤状态
          pipelineContext: { pipelineId, stepId },
        },
      })
      window.dispatchEvent(event)

      return JSON.stringify({
        ok: true,
        stepId,
        stepTitle: step.title,
        stepType: step.type,
        taskId,
        agentType,
        agentName: typeConfig.name,
        status: 'dispatched',
        hint: `步骤「${step.title}」已派发给${typeConfig.name}。使用 get_sub_agent_status(task_id="${taskId}") 查询执行状态。子 Agent 完成后将自动更新步骤状态。`,
      })
    } catch (err) {
      // 派发失败，回滚步骤状态
      steps[stepIndex] = { ...step, status: 'failed' }
      await store.update(pipelineId, {
        properties: { ...p, steps: JSON.stringify(steps) },
      }, 'agent')

      return JSON.stringify({
        ok: false,
        error: `派发子 Agent 失败: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  },
}

// ─── pipeline_propose ───────────────────────────────────────────────────

const pipelineProposeTool: ToolDefinition = {
  name: 'pipeline_propose',
  description: '根据用户描述的创作目标，自动提议一个完整的创作 Pipeline。返回步骤类型指南和框架提示，由你（主 Agent）根据目标设计具体步骤。',
  parameters: {
    goal: { type: 'string', description: '创作目标描述，如「从零设计一个中世纪王国」', required: true },
  },
  meta: {
    permission: 'safe',
    category: 'orchestrator',
    displayName: '提议Pipeline',
  } satisfies ToolMeta,
  execute: async (args: Record<string, unknown>, _ctx: IToolContext): Promise<string> => {
    const goal = String(args.goal)

    return JSON.stringify({
      ok: true,
      goal,
      hint: `请根据用户目标「${goal}」设计 5-8 个创作步骤，然后使用 pipeline_create 创建 Pipeline。`,
      stepTypeGuide: {
        'agent-task': {
          description: 'AI 执行创作任务（生成角色、设计地理等）',
          configFields: ['prompt（任务描述）', 'targetEntityType（目标实体类型）', 'skillIds（技能列表，如 worldbuilding/content-craft）'],
          example: { type: 'agent-task', title: '核心概念设计', config: { prompt: '设计核心概念和基础框架', targetEntityType: 'concept', skillIds: ['worldbuilding'] } },
        },
        'user-review': {
          description: '暂停等待用户审阅/修改',
          configFields: ['instruction（审阅说明）', 'skippable（是否可跳过）'],
          example: { type: 'user-review', title: '审阅核心概念', config: { instruction: '请审阅核心概念设计', skippable: true } },
        },
        'batch-create': {
          description: '批量创建实体',
          configFields: ['entityType（实体类型）', 'count（数量）', 'context（上下文描述）'],
          example: { type: 'batch-create', title: '批量创建角色', config: { entityType: 'character', count: 5, context: '核心角色群' } },
        },
        'consistency-check': {
          description: '一致性校验',
          configFields: ['scope（范围: all/recent）', 'strictness（严格度: normal/strict）'],
          example: { type: 'consistency-check', title: '一致性校验', config: { scope: 'all', strictness: 'normal' } },
        },
        'template-apply': {
          description: '套用预设模板',
          configFields: ['templateId（模板ID）', 'context（上下文）'],
          example: { type: 'template-apply', title: '套用模板', config: { templateId: 'medieval-kingdom', context: '' } },
        },
        'transform': {
          description: '数据转换',
          configFields: ['transformType（转换类型）', 'prompt（转换说明）'],
          example: { type: 'transform', title: '数据转换', config: { transformType: 'general', prompt: '转换说明' } },
        },
      },
      designPrinciples: [
        '每个步骤应聚焦一个明确的创作目标',
        '在关键节点插入 user-review 步骤，让用户把控方向',
        '先设计核心概念，再展开细节，最后批量创建',
        '创作流程末尾应有一致性校验步骤',
        '步骤之间通过 connections 定义执行顺序',
      ],
    })
  },
}

// ─── pipeline_template_list ─────────────────────────────────────────────

const pipelineTemplateListTool: ToolDefinition = {
  name: 'pipeline_template_list',
  description: '列出所有可用的创作模板。',
  parameters: {},
  meta: {
    permission: 'safe',
    category: 'orchestrator',
    displayName: '列出模板',
  } satisfies ToolMeta,
  execute: async (_args: Record<string, unknown>, _ctx: IToolContext): Promise<string> => {
    const templates = Object.entries(TEMPLATE_STEPS).map(([id, t]) => ({
      id,
      name: t.name,
      description: t.description,
      stepCount: t.steps.length,
    }))
    return JSON.stringify({ ok: true, templates, total: templates.length })
  },
}

// ─── pipeline_template_apply ────────────────────────────────────────────

const pipelineTemplateApplyTool: ToolDefinition = {
  name: 'pipeline_template_apply',
  description: '使用指定的创作模板创建一个新的 Pipeline（包含完整步骤）。',
  parameters: {
    template_id: { type: 'string', description: '模板 ID', required: true },
    name: { type: 'string', description: '自定义名称（可选）' },
  },
  meta: {
    permission: 'moderate',
    category: 'orchestrator',
    displayName: '应用模板',
  } satisfies ToolMeta,
  execute: async (args: Record<string, unknown>, ctx: IToolContext): Promise<string> => {
    const store = getEntityStore(ctx)
    const templateId = String(args.template_id)
    const customName = args.name as string | undefined

    const template = TEMPLATE_STEPS[templateId]
    if (!template) {
      return JSON.stringify({
        ok: false,
        error: `模板 "${templateId}" 不存在。可用模板: ${Object.keys(TEMPLATE_STEPS).join(', ')}`,
      })
    }

    const id = `pipeline-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const entity = buildPipelineEntity({
      id,
      name: customName || `创作计划: ${template.name}`,
      description: template.description,
      steps: template.steps,
      connections: template.connections,
      tags: ['template', templateId],
      status: 'ready',
    })

    const newId = await store.add(entity, 'agent')
    return JSON.stringify({
      ok: true,
      id: newId,
      stepCount: template.steps.length,
      message: `已基于「${template.name}」模板创建 Pipeline，包含 ${template.steps.length} 个步骤。`,
    })
  },
}

// ─── 导出 ───────────────────────────────────────────────────────────────

export const pipelineTools: ToolDefinition[] = [
  pipelineListTool,
  pipelineGetTool,
  pipelineCreateTool,
  pipelineUpdateTool,
  pipelineDeleteTool,
  pipelineRunStepTool,
  pipelineProposeTool,
  pipelineTemplateListTool,
  pipelineTemplateApplyTool,
]
