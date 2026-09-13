/**
 * 思维导图文档数据模型 + 持久化
 *
 * 设计要点（2026-09-13 重做）：
 * - 导图 = 独立文档对象（多张并存），节点树为 mind-elixir 的纯 JSON 结构；
 *   树的骨架是「构思」而非实体——与旧版（把实体关系网当导图）的根本区别
 * - 节点绑定实体：存于 NodeObj.metadata.entityId（mind-elixir 官方通用元数据
 *   字段），不另设 sidecar 映射
 * - 持久化模式与 settingsStore 一致：localStorage（回退）+ 项目 DB
 *   project_settings 表（主存，项目级隔离）；键按文档 id 分条，避免单条过大
 */
import { getProjectManager } from '@worldsea/entity-core/core'
import type { MindElixirData } from 'mind-elixir'

export interface MindmapDocMeta {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

export interface MindmapDoc extends MindmapDocMeta {
  data: MindElixirData
}

const LS_INDEX_KEY = 'worldsea_mindmap_index'
const LS_DOC_PREFIX = 'worldsea_mindmap_doc_'
const DB_INDEX_KEY = 'mindmap_index'
const DB_DOC_PREFIX = 'mindmap_doc_'

/** 拿项目 DB；项目系统未初始化时返回 null（走 localStorage 回退） */
function getDb(): { table: (name: string) => { put: (row: { key: string; value: string }) => void; get: (key: string) => string | undefined } } | null {
  try {
    return getProjectManager().getCurrentProjectDb() as never
  } catch {
    return null
  }
}

function lsGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function lsSet(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* quota exceeded：localStorage 满时静默放弃（DB 为主存） */
  }
}

/** 读文档索引（DB 优先，DB 无记录时回退 localStorage——首次迁移场景） */
export function loadDocIndex(): MindmapDocMeta[] {
  const db = getDb()
  if (db) {
    try {
      const raw = db.table('project_settings').get(DB_INDEX_KEY)
      if (raw) return JSON.parse(raw) as MindmapDocMeta[]
    } catch {
      /* fallthrough to localStorage */
    }
  }
  return lsGet<MindmapDocMeta[]>(LS_INDEX_KEY, [])
}

/** 写文档索引（双写） */
export function saveDocIndex(index: MindmapDocMeta[]) {
  lsSet(LS_INDEX_KEY, index)
  const db = getDb()
  if (db) {
    try {
      db.table('project_settings').put({ key: DB_INDEX_KEY, value: JSON.stringify(index) })
    } catch {
      /* localStorage 已兜底 */
    }
  }
}

/** 读单张导图文档 */
export function loadDoc(id: string): MindmapDoc | null {
  const db = getDb()
  if (db) {
    try {
      const raw = db.table('project_settings').get(DB_DOC_PREFIX + id)
      if (raw) return JSON.parse(raw) as MindmapDoc
    } catch {
      /* fallthrough */
    }
  }
  return lsGet<MindmapDoc | null>(LS_DOC_PREFIX + id, null)
}

/** 写单张导图文档（双写） */
export function saveDoc(doc: MindmapDoc) {
  lsSet(LS_DOC_PREFIX + doc.id, doc)
  const db = getDb()
  if (db) {
    try {
      db.table('project_settings').put({ key: DB_DOC_PREFIX + doc.id, value: JSON.stringify(doc) })
    } catch {
      /* localStorage 已兜底 */
    }
  }
}

/** 删除单张导图文档（localStorage 侧删除；DB 无 delete 接口则覆盖为空值——文档索引中移除后不再被读取） */
export function removeDoc(id: string) {
  try {
    localStorage.removeItem(LS_DOC_PREFIX + id)
  } catch {
    /* ignore */
  }
  const db = getDb()
  if (db) {
    try {
      db.table('project_settings').put({ key: DB_DOC_PREFIX + id, value: JSON.stringify(null) })
    } catch {
      /* ignore */
    }
  }
}

/** 新文档默认数据：单根节点「中心主题」 */
export function newDocData(rootTopic = '中心主题'): MindElixirData {
  return {
    nodeData: { id: genId(), topic: rootTopic, children: [] },
  }
}

/** 短随机 id（文档/节点通用；mind-elixir 自建节点自带 id，此处用于文档 id 与初始根节点） */
export function genId(): string {
  return 'me' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}
