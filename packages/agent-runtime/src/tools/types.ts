/**
 * 工具上下文类型定义
 *
 * 定义 WorldSmith 工具执行时的上下文接口，包含：
 * - WorldSmithToolContext: 工具上下文（实体/关系/文件存储、项目信息、UI 发射等）
 * - EntityLike / RelationLike / FileLike: 领域对象的通用形状
 * - unwrap: 解包辅助函数
 */

import type { IEntityStore, IRelationStore, IFileStore, ISettingsStore, IUIStore } from '../toolbus/types'
export type { IToolContext } from '../toolbus/types'

/** 工具执行时注入的上下文对象，提供对项目存储和 UI 通道的访问 */
export interface WorldSmithToolContext {
  stores: {
    entity: IEntityStore
    relation: IRelationStore
    file: IFileStore
    settings: ISettingsStore
    ui: IUIStore
  }
  projectInfo: {
    name: string
    entityTypes: string[]
    relationTypes: string[]
    /** 项目关联的本地目录路径（Phase 2：文件系统主存储） */
    dirPath?: string | null
  }
  /** 向 A2UI 画布发射 UI 更新消息 */
  emitA2UI?: (surfaceId: string, message: import('../bridge-types').A2UIMessage) => void
  /** 当前运行平台 */
  platform?: import('../toolbus/capability-types').Platform
  /** 向聊天消息追加交互式 Block 组件（表格、图片等） */
  appendBlock?: (block: import('../bridge-types').MessageBlock) => void
  /** 上报工具执行进度（0-100），用于图片/视频生成等耗时操作 */
  reportProgress?: (progress: number, status?: string) => void
}

/** 实体的通用形状，兼容不同 store 实现的返回值 */
export interface EntityLike {
  id: string
  type: string
  name: string
  description: string
  properties: Record<string, unknown>
  tags: string[]
  avatar?: string
  createdAt: string
  updatedAt: string
}

/** 关系的通用形状 */
export interface RelationLike {
  id: string
  type: string
  sourceId: string
  targetId: string
  label?: string
  properties: Record<string, unknown>
  pairId?: string
  createdAt: string
  updatedAt: string
}

/** 文件的通用形状 */
export interface FileLike {
  id: string
  name: string
  path: string
  mimeType: string
  size: number
  entityId?: string
  tags: string[]
  createdAt: string
  updatedAt: string
}

/** 文件内容的通用形状（文本或二进制） */
export interface FileContentLike {
  id: string
  textContent?: string
  binaryData?: string
}

/**
 * 解包辅助函数
 *
 * 某些工具参数可能被包装为 `{ value: T }` 形式（来自 UI 中的数据绑定），
 * 此函数统一解包，优先取 `.value`，不存在则返回原值。
 *
 * @param val 可能被包装的值
 * @param fallback 值为 null/undefined 时的默认值
 */
export function unwrap<T>(val: T | { value: T } | undefined, fallback: T): T {
  if (val == null) return fallback
  if (typeof val === 'object' && 'value' in (val as any)) return (val as any).value ?? fallback
  return val as T
}
