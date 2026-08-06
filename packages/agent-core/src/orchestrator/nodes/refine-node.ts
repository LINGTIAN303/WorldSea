/** RefineNode（Self-Refine 迭代优化节点：编排图/收敛条件/修正策略见文档），详细见 docs/details/注释/packages/agent-core/orchestrator/nodes/refine-node.md */

import type {
  OrchestratorNode,
  NodeContext,
  NodeResult,
  NodeType,
  PromptCallOptions,
  ReflectionResult,
  OrchestratorMessage,
} from '../types'

/** 默认 prompt 模板 */
const DEFAULT_REFINE_PROMPT_TEMPLATE = `请根据评审反馈修正以下内容。

原始任务：{{input}}

待修正内容：
{{target}}

评审结果（第{{iteration}}轮）：
- 评分：{{score}}/100
- 问题：
{{issues}}
- 改进建议：
{{suggestions}}

要求：
1. 针对评审指出的问题逐一修正
2. 落实所有改进建议
3. 保持已正确部分不变，只修正有问题的部分
4. 输出修正后的完整内容（不要输出 diff，不要解释，直接输出修正后的内容）`

export interface RefineNodeConfig {
  /** 节点唯一 ID */
  id: string
  /** 人类可读名称（默认 RefineNode:{id}） */
  name?: string
  /** prompt 模板（占位符说明见文档），详细见 docs/details/注释/packages/agent-core/orchestrator/nodes/refine-node.md */
  promptTemplate?: string
  /** LLM 调用选项 */
  promptOptions?: PromptCallOptions
  /** 最大迭代次数（默认 3） */
  maxIterations?: number
  /** 评分达标阈值（默认 90，达到即收敛） */
  minScore?: number
  /** 连续无改进轮数阈值（默认 2，连续 N 轮分数无提升即收敛） */
  noImprovementRounds?: number
  /**
   * 下一个要触发的节点 ID（通常是 ReflectionNode）
   * 默认：'reflection'（约定名）
   * 未收敛时返回 continue + nextNodeId
   */
  reflectionNodeId?: string
  /**
   * 自定义收敛判断
   * 返回 true 表示已收敛（节点返回 done）
   * 默认：综合 maxIterations/minScore/noImprovementRounds 判断
   */
  isConverged?: (ctx: NodeContext, iterations: number) => boolean
  /**
   * 是否将 prompt 写入 state.messages
   * 默认 true
   */
  recordUserMessage?: boolean
}

export class RefineNode implements OrchestratorNode {
  readonly id: string
  readonly name: string
  readonly type: NodeType = 'refine'
  private config: RefineNodeConfig

  constructor(config: RefineNodeConfig) {
    this.id = config.id
    this.name = config.name ?? `RefineNode:${config.id}`
    this.config = config
  }

