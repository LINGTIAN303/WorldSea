/** SKILL.md / skill.yaml frontmatter 解析器（供 loader/manifest/platform-adapters 共用），详细见 docs/details/注释/packages/agent-runtime/skills-parser.md */
// 2026-09-17 协议基座升级（S1）：支持 flow 风格数组（单行 `[a, b]` 与多行 `[\n a,\n b,\n]`）
// 与分隔符字符串（规范 allowed-tools 为空格分隔）、metadata 映射（string→string）、按缩进判定嵌套键。
// 校验规则不在此处（解析保持宽容），见同目录 validator.ts。

import type { SkillCapabilityBinding, SkillSchemaContext } from '../toolbus/capability-types'

/** 解析后的 SKILL.md / skill.yaml 数据结构 */
export interface ParsedSkillMd {
  frontmatter: {
    name: string
    description: string
    allowedTools: string[]
    baseTools: string[]
    capabilities?: SkillCapabilityBinding
    schemaContext?: SkillSchemaContext
    triggers?: string[]
    tags?: string[]
    priority?: number
    autoActivate?: boolean
    category?: 'domain' | 'action' | 'persona'
    icon?: string
    id?: string
    license?: string
    compatibility?: string
    version?: string
    enabled?: boolean
    metadata?: Record<string, string>
  }
  body: string
}

/** 列表型目标（同一时刻只有一个列表处于收集中） */
type ListTarget =
  | 'allowedTools'
  | 'baseTools'
  | 'capInternal'
  | 'capCli'
  | 'capMcp'
  | 'schemaEntityTypes'
  | 'triggers'
  | 'tags'

/** 去掉两端引号（YAML 标量常见包裹） */
function stripQuotes(raw: string): string {
  const s = raw.trim()
  if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
    return s.slice(1, -1)
  }
  return s
}

/**
 * 列表键的 inline 取值解析
 *
 * 支持三种形态（协议基座 S1）：
 * - flow 数组：`[a, b, c]`（也接受空数组 `[]`）
 * - 空格/逗号分隔字符串：`Bash(git:*) Read`（规范 allowed-tools 形态）
 * - 逗号分隔字符串：`a, b`（tags/triggers 等惯用形态）
 */
function splitInlineList(val: string, mode: 'space-or-comma' | 'comma'): string[] {
  const v = val.trim()
  if (!v || v === '[]') return []
  if (v.startsWith('[') && v.endsWith(']')) return splitFlowItems(v.slice(1, -1))
  const parts = mode === 'comma' ? v.split(',') : v.split(/[\s,]+/)
  return parts.map((s) => stripQuotes(s)).filter(Boolean)
}

/** flow 序列内容 → 项数组（按逗号切分；容忍尾逗号与换行；项内逗号不做转义保护——简化解析器边界） */
function splitFlowItems(text: string): string[] {
  return text
    .split(',')
    .map((s) => stripQuotes(s.replace(/\s+/g, ' ')))
    .filter(Boolean)
}

