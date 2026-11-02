/**
 * 项目背景配置：`.worldsea/background.json` 读写、相对路径校验、资产解析、孤儿清理、导出/导入。
 * 配置按 unknown 处理，由调用方用 style-kit 类型归一化（entity-core 不依赖 style-kit）；路径统一用 POSIX 分隔符拼接，不引入 tauri path 插件。
 */
import { invoke } from '@tauri-apps/api/core'
import { cleanupBackgroundOrphans, resolveBackgroundSrc } from './backgroundAsset'
import type { BackgroundTargetKey, BackgroundThemeKey } from './backgroundAsset'

/** 项目内背景图目录，配置中的路径必须以此前缀开头 */
export const PROJECT_BACKGROUND_PREFIX = '.worldsea/backgrounds/'
/** 项目背景配置文件在项目目录内的相对路径 */
export const PROJECT_BACKGROUND_CONFIG = '.worldsea/background.json'

const TARGETS: BackgroundTargetKey[] = ['canvas', 'home', 'titlebar', 'sidebar', 'content']
const THEMES: BackgroundThemeKey[] = ['light', 'dark']

/** 待解析的项目图片引用；path 为项目相对路径（可能为空或非法，由本模块判定） */
export interface ProjectBackgroundRef {
  target: string
  theme: string
  path: string
}

/** 按 target → theme 索引的解析结果，覆盖全部五个目标与两个主题 */
export interface ProjectBackgroundAssets {
  srcs: Record<string, Record<string, string | null>>
  missing: Record<string, Record<string, boolean>>
}

/** 导出/导入进度：done / total 均以引用的图片文件计 */
export type ProjectBackgroundProgress = (done: number, total: number) => void

/** 目标配置的最小本地形态（其余字段原样透传，由 style-kit 归一化） */
interface TargetLike {
  paths?: Record<string, unknown>
  [key: string]: unknown
}

/** 校验项目相对路径：只接受 `.worldsea/backgrounds/` 下的相对 POSIX 路径 */
export function normalizeProjectBackgroundPath(raw: string): string | null {
  if (!raw || raw.includes('\\')) return null
  const value = raw.replace(/^\.\//, '')
  if (value.startsWith('/') || /^[a-zA-Z]:/.test(value)) return null
  if (value.split('/').some((seg) => !seg || seg === '.' || seg === '..')) return null
  return value.startsWith(PROJECT_BACKGROUND_PREFIX) ? value : null
}

function joinInside(baseDir: string, relative: string): string {
  return `${baseDir.replace(/[\\/]+$/, '')}/${relative}`
}

function configPath(projectDir: string): string {
  return joinInside(projectDir, PROJECT_BACKGROUND_CONFIG)
}

/** 项目（或导出目录）内的背景图目录路径，去掉尾部斜杠以便 `cmd_fs_list` 直接比对子项 */
function backgroundDirInside(baseDir: string): string {
  return joinInside(baseDir, PROJECT_BACKGROUND_PREFIX.replace(/\/$/, ''))
}

/** targets 只保留对象形态的条目，数组/标量视作无配置 */
function configTargets(config: unknown): Record<string, TargetLike> {
  const targets = (config as { targets?: unknown } | null)?.targets
  if (!targets || typeof targets !== 'object' || Array.isArray(targets)) return {}
  const out: Record<string, TargetLike> = {}
  for (const [key, value] of Object.entries(targets as Record<string, unknown>)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) out[key] = value as TargetLike
  }
  return out
}

function targetPaths(target: TargetLike): Record<string, unknown> {
  const paths = target.paths
  return paths && typeof paths === 'object' && !Array.isArray(paths) ? (paths as Record<string, unknown>) : {}
}

export async function readProjectBackground(projectDir: string): Promise<unknown | null> {
  if (!projectDir) return null
  let text: string
  try {
    text = (await invoke('cmd_fs_read', { path: configPath(projectDir), encoding: 'utf-8' })) as string
  } catch {
    return null // 配置缺失 = 该项目跟随全局
  }
  try {
    return JSON.parse(text)
  } catch (err) {
    console.warn('[background] 项目背景配置解析失败，按无覆盖处理:', err)
    return null
  }
}

export async function writeProjectBackground(projectDir: string, config: unknown): Promise<void> {
  if (!projectDir) return
  await invoke('cmd_fs_write', {
    path: configPath(projectDir),
    content: JSON.stringify(config, null, 2),
    createDirs: true,
  })
}

export async function deleteProjectBackground(projectDir: string): Promise<void> {
  if (!projectDir) return
  try {
    await invoke('cmd_fs_delete', { path: configPath(projectDir) })
  } catch (err) {
    console.warn('[background] 删除项目背景配置失败:', err)
  }
}

/** 删除项目内被目标引用的背景图；relativePath 先按项目路径规则校验，非法直接忽略 */
export async function removeProjectBackgroundFile(projectDir: string, relativePath: string): Promise<void> {
  if (!projectDir) return
  const rel = normalizeProjectBackgroundPath(relativePath)
  if (!rel) return
  try {
    await invoke('cmd_fs_delete', { path: joinInside(projectDir, rel) })
  } catch (err) {
    console.warn('[background] 删除项目背景文件失败:', err)
  }
}

