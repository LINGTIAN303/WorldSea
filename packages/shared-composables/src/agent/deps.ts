/**
 * Agent UI 端依赖注入契约（deps）
 *
 * 用途：将 `bubbles` 系列共享组件（DeepMessageArea / NormalMessageBubble /
 * useMarkdownRender / useMessageExport）对 Web 应用层资源的依赖，改为
 * 通过 provide/inject 注入，使共享层不直接依赖任何端特定实现。
 *
 * 被注入的 Web 应用层资源（原实现位置）：
 * - `fontFamily` / `enterAnimation` / `persona`：来自 `usePersonaFont`（apps/web/src/space/composables）
 * - `fontPrefs`：来自 `fontStore.prefs.agent`（apps/web/src/stores/fontStore）
 * - `activityLogs`：来自 `useActivityLog`（apps/web/src/space/composables）
 * - `replaceFontSpans`：来自 `fontSpanParser`（apps/web/src/composables/fontSpanParser）
 * - `AvatarBadge`：来自 `../ui/AvatarBadge.vue`（apps/web/src/ui）
 *
 * 设计：与 `useMessageSpeaker` 的 provide/inject 模式保持一致。
 * 各端入口在应用启动时调用 `provideAgentUiDeps(...)` 注入具体实现；
 * 共享组件通过 `useAgentUiDeps()` 获取。
 */

import { inject, provide, type Component, type ComputedRef, type InjectionKey } from 'vue'

/** 活动日志条目（DeepMessageArea 消息时间窗口内展示） */
export interface ActivityLogItem {
  id: string
  type: 'info' | 'tool' | 'knowledge' | 'memory' | 'error'
  message: string
  timestamp: number
  detail?: string
}

/** 字体偏好（对应 Web 端 fontStore.prefs.agent） */
export interface AgentFontPrefs {
  family?: string
  weight?: number
  style?: string
}

/** Persona 字体细节（导出 PNG/GIF 用） */
export interface PersonaFontInfo {
  /** 原始 family 名（不含引号/fallback，用于 font-kit 渲染） */
  fontFamily: string
  sizeScale: number
  /** 字重 token（'normal' | 'medium' | 'semibold' | 'bold'），用于 font-kit 渲染 */
  weightDefault: string
}

/**
 * Agent UI 端依赖契约
 *
 * 各端需提供完整实现；未提供时 `useAgentUiDeps()` 会抛错提示。
 */
export interface AgentUiDeps {
  /** 完整 font-family 字符串（persona 兜底），如 `"xxx", fallback, sans-serif` */
  fontFamily: ComputedRef<string>
  /** 入场动画效果名（导出 GIF / 消息气泡动画用） */
  enterAnimation: ComputedRef<string>
  /** 字体偏好（fontStore.prefs.agent） */
  fontPrefs: ComputedRef<AgentFontPrefs>
  /** persona 字体细节（导出 PNG/GIF 用） */
  persona: ComputedRef<PersonaFontInfo>
  /** 活动日志（DeepMessageArea 时间窗口内展示） */
  activityLogs: ComputedRef<ActivityLogItem[]>
  /** 替换 {font:...} 内联标记为 span 占位符 */
  replaceFontSpans: (text: string) => string
  /** 头像组件（各端各自实现） */
  AvatarBadge: Component
}

/** Agent UI 依赖注入 Key */
export const AGENT_UI_DEPS_KEY: InjectionKey<AgentUiDeps> = Symbol(
  'worldsmith:agent-ui-deps',
)

/**
 * 注入 Agent UI 依赖（在应用入口 setup 中调用）
 *
 * @param deps 各端具体的 AgentUiDeps 实现
 */
export function provideAgentUiDeps(deps: AgentUiDeps): void {
  provide(AGENT_UI_DEPS_KEY, deps)
}

/**
 * 获取 Agent UI 依赖（inject 模式）
 *
 * 未注入时抛错。必须在组件 setup 上下文中调用。
 */
export function useAgentUiDeps(): AgentUiDeps {
  const deps = inject(AGENT_UI_DEPS_KEY, null)
  if (!deps) {
    throw new Error(
      '[useAgentUiDeps] 未注入 AgentUiDeps。请在应用入口调用 provideAgentUiDeps(...)。',
    )
  }
  return deps
}