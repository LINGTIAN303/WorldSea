/**
 * GroupChatSetup 拆分产生的共用类型与常量
 */

/** 参与者草稿（设置阶段） */
export interface ParticipantDraft {
  name: string
  role: string
  color: string
  modelId: string
}

/** 已保存的群聊配置 */
export interface SavedGroupConfig {
  id: string
  name: string
  participants: ParticipantDraft[]
  maxRounds: number
  maxCostUsd: number
  parallelCount: number
  autoDegradation: boolean
  savedAt: number
}

/** 群聊预设模板 */
export interface GroupChatTemplate {
  id: string
  icon: string
  name: string
  desc: string
  participants: Array<{ name: string; role: string; color: string }>
}

/** 内置讨论模板 */
export const GROUP_CHAT_TEMPLATES: GroupChatTemplate[] = [
  { id: 'debate', icon: 'sword', name: '辩论模式', desc: '正反方对立讨论', participants: [
    { name: '正方辩手', role: '支持观点，提供论据', color: '#3b82f6' },
    { name: '反方辩手', role: '反对观点，提出质疑', color: '#ef4444' },
    { name: '裁判', role: '客观评判，总结观点', color: '#22c55e' },
  ]},
  { id: 'brainstorm', icon: 'sparkles', name: '头脑风暴', desc: '多角度创意发散', participants: [
    { name: '创意总监', role: '提出创新方向', color: '#8b5cf6' },
    { name: '技术专家', role: '评估可行性', color: '#3b82f6' },
    { name: '用户代表', role: '从用户角度出发', color: '#f59e0b' },
  ]},
  { id: 'roundtable', icon: 'landmark', name: '圆桌讨论', desc: '平等协商共识', participants: [
    { name: '主持人', role: '引导讨论方向', color: '#6c5ce7' },
    { name: '参与者A', role: '提供专业视角', color: '#3b82f6' },
    { name: '参与者B', role: '提供实践视角', color: '#22c55e' },
    { name: '参与者C', role: '提供批判视角', color: '#ef4444' },
  ]},
  { id: 'analysis', icon: 'search', name: '深度分析', desc: '专家逐层剖析', participants: [
    { name: '分析师', role: '数据驱动的分析', color: '#3b82f6' },
    { name: '审查员', role: '发现逻辑漏洞', color: '#ef4444' },
  ]},
]

/** 参与者颜色调色板（点击头像循环切换） */
export const PARTICIPANT_COLOR_PALETTE = [
  '#3b82f6', '#8b5cf6', '#ef4444', '#22c55e',
  '#f59e0b', '#ec4899', '#06b6d4', '#f97316',
]

/** localStorage 存储键 */
export const SAVED_CONFIGS_STORAGE_KEY = 'worldsmith-group-chat-saved-configs'

/** 参与者数量限制 */
export const MAX_PARTICIPANTS = 8
export const MIN_PARTICIPANTS = 2