  async execute(ctx: NodeContext): Promise<NodeResult> {
    await ctx.waitIfPaused()
    if (ctx.isAborted()) {
      return { status: 'aborted' }
    }

    const reflections = ctx.state.reflections
    if (!reflections || reflections.length === 0) {
      return {
        status: 'error',
        error: 'No reflection found in state. Run ReflectionNode before RefineNode.',
      }
    }

    const latestReflection = reflections[reflections.length - 1]
    const iterations = reflections.length

    // 收敛判断
    const converged = this.config.isConverged
      ? this.config.isConverged(ctx, iterations)
      : this.defaultIsConverged(reflections, iterations)

    if (converged) {
      const reason = this.getConvergenceReason(reflections, iterations)
      ctx.log('info', `RefineNode: converged at iteration ${iterations}`, { reason })
      return {
        status: 'done',
        summary: `Converged: ${reason}`,
      }
    }

    // 找待修正内容（优先用最新 Reflection 的 target，回退到最后一条 assistant 消息）
    const target = this.findTargetToRefine(ctx, latestReflection)
    if (!target) {
      return {
        status: 'error',
        error: 'No content to refine (no assistant message found)',
      }
    }

    // 渲染 prompt
    const input = this.renderPrompt(ctx, target, latestReflection)
    if (!input.trim()) {
      return { status: 'error', error: 'Rendered prompt is empty' }
    }

    if (this.config.recordUserMessage !== false) {
      const userMsg: OrchestratorMessage = { role: 'user', content: input }
      ctx.state.messages.push(userMsg)
    }

    ctx.log('info', `RefineNode executing (iteration ${iterations})`, {
      targetLength: target.length,
      latestScore: latestReflection.score,
    })

    try {
      const response = await ctx.backend.prompt(input, this.config.promptOptions)

      if (ctx.isAborted()) {
        return { status: 'aborted' }
      }

      // 修正后的内容作为新的 assistant 消息
      ctx.state.messages.push({ role: 'assistant', content: response })

      ctx.log('info', `RefineNode completed (iteration ${iterations})`, {
        refinedLength: response.length,
      })

      // 返回 continue，由编排图边触发下一轮 Reflection
      const reflectionNodeId = this.config.reflectionNodeId ?? 'reflection'
      return {
        status: 'continue',
        nextNodeId: reflectionNodeId,
        summary: `Refined content at iteration ${iterations}, next: reflection`,
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      ctx.log('error', `RefineNode failed: ${msg}`)
      return { status: 'error', error: msg }
    }
  }

  /**
   * 默认收敛判断 — 综合三个条件
   */
  private defaultIsConverged(reflections: ReflectionResult[], iterations: number): boolean {
    const maxIter = this.config.maxIterations ?? 3
    const minScore = this.config.minScore ?? 90
    const noImproveRounds = this.config.noImprovementRounds ?? 2

    // 条件 1：达到最大迭代数
    if (iterations >= maxIter) {
      return true
    }

    const latest = reflections[reflections.length - 1]

    // 条件 2：评分达标
    if (latest.score >= minScore) {
      return true
    }

    // 条件 3：连续 N 轮无改进
    if (reflections.length >= noImproveRounds + 1) {
      const recent = reflections.slice(-(noImproveRounds + 1))
      let noImprovement = true
      for (let i = 1; i < recent.length; i++) {
        if (recent[i].score > recent[i - 1].score) {
          noImprovement = false
          break
        }
      }
      if (noImprovement) return true
    }

    return false
  }

  /** 获取收敛原因（用于日志） */
  private getConvergenceReason(reflections: ReflectionResult[], iterations: number): string {
    const maxIter = this.config.maxIterations ?? 3
    const minScore = this.config.minScore ?? 90

    if (iterations >= maxIter) {
      return `max iterations reached (${maxIter})`
    }

    const latest = reflections[reflections.length - 1]
    if (latest.score >= minScore) {
      return `score ${latest.score} >= threshold ${minScore}`
    }

    return `no improvement for ${this.config.noImprovementRounds ?? 2} rounds`
  }

  /**
   * 找待修正内容
   * 优先：最新 Reflection 的 target 字段
   * 回退：state.messages 最后一条 role='assistant' 的消息（跳过 ReflectionNode 写入的 system 消息）
   */
  private findTargetToRefine(ctx: NodeContext, latestReflection: ReflectionResult): string | null {
    // 策略 1：最新 Reflection 的 target
    if (latestReflection.target) {
      // target 是摘要（200字），需要从 messages 找完整内容
      // 但为简化，如果 target 存在就直接用（它已经是被评审内容的摘要）
      // 实际上我们应该找最后一条 assistant 消息作为完整内容
    }

    // 策略 2：最后一条 assistant 消息（跳过 system）
    for (let i = ctx.state.messages.length - 1; i >= 0; i--) {
      const msg = ctx.state.messages[i]
      if (msg.role === 'assistant' && msg.content.trim()) {
        return msg.content
      }
    }

    return null
  }

  private renderPrompt(
    ctx: NodeContext,
    target: string,
    reflection: ReflectionResult,
  ): string {
    const template = this.config.promptTemplate ?? DEFAULT_REFINE_PROMPT_TEMPLATE
    const lastMessage = ctx.state.messages[ctx.state.messages.length - 1]?.content ?? ''

    const issuesText = reflection.issues.length > 0
      ? reflection.issues.map(i => `  - [${i.severity}] ${i.description}`).join('\n')
      : '  （无）'

    const suggestionsText = reflection.suggestions.length > 0
      ? reflection.suggestions.map(s => `  - ${s}`).join('\n')
      : '  （无）'

    return template
      .replace(/\{\{input\}\}/g, ctx.state.input)
      .replace(/\{\{target\}\}/g, target)
      .replace(/\{\{iteration\}\}/g, String(reflection.iteration))
      .replace(/\{\{score\}\}/g, String(reflection.score))
      .replace(/\{\{issues\}\}/g, issuesText)
      .replace(/\{\{suggestions\}\}/g, suggestionsText)
      .replace(/\{\{lastMessage\}\}/g, lastMessage)
  }

  reset?(): void {
    // RefineNode 无内部状态，无需重置
  }
}
