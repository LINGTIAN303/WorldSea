import type { A2UIMessage } from '../bridge-types'
import type { EntityLike, RelationLike, FileLike, FileContentLike } from '../tools/types'
import type { ProviderConfig } from '../providers/config'

export interface IEntityStore {
  entities: EntityLike[] | { value: EntityLike[] }
  add(entity: EntityLike, source?: string): Promise<string>
  update(id: string, changes: Partial<EntityLike>, source?: string): Promise<void>
  remove(id: string, source?: string): Promise<void>
  getById(id: string): Promise<EntityLike | undefined>
  getAllEntities(): Promise<EntityLike[]>
  loadByType(type: string): Promise<void>
  typeCounts: Map<string, number> | { value: Map<string, number> }
}

export interface IRelationStore {
  relations: RelationLike[] | { value: RelationLike[] }
  add(relation: RelationLike, source?: string): Promise<string>
  update(id: string, changes: Partial<RelationLike>): Promise<void>
  remove(id: string, source?: string): Promise<void>
  getAllRelations(): Promise<RelationLike[]>
  loadByEntity(entityId: string): Promise<void>
}

export interface IFileStore {
  files: FileLike[] | { value: FileLike[] }
  add(name: string, path: string, mimeType: string, size: number, content: string, entityId?: string, tags?: string[]): Promise<string>
  getById(id: string): Promise<FileLike | undefined>
  getByPath(path: string): Promise<FileLike | undefined>
  getByEntity(entityId: string): Promise<FileLike[]>
  getContent(id: string): Promise<FileContentLike | undefined>
  update(id: string, changes: Partial<FileLike>): Promise<void>
  remove(id: string): Promise<void>
  associateEntity(fileId: string, entityId: string): Promise<void>
  disassociateEntity(fileId: string): Promise<void>
  getAllFiles(): Promise<FileLike[]>
}

export interface ISettingsStore {
  getProviderConfig(): ProviderConfig
  getSearchConfig?: () => { engine?: string; apiKey?: string }
}

export interface IUIStore {
  confirm(title: string, message: string): Promise<boolean>
}

export interface IToolStores {
  entity: IEntityStore
  relation: IRelationStore
  file: IFileStore
  settings: ISettingsStore
  ui: IUIStore
}

export interface SessionSummary {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  messageCount: number
  pinned?: boolean
}

export interface IToolContext {
  stores: IToolStores
  projectInfo: {
    name: string
    entityTypes: string[]
    relationTypes: string[]
    /** 项目关联的本地目录路径（Phase 2：文件系统主存储） */
    dirPath?: string | null
  }
  emitA2UI?: (surfaceId: string, message: A2UIMessage) => void
  platform?: import('./capability-types').Platform
  appendBlock?: (block: import('../bridge-types').MessageBlock) => void
  reportProgress?: (progress: number, status?: string) => void
  /** 查找指定会话中的文境 block，用于 manuscript_clone */
  findManuscriptInSession?: (sessionId: string) => Promise<import('../bridge-types').ManuscriptBlock | null>
  /** 当前会话 ID */
  currentSessionId?: string
  /** 获取指定会话的摘要信息 */
  getSessionInfo?: (sessionId: string) => Promise<SessionSummary | null>
  /** 列出所有会话，可选按名称过滤 */
  listSessions?: (query?: string) => Promise<SessionSummary[]>
  /** 读取指定会话的消息内容 */
  readSessionMessages?: (sessionId: string) => Promise<{ role: string; content: string; timestamp: number }[] | null>
  /** 深度模式下等待用户确认工具执行（由 bridge.ts execute 调用） */
  waitForConfirmation?: (toolCallId: string) => Promise<boolean>
}
