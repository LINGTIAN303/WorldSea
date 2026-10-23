/** 项目文件系统导出/导入（IndexedDB 数据 ↔ 本地文件夹结构，目录规范见文档），详细见 docs/details/注释/packages/entity-core/core/ProjectFS.md */

import { getProjectManager } from './ProjectManager'
import { useEntityStore, useRelationStore, useSettingsStore } from '../stores'
import { getProjectSwitcherApi } from './ProjectSwitcherApi'
import { getFileStorageBackend } from './StorageBackend'
import { createBatchIpc } from '@worldsea/perf-kit/io'

/* ════════════════════════════════════════
   类型定义
   ════════════════════════════════════════ */

/** project.json 的结构 */
export interface ProjectManifest {
  /** 格式版本号，当前为 1 */
  formatVersion: 1
  /** 项目 ID（UUID） */
  id: string
  /** 项目名称 */
  name: string
  /** 项目描述 */
  description: string
  /** 项目创建时间 */
  createdAt: string
  /** 导出时间 */
  exportedAt: string
  /** 应用版本 */
  appVersion?: string
}

/** .worldsea/cache.json 的结构 */
export interface ProjectCache {
  formatVersion: 1
  entityCount: number
  relationCount: number
  checksums: Record<string, string>
}

/** 导出进度回调 */
export type ExportProgressCallback = (
  phase: 'entities' | 'relations' | 'settings' | 'assets',
  current: number,
  total: number,
) => void

/** 导入进度回调 */
export type ImportProgressCallback = (
  phase: 'manifest' | 'entities' | 'relations' | 'settings',
  current: number,
  total: number,
) => void

/* ════════════════════════════════════════
   Tauri 文件系统操作封装
   ════════════════════════════════════════ */

async function getInvoke() {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke
  } catch {
    return null
  }
}

/** 读取文本文件 */
async function readTextFile(path: string): Promise<string> {
  const invoke = await getInvoke()
  if (!invoke) throw new Error('Tauri 环境不可用，无法读取文件')
  return invoke('cmd_fs_read', { path, encoding: 'utf-8' }) as Promise<string>
}

/** 列出目录内容 */
async function listDir(path: string, recursive = false): Promise<Array<{
  name: string
  path: string
  isDir: boolean
  size: number
}>> {
  const invoke = await getInvoke()
  if (!invoke) throw new Error('Tauri 环境不可用')
  return invoke('cmd_fs_list', { path, recursive }) as Promise<any[]>
}

/** 打开目录选择对话框 */
async function openDirDialog(title: string): Promise<string | null> {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const selected = await open({ directory: true, title, multiple: false })
    return selected as string | null
  } catch {
    return null
  }
}

/** 写入文本文件（createDirs：目标目录不存在则创建） */
async function writeTextFile(path: string, content: string): Promise<void> {
  const invoke = await getInvoke()
  if (!invoke) throw new Error('Tauri 环境不可用，无法写入文件')
  await invoke('cmd_fs_write', { path, content, createDirs: true })
}

/** 归一为正斜杠（导出/导入路径拼接口径） */
function toPosixPath(path: string): string {
  return path.replace(/\\/g, '/')
}

/** 当前项目实体根下的首页 profile 路径（`.worldsea/home.json`，设计 §5.3） */
function currentHomeProfilePath(): string | null {
  const projectDir = getFileStorageBackend()?.projectDir
  return projectDir ? `${toPosixPath(projectDir)}/.worldsea/home.json` : null
}

/* ════════════════════════════════════════
   辅助函数
   ════════════════════════════════════════ */

/** 将实体名称转为安全的文件名 */
function toSafeFileName(name: string, id: string): string {
  // 取名称的前30个字符，替换不安全字符
  const safe = name
    .slice(0, 30)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
  // 追加 ID 前8位确保唯一性
  const shortId = id.slice(0, 8)
  return safe ? `${safe}_${shortId}.json` : `${shortId}.json`
}

