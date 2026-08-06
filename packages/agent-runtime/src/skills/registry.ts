export interface OutputPreference {
  channel: 'chat' | 'a2ui' | 'plugin' | 'file'
  component?: string
  plugin?: string
  condition?: string
}

export interface PluginToolBinding {
  pluginId: string
  tools: string[]
  capabilities?: string[]
}

export interface SkillMeta {
  id: string
  name: string
  icon: string
  description: string
  category: 'domain' | 'action' | 'persona'
  enabled: boolean
  promptFile?: string
  allowedTools: string[]
  baseTools: string[]
  examples?: string[]
  references?: string[]
  triggers?: string[]
  outputPreferences?: OutputPreference[]
  relatedPlugins?: string[]
  pluginTools?: PluginToolBinding[]
  tags?: string[]
  priority?: number
  autoActivate?: boolean
  visibility: SkillVisibility
  version: string
  capabilities?: import('../toolbus/capability-types').SkillCapabilityBinding
  schemaContext?: import('../toolbus/capability-types').SkillSchemaContext
}

export type SkillVisibility = 'always' | 'advanced' | 'developer' | 'hidden'

export const SKILL_META_REQUIRED_FIELDS: (keyof SkillMeta)[] = [
  'id', 'name', 'icon', 'description', 'category', 'enabled',
  'visibility', 'version', 'promptFile', 'allowedTools', 'baseTools',
]

/** Skill 注册中心：技能元数据/工具白名单/工具合并/提示词生成/一致性校验，详细见 docs/details/注释/packages/agent-runtime/skills-registry.md */

export const ALWAYS_AVAILABLE_TOOLS = [
  'entity_list', 'entity_get', 'content_search', 'relation_list',
  'entity_suggest_field', 'entity_smart_fill', 'entity_get_context',
  'daily_report', 'consistency_check',
  'memory_store', 'memory_recall', 'memory_delete',
  'kb_write', 'kb_read', 'kb_list', 'kb_search', 'kb_delete', 'kb_extract', 'kb_reflect', 'kb_link', 'kb_init',
  'project_export', 'project_import',
  'load_skill',
  'output_table', 'output_choice', 'output_code', 'output_entity_card',
  'output_alert', 'output_stat', 'output_list', 'output_progress',
  'output_comparison', 'output_timeline', 'output_image', 'output_accordion',
  'vision_analyze', 'list_vision_images',
  'image_generate', 'image_gen_config', 'image_list', 'image_show',
  'read_file', 'clipboard_read', 'clipboard_write', 'notify',
  // 编码 Agent 标准工具集
  'read_file', 'write_file', 'edit_file', 'search_files', 'list_directory',
  'execute_command', 'shell_session', 'web_search', 'web_fetch',
]

// SKILL_REGISTRY 静态数据按类别拆分至 skills/data/（纯静态数据与逻辑分离），合并顺序与原内联数组一致
import { getSkillVisibility } from './data/visibility'
import { CREATION_SKILLS } from './data/creation'
import { ANALYSIS_SKILLS } from './data/analysis'
import { DEVELOPMENT_SKILLS } from './data/development'
import { COMMUNICATION_SKILLS } from './data/communication'
import { WORLDBUILDING_SKILLS } from './data/worldbuilding'
import { OTHER_SKILLS } from './data/other'

export const SKILL_REGISTRY: SkillMeta[] = [
  ...CREATION_SKILLS,
  ...ANALYSIS_SKILLS,
  ...DEVELOPMENT_SKILLS,
  ...COMMUNICATION_SKILLS,
  ...WORLDBUILDING_SKILLS,
  ...OTHER_SKILLS,
]

/**
 * 返回始终可用工具列表的副本
 *
 * 始终可用工具不依赖于任何技能激活状态，所有技能均可访问这些基础工具。
 * 返回的是数组浅拷贝，避免外部修改影响内部状态。
 */
export function getAlwaysAvailableTools(): string[] {
  return [...ALWAYS_AVAILABLE_TOOLS]
}

