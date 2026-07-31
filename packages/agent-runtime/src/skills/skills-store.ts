/**
 * Skills Store 前端封装（Task 24 阶段2）
 *
 * 封装 Tauri 端 skills_store 命令，提供技能包下载/安装/卸载/版本查询能力。
 * 安装/卸载后自动调用 initSkillRegistry() 重新扫描，使新技能立即可用。
 *
 * 非 Tauri 环境（Web 模式/vitest）安全降级：返回 null/空数组，零回归。
 */

import { isTauri } from '../execution'
import { initSkillRegistry } from './registry'

/** Tauri invoke 函数类型 */
type TauriInvoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>

/** 安装结果（与 Rust 端 InstallResult 对齐） */
export interface InstallResult {
  skill_id: string
  version: string
  file_count: number
}

/** 已安装技能元信息（与 Rust 端 InstalledMeta 对齐） */
export interface InstalledMeta {
  id: string
  version: string
  install_dir: string
}

/** 远程技能索引条目（skills-manifest.json 中的单个技能） */
export interface RemoteSkillEntry {
  id: string
  name: string
  description?: string
  version: string
  author?: string
  homepage?: string
  /** zip 下载 URL */
  downloadUrl: string
  /** zip 内技能目录路径（空字符串表示 zip 根直接是技能文件） */
  pathInArchive: string
  /** zip 的 sha256 校验值（小写十六进制） */
  sha256: string
}

/** 远程技能索引清单（skills-manifest.json 结构） */
export interface RemoteManifest {
  name: string
  version?: string
  updated?: string
  skills: RemoteSkillEntry[]
}

/** Tauri invoke 缓存 */
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

/**
 * 下载远程技能索引清单（skills-manifest.json）
 *
 * @param manifestUrl manifest.json 的 URL（如 GitHub raw URL）
 * @returns 解析后的 RemoteManifest；非 Tauri 环境或下载/解析失败返回 null
 */
export async function downloadRemoteManifest(manifestUrl: string): Promise<RemoteManifest | null> {
  const invoke = await getTauriInvoke()
  if (!invoke) return null
  try {
    const text = (await invoke('cmd_skills_download_manifest', { url: manifestUrl })) as string
    const parsed = JSON.parse(text)
    if (!parsed || !Array.isArray(parsed.skills)) return null
    return parsed as RemoteManifest
  } catch {
    return null
  }
}

/** 安装技能参数 */
export interface InstallSkillOptions {
  /** zip 下载 URL */
  downloadUrl: string
  /** zip 内技能目录路径（空字符串表示 zip 根直接是技能文件） */
  pathInArchive: string
  /** zip 的 sha256 校验值（小写十六进制） */
  sha256: string
  /** 技能 id（作为安装目录名） */
  skillId: string
}

/**
 * 安装技能：下载 zip → sha256 校验 → 解压到 app_data_dir/skills/<skillId>/
 *
 * 注意：此函数不触发重新扫描。安装后需调用 initSkillRegistry() 才能使技能生效。
 * 通常用 installSkillAndReload 一步完成安装+重扫。
 *
 * @returns 安装结果；非 Tauri 环境返回 null
 */
export async function installSkill(opts: InstallSkillOptions): Promise<InstallResult | null> {
  const invoke = await getTauriInvoke()
  if (!invoke) return null
  try {
    return (await invoke('cmd_skills_install', {
      downloadUrl: opts.downloadUrl,
      pathInArchive: opts.pathInArchive,
      sha256Expected: opts.sha256,
      skillId: opts.skillId,
    })) as InstallResult
  } catch {
    return null
  }
}

/**
 * 安装技能并重新扫描注册表（推荐入口）
 *
 * 流程：installSkill → initSkillRegistry() → 返回安装结果
 * 安装成功后新技能立即可用（findSkillById 等查询函数可查到）。
 */
export async function installSkillAndReload(opts: InstallSkillOptions): Promise<InstallResult | null> {
  const result = await installSkill(opts)
  if (result) {
    await initSkillRegistry()
  }
  return result
}

