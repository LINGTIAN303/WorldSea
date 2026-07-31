/**
 * # useAgent — 端无关 Agent Backend 注入层
 *
 * ## 设计目标
 * 三端（Web / Tauri / CLI）共享的 Agent Backend 注入工具。
 * 各端在应用入口调用 `provideAgentBackend(backend)` 注入具体实现，
 * 共享代码通过 `useAgent()` / `useAgentOptional()` 获取。
 *
 * ## 类型定义
 * 保留被多文件引用的类型（DeepSegment / ToolCallView 等），
 * 各端 useAgent 实现可 re-export 这些类型保持向后兼容。
 *
 * ## 注入模式
 * - `useAgent()`：必须注入，未注入抛错（用于核心路径）
 * - `useAgentOptional()`：可选注入，未注入返回 null（用于降级路径）
 * - `provideAgentBackend(backend)`：在组件 setup 中调用，注入给后代组件
 */

import { inject, provide, type InjectionKey } from 'vue'
import type { ImageAttachment, FileAttachment, ChatMode } from '@agent/index'

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

/** 最终结论区 */
export interface FinalOutput {
  content: string
  blocks: import('@agent/index').MessageBlock[]
  images: ImageAttachment[]
  files: FileAttachment[]
  status: 'streaming' | 'complete'
}

/**
 * 深度模式段类型：
 * - thinking: 推理过程（保留所有历史推理）
 * - phase: 阶段容器（内嵌工具列表 + 中间输出）
 */
export type DeepSegment =
  | { id: string; type: 'thinking'; thinking: string; timestamp: number; status: 'streaming' | 'complete' }
  | { id: string; type: 'phase'; label: string; index: number; timestamp: number;
      tools: ToolCallView[]; outputs: PhaseOutput[]; status: 'active' | 'done' }

/**
 * Agent Backend 注入 Key
 *
 * 使用宽松类型（any）以兼容各端不同的返回类型：
 * - Tauri 端：useAgentRustAdapter() 返回的完整适配器（含 UI 状态、会话管理等）
 * - Web 端：待实现的 WebSocket 适配器
 * - CLI 端：待实现的 CLI 适配器
 *
 * 严格类型校验在各端入口完成，shared 层只保证注入契约。
 */
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