/** 解析 YAML frontmatter（行级简化解析器；支持缩进嵌套、块式/单行 flow/多行 flow 列表），详细见 docs/details/注释/packages/agent-runtime/skills-parser.md */
export function parseFrontmatter(raw: string): ParsedSkillMd {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/)
  if (!match) {
    return {
      frontmatter: { name: '', description: '', allowedTools: [], baseTools: [] },
      body: raw,
    }
  }

  const yaml = match[1]
  const body = match[2]
  const fm: ParsedSkillMd['frontmatter'] = { name: '', description: '', allowedTools: [], baseTools: [] }

  const internalArr: string[] = []
  const cliArr: string[] = []
  const mcpArr: string[] = []
  const entityTypesArr: string[] = []
  const triggersArr: string[] = []
  const tagsArr: string[] = []
  const metadata: Record<string, string> = {}

  /** 当前收集中列表（null = 未处于列表收集态） */
  let pendingList: ListTarget | null = null
  /** 多行 flow 序列缓冲区（非 null 表示 `[` 已开启、等待 `]`） */
  let flowBuf: string | null = null
  // 嵌套父级（按缩进判定）
  let inCapabilities = false
  let inSchemaContext = false
  let inMetadata = false

  const pushItems = (target: ListTarget, items: string[]) => {
    if (items.length === 0) return
    switch (target) {
      case 'allowedTools': fm.allowedTools.push(...items); break
      case 'baseTools': fm.baseTools.push(...items); break
      case 'capInternal': internalArr.push(...items); break
      case 'capCli': cliArr.push(...items); break
      case 'capMcp': mcpArr.push(...items); break
      case 'schemaEntityTypes': entityTypesArr.push(...items); break
      case 'triggers': triggersArr.push(...items); break
      case 'tags': tagsArr.push(...items); break
    }
  }

  for (const line of yaml.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const isNested = /^\s/.test(line)

    // ── 列表收集态（块式 `- item` / 单行 flow `[a, b]` / 多行 flow）──
    if (flowBuf !== null && pendingList) {
      const end = trimmed.indexOf(']')
      flowBuf += ` ${end >= 0 ? trimmed.slice(0, end) : trimmed}`
      if (end >= 0) {
        pushItems(pendingList, splitFlowItems(flowBuf))
        flowBuf = null
        pendingList = null
      }
      continue
    }
    if (pendingList) {
      if (trimmed.startsWith('- ')) {
        pushItems(pendingList, [stripQuotes(trimmed.slice(2).trim())])
        continue
      }
      if (trimmed.startsWith('[')) {
        const end = trimmed.indexOf(']')
        if (end >= 0) {
          pushItems(pendingList, splitFlowItems(trimmed.slice(1, end)))
          pendingList = null
        } else {
          flowBuf = trimmed.slice(1)
        }
        continue
      }
      pendingList = null // 列表结束（遇到非列表行）
    }

    const colonIdx = trimmed.indexOf(':')
    if (colonIdx < 0) continue
    const key = trimmed.slice(0, colonIdx).trim()
    const val = stripQuotes(trimmed.slice(colonIdx + 1).trim())

    // ── 嵌套键（缩进 + 父级在位）：仅处理父级声明的子键 ──
    if (isNested) {
      if (inMetadata) {
        if (val !== '') metadata[key] = val
        continue
      }
      if (inCapabilities) {
        const target: ListTarget | null =
          key === 'internal' ? 'capInternal' : key === 'cli' ? 'capCli' : key === 'mcp' ? 'capMcp' : null
        if (target) {
          if (val) pushItems(target, splitInlineList(val, 'comma'))
          else pendingList = target
        }
        continue
      }
      if (inSchemaContext) {
        if (key === 'entity-types' || key === 'entityTypes') {
          if (val) pushItems('schemaEntityTypes', splitInlineList(val, 'comma'))
          else pendingList = 'schemaEntityTypes'
        }
        continue
      }
      continue // 无父级的缩进行：忽略（宽容解析）
    }

    // ── 顶层键 ──
    inCapabilities = false
    inSchemaContext = false
    inMetadata = false

    if (key === 'name') fm.name = val
    else if (key === 'description') fm.description = val
    else if (key === 'allowed-tools' || key === 'allowedTools') {
      // 规范：空格分隔字符串；兼容 flow 数组与块式
      if (val) fm.allowedTools.push(...splitInlineList(val, 'space-or-comma'))
      else pendingList = 'allowedTools'
    } else if (key === 'base-tools' || key === 'baseTools') {
      if (val) fm.baseTools.push(...splitInlineList(val, 'comma'))
      else pendingList = 'baseTools'
    } else if (key === 'license') fm.license = val
    else if (key === 'compatibility') fm.compatibility = val
    else if (key === 'id') fm.id = val
    else if (key === 'icon') fm.icon = val
    else if (key === 'version') fm.version = val
    else if (key === 'enabled') fm.enabled = val === 'true'
    else if (key === 'category' && ['domain', 'action', 'persona'].includes(val)) fm.category = val as ParsedSkillMd['frontmatter']['category']
    else if (key === 'priority') fm.priority = Number(val) || undefined
    else if (key === 'auto-activate' || key === 'autoActivate') fm.autoActivate = val === 'true'
    else if (key === 'capabilities') inCapabilities = true
    else if (key === 'schema-context' || key === 'schemaContext') inSchemaContext = true
    else if (key === 'metadata') inMetadata = true
    else if (key === 'triggers') {
      if (val) triggersArr.push(...splitInlineList(val, 'comma'))
      else pendingList = 'triggers'
    } else if (key === 'tags') {
      if (val) tagsArr.push(...splitInlineList(val, 'comma'))
      else pendingList = 'tags'
    }
  }

  if (internalArr.length > 0 || cliArr.length > 0 || mcpArr.length > 0) {
    fm.capabilities = { internal: internalArr, cli: cliArr, mcp: mcpArr }
  }
  if (entityTypesArr.length > 0) {
    fm.schemaContext = { entityTypes: entityTypesArr, fieldPolicy: 'prefer-defined' }
  }
  if (triggersArr.length > 0) fm.triggers = triggersArr
  if (tagsArr.length > 0) fm.tags = tagsArr
  if (Object.keys(metadata).length > 0) fm.metadata = metadata

  if (!fm.capabilities && fm.allowedTools.length > 0) {
    fm.capabilities = { internal: fm.allowedTools, cli: [], mcp: [] }
  }

  return { frontmatter: fm, body }
}