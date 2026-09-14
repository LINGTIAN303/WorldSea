/**
 * fileTrash —— 文件/目录软删除基建（三期侧栏「删除可逆化」拍板项的实现）
 *
 * 与实体回收站（entity-core trashStore）的关系：**同语义、不同实现** ——
 * trashStore 的 TrashItem.data 是 Entity|Relation 且存 localStorage，硬塞文件记录会污染
 * 其类型；而文件软删除的真相天然在磁盘上。故本模块采用「磁盘即真相」：
 * - 本体：`{root}/.trash/{时间戳}_{原名}`（cmd_fs_rename 同卷移动，目录/文件通用）
 * - 记账：`{root}/.trash/manifest.json`（原路径、时间；还原/永久删除按此定位）
 * - 过期口径与 trashStore 一致：**30 天**（计划文档曾写 90 天，实为对 trashStore 的笔误，
 *   2026-09-14 实读 trashStore.ts:19 修正）。过期清理由 moveToTrash 惰性触发，不做后台任务。
 *
 * 跨卷说明：fs::rename 同卷可移动目录，项目内文件必然与 {root}/.trash 同卷；
 * 跨卷失败（理论上仅外部路径）由调用方捕获降级为「确认后永久删除」。
 */
import { invoke } from '@tauri-apps/api/core'

export interface FileTrashRecord {
  /** trashName（毫秒时间戳前缀，天然唯一） */
  id: string
  originalPath: string
  name: string
  isDir: boolean
  deletedAt: string
}

const EXPIRE_DAYS = 30
const MANIFEST_NAME = 'manifest.json'

function norm(p: string): string {
  return p.replace(/\\/g, '/')
}

function joinPath(...parts: string[]): string {
  return parts.map(norm).join('/').replace(/\/{2,}/g, '/')
}

