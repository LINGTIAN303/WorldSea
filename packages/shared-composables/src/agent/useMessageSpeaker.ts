/** 消息发言者信息（端无关 + 依赖注入：speaker name/avatar/color/fontFamily），详细见 docs/details/注释/packages/shared-composables/agent/useMessageSpeaker.md */

import { computed, inject, provide, type ComputedRef, type InjectionKey } from 'vue'

/** 消息中携带的身份字段（群聊填充，单聊从 store 读） */
export interface SpeakerMessage {
  role: string
  speakerName?: string
  speakerAvatar?: string
  speakerColor?: string
}

export interface SpeakerInfo {
  /** 发言者名称（用于文字首字 fallback 与 tooltip） */
  name: string
  /** avatar 字段原值（图片/文字/引用）；由 AvatarBadge 内部 useAvatarImage 解析为可显示 src */
  avatar: string | null
  /** 头像背景色（无图片时） */
  color: string
  /** 文字字体（Agent 传 persona 字体，user 不传） */
  fontFamily?: string
}

/**
 * Speaker 上下文契约
 *
 * 各端入口需提供具体实现，将端特定 store 的字段包装为 ComputedRef 注入。
 */
export interface SpeakerContext {
  /** 当前 Agent persona（单聊 assistant 消息身份） */
  persona: ComputedRef<{
    name: string
    avatar?: string | null
  }>
  /** 当前 user profile（单聊 user 消息身份） */
  userProfile: ComputedRef<{
    nickname: string
    avatar?: string | null
    /** 当前状态对应的展示色（由端特定 STATUS_CONFIG 解析） */
    statusColor: string
  }>
  /** 当前 Agent 字体设置（agent 消息使用） */
  agentFont: ComputedRef<{
    fontFamily?: string
    /** 主题强调色（agent 消息气泡色） */
    accentColor: string
  }>
  /** 默认 Agent 头像背景色（无 speaker 信息时使用） */
  defaultAgentColor: string
}

/** Speaker 上下文注入 Key */
export const SPEAKER_CONTEXT_INJECTION_KEY: InjectionKey<SpeakerContext> = Symbol(
  'worldsea:speaker-context',
)

/**
 * 注入 Speaker 上下文（在组件 setup 中调用）
 *
 * @param ctx 各端具体的 SpeakerContext 实现
 */
export function provideMessageSpeakerContext(ctx: SpeakerContext): void {
  provide(SPEAKER_CONTEXT_INJECTION_KEY, ctx)
}

/**
 * 获取 Speaker 上下文（inject 模式）
 *
 * 未注入时抛错。必须在组件 setup 上下文中调用。
 */
function useSpeakerContext(): SpeakerContext {
  const ctx = inject(SPEAKER_CONTEXT_INJECTION_KEY, null)
  if (!ctx) {
    throw new Error(
      '[useMessageSpeaker] 未注入 SpeakerContext。请在应用入口调用 provideMessageSpeakerContext(...)。',
    )
  }
  return ctx
}

/** 统一获取消息的 speaker 信息（群聊字段优先 + 注入上下文兜底），详细见 docs/details/注释/packages/shared-composables/agent/useMessageSpeaker.md */
export function useMessageSpeaker(
  getter: () => SpeakerMessage | undefined | null,
): ComputedRef<SpeakerInfo> {
  const ctx = useSpeakerContext()

  return computed<SpeakerInfo>(() => {
    const m = getter()
    const agentFont = ctx.agentFont.value

    if (!m) {
      return {
        name: '',
        avatar: null,
        color: ctx.defaultAgentColor,
        fontFamily: agentFont.fontFamily,
      }
    }

    // 群聊消息：msg.speaker* 优先
    if (m.speakerName || m.speakerAvatar || m.speakerColor) {
      return {
        name: m.speakerName || '',
        avatar: m.speakerAvatar || null,
        color: m.speakerColor || ctx.defaultAgentColor,
        fontFamily: agentFont.fontFamily,
      }
    }

    // 单聊 user 消息
    if (m.role === 'user') {
      const profile = ctx.userProfile.value
      return {
        name: profile.nickname,
        avatar: profile.avatar || null,
        color: profile.statusColor,
      }
    }

    // 单聊 assistant（及 system/toolResult 等非 user 角色，统一按 Agent 身份）
    const persona = ctx.persona.value
    return {
      name: persona.name,
      avatar: persona.avatar || null,
      color: agentFont.accentColor,
      fontFamily: agentFont.fontFamily,
    }
  })
}
