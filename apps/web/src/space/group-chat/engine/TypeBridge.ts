/**
 * 群聊前后端类型桥接
 *
 * 前端使用 GroupMember / GroupChatMessage（src/space/group-chat/types.ts），
 * 后端模块使用 AgentProfile / GroupChatMessage（worldsmith-agent/src/group-chat/types.ts）。
 * 本模块提供双向转换，使后端模块可无缝接入前端引擎。
 */

import type { AgentProfile, GroupChatMessage as BackendMsg, SpeakingDesireConfig, AgentPersonality } from '@agent/group-chat/types'
import type { GroupMember, GroupChatMessage as FrontendMsg } from '../types'

// ─── Frontend → Backend ─────────────────────────────────────────────

/** 将前端 GroupMember 转换为后端 AgentProfile */
export function memberToProfile(member: GroupMember): AgentProfile {
  const personality: AgentPersonality = {
    speakingStyle: inferSpeakingStyle(member.role),
    expertise: member.enabledSkills?.length ? member.enabledSkills : extractKeywords(member.systemPrompt),
  }

  const speakingDesire: SpeakingDesireConfig = {
    baseProbability: 0.3,
    topicAffinities: buildTopicAffinities(member),
    talkativeness: member.muted ? 0 : 1.0,
  }

  return {
    id: member.id,
    name: member.name,
    avatar: member.avatar,
    color: member.color,
    systemPrompt: member.systemPrompt,
    providerSlotId: '',
    personality,
    speakingDesire,
    enabled: !member.muted,
    createdAt: new Date(member.joinedAt).toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

/** 将前端 GroupChatMessage 转换为后端 GroupChatMessage */
export function casualToBackendMsg(msg: FrontendMsg): BackendMsg {
  return {
    id: msg.id,
    role: msg.role === 'system' || msg.role === 'toolResult' ? 'assistant' : msg.role,
    agentId: msg.speakerId ?? null,
    agentName: msg.speakerName,
    agentAvatar: msg.speakerAvatar,
    agentColor: msg.speakerColor,
    content: msg.content,
    thinking: msg.thinking,
    mentions: msg.mentions,
    timestamp: msg.timestamp,
    metadata: {
      replyTo: msg.replyTo,
      type: msg.type,
      imageUrl: msg.imageUrl,
      fileName: msg.fileName,
      fileUrl: msg.fileUrl,
    },
  }
}

// ─── Backend → Frontend ─────────────────────────────────────────────

/** 将后端 GroupChatMessage 转换为前端 GroupChatMessage */
export function backendToCasualMsg(msg: BackendMsg): FrontendMsg {
  return {
    id: msg.id,
    role: msg.role === 'moderator' ? 'system' : msg.role,
    content: msg.content,
    thinking: msg.thinking,
    timestamp: msg.timestamp,
    speakerId: msg.agentId ?? undefined,
    speakerName: msg.agentName,
    speakerAvatar: msg.agentAvatar,
    speakerColor: msg.agentColor,
    type: (msg.metadata?.type as FrontendMsg['type']) ?? 'text',
    replyTo: msg.metadata?.replyTo as string | undefined,
    mentions: msg.mentions,
    imageUrl: msg.metadata?.imageUrl as string | undefined,
    fileName: msg.metadata?.fileName as string | undefined,
    fileUrl: msg.metadata?.fileUrl as string | undefined,
  }
}

// ─── 辅助函数 ────────────────────────────────────────────────────────

/** 从角色名推断说话风格 */
function inferSpeakingStyle(role: string): string {
  const map: Record<string, string> = {
    '作家': '文学性，善用比喻',
    '科学家': '严谨精确，引用数据',
    '艺术家': '感性浪漫，关注美感',
    '历史学家': '沉稳厚重，引经据典',
    '哲学家': '思辨深邃，追问本质',
    '工程师': '务实简洁，关注可行性',
    '商人': '精明干练，关注价值',
  }
  return map[role] || '自然随性'
}

/** 从系统提示词中提取关键词 */
function extractKeywords(systemPrompt: string): string[] {
  if (!systemPrompt) return []
  return systemPrompt
    .split(/[,，、\s]+/)
    .filter(w => w.length > 1)
    .slice(0, 10)
}

/** 从成员信息构建话题亲和度映射 */
function buildTopicAffinities(member: GroupMember): Record<string, number> {
  const affinities: Record<string, number> = {}
  if (member.enabledSkills) {
    for (const skill of member.enabledSkills) {
      affinities[skill] = 1.2
    }
  }
  return affinities
}
