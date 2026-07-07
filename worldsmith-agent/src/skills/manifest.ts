/**
 * 已安装技能 Manifest 解析器（Task 24 阶段1）
 *
 * 从 app_data_dir/skills/ 目录扫描已安装技能（Skills Store 通过 Git 安装），
 * 解析其 manifest（skill.yaml 优先，SKILL.md frontmatter 降级），转换为 SkillMeta。
 *
 * 已安装技能目录结构：
 *   <app_data_dir>/skills/
 *     my-skill/
 *       skill.yaml          # 完整 manifest（优先）
 *       SKILL.md            # 提示词（frontmatter 作为 manifest 降级源）
 *       references/         # 参考文档
 *       assets/             # 资源文件
 *       instructions.md     # 备选提示词
 *
 * 设计要点：
 * - 仅在 Tauri 环境工作；非 Tauri（如 vitest）返回空数组，零回归。
 * - 不依赖 loader.ts / registry.ts，避免循环依赖。
 * - 不依赖 js-yaml：内置极简 YAML 解析器（标量 + 列表），覆盖 skill.yaml 用例。
 * - 禁止 emoji 图标：检测到 emoji 时替换为默认图标（项目规范）。
 */

import { isTauri } from '../execution'
import type { SkillMeta } from './registry'

/** Tauri invoke 函数类型 */
type TauriInvoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>

/** FsEntry：与 Rust 端 cmd_fs_list 返回结构对齐 */
interface FsEntry {
  name: string
  path: string
  is_dir: boolean
  size: number
  modified: string | null
}

/** Tauri invoke 缓存（与 fs-tools.ts 一致的模式，避免重复动态 import） */
let _invoke: TauriInvoke | null = null
async function getTauriInvoke(): Promise<TauriInvoke | null> {
  if (_invoke) return _invoke
  if (!isTauri()) return null
  try {
    const api = await import('@tauri-apps/api/core')
    _invoke = api.invoke
    return _invoke
  } catch {
    return null
  }
}

/** 已安装技能扫描结果 */
export interface InstalledSkillEntry {
  meta: SkillMeta
  /** skills/ 下的子目录名（loader 据此定位文件） */
  installDir: string
}

/** 获取已安装技能根目录绝对路径；非 Tauri 环境返回 null */
export async function getInstalledSkillsDir(): Promise<string | null> {
  const invoke = await getTauriInvoke()
  if (!invoke) return null
  try {
    return (await invoke('cmd_skills_get_dir')) as string
  } catch {
    return null
  }
}

/** 读取文件文本（utf-8）；失败返回 null */
async function readFileText(absPath: string): Promise<string | null> {
  const invoke = await getTauriInvoke()
  if (!invoke) return null
  try {
    return (await invoke('cmd_fs_read', { path: absPath, encoding: 'utf-8' })) as string
  } catch {
    return null
  }
}

/** 合并路径片段（避免依赖 node path 模块，保持浏览器兼容） */
function joinPath(base: string, ...parts: string[]): string {
  return [base.replace(/\/+$/, ''), ...parts].join('/')
}

/** Emoji 检测正则（项目规范：禁止 emoji 图标，改用 Naive UI 图标名） */
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u

/** 清洗图标：空或含 emoji 时回退到默认图标 'module-builder' */
function sanitizeIcon(icon: unknown): string {
  const s = typeof icon === 'string' ? icon.trim() : ''
  if (!s || EMOJI_RE.test(s)) return 'module-builder'
  return s
}

/**
 * 极简 YAML 解析器（标量 + 列表）
 *
 * 支持格式：
 *   key: value
 *   key: "quoted value"
 *   key:
 *     - item1
 *     - item2
 *
 * 不支持嵌套对象、多行字符串、锚点等复杂特性。
 * 仅用于 skill.yaml（格式简单、可控），非通用 YAML 解析器。
 */
function parseSimpleYaml(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const lines = content.split('\n')
  let currentList: unknown[] | null = null

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '')
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    // 列表项（必须在某个 key 的列表上下文中）
    if (trimmed.startsWith('- ') && currentList !== null) {
      currentList.push(parseScalar(trimmed.slice(2).trim()))
      continue
    }

    // key: value
    const colonIdx = trimmed.indexOf(':')
    if (colonIdx < 0) continue
    const key = trimmed.slice(0, colonIdx).trim()
    let val = trimmed.slice(colonIdx + 1).trim()

    // 移除行内注释（# 后，但不在引号内——简易处理）
    const hashIdx = val.indexOf('#')
    if (hashIdx >= 0 && !val.startsWith('"') && !val.startsWith("'")) {
      val = val.slice(0, hashIdx).trim()
    }

    if (val === '') {
      // 列表头：key:\n  - item
      currentList = []
      result[key] = currentList
    } else {
      result[key] = parseScalar(val)
      currentList = null
    }
  }
  return result
}

/** 解析标量值：去引号、转布尔/数字/字符串 */
function parseScalar(val: string): unknown {
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    return val.slice(1, -1)
  }
  if (val === 'true') return true
  if (val === 'false') return false
  if (val === 'null' || val === '~') return null
  if (/^-?\d+$/.test(val)) return parseInt(val, 10)
  if (/^-?\d+\.\d+$/.test(val)) return parseFloat(val)
  return val
}

