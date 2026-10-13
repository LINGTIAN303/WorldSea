import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useShallowArray, useShallowRefMap } from '@worldsea/perf-kit/reactive'
import { getProjectManager } from '../core/ProjectManager'
import { getEventBus } from '../core/serviceProvider'
import type { Artifact, ArtifactVersion } from '../types'

/**
 * ArtifactStore — Agent 产物（多版本 + 回滚）
 * 采用「entity-core Dexie」存储：直接读写当前项目的 WorldDatabase（IndexedDB），不经过 StorageBackend 抽象（后者面向实体的 Tauri/File 多后端）；
 * 每次内容变更自动追加一个历史版本，支持回滚到任意版本。
 */
export const useArtifactStore = defineStore('artifact', () => {
  const { items: artifacts, setAll, push, removeById, updateById, findById } =
    useShallowArray<Artifact>('id')
  const { map: versionsMap, replaceAll: versionsReplaceAll, set: versionsSet, delete: versionsDel } =
    useShallowRefMap<string, ArtifactVersion[]>()
  const loading = ref(false)
  const error = ref<string | null>(null)

  function clearError() { error.value = null }
  function setError(msg: string) { error.value = msg; console.error('[ArtifactStore]', msg) }

  /** 当前项目的 WorldDatabase（Dexie）。项目切换后动态获取。 */
  function currentDb() {
    return getProjectManager().getCurrentProjectDb()
  }

  const totalCount = computed(() => artifacts.value.length)

  function sanitize(raw: (Artifact | undefined)[]): Artifact[] {
    return raw.filter((a): a is Artifact => a != null && typeof a.id === 'string')
  }

  /** 加载当前项目全部产物（含各产物版本列表）。项目切换后调用。 */
  async function loadAll() {
    clearError()
    loading.value = true
    try {
      const db = currentDb()
      const all = sanitize(await db.artifacts.toArray())
      all.sort((a, b) => (b.updated_at ?? b.created_at).localeCompare(a.updated_at ?? a.created_at))
      setAll(all)
      // 预载版本列表
      const versions = await db.artifact_versions.toArray()
      const grouped = new Map<string, ArtifactVersion[]>()
      for (const v of versions) {
        const list = grouped.get(v.artifact_id)
        if (list) list.push(v)
        else grouped.set(v.artifact_id, [v])
      }
      for (const list of grouped.values()) {
        list.sort((a, b) => b.version - a.version)
      }
      versionsReplaceAll(grouped)
    } catch (e: any) {
      setError(e?.message ?? '加载产物失败')
    } finally {
      loading.value = false
    }
  }

  /** 清空内存态（项目切换时由调用方触发，避免串项目数据） */
  function reset() {
    setAll([])
    versionsReplaceAll(new Map())
  }

  /** 新建产物（version=1，写入历史快照）。返回新 id。 */
  async function create(input: { title: string; content: string; artifact_type?: string }): Promise<string> {
    const db = currentDb()
    const projectId = getProjectManager().getCurrentProjectId() ?? ''
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    const artifact: Artifact = {
      id,
      title: input.title,
      content: input.content,
      artifact_type: input.artifact_type ?? 'document',
      version: 1,
      project_id: projectId,
      created_at: now,
      updated_at: now,
    }
    const version: ArtifactVersion = {
      id: crypto.randomUUID(),
      artifact_id: id,
      version: 1,
      content: input.content,
      created_at: now,
    }
    await db.transaction('rw', db.artifacts, db.artifact_versions, async () => {
      await db.artifacts.put(artifact)
      await db.artifact_versions.put(version)
    })
    push(artifact)
    versionsSet(id, [version])
    getEventBus().emit('artifact:create', { artifactId: id })
    return id
  }

  /** 更新产物内容。内容有变化时自动追加新版本（+1）。 */
  async function updateImpl(id: string, patch: { title?: string; content?: string; artifact_type?: string }): Promise<void> {
    const db = currentDb()
    const cur = findById(id) ?? (await db.artifacts.get(id))
    if (!cur) throw new Error(`产物不存在: ${id}`)

    const next: Partial<Artifact> = { ...patch, updated_at: new Date().toISOString() }
    delete (next as any).id
    delete (next as any).created_at

    // 内容有变化 → 追加历史版本
    if (patch.content != null && patch.content !== cur.content) {
      const newVersion = cur.version + 1
      const now = new Date().toISOString()
      const version: ArtifactVersion = {
        id: crypto.randomUUID(),
        artifact_id: id,
        version: newVersion,
        content: patch.content,
        created_at: now,
      }
      next.version = newVersion
      await db.transaction('rw', db.artifacts, db.artifact_versions, async () => {
        await db.artifacts.update(id, next)
        await db.artifact_versions.put(version)
      })
      updateById(id, { ...next, version: newVersion })
      versionsSet(id, [version, ...(versionsMap.value.get(id) ?? [])])
    } else {
      await db.artifacts.update(id, next)
      updateById(id, next)
    }
    getEventBus().emit('artifact:update', { artifactId: id })
  }

  /** 回滚到指定版本：把该版本内容写回当前内容，并追加一个新版本（保留完整历史）。 */
  async function rollback(id: string, targetVersion: number): Promise<void> {
    const versions = await getVersions(id)
    const target = versions.find(v => v.version === targetVersion)
    if (!target) throw new Error(`版本不存在: ${targetVersion}`)
    await updateImpl(id, { content: target.content })
  }

  /** 获取产物全部历史版本（按版本号降序）。 */
  async function getVersions(id: string): Promise<ArtifactVersion[]> {
    const cached = versionsMap.value.get(id)
    if (cached) return cached
    const list = await currentDb().artifact_versions
      .where('artifact_id')
      .equals(id)
      .toArray()
    list.sort((a, b) => b.version - a.version)
    versionsSet(id, list)
    return list
  }

  /** 获取指定产物指定版本。 */
  async function getVersion(id: string, version: number): Promise<ArtifactVersion | undefined> {
    const versions = await getVersions(id)
    return versions.find(v => v.version === version)
  }

  /** 删除产物及其全部历史版本。 */
  async function remove(id: string): Promise<void> {
    const db = currentDb()
    await db.transaction('rw', db.artifacts, db.artifact_versions, async () => {
      await db.artifacts.delete(id)
      await db.artifact_versions.where('artifact_id').equals(id).delete()
    })
    removeById(id)
    versionsDel(id)
    getEventBus().emit('artifact:delete', { artifactId: id })
  }

  return {
    artifacts,
    versionsMap,
    loading,
    error,
    totalCount,
    clearError,
    loadAll,
    reset,
    create,
    update: updateImpl,
    rollback,
    getVersions,
    getVersion,
    remove,
  }
})