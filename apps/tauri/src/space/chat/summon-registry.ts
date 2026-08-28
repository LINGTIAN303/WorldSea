/**
 * 召唤系统注册表（summon registry）—— 统一符号召唤分层（D1）
 *
 * 五符号统一入口，触发方式在 ChatInput 内实现（任意光标位置 + rAF 节流）：
 *   # 应用层面板 → 打开面板（运行 / 配置 / 会话列表）
 *   ~ Agent 资产 → 打开持久化资产面板（记忆架 / 知识墙）
 *   ！创作区     → 切换插件创作视图（角色 / 区域 / 概念 / 物品 …）
 *   / 指令+技能  → 立即执行指令（模式切换 / 帮助）；技能转 Chip 随消息发送
 *   @ 引用       → 从世界设定实体库异步拉列表 → Chip 随消息发送
 *
 * # / ~ 面板为静态定义；！创作区由 buildSummonItems 从插件视图注册表动态生成；
 * @ 引用由 getReferenceEntries 从实体类型注册表动态生成。
 */
import type { ChatMode } from '@worldsmith/shared-composables/agent/useAgent'
import { entitySchemaRegistry } from '@worldsmith/entity-core'

export type { ChatMode }

export type SummonKind = 'panel' | 'asset' | 'region' | 'skill' | 'command' | 'reference' | 'pipeline'

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
export const SUMMON_PREFIXES = ['#', '/', '！', '!', '~', '@'] as const

/** 对话模式枚举（与 space-store ChatMode 对齐，供 /模式 二级菜单） */
export const CHAT_MODE_ENUM: ChatMode[] = ['deep', 'explore', 'task']

/**
 * 应用层面板（#）——静态定义，打开国际化控制器面板。
 * payload 与 space-store 右侧面板/侧边栏操作对齐。
 */
export const APP_PANELS: SummonItem[] = [
  { id: 'panel-exec', prefix: '#', name: '运行面板', description: '打开运行面板（轨迹/活动/计划）', icon: 'chart', kind: 'panel', payload: 'exec' },
  { id: 'panel-config', prefix: '#', name: '配置面板', description: '打开配置面板（记忆/人格）', icon: 'settings', kind: 'panel', payload: 'config' },
  { id: 'panel-sessions', prefix: '#', name: '会话列表', description: '打开会话侧边栏', icon: 'chat', kind: 'panel', payload: 'sessions' },
]

/**
 * Agent 持久化资产（~）——静态定义，打开资产面板。
 * knowledge 并入侧边栏 Tab，memory 为配置面板内记忆子页。
 */
export const AGENT_ASSETS: SummonItem[] = [
  { id: 'asset-knowledge', prefix: '~', name: '知识墙', description: '打开知识墙（侧边栏）', icon: 'book', kind: 'asset', payload: 'knowledge' },
  { id: 'asset-memory', prefix: '~', name: '记忆架', description: '打开记忆架（配置面板）', icon: 'brain', kind: 'asset', payload: 'memory' },
]

/** 指令（/ 立即执行）——模式切换 / 帮助 */
export const COMMAND_ITEMS: SummonItem[] = [
  {
    id: 'cmd-mode',
    prefix: '/',
    name: '模式',
    description: '切换对话模式（深度/探索/任务）',
    icon: 'chat',
    kind: 'command',
    payload: 'chatMode',
    params: [{ type: 'enum', enum_values: [...CHAT_MODE_ENUM] }],
  },
  {
    id: 'cmd-help',
    prefix: '/',
    name: '帮助',
    description: '查看召唤指令说明',
    icon: 'help',
    kind: 'command',
    payload: 'help',
  },
]

/** 技能（/ Chip，随消息发送） */
export const SKILL_ITEMS: SummonItem[] = [
  { id: 'skill-detail', prefix: '/', name: '深度解析', description: '逐步深入分析问题', icon: 'brain', kind: 'skill', payload: '请逐步深入分析：' },
  { id: 'skill-brainstorm', prefix: '/', name: '创意发散', description: '头脑风暴多种可能', icon: 'lightbulb', kind: 'skill', payload: '请进行创意发散：' },
  { id: 'skill-summarize', prefix: '/', name: '精炼总结', description: '提取核心要点', icon: 'list', kind: 'skill', payload: '请精炼总结：' },
  { id: 'skill-code', prefix: '/', name: '代码生成', description: '生成代码实现', icon: 'code', kind: 'skill', payload: '请生成代码：' },
  { id: 'skill-outline', prefix: '/', name: '大纲', description: '生成结构化大纲', icon: 'outline', kind: 'skill', payload: '请先生成大纲：' },
]

