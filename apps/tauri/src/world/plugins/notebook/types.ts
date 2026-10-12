import type { Entity } from '@worldsea/entity-core'

export interface NotebookEntity extends Entity {
  type: 'notebook'
  properties: {
    content: string
    wordCount?: string
    sortOrder?: string
    // 批 5 F6：canvas 已移除（未实现占位）；历史数据如有残留以 markdown 语义兜底展示
    noteType: 'markdown' | 'code' | 'reference'
    backlinks?: string[]
    forwardLinks?: string[]
    linkedEntities?: string[]
    codeLanguage?: string
    codeOutput?: string
    folderId?: string
    tags?: string[]
    /** 置顶（批 3 I9）：侧栏置顶区 */
    pinned?: boolean
  }
}
