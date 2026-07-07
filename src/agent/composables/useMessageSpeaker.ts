import { computed, type ComputedRef } from 'vue'
import { useSpaceStore } from '../../space/stores/space-store'
import { useUserProfileStore, STATUS_CONFIG } from '../../space/stores/user-profile-store'
import { usePersonaFontStore } from '../../space/stores/persona-font-store'
import { getAvatarColor } from '../../ui/avatar'

/** 消息中携带的身份字段（群聊填充，单聊从 store 读） */
interface SpeakerMessage {
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
 * 统一获取消息的 speaker 信息
 *
 * 数据流统一（迭代点 2）：
 * - 群聊消息：优先用 msg.speaker* 字段（GroupChatCoordinator 填充）
 * - 单聊消息：从 store 读（assistant→spaceStore.persona + accentColor，user→userProfileStore）
 *
 * 配合 AvatarBadge 组件使用：AvatarBadge 内部 useAvatarImage 自动解析 avatar（图片/引用）为 src，
 * 无图片时显示文字（avatar/name 首字）+ 背景色。
 *
 * 直接用 usePersonaFontStore（而非 usePersonaFont composable）避免字体加载副作用。
 */
export function useMessageSpeaker(
  getter: () => SpeakerMessage | undefined | null,
): ComputedRef<SpeakerInfo> {
  const spaceStore = useSpaceStore()
  const userProfileStore = useUserProfileStore()
  const fontStore = usePersonaFontStore()

  return computed<SpeakerInfo>(() => {
    const m = getter()
    const agentFont = fontStore.activeProfile.fontFamily

    if (!m) {
      return {
        name: '',
        avatar: null,
        color: getAvatarColor(null, 'agent'),
        fontFamily: agentFont,
      }
    }

    // 群聊消息：msg.speaker* 优先
    if (m.speakerName || m.speakerAvatar || m.speakerColor) {
      return {
        name: m.speakerName || '',
        avatar: m.speakerAvatar || null,
        color: m.speakerColor || getAvatarColor(null, 'agent'),
        fontFamily: agentFont,
      }
    }

    // 单聊 user 消息
    if (m.role === 'user') {
      const avatar = userProfileStore.profile.avatar
      return {
        name: userProfileStore.profile.nickname,
        avatar: avatar || null,
        color: STATUS_CONFIG[userProfileStore.profile.status].color,
      }
    }

    // 单聊 assistant（及 system/toolResult 等非 user 角色，统一按 Agent 身份）
    const persona = spaceStore.persona
    return {
      name: persona.name,
      avatar: persona.avatar || null,
      color: fontStore.activeProfile.accentColor,
      fontFamily: agentFont,
    }
  })
}
