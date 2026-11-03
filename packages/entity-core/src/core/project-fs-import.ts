// 项目导入链：把本地文件夹结构读回 IndexedDB（实体 / 关联 / 设置 / 资产）。
// 导出链在 ProjectFS.ts，共享类型与文件系统封装在 project-fs-shared.ts。
// 目录规范见 docs/details/注释/packages/entity-core/core/ProjectFS.md
import { getProjectManager } from './ProjectManager'
import { useEntityStore, useRelationStore, useSettingsStore } from '../stores'
import { getProjectSwitcherApi } from './ProjectSwitcherApi'
import { getProjectExtraProviders } from './projectExtras'
import { getFileStorageBackend } from './StorageBackend'
import { importProjectIcons } from './projectIconsFS'
import { importProjectBackgrounds } from './backgroundProject'
import {
  currentHomeProfilePath,
  listDir,
  openDirDialog,
  readTextFile,
  toPosixPath,
  writeTextFile,
  type ImportProgressCallback,
  type ProjectManifest,
} from './project-fs-shared'

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

  // 7b. 芽注册的项目级附加文件（文件缺失不阻断导入）
  for (const provider of getProjectExtraProviders()) {
    try {
      const content = await readTextFile(`${sourceDir}/${provider.path}`)
      await provider.importFile(content)
    } catch {
      // 附加文件可能不存在
    }
  }

  // 7c. 自定义图标与项目图标覆盖（可选分区；缺失即跳过）
  try {
    await importProjectIcons(sourceDir, (done, total) => onProgress?.('assets', done, total))
  } catch (err) {
    console.warn('[ProjectFS] 自定义图标导入失败（不影响主体）:', err)
  }

  // 7d. 项目背景图片与配置（缺失文件槽位置空；失败不阻断主体）
  try {
    const backgroundTargetDir = getFileStorageBackend()?.projectDir
    await importProjectBackgrounds(toPosixPath(sourceDir), toPosixPath(backgroundTargetDir ?? ''), (done, total) => onProgress?.('assets', done, total))
  } catch (err) {
    console.warn('[ProjectFS] 项目背景导入失败（不影响主体）:', err)
  }

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
