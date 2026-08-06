/** ReflectionNode（Reflection 评审节点：维度/JSON 协议/ReAct 集成见文档），详细见 docs/details/注释/packages/agent-core/orchestrator/nodes/reflection-node.md */

import type {
  OrchestratorNode,
  NodeContext,
  NodeResult,
  NodeType,
  PromptCallOptions,
  ReflectionResult,
  OrchestratorMessage,
} from '../types'

/** 评审维度的元数据描述（注入到 prompt 中引导 LLM 评审） */
export interface ReflectionDimension {
  /** 维度键名（如 'correctness'） */
  key: string
  /** 维度中文名（如 '正确性'） */
  label: string
  /** 该维度的评审说明（引导 LLM 如何评估） */
  description: string
}

/** 默认评审维度 */
const DEFAULT_DIMENSIONS: ReflectionDimension[] = [
  {
    key: 'correctness',
    label: '正确性',
    description: '事实是否准确、推理是否合理、逻辑是否自洽',
  },
  {
    key: 'completeness',
    label: '完整性',
    description: '是否覆盖了用户任务的所有需求点，是否有遗漏',
  },
  {
    key: 'style',
    label: '风格',
    description: '输出格式、表达方式、语言风格是否符合期望',
  },
]

/** 默认 prompt 模板 */
const DEFAULT_REFLECTION_PROMPT_TEMPLATE = `请对以下内容进行严格评审。

原始任务：{{input}}

待评审内容：
{{target}}

评审维度：
{{dimensions}}

要求：
1. 对每个维度进行评估
2. 给出综合评分（0-100，越高越好）
3. 列出识别的问题（severity: info/warning/error）
4. 给出具体的改进建议

输出 JSON 格式：
\`\`\`json
{
  "score": 85,
  "issues": [
    { "severity": "warning", "description": "具体问题描述" }
  ],
  "suggestions": ["具体可执行的改进建议1", "改进建议2"]
}
\`\`\`

只输出 JSON，不要额外解释。`

/** LLM 输出的原始评审结构（解析前） */
interface RawReflection {
  score?: unknown
  issues?: unknown
  suggestions?: unknown
}

export interface ReflectionNodeConfig {
  /** 节点唯一 ID */
  id: string
  /** 人类可读名称（默认 ReflectionNode:{id}） */
  name?: string
  /**
   * prompt 模板，支持占位符：
   * - {{input}}：用户原始输入
   * - {{target}}：被评审内容
   * - {{dimensions}}：评审维度列表
   * - {{lastMessage}}：上一条消息内容
   * 省略时用默认模板
   */
  promptTemplate?: string
  /** LLM 调用选项 */
  promptOptions?: PromptCallOptions
  /** 评审维度（默认 correctness/completeness/style） */
  dimensions?: ReflectionDimension[]
  /**
   * 评审目标选择器
   * 默认：state.messages 中最后一条 role='assistant' 的消息内容
   * 返回 null 表示没有可评审内容，节点直接返回 done
   */
  targetSelector?: (ctx: NodeContext) => string | null
  /**
   * 通过评分阈值
   * - score >= threshold 视为通过，返回 done
   * - score < threshold 视为需改进，返回 continue
   * 默认 70
   */
  passThreshold?: number
  /**
   * 自定义 JSON 解析回调
   * 默认：JSON.parse + 正则回退
   */
  parseReflection?: (response: string) => RawReflection | null
  /**
   * 是否将 prompt 写入 state.messages
   * 默认 true（保持消息历史完整）
   */
  recordUserMessage?: boolean
  /**
   * 是否将评审结果作为 system 消息写入 state.messages
   * 默认 true（供后续 RefineNode 引用）
   */
  recordReflectionAsMessage?: boolean
}

export class ReflectionNode implements OrchestratorNode {
  readonly id: string
  readonly name: string
  readonly type: NodeType = 'reflection'
  private config: ReflectionNodeConfig

