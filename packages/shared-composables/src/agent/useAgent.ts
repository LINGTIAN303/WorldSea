/** 端无关 Agent Backend 注入层（provideAgentBackend/useAgent 注入契约），详细见 docs/details/注释/packages/shared-composables/agent/useAgent.md */

import { inject, provide, type InjectionKey } from 'vue'
import type { ChatMode } from '@agent/index'

export type { ChatMode }

/** 交互工具分类 */
export type InteractiveToolType = 'choice' | 'display' | 'waiting' | 'confirm' | 'none'

/** 工具调用视图（阶段内嵌） */
export interface ToolCallView {
  id: string
  name: string
  args: Record<string, unknown>
  status: 'running' | 'completed' | 'failed'
  result?: string
  startedAt: number
  endedAt?: number
  /** 行段种类（行段模型 v2）：归约层由工具名推导；旧路径未携带时渲染层按名称回退分类 */
  rowKind?: import('./turnModel').ActionRowKind
  /** 执行耗时（毫秒，H7 P0.5 事件权威字段）；旧事件/历史回源无此字段则不显示 */
  durationMs?: number
  /** 交互类型分类（深度模式专用） */
  interactiveType?: InteractiveToolType
  /** 展示型工具的 Block 数据（output_* 工具执行后回填） */
  block?: import('@agent/index').MessageBlock
  /** 确认型工具的权限级别 */
  permissionLevel?: 'safe' | 'moderate' | 'dangerous'
  /** 工具执行进度（0-100，-1 表示失败，由 useAgentEvents 维护） */
  progress?: number
}

/** 阶段内的中间输出 */
export interface PhaseOutput {
  id: string
  content: string
  timestamp: number
  status: 'streaming' | 'complete'
}

/**
 * 深度模式段类型：
 * - thinking: 推理过程（保留所有历史推理）
 * - phase: 阶段容器（内嵌工具列表 + 中间输出）
 *
 * @deprecated 待 Phase 4 清理，改用 AgentStreamItem
 */
export type DeepSegment =
  | { id: string; type: 'thinking'; thinking: string; timestamp: number; status: 'streaming' | 'complete' }
  | { id: string; type: 'phase'; label: string; index: number; timestamp: number;
      tools: ToolCallView[]; outputs: PhaseOutput[]; status: 'active' | 'done' }

/** Agent Backend 注入 Key（宽松类型兼容各端不同返回类型），详细见 docs/details/注释/packages/shared-composables/agent/useAgent.md */
export const AGENT_BACKEND_INJECTION_KEY: InjectionKey<any> = Symbol('worldsmith:agent-backend')

/**
 * 注入 Agent Backend（在组件 setup 中调用）
 *
 * @param backend 各端具体的 Agent Backend 实现
 */
export function provideAgentBackend(backend: any): void {
  provide(AGENT_BACKEND_INJECTION_KEY, backend)
}

/**
 * 获取 Agent Backend（inject 模式）
 *
 * 未注入时抛错，用于必须依赖 Agent 的核心路径。
 * 必须在组件 setup 上下文中调用（inject 限制）。
 */
export function useAgent(): any {
  const backend = inject(AGENT_BACKEND_INJECTION_KEY, null)
  if (!backend) {
    throw new Error(
      '[useAgent] 未注入 Agent Backend。请在应用入口调用 provideAgentBackend(backend)。',
    )
  }
  return backend
}

/**
 * 可选获取 Agent Backend（inject 模式）
 *
 * 未注入时返回 null，用于可降级的路径（如 MCP 连接管理）。
 * 必须在组件 setup 上下文中调用（inject 限制）。
 */
export function useAgentOptional(): any | null {
  return inject(AGENT_BACKEND_INJECTION_KEY, null)
}

/** Agent 输出事件流单行（统一渲染源，对齐 Harness Node 流） */
export type AgentStreamItem =
  /** turnId：所属轮次（渲染层按轮次分组、折叠 latch 归属都需要；旧调用方可不传） */
  | {
      type: 'user'
      msg: import('@agent/index').AgentMessage
      id: string
      timestamp: number
      turnId?: string
    }
  /** isResult=true 表示此正文行是 ③ 结果层；false/undefined 为 ② 过程层的过程文本段 */
  | {
      type: 'assistant'
      msg: import('@agent/index').AgentMessage
      id: string
      timestamp: number
      isResult?: boolean
    }
  | { type: 'think'; id: string; text: string; status: 'streaming' | 'complete'; timestamp: number }
  | { type: 'tool'; tc: ToolCallView; id: string; timestamp: number }
  | { type: 'divider'; id: string; dividerText: string; timestamp: number }
  /** 过程层折叠摘要行：过程层折叠时替代全部过程行段，点击可展开 */
  | {
      type: 'process_summary'
      id: string
      turnId: string
      thinkCount: number
      actionCount: number
      timestamp: number
    }