export async function resolveProjectBackgroundAssets(
  projectDir: string,
  refs: ProjectBackgroundRef[],
): Promise<ProjectBackgroundAssets> {
  const srcs: Record<string, Record<string, string | null>> = {}
  const missing: Record<string, Record<string, boolean>> = {}
  for (const target of TARGETS) {
    srcs[target] = Object.fromEntries(THEMES.map((theme) => [theme, null]))
    missing[target] = Object.fromEntries(THEMES.map((theme) => [theme, false]))
  }
  await Promise.all(refs.map(async ({ target, theme, path }) => {
    srcs[target] ??= {}
    missing[target] ??= {}
    if (!path) {
      // 空路径 = 未配置图片，不算缺失
      srcs[target][theme] = null
      missing[target][theme] = false
      return
    }
    const relative = normalizeProjectBackgroundPath(path)
    // 非法路径直接记缺失，不做 stat，避免把目录穿越拼进真实路径
    const src = relative && projectDir ? await resolveBackgroundSrc(joinInside(projectDir, relative)) : null
    srcs[target][theme] = src
    missing[target][theme] = !src
  }))
  return { srcs, missing }
}

export async function cleanupProjectBackgroundOrphans(
  projectDir: string,
  referenced: string[] | (() => string[]),
): Promise<void> {
  if (!projectDir) return
  try {
    await cleanupBackgroundOrphans(backgroundDirInside(projectDir), referenced)
  } catch (err) {
    console.warn('[background] 清理项目孤儿背景失败:', err)
  }
}

/** 收集配置里所有合法的项目相对路径（去重） */
function collectBackgroundPaths(config: unknown): string[] {
  const out = new Set<string>()
  for (const target of Object.values(configTargets(config))) {
    for (const value of Object.values(targetPaths(target))) {
      const relative = typeof value === 'string' ? normalizeProjectBackgroundPath(value) : null
      if (relative) out.add(relative)
    }
  }
  return [...out]
}

export async function exportProjectBackgrounds(
  projectDir: string,
  outDir: string,
  onProgress?: ProjectBackgroundProgress,
): Promise<void> {
  if (!projectDir || !outDir) return
  const config = await readProjectBackground(projectDir)
  if (config === null) return // 旧数据包无背景配置：静默跳过
  const paths = collectBackgroundPaths(config)
  const backgroundDir = backgroundDirInside(outDir)
  let done = 0
  if (paths.length) await invoke('cmd_fs_mkdir', { path: backgroundDir }).catch(() => {})
  for (const relative of paths) {
    try {
      await invoke('cmd_fs_copy', {
        src: joinInside(projectDir, relative),
        dest: joinInside(outDir, relative),
      })
    } catch (err) {
      console.warn('[background] 导出背景文件跳过（缺失或不可复制）:', relative, err)
    }
    onProgress?.(++done, paths.length)
  }
  await writeProjectBackground(outDir, config)
}

export async function importProjectBackgrounds(
  sourceDir: string,
  targetProjectDir: string,
  onProgress?: ProjectBackgroundProgress,
): Promise<void> {
  if (!sourceDir || !targetProjectDir) return
  const source = await readProjectBackground(sourceDir)
  if (source === null) return // 旧数据包无背景配置：静默跳过
  if (typeof source !== 'object' || Array.isArray(source)) {
    console.warn('[background] 源项目背景配置不是对象，跳过导入')
    return
  }
  const targets = configTargets(source)
  const total = Object.values(targets).reduce((sum, target) => sum + Object.keys(targetPaths(target)).length, 0)
  const backgroundDir = backgroundDirInside(targetProjectDir)
  const cleanedTargets: Record<string, TargetLike> = {}
  let done = 0
  let prepared = false
  for (const [key, target] of Object.entries(targets)) {
    const cleaned: Record<string, string> = {}
    for (const [theme, value] of Object.entries(targetPaths(target))) {
      const relative = typeof value === 'string' ? normalizeProjectBackgroundPath(value) : null
      cleaned[theme] = ''
      if (relative) {
        if (!prepared) {
          await invoke('cmd_fs_mkdir', { path: backgroundDir }).catch(() => {})
          prepared = true
        }
        try {
          await invoke('cmd_fs_copy', {
            src: joinInside(sourceDir, relative),
            dest: joinInside(targetProjectDir, relative),
          })
          cleaned[theme] = relative
        } catch (err) {
          console.warn('[background] 导入背景文件缺失，槽位置空:', relative, err)
        }
      } else if (typeof value === 'string' && value) {
        console.warn('[background] 导入时丢弃非法背景路径:', value)
      }
      onProgress?.(++done, total)
    }
    // 无图目标整目标剔除，避免导入后显示「自定义但无背景」
    if (Object.values(cleaned).some(Boolean)) cleanedTargets[key] = { ...target, paths: cleaned }
  }
  if (!Object.keys(cleanedTargets).length) return
  try {
    await writeProjectBackground(targetProjectDir, { ...(source as Record<string, unknown>), targets: cleanedTargets })
  } catch (err) {
    // 导入为附加步骤：写配置失败只告警，不打断项目导入主体
    console.warn('[background] 写入导入后的项目背景配置失败:', err)
  }
}
