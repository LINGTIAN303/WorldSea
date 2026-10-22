/** 文件系统变更监听（Tauri fs:change 事件同步到 Store，模块级单例 + 引用计数），详细见 docs/details/注释/packages/entity-core/composables/useFsWatcher.md */

import { getFileStorageBackend, isTauri } from '../core'
import { useEntityStore, useRelationStore, useFileStore } from '../stores'
import { startBackgroundTask } from './useBackgroundTask'

/** 防抖间隔（ms） */
const DEBOUNCE_MS = 1000

/* ─── 模块级状态 ─── */
let _watchId: string | null = null
let _unlisten: (() => void) | null = null
let _debounceTimer: ReturnType<typeof setTimeout> | null = null
let _pendingChanges = new Set<string>()
/** 引用计数：跟踪当前有多少消费者需要监听 */
let _refCount = 0
/** 当前正在监听的目录（用于检测目录变更） */
let _watchedDir: string | null = null

/* ─── 插件目录变更分发（批1）：entity-core 不反向依赖 world 树，world 侧订阅 ─── */
const pluginDirHandlers = new Set<(paths: string[]) => void>()

/**
 * 订阅「外部插件目录」（`<worlddata>/.worldsea/plugins/`）变更。
 * @returns 退订函数。多 handler 逐个调用、单点抛错隔离（在 processChanges 内）。
 */
export function onPluginDirChange(handler: (paths: string[]) => void): () => void {
  pluginDirHandlers.add(handler)
  return () => {
    pluginDirHandlers.delete(handler)
  }
}

const schemaDirHandlers = new Set<(paths: string[]) => void>()

/**
 * 订阅「项目级 schema 覆盖目录」（`<worlddata>/.worldsea/schemas/`）变更（批 7）。
 * @returns 退订函数。多 handler 逐个调用、单点抛错隔离（在 processChanges 内）。
 */
export function onSchemaDirChange(handler: (paths: string[]) => void): () => void {
  schemaDirHandlers.add(handler)
  return () => {
    schemaDirHandlers.delete(handler)
  }
}

export function useFsWatcher() {
  /**
   * 启动项目目录监听。
   * 引用计数：多次调用同一目录仅增加计数；
   * 若目录变更则重启后端监听。
   */
  async function startWatching(): Promise<void> {
    if (!isTauri()) return

    const fsb = getFileStorageBackend()
    if (!fsb?.isReady || !fsb.projectDir) return

    _refCount++

    // 已在监听同一目录 → 仅增加引用计数，无需重启
    if (_watchId && _watchedDir === fsb.projectDir) {
      console.log(`[FsWatcher] 已在监听 ${fsb.projectDir}，引用计数=${_refCount}`)
      return
    }

    // 目录变更或首次启动 → 停止旧监听 + 启动新监听
    await stopBackendWatcher()
    await startBackendWatcher(fsb.projectDir)
  }

  /**
   * 停止监听。
   * 引用计数：仅当最后一个消费者退出时才真正停止后端监听。
   */
  async function stopWatching(): Promise<void> {
    _refCount = Math.max(0, _refCount - 1)
    if (_refCount > 0) {
      console.log(`[FsWatcher] 引用计数减少至 ${_refCount}，保留监听`)
      // 仍需清理防抖状态，避免残留的 processChanges 在无人监听时触发
      if (_debounceTimer) {
        clearTimeout(_debounceTimer)
        _debounceTimer = null
      }
      return
    }
    // 引用计数归零 → 真正停止后端监听
    await stopBackendWatcher()
  }

  return {
    startWatching,
    stopWatching,
  }
}

/* ─── 内部实现 ─── */

