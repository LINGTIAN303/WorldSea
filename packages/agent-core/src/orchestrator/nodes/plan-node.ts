/**
 * PlanNode — Plan-and-Execute 模式的计划生成节点
 *
 * 设计理念：
 * - 单次 execute = 一次 backend.prompt 调用 = 生成完整计划
 * - 要求 LLM 输出 JSON 数组格式（[{title, description}, ...]）
 * - 解析后写入 state.plan，发射 plan_created 事件
 * - 节点本身不循环，执行完毕返回 'done'
 *
 * JSON 格式约定：
 * ```json
 * [
 *   { "title": "步骤标题", "description": "步骤描述" },
 *   ...
 * ]
 * ```
 *
 * 容错策略：
 * 1. 直接 JSON.parse
 * 2. 失败则用正则提取首个 [...] 块再 parse
 * 3. 仍失败则返回 error（可由自定义 parsePlan 回调覆盖）
 *
 * 与 ExecuteNode 的协作：
 * - PlanNode 生成计划 → ExecuteNode 逐步执行
 * - 编排图边：PlanNode → ExecuteNode（无条件）
 * - ExecuteNode 完成一项后 → 条件边回到自身（还有 pending）或结束
 */

import type {
  OrchestratorNode,
  NodeContext,
  NodeResult,
  NodeType,
  PromptCallOptions,
  PlanItem,
  OrchestratorMessage,
} from '../types'

/** LLM 输出的原始计划项（解析前） */
interface RawPlanItem {
  title?: unknown
  description?: unknown
}

/** 默认 prompt 模板 — 引导 LLM 输出 JSON 格式计划 */
const DEFAULT_PLAN_PROMPT_TEMPLATE = `请将以下任务分解为可执行的步骤计划。

任务：{{input}}

要求：
1. 输出一个 JSON 数组，每个元素包含 "title"（步骤标题）和 "description"（步骤描述，可选）
2. 步骤数量控制在 {{maxItems}} 个以内
3. 步骤顺序应逻辑合理，前序步骤的输出可作为后续步骤的输入
4. 只输出 JSON，不要额外解释

输出格式示例：
\`\`\`json
[
  { "title": "分析需求", "description": "理解任务的核心目标" },
  { "title": "设计方案", "description": "确定技术实现路径" }
]
\`\`\``

export interface PlanNodeConfig {
  /** 节点唯一 ID */
  id: string
  /** 人类可读名称（默认 PlanNode:{id}） */
  name?: string
  /**
   * prompt 模板，支持占位符：
   * - {{input}}：用户原始输入
   * - {{maxItems}}：最大步骤数
   * - {{lastMessage}}：上一条消息内容
   * 省略时用默认模板（含 JSON 输出格式说明）
   */
  promptTemplate?: string
  /** LLM 调用选项 */
  promptOptions?: PromptCallOptions
  /** 最大计划项数（默认 10） */
  maxItems?: number
  /**
   * 自定义 JSON 解析回调
   * 默认：JSON.parse + 正则回退
   * 返回 null 表示解析失败
   */
  parsePlan?: (response: string) => RawPlanItem[] | null
  /**
   * 是否将 prompt 写入 state.messages
   * 默认 true（保持消息历史完整）
   */
  recordUserMessage?: boolean
}

export class PlanNode implements OrchestratorNode {
  readonly id: string
  readonly name: string
  readonly type: NodeType = 'plan'
  private config: PlanNodeConfig

  constructor(config: PlanNodeConfig) {
    this.id = config.id
    this.name = config.name ?? `PlanNode:${config.id}`
    this.config = config
  }

