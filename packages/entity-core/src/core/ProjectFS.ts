/** 项目文件系统导出/导入（IndexedDB 数据 ↔ 本地文件夹结构，目录规范见文档），详细见 docs/details/注释/packages/entity-core/core/ProjectFS.md */

import { getProjectManager } from './ProjectManager'
import { useEntityStore, useRelationStore, useSettingsStore } from '../stores'
import { getProjectExtraProviders } from './projectExtras'
import { getFileStorageBackend } from './StorageBackend'
import { exportProjectIcons } from './projectIconsFS'
import { exportProjectBackgrounds } from './backgroundProject'
import { createBatchIpc } from '@worldsea/perf-kit/io'
import {
  currentHomeProfilePath,
  openDirDialog,
  readTextFile,
  toSafeFileName,
  simpleChecksum,
  toPosixPath,
  type ExportProgressCallback,
  type ProjectCache,
  type ProjectManifest,
} from './project-fs-shared'

// 共享类型、Tauri 文件系统封装、路径/校验工具在 project-fs-shared.ts；导入链在 project-fs-import.ts
export type {
  ExportProgressCallback,
  ImportProgressCallback,
  ProjectCache,
  ProjectManifest,
} from './project-fs-shared'
export { importProjectFromDir } from './project-fs-import'

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

  // 5b. 芽注册的项目级附加文件（时间体系的历法配置等）
  for (const provider of getProjectExtraProviders()) {
    try {
      const extra = await provider.exportFile()
      if (!extra) continue
      batchWriter.add(`${projectDir}/${extra.path}`, extra.content)
      checksums[extra.path] = simpleChecksum(extra.content)
    } catch (err) {
      console.warn(`[ProjectFS] 附加文件导出失败：${provider.id}`, err)
    }
  }

  // 5c. 自定义图标与项目图标覆盖（可选分区；失败不阻断主体）
  try {
    await exportProjectIcons(projectDir, (done, total) => onProgress?.('assets', done, total))
  } catch (err) {
    console.warn('[ProjectFS] 自定义图标导出失败（不影响主体）:', err)
  }

  // 5d. 项目背景配置与被引用图片（可选分区；旧数据包无配置时静默跳过）
  try {
    const backgroundSourceDir = getFileStorageBackend()?.projectDir
    await exportProjectBackgrounds(toPosixPath(backgroundSourceDir ?? ''), projectDir, (done, total) => onProgress?.('assets', done, total))
  } catch (err) {
    console.warn('[ProjectFS] 项目背景导出失败（不影响主体）:', err)
  }

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