/** 真正启动 Rust 端监听 + 前端事件监听 */
async function startBackendWatcher(dir: string): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const { listen } = await import('@tauri-apps/api/event')

    // 启动 Rust 端监听
    const id = `project-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    _watchId = await invoke('cmd_fs_watch_start', {
      path: dir,
      watchId: id,
    }) as string
    _watchedDir = dir

    // 监听前端事件
    _unlisten = await listen<{ watchId: string; kind: string; paths: string[] }>(
      'fs:change',
      (event) => {
        if (event.payload.watchId !== _watchId) return
        for (const path of event.payload.paths) {
          _pendingChanges.add(path)
        }
        // 防抖：合并短时间内的多次变更
        if (_debounceTimer) clearTimeout(_debounceTimer)
        _debounceTimer = setTimeout(() => {
          processChanges()
        }, DEBOUNCE_MS)
      },
    )

    console.log(`[FsWatcher] 开始监听: ${dir} (watchId=${_watchId}, ref=${_refCount})`)
  } catch (err) {
    console.warn('[FsWatcher] 启动监听失败:', err)
    // 启动失败时回滚状态，避免 _watchId 残留
    _watchId = null
    _watchedDir = null
  }
}

/** 真正停止 Rust 端监听 + 前端事件监听 */
async function stopBackendWatcher(): Promise<void> {
  if (_debounceTimer) {
    clearTimeout(_debounceTimer)
    _debounceTimer = null
  }
  if (_unlisten) {
    _unlisten()
    _unlisten = null
  }
  if (_watchId) {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('cmd_fs_watch_stop', { watchId: _watchId })
    } catch (err) {
      const msg = String((err as Error)?.message ?? err)
      // "not found" 表示后端已无此 watcher（可能已被清理），属正常情况
      if (msg.includes('not found') || msg.includes('not Found')) {
        console.log(`[FsWatcher] watcher ${_watchId} 已不在后端（正常）`)
      } else {
        console.warn(`[FsWatcher] 停止监听失败 (watchId=${_watchId}):`, err)
      }
    }
    _watchId = null
    _watchedDir = null
  }
  _pendingChanges.clear()
}

/**
 * 处理变更事件：解析受影响的文件，增量更新 Store
 * 如果处于自身写入静默期，跳过 reload 避免闪烁
 */
function processChanges() {
  const changes = new Set(_pendingChanges)
  _pendingChanges.clear()

  if (changes.size === 0) return

  const fsb = getFileStorageBackend()
  if (!fsb?.isReady || !fsb.projectDir) return

  // 自身写入静默期：跳过 reload，避免自身写入触发 UI 闪烁
  if (fsb.isInSelfWriteWindow) {
    console.log(`[FsWatcher] 自身写入静默期，跳过 reload (paths=${changes.size})`)
    return
  }

  const dir = fsb.projectDir.replace(/\\/g, '/')
  let entitiesChanged = false
  let relationsChanged = false
  let filesChanged = false
  let pluginsChanged = false
  let schemasChanged = false
  const entityPaths: string[] = []

  for (const path of changes) {
    const normalizedPath = path.replace(/\\/g, '/')
    // kv_store.json / files_meta.json 由 Rust 端过滤，此处兜底跳过
    if (normalizedPath.endsWith('/.worldsea/kv_store.json')) continue
    if (normalizedPath.endsWith('/.worldsea/files_meta.json')) continue
    if (normalizedPath.startsWith(`${dir}/entities/`)) {
      entitiesChanged = true
      entityPaths.push(path)
    } else if (normalizedPath.startsWith(`${dir}/relations/`)) {
      relationsChanged = true
    } else if (normalizedPath.startsWith(`${dir}/.worldsea/plugins/`)) {
      // 外部插件目录（批1）：world 树订阅做热装载
      pluginsChanged = true
    } else if (normalizedPath.startsWith(`${dir}/.worldsea/schemas/`)) {
      // 项目级 schema 覆盖目录（批7）：world 树订阅做热重填
      schemasChanged = true
    } else if (normalizedPath.startsWith(`${dir}/.worldsea/files_content/`)) {
      // 监听文件内容变更，支持外部编辑触发 fileStore reload
      filesChanged = true
    }
  }

  console.log(`[FsWatcher] 处理变更: entities=${entitiesChanged}, relations=${relationsChanged}, files=${filesChanged}, plugins=${pluginsChanged}, schemas=${schemasChanged}, paths=${changes.size}`)

  // 外部插件目录变更 → 分发给订阅方（world 树热装载；单点抛错不影响其余 handler）
  if (pluginsChanged && pluginDirHandlers.size > 0) {
    const paths = [...changes]
    for (const handler of pluginDirHandlers) {
      try {
        handler(paths)
      } catch (err) {
        console.warn('[FsWatcher] 插件目录处理器抛错（已隔离）:', err)
      }
    }
  }

  // 项目级 schema 覆盖变更 → 分发给订阅方（world 树热重填；单点抛错不影响其余 handler）
  if (schemasChanged && schemaDirHandlers.size > 0) {
    const paths = [...changes]
    for (const handler of schemaDirHandlers) {
      try {
        handler(paths)
      } catch (err) {
        console.warn('[FsWatcher] schema 目录处理器抛错（已隔离）:', err)
      }
    }
  }

  // 增量更新受影响的 Store；R4 只在同步 >1s 时出现顶线，不打断操作
  const syncs: Promise<void>[] = []

  if (entitiesChanged) {
    syncs.push((async () => {
      try {
        const entityStore = useEntityStore()
        await fsb.reloadPaths(entityPaths)
        await entityStore.loadAll()
        console.log('[FsWatcher] 实体已同步')
      } catch (err) {
        console.warn('[FsWatcher] 实体同步失败:', err)
        throw err
      }
    })())
  }

  if (relationsChanged) {
    syncs.push((async () => {
      try {
        await useRelationStore().loadAll()
        console.log('[FsWatcher] 关系已同步')
      } catch (err) {
        console.warn('[FsWatcher] 关系同步失败:', err)
        throw err
      }
    })())
  }

  if (filesChanged) {
    syncs.push((async () => {
      try {
        await useFileStore().loadAll()
        console.log('[FsWatcher] 文件已同步')
      } catch (err) {
        console.warn('[FsWatcher] 文件同步失败:', err)
        throw err
      }
    })())
  }

  if (syncs.length > 0) {
    const task = startBackgroundTask('正在同步外部变更')
    void Promise.allSettled(syncs).then((results) => {
      if (results.every(r => r.status === 'fulfilled')) task.done()
      else task.fail('部分外部变更同步失败')
    })
  }
}