export function getEnabledSkills(): SkillMeta[] {
  const disabled = loadDisabledSkills()
  return getAllRegisteredSkills().filter(s => !disabled.includes(s.id))
}

export function getAllSkills(): SkillMeta[] {
  const disabled = loadDisabledSkills()
  return getAllRegisteredSkills().map(s => ({
    ...s,
    enabled: !disabled.includes(s.id),
  }))
}

export function toggleSkill(skillId: string): boolean {
  const disabled = loadDisabledSkills()
  const idx = disabled.indexOf(skillId)
  if (idx >= 0) {
    disabled.splice(idx, 1)
  } else {
    disabled.push(skillId)
  }
  saveDisabledSkills(disabled)
  return idx < 0
}

function loadDisabledSkills(): string[] {
  try {
    const raw = localStorage.getItem('agent_disabled_skills')
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function saveDisabledSkills(ids: string[]): void {
  try {
    localStorage.setItem('agent_disabled_skills', JSON.stringify(ids))
  } catch {}
}

export function findSkillById(id: string): SkillMeta | undefined {
  return getAllRegisteredSkills().find(s => s.id === id)
}

export function findSkillByToolName(toolName: string): SkillMeta | undefined {
  return getAllRegisteredSkills().find(s => s.allowedTools.includes(toolName))
}

export const CAPABILITY_TO_TOOL: Record<string, string> = {
  'ui.output.table': 'output_table',
  'ui.output.choice': 'output_choice',
  'ui.output.code': 'output_code',
  'ui.output.entity-card': 'output_entity_card',
  'ui.output.alert': 'output_alert',
  'ui.output.stat': 'output_stat',
  'ui.output.list': 'output_list',
  'ui.output.progress': 'output_progress',
  'ui.output.comparison': 'output_comparison',
  'ui.output.timeline': 'output_timeline',
  'ui.output.image': 'output_image',
  'ui.output.accordion': 'output_accordion',
}

/** 根据激活技能 ID 合并可用工具集（基础工具 + baseTools/capabilities 映射），详细见 docs/details/注释/packages/agent-runtime/skills-registry.md */
export function resolveToolNames(activeSkillIds: string[]): string[] {
  const tools = new Set(ALWAYS_AVAILABLE_TOOLS)
  for (const id of activeSkillIds) {
    const skill = getAllRegisteredSkills().find(s => s.id === id)
    if (!skill) continue
    for (const t of skill.baseTools) tools.add(t)
    if (skill.capabilities) {
      for (const t of skill.capabilities.internal) tools.add(CAPABILITY_TO_TOOL[t] || t)
      for (const t of skill.capabilities.cli) tools.add(CAPABILITY_TO_TOOL[t] || t)
      for (const t of skill.capabilities.mcp) tools.add(CAPABILITY_TO_TOOL[t] || t)
    } else {
      for (const t of skill.allowedTools) tools.add(t)
    }
  }
  return [...tools]
}

export function getVisibleSkills(developerMode: boolean, advancedMode: boolean): SkillMeta[] {
  const enabled = getEnabledSkills()
  return enabled.filter(s => {
    if (s.visibility === 'hidden') return false
    if (s.visibility === 'always') return true
    if (s.visibility === 'advanced' && (advancedMode || developerMode)) return true
    if (s.visibility === 'developer' && developerMode) return true
    return false
  })
}

/** 生成技能列表的系统提示词（按 category 分组 + 隐藏提示），详细见 docs/details/注释/packages/agent-runtime/skills-registry.md */
export function buildSkillIndexPrompt(developerMode = false, advancedMode = false): string {
  const visible = getVisibleSkills(developerMode, advancedMode)
  const domainSkills = visible.filter(s => s.category === 'domain')
  const actionSkills = visible.filter(s => s.category === 'action')
  const personaSkills = visible.filter(s => s.category === 'persona')

  const sections: string[] = [
    '## 可用技能 (Available Skills)',
    '',
    '你可以通过调用 `load_skill` 工具激活技能。当用户任务匹配技能描述时，主动激活对应技能。',
    '激活技能后，你将获得该技能的详细工作流程、质量标准和专业方法论。',
  ]

  if (domainSkills.length > 0) {
    sections.push('', '### 世界观领域', '')
    for (const s of domainSkills.sort((a, b) => (b.priority || 0) - (a.priority || 0))) {
      sections.push(`- **${s.id}**: ${s.description}`)
    }
  }

  if (actionSkills.length > 0) {
    sections.push('', '### 通用操作', '')
    for (const s of actionSkills.sort((a, b) => (b.priority || 0) - (a.priority || 0))) {
      sections.push(`- **${s.id}**: ${s.description}`)
    }
  }

  if (personaSkills.length > 0) {
    sections.push('', '### 人格 / 角色', '')
    for (const s of personaSkills) {
      sections.push(`- **${s.id}**: ${s.description}`)
    }
  }

  const hiddenCount = getEnabledSkills().length - visible.length
  if (hiddenCount > 0) {
    sections.push('', `> ${hiddenCount} 个开发者/高级工具已隐藏，可在设置中开启。`)
  }

  return sections.join('\n')
}

/**
 * 生成输出通道偏好的提示词
 *
 * 收集所有激活技能的 outputPreferences，按通道（chat/a2ui/plugin/file）
 * 生成带条件的输出偏好指南。若激活技能无输出偏好配置则返回空字符串。
 *
 * @param activeSkillIds - 当前激活的技能 ID 数组
 * @returns 格式化的输出偏好指南文本，无偏好时返回空字符串
 */
export function buildOutputGuidePrompt(activeSkillIds: string[]): string {
  const skills = activeSkillIds
    .map(id => findSkillById(id))
    .filter((s): s is SkillMeta => s != null)

  const prefs = skills.flatMap(s => s.outputPreferences || [])
  if (prefs.length === 0) return ''

  const channelMap: Record<string, string> = {
    chat: '💬 聊天文本',
    a2ui: '🧩 A2UI 组件',
    plugin: '🔌 插件写入',
    file: '📁 文件导出',
  }

  const lines = [
    '## 输出指南 (Output Guide)',
    '',
    '根据当前激活的技能，你的输出应遵循以下偏好：',
    '',
  ]

  for (const pref of prefs) {
    let line = `- ${channelMap[pref.channel] || pref.channel}`
    if (pref.component) line += ` → ${pref.component}`
    if (pref.plugin) line += ` → ${pref.plugin} 插件`
    if (pref.condition) line += `（当${pref.condition}）`
    lines.push(line)
  }

  lines.push('', '当不确定输出形式时，优先使用首选通道。复杂输出可组合多个通道。')
  return lines.join('\n')
}

/** 校验技能注册表一致性（必填字段/semver/visibility/重复 ID），详细见 docs/details/注释/packages/agent-runtime/skills-registry.md */
export function validateRegistryConsistency(): string[] {
  const warnings: string[] = []

  for (const skill of getAllRegisteredSkills()) {
    const missingFields = SKILL_META_REQUIRED_FIELDS.filter(f => {
      const v = skill[f]
      if (typeof v === 'string') return !v
      if (Array.isArray(v)) return false
      return v === undefined || v === null
    })
    if (missingFields.length > 0) {
      warnings.push(`[${skill.id}] Missing required fields: ${missingFields.join(', ')}`)
    }

    if (!skill.version) {
      warnings.push(`[${skill.id}] Missing version field`)
    } else if (!/^\d+\.\d+\.\d+/.test(skill.version)) {
      warnings.push(`[${skill.id}] Invalid version format: "${skill.version}", expected semver`)
    }

    if (!skill.visibility) {
      warnings.push(`[${skill.id}] Missing visibility field`)
    }

    const expectedVisibility = getSkillVisibility(skill.id)
    if (skill.visibility && skill.visibility !== expectedVisibility) {
      warnings.push(`[${skill.id}] Visibility mismatch: registry has "${skill.visibility}", expected "${expectedVisibility}"`)
    }

    if (skill.category === 'persona' && skill.visibility !== 'always') {
      warnings.push(`[${skill.id}] Persona skills should always have visibility: "always"`)
    }
  }

  const ids = getAllRegisteredSkills().map(s => s.id)
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i)
  if (dupes.length > 0) {
    warnings.push(`Duplicate skill IDs: ${[...new Set(dupes)].join(', ')}`)
  }

  return warnings
}

/** 任务3 接线：将本地 SKILL_REGISTRY 同步到全局 SkillRegistry，详细见 docs/details/注释/packages/agent-runtime/skills-registry.md */
import { getGlobalSkillRegistry } from '@worldsmith/agent-core'
import type { SkillDeclaration } from '@worldsmith/agent-core'
import { scanInstalledSkills } from './manifest'

let _skillsRegistered = false

// ── 已安装技能（Task 24 阶段1：Skills Store 动态加载） ──
/** 已安装技能列表（运行时从 app_data_dir/skills 扫描，初始为空） */
let _installedSkills: SkillMeta[] = []
/** 已安装技能 id → installDir 映射（loader 据此走 fs 加载分支） */
const _installedSkillDirs = new Map<string, string>()
/** initSkillRegistry 是否已完成（幂等守卫） */
let _skillRegistryInited = false

/** 返回内置 + 已安装的全部技能（合并视图） */
function getAllRegisteredSkills(): SkillMeta[] {
  return [...SKILL_REGISTRY, ..._installedSkills]
}

/** 判断技能是否为已安装技能（来自 Skills Store，需走 fs 加载） */
export function isInstalledSkill(skillId: string): boolean {
  return _installedSkillDirs.has(skillId)
}

/** 获取已安装技能的 installDir；非已安装技能返回 undefined */
export function getInstalledSkillDir(skillId: string): string | undefined {
  return _installedSkillDirs.get(skillId)
}

/** 将 SKILL_REGISTRY 同步到全局 SkillRegistry（幂等） */
export function registerSkillsToGlobalRegistry(): void {
  const registry = getGlobalSkillRegistry()
  // 幂等：先清空已注册技能
  for (const s of registry.getAll()) {
    registry.unregister(s.id)
  }
  // 转换 SkillMeta → SkillDeclaration 并注册
  const declarations: SkillDeclaration[] = getAllRegisteredSkills().map(s => ({
    id: s.id,
    name: s.name,
    icon: s.icon,
    description: s.description,
    category: s.category,
    enabled: s.enabled,
    visibility: s.visibility,
    version: s.version,
    allowedTools: s.allowedTools,
    baseTools: s.baseTools,
    promptFile: s.promptFile,
    references: s.references,
    triggers: s.triggers,
    outputPreferences: s.outputPreferences,
    relatedPlugins: s.relatedPlugins,
    tags: s.tags,
    priority: s.priority,
    autoActivate: s.autoActivate,
    examples: s.examples,
  }))
  registry.registerAll(declarations)
  _skillsRegistered = true
}

/** 是否已注册到全局 SkillRegistry */
export function isSkillsRegisteredToGlobal(): boolean {
  return _skillsRegistered
}

/** 初始化技能注册表：扫描已安装技能并合并（幂等），详细见 docs/details/注释/packages/agent-runtime/skills-registry.md */
export async function initSkillRegistry(): Promise<void> {
  const entries = await scanInstalledSkills()
  const builtinIds = new Set(SKILL_REGISTRY.map(s => s.id))

  _installedSkills = []
  _installedSkillDirs.clear()

  for (const { meta, installDir } of entries) {
    if (builtinIds.has(meta.id)) continue // 内置优先，跳过 id 冲突
    if (_installedSkillDirs.has(meta.id)) continue // 防同 id 重复
    _installedSkills.push(meta)
    _installedSkillDirs.set(meta.id, installDir)
  }

  // 重新注册到全局 SkillRegistry（包含已安装技能）
  registerSkillsToGlobalRegistry()
  _skillRegistryInited = true
}

/** initSkillRegistry 是否已完成 */
export function isSkillRegistryInited(): boolean {
  return _skillRegistryInited
}

// 模块加载时自动注册（确保全局 SkillRegistry 始终有数据）
registerSkillsToGlobalRegistry()
