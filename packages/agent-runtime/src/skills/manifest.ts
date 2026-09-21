/** 已安装技能 Manifest 解析器：扫描 app_data_dir/skills 解析 skill.yaml/SKILL.md，详细见 docs/details/注释/packages/agent-runtime/skills-manifest.md */

import { isTauri } from '../execution'
import type { SkillMeta } from './registry'
import { parseFrontmatter } from './parser'
import type { ParsedSkillMd } from './parser'
import { parseWorldSeaSkillSidecar, WORLDSEA_SKILL_SIDECAR_FILE } from './sidecar'
import type { WorldSeaSkillSidecar } from './sidecar'
import { validateSkillFrontmatter } from './validator'
import type { SkillValidationIssue } from './validator'

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
/**
 * 端注入覆盖（风险点② 补桥，2026-08-30）：app 层把 transport.invoke 注入进来，
 * 使浏览器 HTTP 模式的 cmd_skills_get_dir / cmd_fs_* 路由到 /rpc 桥。
 * 本包端无关、不能 import transport，故用注入而非直接依赖。
 */
let _override: TauriInvoke | null = null
export function setSkillsManifestInvoke(fn: TauriInvoke | null): void {
  _override = fn
}
async function getTauriInvoke(): Promise<TauriInvoke | null> {
  if (_override) return _override
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
  /** 协议校验问题（S2：扫描即校验，供注册表/面板登记；不阻断加载） */
  issues: SkillValidationIssue[]
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

/** 校验 category 合法性 */
function normalizeCategory(raw: unknown): SkillMeta['category'] {
  const s = String(raw)
  return s === 'domain' || s === 'action' || s === 'persona' ? s : 'action'
}

/**
 * 把解析后的 frontmatter 转为 SkillMeta
 *
 * @param fm parseFrontmatter 返回的 frontmatter
 * @param installDir skills/ 下的子目录名（作为 id 兜底）
 * @param promptFile 实际提示词文件名（SKILL.md 或 instructions.md）
 * @param sidecar 目录内 worldsea.skill.json 的解析结果（D2 裁定：私有字段权威源；缺失即降级）
 */
export function frontmatterToSkillMeta(
  fm: ParsedSkillMd['frontmatter'],
  installDir: string,
  promptFile: string,
  sidecar?: WorldSeaSkillSidecar | null,
): SkillMeta {
  return {
    id: fm.id || installDir,
    name: fm.name || fm.id || installDir,
    icon: sanitizeIcon(sidecar?.icon ?? fm.icon),
    description: fm.description || '',
    category: normalizeCategory(sidecar?.category ?? fm.category),
    enabled: fm.enabled !== false, // 默认 true，除非显式 enabled: false
    visibility: sidecar?.visibility ?? 'always',
    version: fm.version || '1.0.0',
    promptFile,
    baseTools: fm.baseTools,
    allowedTools: fm.allowedTools,
    capabilities: sidecar?.capabilities ?? fm.capabilities,
    schemaContext: sidecar?.schemaContext ?? fm.schemaContext,
    triggers: sidecar?.triggers ?? fm.triggers,
    tags: sidecar?.tags ?? fm.tags,
    priority: sidecar?.priority ?? fm.priority ?? 5,
    autoActivate: sidecar?.autoActivate ?? fm.autoActivate,
    outputPreferences: sidecar?.outputPreferences,
    relatedPlugins: sidecar?.relatedPlugins,
    pluginTools: sidecar?.pluginTools,
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

/** 扫描已安装技能目录返回 manifest（skill.yaml 优先，SKILL.md 降级），详细见 docs/details/注释/packages/agent-runtime/skills-manifest.md */
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

    // 检测提示词文件：SKILL.md 优先，降级 instructions.md
    const skillMdContent = await readFileText(joinPath(skillsDir, installDir, 'SKILL.md'))
    const instructionsContent = skillMdContent == null
      ? await readFileText(joinPath(skillsDir, installDir, 'instructions.md'))
      : null
    if (skillMdContent == null && instructionsContent == null) continue // 无提示词文件，跳过

    const promptFile = skillMdContent != null ? 'SKILL.md' : 'instructions.md'

    let fm: ParsedSkillMd['frontmatter'] | null = null

    // 优先 skill.yaml（包装成 frontmatter 格式用 parseFrontmatter 解析）
    const yamlContent = await readFileText(joinPath(skillsDir, installDir, 'skill.yaml'))
    if (yamlContent) {
      const wrapped = `---\n${yamlContent}\n---\n`
      const parsed = parseFrontmatter(wrapped)
      // skill.yaml 必须有 id 或 name 才视为有效 manifest
      if (parsed.frontmatter.id || parsed.frontmatter.name) {
        fm = parsed.frontmatter
      }
    }

    // 降级到 SKILL.md frontmatter（Claude Code 标准格式）
    if (!fm && skillMdContent != null) {
      const parsed = parseFrontmatter(skillMdContent)
      if (parsed.frontmatter.id || parsed.frontmatter.name) {
        fm = parsed.frontmatter
      }
    }

    // instructions.md 无 frontmatter，用 installDir 构造最小 manifest
    if (!fm && instructionsContent != null) {
      fm = {
        name: '',
        description: '',
        allowedTools: [],
        baseTools: [],
        id: installDir,
      }
    }

    if (fm) {
      // sidecar（worldsea.skill.json）：D2 裁定的私有字段权威源（缺失即降级，不阻断）
      const sidecarRaw = await readFileText(joinPath(skillsDir, installDir, WORLDSEA_SKILL_SIDECAR_FILE))
      const sidecar = parseWorldSeaSkillSidecar(sidecarRaw)
      result.push({
        meta: frontmatterToSkillMeta(fm, installDir, promptFile, sidecar),
        installDir,
        // 扫描即校验（S2）：规范要求 name 与目录同名；问题登记不阻断加载
        issues: validateSkillFrontmatter(fm, { dirName: installDir }),
      })
    }
  }
  return result
}