/** 简单 CRC32 校验（用于 cache.json） */
function simpleChecksum(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/* ════════════════════════════════════════
   导出
   ════════════════════════════════════════ */

/**
 * 将当前项目导出到指定目录。
 * @param dirPath 目标目录路径（如果为空则弹出目录选择对话框）；@param onProgress 进度回调
 * @returns 导出的目录路径，或 null 表示用户取消
 */
export async function exportProjectToDir(
  dirPath?: string,
  onProgress?: ExportProgressCallback,
): Promise<string | null> {
  // 1. 选择目录
  const targetDir = dirPath || await openDirDialog('选择项目导出目录')
  if (!targetDir) return null

  const pm = getProjectManager()
  const projectId = pm.getCurrentProjectId()!
  const projectInfo = (await pm.getCurrentProject())!

  // 项目根目录 = 目标目录 / 项目名
  const projectDir = `${targetDir}/${projectInfo.name}`

  // 2. 写入 project.json
  const manifest: ProjectManifest = {
    formatVersion: 1,
    id: projectId,
    name: projectInfo.name,
    description: projectInfo.description,
    createdAt: projectInfo.createdAt,
    exportedAt: new Date().toISOString(),
  }
  const batchWriter = createBatchIpc({ maxBatchSize: 50 })
  batchWriter.add(`${projectDir}/project.json`, JSON.stringify(manifest, null, 2))

  // 3. 导出实体（按类型分目录，每个实体一个文件）
  const entityStore = useEntityStore()
  const entities = await entityStore.getAllEntities()

  // 按类型分组
  const entitiesByType = new Map<string, any[]>()
  for (const entity of entities) {
    const list = entitiesByType.get(entity.type) || []
    list.push(entity)
    entitiesByType.set(entity.type, list)
  }

  const checksums: Record<string, string> = {}
  let entityIdx = 0

  for (const [type, typeEntities] of entitiesByType) {
    for (const entity of typeEntities) {
      const fileName = toSafeFileName(entity.name, entity.id)
      const filePath = `${projectDir}/entities/${type}/${fileName}`
      const content = JSON.stringify(entity, null, 2)
      batchWriter.add(filePath, content)
      checksums[`entities/${type}/${fileName}`] = simpleChecksum(content)
      entityIdx++
      onProgress?.('entities', entityIdx, entities.length)
    }
  }

  // 4. 导出关系（单文件）
  const relationStore = useRelationStore()
  const relations = await relationStore.getAllRelations()
  const relationsContent = JSON.stringify(relations, null, 2)
  batchWriter.add(`${projectDir}/relations/_index.json`, relationsContent)
  checksums['relations/_index.json'] = simpleChecksum(relationsContent)
  onProgress?.('relations', 1, 1)

  // 5. 导出设置
  const settingsStore = useSettingsStore()
  const sproutsConfig = settingsStore.sprouts.map(p => ({ id: p.id, active: p.active }))
  batchWriter.add(
    `${projectDir}/settings/plugins.json`,
    JSON.stringify(sproutsConfig, null, 2),
  )
  onProgress?.('settings', 1, 1)

  // 6. 导出首页 profile（`.worldsea/home.json`，设计 §5.3 白名单）：可选文件，缺失即跳过
  const homeSourcePath = currentHomeProfilePath()
  if (homeSourcePath) {
    try {
      batchWriter.add(`${projectDir}/.worldsea/home.json`, await readTextFile(homeSourcePath))
    } catch {
      // 未填写首页简介（无 home.json）属正常情况
    }
  }

  // 7. 写入缓存信息
  const cache: ProjectCache = {
    formatVersion: 1,
    entityCount: entities.length,
    relationCount: relations.length,
    checksums,
  }
  batchWriter.add(`${projectDir}/.worldsea/cache.json`, JSON.stringify(cache, null, 2))

  // 8. 批量刷出所有文件
  await batchWriter.flush()
  batchWriter.destroy()

  return projectDir
}

/* ════════════════════════════════════════
   导入
   ════════════════════════════════════════ */

/**
 * 从指定目录导入项目。
 * @param dirPath 源目录路径（如果为空则弹出目录选择对话框）；@param onProgress 进度回调
 * @returns 导入结果信息，或 null 表示用户取消
 */
export async function importProjectFromDir(
  dirPath?: string,
  onProgress?: ImportProgressCallback,
): Promise<{ projectName: string; entityCount: number; relationCount: number } | null> {
  // 1. 选择目录
  const sourceDir = dirPath || await openDirDialog('选择项目导入目录')
  if (!sourceDir) return null

  // 2. 读取 project.json
  const manifestText = await readTextFile(`${sourceDir}/project.json`)
  const manifest: ProjectManifest = JSON.parse(manifestText)
  onProgress?.('manifest', 1, 1)

  // 3. 创建新项目
  const pm = getProjectManager()
  const newProject = await pm.createProject(manifest.name, manifest.description)

  // 4. 切换到新项目
  const switcherApi = getProjectSwitcherApi()
  if (!switcherApi) {
    throw new Error('项目切换服务未注册：请先调用 registerProjectSwitcherApi')
  }
  const switched = await switcherApi.switchProject(newProject.id)
  if (!switched) throw new Error('切换到导入项目失败，已中止导入')

  // 5. 导入实体（批量收集后一次性写入 DB）
  const entitiesDir = `${sourceDir}/entities`
  const entityTypes = await listDir(entitiesDir)
  let entityCount = 0
  let entityTotal = 0

  // 先统计总数
  for (const typeDir of entityTypes) {
    if (!typeDir.isDir) continue
    const files = await listDir(typeDir.path)
    entityTotal += files.filter(f => f.name.endsWith('.json')).length
  }

  // 收集所有实体
  const allEntities: any[] = []
  for (const typeDir of entityTypes) {
    if (!typeDir.isDir) continue
    const files = await listDir(typeDir.path)
    for (const file of files) {
      if (!file.name.endsWith('.json')) continue
      const content = await readTextFile(file.path)
      allEntities.push(JSON.parse(content))
      entityCount++
      onProgress?.('entities', entityCount, entityTotal)
    }
  }

  // 批量写入 DB + 刷新内存状态
  const entityStore = useEntityStore()
  await entityStore.importBatch(allEntities)
  onProgress?.('entities', entityTotal, entityTotal)

  // 6. 导入关系（批量）
  let relationCount = 0
  try {
    const relationsText = await readTextFile(`${sourceDir}/relations/_index.json`)
    const relations = JSON.parse(relationsText)
    const relationStore = useRelationStore()
    await relationStore.importBatch(relations)
    relationCount = relations.length
  } catch {
    // 关系文件可能不存在
  }
  onProgress?.('relations', 1, 1)

  // 7. 导入芽设置
  try {
    const pluginsText = await readTextFile(`${sourceDir}/settings/plugins.json`)
    const pluginsConfig = JSON.parse(pluginsText)
    const settingsStore = useSettingsStore()
    for (const p of pluginsConfig) {
      if (p.active) {
        settingsStore.toggleSprout(p.id)
      }
    }
  } catch {
    // 设置文件可能不存在
  }
  onProgress?.('settings', 1, 1)

  // 8. 导入首页 profile（可选文件：缺失即跳过；写入新项目实体根的 `.worldsea/`）
  const homeTargetPath = currentHomeProfilePath()
  if (homeTargetPath) {
    try {
      const homeText = await readTextFile(`${toPosixPath(sourceDir)}/.worldsea/home.json`)
      await writeTextFile(homeTargetPath, homeText)
      // 切换项目早于本步写入，已挂载的首页资料 store 首轮可能读到空资料——广播让消费方重读
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('ws-home-profile-changed'))
    } catch {
      // 源目录无 home.json 或新项目目录未就绪：跳过，不影响导入主体
    }
  }

  return {
    projectName: manifest.name,
    entityCount,
    relationCount,
  }
}
