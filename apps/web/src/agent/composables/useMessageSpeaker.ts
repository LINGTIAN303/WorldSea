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

/** 统一获取消息 speaker 信息（群聊/单聊数据流统一，配合 AvatarBadge），详细见 docs/details/注释/web/agent/composables/useMessageSpeaker.md */
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
