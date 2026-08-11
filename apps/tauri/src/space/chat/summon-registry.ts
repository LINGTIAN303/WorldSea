/**
 * 召唤系统注册表（summon registry）
 *
 * 四符号统一入口，触发方式在 ChatInput 内实现（任意光标位置 + rAF 节流）：
 *   # 命令   → 立即执行（切换模式 / 帮助）
 *   / 技能   → 转成 Chip 随消息发送（附加指令前缀）
 *   ！区域   → 召唤面板 / 视图
 *   @ 引用   → 从世界设定实体库异步拉列表 → Chip 随消息发送
 */
import type { ChatMode } from '@worldsmith/shared-composables/agent/useAgent'
import { entitySchemaRegistry } from '@worldsmith/entity-core'

export type { ChatMode }

export type SummonKind = 'command' | 'skill' | 'region' | 'reference'

export interface SummonParam {
  type: 'enum'
  enum_values: string[]
}

export interface SummonItem {
  id: string
  /** 触发符号：# / ！ @（实体统一为 ！，内部归一化） */
  prefix: string
  name: string
  description: string
  /** WsIcon Lucide 名 */
  icon: string
  kind: SummonKind
  payload: string
  /** 二级菜单枚举参数（#命令） */
  params?: SummonParam[]
  /** 引用对象（@引用选中后回填） */
  referenceId?: string
  referenceName?: string
}

/** 召唤符号集合（！兼容英文 ! 输入，统一归一化为中文 ！） */
export const SUMMON_PREFIXES = ['#', '/', '！', '!', '@'] as const

/** 对话模式枚举（与 space-store ChatMode 对齐，供 #模式 二级菜单） */
export const CHAT_MODE_ENUM: ChatMode[] = ['deep', 'explore', 'task']

/** 内置召唤条目（后续可按需扩展） */
export const SUMMON_ITEMS: SummonItem[] = [
  // ── # 命令（立即执行）──
  {
    id: 'cmd-mode',
    prefix: '#',
    name: '模式',
    description: '切换对话模式（深度/探索/任务）',
    icon: 'chat',
    kind: 'command',
    payload: 'chatMode',
    params: [{ type: 'enum', enum_values: [...CHAT_MODE_ENUM] }],
  },
  {
    id: 'cmd-help',
    prefix: '#',
    name: '帮助',
    description: '查看召唤指令说明',
    icon: 'help',
    kind: 'command',
    payload: 'help',
  },
  // ── / 技能（Chip，随消息发送）──
  { id: 'skill-detail', prefix: '/', name: '深度解析', description: '逐步深入分析问题', icon: 'brain', kind: 'skill', payload: '请逐步深入分析：' },
  { id: 'skill-brainstorm', prefix: '/', name: '创意发散', description: '头脑风暴多种可能', icon: 'lightbulb', kind: 'skill', payload: '请进行创意发散：' },
  { id: 'skill-summarize', prefix: '/', name: '精炼总结', description: '提取核心要点', icon: 'list', kind: 'skill', payload: '请精炼总结：' },
  { id: 'skill-code', prefix: '/', name: '代码生成', description: '生成代码实现', icon: 'code', kind: 'skill', payload: '请生成代码：' },
  { id: 'skill-outline', prefix: '/', name: '大纲', description: '生成结构化大纲', icon: 'outline', kind: 'skill', payload: '请先生成大纲：' },
  // ── ！区域（召唤面板 / 视图）──
  { id: 'region-knowledge', prefix: '！', name: '知识墙', description: '打开知识墙面板', icon: 'book', kind: 'region', payload: 'knowledge' },
  { id: 'region-memory', prefix: '！', name: '记忆架', description: '打开记忆架', icon: 'brain', kind: 'region', payload: 'memory' },
  { id: 'region-exec', prefix: '！', name: '运行面板', description: '打开运行面板（轨迹/活动/计划）', icon: 'chart', kind: 'region', payload: 'exec' },
  { id: 'region-sessions', prefix: '！', name: '会话列表', description: '打开会话列表', icon: 'chat', kind: 'region', payload: 'sessions' },
]

/**
 * 生成 @ 引用条目（动态读取实体类型注册表）
 * 每个已注册类型对应一条引用（@角色 / @地点 / …），另附「全部实体」兜底。
 */
export function getReferenceEntries(): SummonItem[] {
  const types = entitySchemaRegistry.getAll()
  const typed = types.map((t) => ({
    id: `ref-type-${t.typeKey}`,
    prefix: '@',
    name: entitySchemaRegistry.getLabel(t.typeKey),
    description: `引用${entitySchemaRegistry.getLabel(t.typeKey)}`,
    icon: entitySchemaRegistry.getIconName(t.typeKey),
    kind: 'reference' as const,
    payload: t.typeKey,
  }))
  return [
    ...typed,
    { id: 'ref-all', prefix: '@', name: '全部实体', description: '引用所有类型实体', icon: 'document', kind: 'reference', payload: 'all' },
  ]
}

/** 按触发符号过滤条目（英文 ! 归一化为中文 ！） */
export function filterByPrefix(items: SummonItem[], prefix: string): SummonItem[] {
  const norm = prefix === '!' ? '！' : prefix
  return items.filter((i) => i.prefix === norm)
}

/** 匹配过滤文本（名称 / id 包含即命中，供菜单与 hasMatches 判断） */
export function matchesFilter(item: SummonItem, filter: string): boolean {
  const f = filter.trim().toLowerCase()
  if (!f) return true
  return item.name.toLowerCase().includes(f) || item.id.toLowerCase().includes(f) || item.payload.toLowerCase().includes(f)
}