/**
 * 卸载技能：删除 app_data_dir/skills/<skillId>/ 目录
 *
 * 注意：卸载后需调用 initSkillRegistry() 才能使注册表更新。
 * 通常用 uninstallSkillAndReload 一步完成卸载+重扫。
 *
 * @returns true 表示已删除；false 表示目录不存在；非 Tauri 环境返回 null
 */
export async function uninstallSkill(skillId: string): Promise<boolean | null> {
  const invoke = await getTauriInvoke()
  if (!invoke) return null
  try {
    return (await invoke('cmd_skills_uninstall', { skillId })) as boolean
  } catch {
    return null
  }
}

/**
 * 卸载技能并重新扫描注册表（推荐入口）
 *
 * 流程：uninstallSkill → initSkillRegistry() → 返回是否已删除
 */
export async function uninstallSkillAndReload(skillId: string): Promise<boolean | null> {
  const result = await uninstallSkill(skillId)
  await initSkillRegistry()
  return result
}

/**
 * 获取已安装技能版本列表
 *
 * 用于前端检测更新：对比 remote manifest 的 version 与本地已安装 version。
 *
 * @returns 已安装技能元信息数组；非 Tauri 环境返回空数组
 */
export async function getInstalledVersions(): Promise<InstalledMeta[]> {
  const invoke = await getTauriInvoke()
  if (!invoke) return []
  try {
    const result = await invoke('cmd_skills_get_installed_versions')
    return Array.isArray(result) ? (result as InstalledMeta[]) : []
  } catch {
    return []
  }
}

/**
 * 检测可更新技能
 *
 * 对比远程 manifest 与本地已安装版本，返回有新版本的技能列表。
 *
 * @param manifest 远程技能索引
 * @returns 可更新技能条目数组（远程 version 高于本地）
 */
export async function checkUpdates(manifest: RemoteManifest): Promise<RemoteSkillEntry[]> {
  const installed = await getInstalledVersions()
  const installedMap = new Map(installed.map(s => [s.id, s.version]))
  return manifest.skills.filter(remote => {
    const localVersion = installedMap.get(remote.id)
    if (!localVersion) return false // 未安装，不算更新
    return localVersion !== remote.version // 版本不同则可更新
  })
}

/** 本地导入参数（Task 24 阶段4：多平台互通） */
export interface ImportLocalOptions {
  /** 技能 id（作为目录名） */
  skillId: string
  /** skill.yaml manifest 文本 */
  skillYaml: string
  /** SKILL.md 提示词文本（可选，空则不写） */
  skillMd?: string
}

/**
 * 本地导入技能：写入 skill.yaml + SKILL.md 到 app_data_dir/skills/<skillId>/
 *
 * 用于多平台互通：前端用 platform-adapters 解析 Claude Code/Cursor/WorldSmith 格式，
 * 生成标准 skill.yaml + SKILL.md 文本后调用本函数写入。已存在同名技能则覆盖。
 *
 * 注意：此函数不触发重新扫描。导入后需调用 initSkillRegistry() 才能使技能生效。
 * 通常用 importLocalSkillAndReload 一步完成导入+重扫。
 *
 * @returns 安装结果；非 Tauri 环境返回 null
 */
export async function importLocalSkill(opts: ImportLocalOptions): Promise<InstallResult | null> {
  const invoke = await getTauriInvoke()
  if (!invoke) return null
  try {
    return (await invoke('cmd_skills_import_local', {
      skillId: opts.skillId,
      skillYaml: opts.skillYaml,
      skillMd: opts.skillMd ?? null,
    })) as InstallResult
  } catch {
    return null
  }
}

/**
 * 本地导入技能并重新扫描注册表（推荐入口）
 *
 * 流程：importLocalSkill → initSkillRegistry() → 返回导入结果
 * 导入成功后新技能立即可用。
 */
export async function importLocalSkillAndReload(opts: ImportLocalOptions): Promise<InstallResult | null> {
  const result = await importLocalSkill(opts)
  if (result) {
    await initSkillRegistry()
  }
  return result
}