async function readManifest(manifestPath: string): Promise<FileTrashRecord[]> {
  try {
    const raw = await invoke<string>('cmd_fs_read', { path: manifestPath })
    const parsed = JSON.parse(raw) as FileTrashRecord[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return [] // 无 manifest / 读取失败 = 空回收站
  }
}

async function writeManifest(manifestPath: string, items: FileTrashRecord[]): Promise<void> {
  await invoke('cmd_fs_write', {
    path: manifestPath,
    content: JSON.stringify(items, null, 2),
    createDirs: true,
  })
}

/** 原位置被占时推导可用路径：`name(1).ext`、`name(2).ext` …（上限 99）
 *  判据：cmd_fs_stat 对不存在的路径直接 Err（FsStat 无 exists 字段，fs_commands.rs:221） */
async function deriveAvailablePath(originalPath: string): Promise<string> {
  const dot = originalPath.lastIndexOf('.')
  const slash = Math.max(originalPath.lastIndexOf('/'), originalPath.lastIndexOf('\\'))
  const hasExt = dot > slash + 1
  const stem = hasExt ? originalPath.slice(0, dot) : originalPath
  const ext = hasExt ? originalPath.slice(dot) : ''
  for (let i = 1; i < 100; i++) {
    const candidate = `${stem}(${i})${ext}`
    const free = await invoke('cmd_fs_stat', { path: candidate }).then(() => false).catch(() => true)
    if (free) return candidate
  }
  return `${stem}_恢复_${Date.now()}${ext}`
}

export interface FileTrash {
  /** 记账条目（响应式） */
  items: () => FileTrashRecord[]
  /** 移入回收站；返回记账记录（失败抛错，调用方决定降级） */
  moveToTrash(path: string, isDir: boolean): Promise<FileTrashRecord>
  /** 还原到原位置；原位置被占时自动加 `(n)` 后缀 */
  restore(id: string): Promise<string>
  /** 永久删除（唯一的 cmd_fs_delete 入口，调用方需二次确认） */
  permanentDelete(id: string): Promise<void>
  /** 清空 */
  empty(): Promise<void>
  /** 刷新记账（重新读 manifest） */
  reload(): Promise<void>
}

/**
 * 按根目录创建文件回收站句柄。同 rootPath 共享模块级缓存（两处内嵌面板同根不重复建）。
 * 根未就绪（null）时各方法空转/抛错，由调用方守卫。
 */
export function useFileTrash(rootPath: () => string | null): FileTrash {
  const cache: {
    root: string | null
    items: FileTrashRecord[]
  } = { root: null, items: [] }

  function paths(root: string): { trashDir: string; manifest: string } {
    const trashDir = joinPath(root, '.trash')
    return { trashDir, manifest: joinPath(trashDir, MANIFEST_NAME) }
  }

  async function ensureLoaded(root: string): Promise<void> {
    if (cache.root === root) return
    cache.root = root
    cache.items = await readManifest(paths(root).manifest)
    await purgeExpired(root)
  }

  async function purgeExpired(root: string): Promise<void> {
    const expire = Date.now() - EXPIRE_DAYS * 24 * 60 * 60 * 1000
    const expired = cache.items.filter(i => new Date(i.deletedAt).getTime() < expire)
    if (!expired.length) return
    const { trashDir } = paths(root)
    for (const item of expired) {
      await invoke('cmd_fs_delete', { path: joinPath(trashDir, item.id) }).catch(() => {})
    }
    cache.items = cache.items.filter(i => !expired.includes(i))
    await writeManifest(paths(root).manifest, cache.items)
  }

  return {
    items: () => cache.items,

    async moveToTrash(path: string, isDir: boolean): Promise<FileTrashRecord> {
      const root = rootPath()
      if (!root) throw new Error('项目目录未就绪')
      await ensureLoaded(root)
      const { trashDir, manifest } = paths(root)
      await invoke('cmd_fs_mkdir', { path: trashDir }).catch(() => {})
      const name = norm(path).split('/').filter(Boolean).pop() || path
      const id = `${Date.now()}_${name}`
      await invoke('cmd_fs_rename', { src: path, dest: joinPath(trashDir, id) })
      const record: FileTrashRecord = {
        id,
        originalPath: norm(path),
        name,
        isDir,
        deletedAt: new Date().toISOString(),
      }
      cache.items.unshift(record)
      await writeManifest(manifest, cache.items)
      return record
    },

    async restore(id: string): Promise<string> {
      const root = rootPath()
      if (!root) throw new Error('项目目录未就绪')
      await ensureLoaded(root)
      const { trashDir, manifest } = paths(root)
      const item = cache.items.find(i => i.id === id)
      if (!item) throw new Error('回收站记录不存在')
      let dest = item.originalPath
      try {
        await invoke('cmd_fs_rename', { src: joinPath(trashDir, id), dest })
      } catch {
        dest = await deriveAvailablePath(item.originalPath)
        await invoke('cmd_fs_rename', { src: joinPath(trashDir, id), dest })
      }
      cache.items = cache.items.filter(i => i.id !== id)
      await writeManifest(manifest, cache.items)
      return dest
    },

    async permanentDelete(id: string): Promise<void> {
      const root = rootPath()
      if (!root) throw new Error('项目目录未就绪')
      await ensureLoaded(root)
      const { trashDir, manifest } = paths(root)
      const item = cache.items.find(i => i.id === id)
      if (!item) return
      await invoke('cmd_fs_delete', { path: joinPath(trashDir, id) })
      cache.items = cache.items.filter(i => i.id !== id)
      await writeManifest(manifest, cache.items)
    },

    async empty(): Promise<void> {
      const root = rootPath()
      if (!root) throw new Error('项目目录未就绪')
      await ensureLoaded(root)
      const ids = cache.items.map(i => i.id)
      for (const id of ids) await this.permanentDelete(id)
    },

    async reload(): Promise<void> {
      const root = rootPath()
      if (!root) return
      cache.root = null
      await ensureLoaded(root)
    },
  }
}
