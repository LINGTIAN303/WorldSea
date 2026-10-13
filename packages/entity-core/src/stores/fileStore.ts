import { ref } from 'vue'
import { defineStore } from 'pinia'
import { useShallowArray } from '@worldsea/perf-kit/reactive'
import { storage } from '../core/StorageBackend'
import type { ProjectFile, ProjectFileContent } from '../types/file'

/** 文件持久化事件载荷——id 必填，path 在 add 时已知，update 时从缓存或存储回读 */
export interface FilePersistedEvent {
  id: string
  path: string
}

type FilePersistedListener = (event: FilePersistedEvent) => void
const filePersistedListeners = new Set<FilePersistedListener>()

/**
 * 订阅「文件已写入 IndexedDB」事件。
 * 在 add/update 的 IDB 写完成且本地缓存更新后触发，订阅方在回调内读 store 一定能看到新数据。
 * 返回取消订阅的函数。
 */
export function onFilePersisted(listener: FilePersistedListener): () => void {
  filePersistedListeners.add(listener)
  return () => { filePersistedListeners.delete(listener) }
}

function emitFilePersisted(event: FilePersistedEvent): void {
  for (const listener of filePersistedListeners) {
    try {
      listener(event)
    } catch (e) {
      console.warn('[fileStore] onFilePersisted listener error:', e)
    }
  }
}

export const useFileStore = defineStore('files', () => {
  const { items: files, setAll, push, removeById, updateById, findById } = useShallowArray<ProjectFile>('id')
  const loading = ref(false)

  async function loadAll(): Promise<void> {
    loading.value = true
    try {
      setAll(await storage.getAllFiles())
    } finally {
      loading.value = false
    }
  }

  async function getById(id: string): Promise<ProjectFile | undefined> {
    const cached = findById(id)
    if (cached) return cached
    return storage.getFile(id)
  }

  async function getByPath(path: string): Promise<ProjectFile | undefined> {
    const cached = files.value.find(f => f.path === path)
    if (cached) return cached
    return storage.getFileByPath(path)
  }

  async function getByEntity(entityId: string): Promise<ProjectFile[]> {
    return storage.getFilesByEntity(entityId)
  }

  async function getContent(id: string): Promise<ProjectFileContent | undefined> {
    return storage.getFileContent(id)
  }

  async function add(
    name: string,
    path: string,
    mimeType: string,
    size: number,
    content: string,
    entityId?: string,
    tags: string[] = []
  ): Promise<string> {
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    const file: ProjectFile = {
      id,
      name,
      path,
      mimeType,
      size,
      entityId,
      tags,
      createdAt: now,
      updatedAt: now,
    }
    const fileContent: ProjectFileContent = {
      id,
      textContent: mimeType.startsWith('text/') || mimeType === 'application/json' || mimeType === 'application/xml' || mimeType === 'application/javascript' || mimeType === 'application/typescript' ? content : undefined,
      binaryData: !mimeType.startsWith('text/') && mimeType !== 'application/json' && mimeType !== 'application/xml' && mimeType !== 'application/javascript' && mimeType !== 'application/typescript' ? content : undefined,
    }
    await storage.putFile(file, fileContent)
    push(file)
    emitFilePersisted({ id, path })
    return id
  }

  async function update(id: string, changes: Partial<ProjectFile>): Promise<void> {
    const changesWithTs = { ...changes, updatedAt: new Date().toISOString() }
    await storage.updateFile(id, changesWithTs)
    updateById(id, changesWithTs)
    const updated = findById(id)
    if (updated) {
      emitFilePersisted({ id, path: updated.path })
    } else {
      // 缓存未命中时回读一次，确保事件 payload 携带最新 path
      const fresh = await storage.getFile(id)
      emitFilePersisted({ id, path: fresh?.path ?? '' })
    }
  }

  async function remove(id: string): Promise<void> {
    await storage.deleteFile(id)
    removeById(id)
  }

  async function associateEntity(fileId: string, entityId: string): Promise<void> {
    await update(fileId, { entityId })
  }

  async function disassociateEntity(fileId: string): Promise<void> {
    await update(fileId, { entityId: undefined })
  }

  async function getAllFiles(): Promise<ProjectFile[]> {
    return storage.getAllFiles()
  }

  return {
    files,
    loading,
    loadAll,
    getById,
    getByPath,
    getByEntity,
    getContent,
    add,
    update,
    remove,
    associateEntity,
    disassociateEntity,
    getAllFiles,
  }
})