  async execute(ctx: NodeContext): Promise<NodeResult> {
    // 中断检查
    await ctx.waitIfPaused()
    if (ctx.isAborted()) {
      return { status: 'aborted' }
    }

    const maxItems = this.config.maxItems ?? 10

    // 渲染 prompt
    const input = this.renderPrompt(ctx, maxItems)
    if (!input.trim()) {
      return { status: 'error', error: 'Rendered prompt is empty' }
    }

    // 记录用户消息
    if (this.config.recordUserMessage !== false) {
      const userMsg: OrchestratorMessage = { role: 'user', content: input }
      ctx.state.messages.push(userMsg)
    }

    ctx.log('info', 'PlanNode executing', {
      inputLength: input.length,
      maxItems,
    })

    try {
      const response = await ctx.backend.prompt(input, this.config.promptOptions)

      if (ctx.isAborted()) {
        return { status: 'aborted' }
      }

      // 记录 assistant 响应
      ctx.state.messages.push({ role: 'assistant', content: response })

      // 解析计划
      const rawItems = this.config.parsePlan
        ? this.config.parsePlan(response)
        : this.defaultParsePlan(response)

      if (!rawItems || rawItems.length === 0) {
        ctx.log('error', 'PlanNode: failed to parse plan from response', {
          responsePreview: response.slice(0, 200),
        })
        return {
          status: 'error',
          error: 'Failed to parse plan from LLM response (expected JSON array)',
        }
      }

      // 转换为 PlanItem（补充 id/order/status）
      const planItems: PlanItem[] = rawItems.slice(0, maxItems).map((raw, idx) => ({
        id: `plan-${Date.now()}-${idx}`,
        title: typeof raw.title === 'string' ? raw.title : `步骤 ${idx + 1}`,
        description: typeof raw.description === 'string' ? raw.description : undefined,
        status: 'pending' as const,
        order: idx,
      }))

      // 写入共享状态
      ctx.state.plan = planItems

      // 发射 plan_created 事件（前端可监听展示进度）
      ctx.emit({ type: 'plan_created', items: planItems })

      ctx.log('info', 'PlanNode completed', {
        planSize: planItems.length,
        titles: planItems.map(p => p.title),
      })

      return {
        status: 'done',
        summary: `Generated ${planItems.length} plan items`,
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      ctx.log('error', `PlanNode failed: ${msg}`)
      return { status: 'error', error: msg }
    }
  }

  /**
   * 默认 JSON 解析 — 容错策略
   * 1. 直接 JSON.parse
   * 2. 失败则正则提取首个 [...] 块
   * 3. 仍失败返回 null
   */
  private defaultParsePlan(response: string): RawPlanItem[] | null {
    // 策略 1：直接解析
    try {
      const parsed = JSON.parse(response)
      if (Array.isArray(parsed)) {
        return parsed.filter(this.isValidRawItem)
      }
    } catch {
      // 继续 fallback
    }

    // 策略 2：提取 ```json ... ``` 代码块
    const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (codeBlockMatch) {
      try {
        const parsed = JSON.parse(codeBlockMatch[1].trim())
        if (Array.isArray(parsed)) {
          return parsed.filter(this.isValidRawItem)
        }
      } catch {
        // 继续 fallback
      }
    }

    // 策略 3：提取首个 [...] 块
    const arrayMatch = response.match(/\[[\s\S]*\]/)
    if (arrayMatch) {
      try {
        const parsed = JSON.parse(arrayMatch[0])
        if (Array.isArray(parsed)) {
          return parsed.filter(this.isValidRawItem)
        }
      } catch {
        // 最终失败
      }
    }

    return null
  }

  private isValidRawItem(item: unknown): item is RawPlanItem {
    return typeof item === 'object' && item !== null && 'title' in item
  }

  private renderPrompt(ctx: NodeContext, maxItems: number): string {
    const template = this.config.promptTemplate ?? DEFAULT_PLAN_PROMPT_TEMPLATE
    const lastMessage = ctx.state.messages[ctx.state.messages.length - 1]?.content ?? ''

    return template
      .replace(/\{\{input\}\}/g, ctx.state.input)
      .replace(/\{\{maxItems\}\}/g, String(maxItems))
      .replace(/\{\{lastMessage\}\}/g, lastMessage)
  }

  reset?(): void {
    // PlanNode 无内部状态，无需重置
  }
}