/** 从 SKILL.md 提取 frontmatter 基本标量字段（降级路径） */
function extractFrontmatterFields(mdContent: string): Record<string, string> {
  const match = mdContent.match(/^---\s*\n([\s\S]*?)\n---/)
  if (!match) return {}
  const yaml = match[1]
  const fields: Record<string, string> = {}
  for (const line of yaml.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-')) continue
    const colonIdx = trimmed.indexOf(':')
    if (colonIdx < 0) continue
    const key = trimmed.slice(0, colonIdx).trim()
    const val = trimmed.slice(colonIdx + 1).trim()
    // 降级路径仅提取标量字段；capabilities 等列表字段由 skill.yaml 主路径处理
    if (['id', 'name', 'description', 'icon', 'category', 'priority', 'auto-activate'].includes(key)) {
      fields[key] = val
    }
  }
  return fields
}

/** 校验 category 合法性 */
function normalizeCategory(raw: unknown): SkillMeta['category'] {
  const s = String(raw)
  return s === 'domain' || s === 'action' || s === 'persona' ? s : 'action'
}

/** YAML 对象 → SkillMeta */
function yamlToSkillMeta(yaml: Record<string, unknown>, installDir: string): SkillMeta {
  const meta: SkillMeta = {
    id: String(yaml.id || installDir),
    name: String(yaml.name || yaml.id || installDir),
    icon: sanitizeIcon(yaml.icon),
    description: String(yaml.description || ''),
    category: normalizeCategory(yaml.category),
    enabled: true,
    visibility: 'always',
    version: String(yaml.version || '1.0.0'),
    promptFile: String(yaml.promptFile || 'SKILL.md'),
    baseTools: Array.isArray(yaml.baseTools) ? yaml.baseTools.map(String) : [],
    allowedTools: Array.isArray(yaml.allowedTools) ? yaml.allowedTools.map(String) : [],
    triggers: Array.isArray(yaml.triggers) ? yaml.triggers.map(String) : undefined,
    tags: Array.isArray(yaml.tags) ? yaml.tags.map(String) : undefined,
    examples: Array.isArray(yaml.examples) ? yaml.examples.map(String) : undefined,
    priority: typeof yaml.priority === 'number' ? yaml.priority : 5,
    autoActivate: typeof yaml.autoActivate === 'boolean' ? yaml.autoActivate : undefined,
  }
  return meta
}

/** SKILL.md frontmatter → SkillMeta（降级路径，字段有限） */
function mdToSkillMeta(mdContent: string, installDir: string): SkillMeta {
  const fm = extractFrontmatterFields(mdContent)
  return {
    id: fm.id || installDir,
    name: fm.name || fm.id || installDir,
    icon: sanitizeIcon(fm.icon),
    description: fm.description || '',
    category: normalizeCategory(fm.category),
    enabled: true,
    visibility: 'always',
    version: '1.0.0',
    promptFile: 'SKILL.md',
    baseTools: [],
    allowedTools: [],
    priority: fm.priority ? Number(fm.priority) || 5 : 5,
    autoActivate: fm['auto-activate'] === 'true' || undefined,
  }
}

/**
 * 读取已安装技能目录下的文件文本
 *
 * @param installDir skills/ 下的子目录名
 * @param relativePath 相对于 installDir 的文件路径（如 'SKILL.md'、'references/xxx.md'、'assets/yyy.yaml'）
 * @returns 文件文本内容；非 Tauri 环境或文件不存在返回 null
 */
export async function readInstalledSkillFile(installDir: string, relativePath: string): Promise<string | null> {
  const skillsDir = await getInstalledSkillsDir()
  if (!skillsDir) return null
  return readFileText(joinPath(skillsDir, installDir, relativePath))
}

/**
 * 扫描已安装技能目录，返回所有有效技能的 manifest
 *
 * 流程：
 * 1. 获取 skills 根目录（cmd_skills_get_dir）
 * 2. 列举子目录（cmd_fs_list）
 * 3. 每个子目录优先读 skill.yaml，降级读 SKILL.md frontmatter
 * 4. 解析为 SkillMeta
 *
 * 非 Tauri 环境或目录为空时返回空数组（零回归）。
 */
export async function scanInstalledSkills(): Promise<InstalledSkillEntry[]> {
  const skillsDir = await getInstalledSkillsDir()
  if (!skillsDir) return []

  const invoke = await getTauriInvoke()
  if (!invoke) return []

  let entries: FsEntry[]
  try {
    entries = (await invoke('cmd_fs_list', { path: skillsDir, recursive: false })) as FsEntry[]
  } catch {
    return []
  }
  if (!Array.isArray(entries)) return []

  const result: InstalledSkillEntry[] = []
  for (const entry of entries) {
    if (!entry.is_dir) continue
    const installDir = entry.name

    // 优先 skill.yaml（完整 manifest）
    let meta: SkillMeta | null = null
    const yamlContent = await readFileText(joinPath(skillsDir, installDir, 'skill.yaml'))
    if (yamlContent) {
      try {
        meta = yamlToSkillMeta(parseSimpleYaml(yamlContent), installDir)
      } catch {
        meta = null
      }
    }

    // 降级到 SKILL.md frontmatter
    if (!meta) {
      const mdContent = await readFileText(joinPath(skillsDir, installDir, 'SKILL.md'))
      if (mdContent) {
        meta = mdToSkillMeta(mdContent, installDir)
      }
    }

    if (meta) {
      result.push({ meta, installDir })
    }
  }
  return result
}