/**
 * 四管线（/ Chip，随消息发送，force_pipeline 强制路由）
 *
 * A3 Routing 四管线：payload 注入 `/管线` 前缀，作为消息首 token，
 * 后端 `extract_force_pipeline` 命中后跳过 LLM 意图分类直接路由到对应管线。
 * 非强约束：仅当消息首 token 命中时生效，其余走 LLM(3s 超时降级关键词)。
 */
export const PIPELINE_ITEMS: SummonItem[] = [
  { id: 'pipeline-query', prefix: '/', name: '查询', description: '强制查询管线：事实检索、快速问答', icon: 'search', kind: 'pipeline', payload: '/查询 ' },
  { id: 'pipeline-research', prefix: '/', name: '研究', description: '强制研究管线：深度调研、文献综述', icon: 'book-open', kind: 'pipeline', payload: '/调研 ' },
  { id: 'pipeline-experiment', prefix: '/', name: '实验', description: '强制实验管线：数据分析、代码计算', icon: 'flask-conical', kind: 'pipeline', payload: '/分析 ' },
  { id: 'pipeline-compose', prefix: '/', name: '创作', description: '强制创作管线：写作、润色、内容生成', icon: 'pen-line', kind: 'pipeline', payload: '/写作 ' },
  // M4-3（A1/C0-15 契约发现）：编排模式从 patternRegistry 注入命令菜单——按模式直发对应 run_*
  { id: 'pipeline-plan', prefix: '/', name: '规划执行', description: '强制规划管线：计划→执行→评审收敛', icon: 'task', kind: 'pipeline', payload: '/plan ' },
  { id: 'pipeline-tot', prefix: '/', name: '思维树探索', description: '强制 ToT：分支式思维探索（解多解/难题）', icon: 'mindmap', kind: 'pipeline', payload: '/tot ' },
  { id: 'pipeline-got', prefix: '/', name: '思维图聚合', description: '强制 GoT：多源聚合推理与对比', icon: 'workflow', kind: 'pipeline', payload: '/got ' },
  { id: 'pipeline-supervisor', prefix: '/', name: '监督委派', description: '强制 Supervisor：拆分子任务委派子 Agent', icon: 'handshake', kind: 'pipeline', payload: '/supervisor ' },
  { id: 'pipeline-multi', prefix: '/', name: '多智能体协作', description: '强制 MultiAgent：黑板协作多智能体解法', icon: 'users', kind: 'pipeline', payload: '/multi ' },
]

/** 创作区视图源（！）——由插件视图注册表驱动，见 buildSummonItems */
export interface CreationViewSource {
  id: string
  label: string
  icon: string
}

/**
 * 统一构建全部召唤条目（D1 分层）。
 * 传入插件视图注册表（pluginStore.views 或 pluginAPI.getViews()）作为 ！创作区来源，
 * 与静态 # 面板 / ~ 资产 / / 指令+技能 合并；@ 引用由 getReferenceEntries 单独动态生成。
 */
export function buildSummonItems(creationViews: CreationViewSource[] = []): SummonItem[] {
  const items: SummonItem[] = [
    ...APP_PANELS,
    ...AGENT_ASSETS,
    ...COMMAND_ITEMS,
    // I2 修复：编排模式项提前到技能之前（原在 SKILL_ITEMS 尾部，打 / 首屏看不到 /plan 等 5 项）
    ...PIPELINE_ITEMS,
    ...SKILL_ITEMS,
  ]
  for (const v of creationViews) {
    items.push({
      id: `region-${v.id}`,
      prefix: '！',
      name: v.label,
      description: '切换到创作视图',
      icon: v.icon || 'layout',
      kind: 'region',
      payload: v.id,
    })
  }
  return items
}

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