  constructor(config: ReflectionNodeConfig) {
    this.id = config.id
    this.name = config.name ?? `ReflectionNode:${config.id}`
    this.config = config
  }

  async execute(ctx: NodeContext): Promise<NodeResult> {
    await ctx.waitIfPaused()
    if (ctx.isAborted()) {
      return { status: 'aborted' }
    }

    // 选择评审目标
    const target = this.config.targetSelector
      ? this.config.targetSelector(ctx)
      : this.defaultTargetSelector(ctx)

    if (!target) {
      ctx.log('warn', 'ReflectionNode: no target to reflect on')
      return {
        status: 'done',
        summary: 'No target to reflect on',
      }
    }

    const dimensions = this.config.dimensions ?? DEFAULT_DIMENSIONS
    const threshold = this.config.passThreshold ?? 70
    const iteration = (ctx.state.reflections?.length ?? 0) + 1

    // 渲染 prompt
    const input = this.renderPrompt(ctx, target, dimensions)
    if (!input.trim()) {
      return { status: 'error', error: 'Rendered prompt is empty' }
    }

    if (this.config.recordUserMessage !== false) {
      const userMsg: OrchestratorMessage = { role: 'user', content: input }
      ctx.state.messages.push(userMsg)
    }

    ctx.log('info', `ReflectionNode executing (iteration ${iteration})`, {
      targetLength: target.length,
      dimensions: dimensions.map(d => d.key),
      threshold,
    })

    try {
      const response = await ctx.backend.prompt(input, this.config.promptOptions)

      if (ctx.isAborted()) {
        return { status: 'aborted' }
      }

      ctx.state.messages.push({ role: 'assistant', content: response })

      // 解析评审结果
      const raw = this.config.parseReflection
        ? this.config.parseReflection(response)
        : this.defaultParseReflection(response)

      if (!raw) {
        ctx.log('error', 'ReflectionNode: failed to parse reflection', {
          responsePreview: response.slice(0, 200),
        })
        return {
          status: 'error',
          error: 'Failed to parse reflection from LLM response (expected JSON)',
        }
      }

      // 规范化为 ReflectionResult
      const result: ReflectionResult = {
        target: target.slice(0, 200), // 摘要避免占用过多状态空间
        score: this.normalizeScore(raw.score),
        issues: this.normalizeIssues(raw.issues),
        suggestions: this.normalizeSuggestions(raw.suggestions),
        iteration,
      }

      // 写入状态
      if (!ctx.state.reflections) {
        ctx.state.reflections = []
      }
      ctx.state.reflections.push(result)

      // 发射事件
      ctx.emit({ type: 'reflection_result', result })

      // 作为 system 消息写入（供 RefineNode 引用）
      if (this.config.recordReflectionAsMessage !== false) {
        const reflectionMsg: OrchestratorMessage = {
          role: 'system',
          content: this.formatReflectionForMessage(result),
        }
        ctx.state.messages.push(reflectionMsg)
      }

      ctx.log('info', `ReflectionNode completed`, {
        score: result.score,
        issueCount: result.issues.length,
        passed: result.score >= threshold,
      })

      // 判断是否通过
      const passed = result.score >= threshold
      return {
        status: passed ? 'done' : 'continue',
        summary: `Score ${result.score}/${threshold}, ${result.issues.length} issues, ${passed ? 'passed' : 'needs refinement'}`,
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      ctx.log('error', `ReflectionNode failed: ${msg}`)
      return { status: 'error', error: msg }
    }
  }

  /**
   * 默认评审目标选择器 — 最后一条 assistant 消息
   */
  private defaultTargetSelector(ctx: NodeContext): string | null {
    for (let i = ctx.state.messages.length - 1; i >= 0; i--) {
      const msg = ctx.state.messages[i]
      if (msg.role === 'assistant' && msg.content.trim()) {
        return msg.content
      }
    }
    return null
  }

  /**
   * 默认 JSON 解析 — 容错策略
   * 1. 直接 JSON.parse
   * 2. 提取 ```json ... ``` 代码块
   * 3. 提取首个 {...} 块
   */
  private defaultParseReflection(response: string): RawReflection | null {
    // 策略 1：直接解析
    try {
      const parsed = JSON.parse(response)
      if (typeof parsed === 'object' && parsed !== null) {
        return parsed as RawReflection
      }
    } catch {
      // 继续 fallback
    }

    // 策略 2：代码块
    const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (codeBlockMatch) {
      try {
        const parsed = JSON.parse(codeBlockMatch[1].trim())
        if (typeof parsed === 'object' && parsed !== null) {
          return parsed as RawReflection
        }
      } catch {
        // 继续 fallback
      }
    }

    // 策略 3：首个 {...} 块
    const objMatch = response.match(/\{[\s\S]*\}/)
    if (objMatch) {
      try {
        const parsed = JSON.parse(objMatch[0])
        if (typeof parsed === 'object' && parsed !== null) {
          return parsed as RawReflection
        }
      } catch {
        // 最终失败
      }
    }

    return null
  }

  /** 规范化评分为 0-100 整数 */
  private normalizeScore(score: unknown): number {
    if (typeof score === 'number' && !isNaN(score)) {
      return Math.max(0, Math.min(100, Math.round(score)))
    }
    if (typeof score === 'string') {
      const parsed = parseInt(score, 10)
      if (!isNaN(parsed)) return Math.max(0, Math.min(100, parsed))
    }
    return 50 // 默认中等评分
  }

  /** 规范化问题列表 */
  private normalizeIssues(issues: unknown): ReflectionResult['issues'] {
    if (!Array.isArray(issues)) return []
    return issues
      .filter((item): item is Record<string, unknown> =>
        typeof item === 'object' && item !== null,
      )
      .map(item => {
        const severity = item.severity
        const validSeverities: ReflectionResult['issues'][number]['severity'][] = ['info', 'warning', 'error']
        return {
          severity: validSeverities.includes(severity as any)
            ? (severity as ReflectionResult['issues'][number]['severity'])
            : 'info',
          description: typeof item.description === 'string' ? item.description : String(item.description ?? ''),
        }
      })
  }

  /** 规范化建议列表 */
  private normalizeSuggestions(suggestions: unknown): string[] {
    if (!Array.isArray(suggestions)) return []
    return suggestions
      .filter((s): s is string => typeof s === 'string')
      .map(s => s.trim())
      .filter(s => s.length > 0)
  }

  /** 将评审结果格式化为 system 消息内容（供 RefineNode 引用） */
  private formatReflectionForMessage(result: ReflectionResult): string {
    const issuesText = result.issues.length > 0
      ? result.issues.map(i => `  - [${i.severity}] ${i.description}`).join('\n')
      : '  （无）'
    const suggestionsText = result.suggestions.length > 0
      ? result.suggestions.map(s => `  - ${s}`).join('\n')
      : '  （无）'

    return `[评审结果 第${result.iteration}轮] 评分: ${result.score}/100
问题:
${issuesText}
建议:
${suggestionsText}`
  }

  private renderPrompt(
    ctx: NodeContext,
    target: string,
    dimensions: ReflectionDimension[],
  ): string {
    const template = this.config.promptTemplate ?? DEFAULT_REFLECTION_PROMPT_TEMPLATE
    const lastMessage = ctx.state.messages[ctx.state.messages.length - 1]?.content ?? ''

    const dimensionsText = dimensions
      .map(d => `- ${d.label}（${d.key}）：${d.description}`)
      .join('\n')

    return template
      .replace(/\{\{input\}\}/g, ctx.state.input)
      .replace(/\{\{target\}\}/g, target)
      .replace(/\{\{dimensions\}\}/g, dimensionsText)
      .replace(/\{\{lastMessage\}\}/g, lastMessage)
  }

  reset?(): void {
    // ReflectionNode 无内部状态，无需重置
  }
}
