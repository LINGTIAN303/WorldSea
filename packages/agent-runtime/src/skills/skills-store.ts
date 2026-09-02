/**
 * Skills Store 前端封装（Task 24 阶段2）
 *
 * 封装 Tauri 端 skills_store 命令，提供技能包下载/安装/卸载/版本查询能力。
 * 安装/卸载后自动调用 initSkillRegistry() 重新扫描，使新技能立即可用。
 *
 * 非 Tauri 环境（Web 模式/vitest）安全降级：返回 null/空数组，零回归。
 */

import { isTauri } from '../execution'
import { initSkillRegistry, notifySessionPromptDirty } from './registry'

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
/**
 * 端注入覆盖（风险点② 补桥，2026-08-30）：app 层把 transport.invoke 注入进来，
 * 使浏览器 HTTP 模式的商城命令路由到 /rpc 桥（cmd_skills_* 六命令已注册）。
 * 本包端无关、不能 import transport，故用注入而非直接依赖。
 */
let _override: TauriInvoke | null = null
export function setSkillsStoreInvoke(fn: TauriInvoke | null): void {
  _override = fn
}
/**
 * 商城能力是否可用（T02 修复，2026-09-01）：true = 有可用的 invoke 通道——
 * 桌面 Tauri（_invoke 惰性初始化 或 isTauri）或浏览器 HTTP 桥已注入（_override）。
 * 供 useSkillsStore 等判定商城是否可用（替代只看 __TAURI_INTERNALS__ 的旧判断，
 * 使浏览器 HTTP 模式的商城功能不再被「仅桌面端可用」占位挡住）。
 */
export function hasSkillsInvoke(): boolean {
  return !!_override || !!_invoke || isTauri()
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
    notifySessionPromptDirty('skills-install')
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
  notifySessionPromptDirty('skills-uninstall')
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

/** 本地导入技能：写 skill.yaml + SKILL.md 到 app_data_dir/skills（不触发重扫），详细见 docs/details/注释/packages/agent-runtime/skills-skills-store.md */
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
    notifySessionPromptDirty('skills-import')
  }
  return result
}
