/**
 * WorldSea Skill sidecar（技能目录内 `worldsea.skill.json`）：编排类私有字段的承载位（D2 裁定），详细见 docs/details/注释/packages/agent-runtime/skills-protocol.md
 *
 * 宽容解析（坏 JSON / 非法字段 → null 降级，不阻断加载）；读取时机 = 已安装技能扫描。
 */

import type { SkillCapabilityBinding, SkillSchemaContext } from '../toolbus/capability-types'
import type { OutputPreference, PluginToolBinding, SkillVisibility } from './registry'

/** sidecar 文件名（技能目录内） */
export const WORLDSEA_SKILL_SIDECAR_FILE = 'worldsea.skill.json'

/** WorldSea 私有字段承载（全部可选；缺失即用默认值） */
export interface WorldSeaSkillSidecar {
  icon?: string
  category?: 'domain' | 'action' | 'persona'
  visibility?: SkillVisibility
  priority?: number
  autoActivate?: boolean
  triggers?: string[]
  tags?: string[]
  capabilities?: SkillCapabilityBinding
  schemaContext?: SkillSchemaContext
  outputPreferences?: OutputPreference[]
  relatedPlugins?: string[]
  pluginTools?: PluginToolBinding[]
}

/** 仅接受字符串数组（过滤非字符串项） */
function asStringArray(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const arr = raw.filter((v): v is string => typeof v === 'string')
  return arr.length > 0 ? arr : undefined
}

/** 仅接受 string→string 数组映射（capabilities 三通道） */
function asCapabilities(raw: unknown): SkillCapabilityBinding | undefined {
  if (raw == null || typeof raw !== 'object') return undefined
  const obj = raw as Record<string, unknown>
  const internal = asStringArray(obj.internal)
  const cli = asStringArray(obj.cli)
  const mcp = asStringArray(obj.mcp)
  if (!internal && !cli && !mcp) return undefined
  return { internal: internal ?? [], cli: cli ?? [], mcp: mcp ?? [] }
}

/** schemaContext：entityTypes 必需，fieldPolicy 缺省 prefer-defined（与 parser 口径一致） */
function asSchemaContext(raw: unknown): SkillSchemaContext | undefined {
  if (raw == null || typeof raw !== 'object') return undefined
  const obj = raw as Record<string, unknown>
  const entityTypes = asStringArray(obj.entityTypes)
  if (!entityTypes) return undefined
  const policy = obj.fieldPolicy
  const fieldPolicy = policy === 'strict' || policy === 'open' || policy === 'prefer-defined' ? policy : 'prefer-defined'
  return { entityTypes, fieldPolicy }
}

/** outputPreferences：按通道白名单过滤（通道/组件/插件/条件均为字符串） */
function asOutputPreferences(raw: unknown): OutputPreference[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const channels = ['chat', 'a2ui', 'plugin', 'file']
  const prefs: OutputPreference[] = []
  for (const item of raw) {
    if (item == null || typeof item !== 'object') continue
    const obj = item as Record<string, unknown>
    if (typeof obj.channel !== 'string' || !channels.includes(obj.channel)) continue
    prefs.push({
      channel: obj.channel as OutputPreference['channel'],
      component: typeof obj.component === 'string' ? obj.component : undefined,
      plugin: typeof obj.plugin === 'string' ? obj.plugin : undefined,
      condition: typeof obj.condition === 'string' ? obj.condition : undefined,
    })
  }
  return prefs.length > 0 ? prefs : undefined
}

/** pluginTools：pluginId 必需，tools 字符串数组 */
function asPluginToolBindings(raw: unknown): PluginToolBinding[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const bindings: PluginToolBinding[] = []
  for (const item of raw) {
    if (item == null || typeof item !== 'object') continue
    const obj = item as Record<string, unknown>
    if (typeof obj.pluginId !== 'string' || !Array.isArray(obj.tools)) continue
    bindings.push({
      pluginId: obj.pluginId,
      tools: obj.tools.filter((t): t is string => typeof t === 'string'),
      capabilities: asStringArray(obj.capabilities),
    })
  }
  return bindings.length > 0 ? bindings : undefined
}

/**
 * 解析 sidecar 文本（宽容：坏 JSON / 非对象 / 无有效字段 → null，不抛错）
 *
 * @param raw 文件文本（null/undefined 直接返回 null）
 */
export function parseWorldSeaSkillSidecar(raw: string | null | undefined): WorldSeaSkillSidecar | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const obj = parsed as Record<string, unknown>

  const sidecar: WorldSeaSkillSidecar = {
    icon: typeof obj.icon === 'string' && obj.icon.trim() ? obj.icon.trim() : undefined,
    category:
      obj.category === 'domain' || obj.category === 'action' || obj.category === 'persona'
        ? obj.category
        : undefined,
    visibility:
      obj.visibility === 'always' ||
      obj.visibility === 'advanced' ||
      obj.visibility === 'developer' ||
      obj.visibility === 'hidden'
        ? obj.visibility
        : undefined,
    priority: typeof obj.priority === 'number' && Number.isFinite(obj.priority) ? obj.priority : undefined,
    autoActivate: typeof obj.autoActivate === 'boolean' ? obj.autoActivate : undefined,
    triggers: asStringArray(obj.triggers),
    tags: asStringArray(obj.tags),
    capabilities: asCapabilities(obj.capabilities),
    schemaContext: asSchemaContext(obj.schemaContext),
    outputPreferences: asOutputPreferences(obj.outputPreferences),
    relatedPlugins: asStringArray(obj.relatedPlugins),
    pluginTools: asPluginToolBindings(obj.pluginTools),
  }

  const hasAny = Object.values(sidecar).some((v) => v !== undefined)
  return hasAny ? sidecar : null
}