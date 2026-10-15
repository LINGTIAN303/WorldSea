import type { Entity } from '@worldsea/entity-core'

export interface NotebookEntity extends Entity {
  type: 'notebook'
  properties: {
    content: string
    wordCount?: string
    sortOrder?: string
    // 批 5 F6：canvas 已移除（未实现占位）；历史数据如有残留以 markdown 语义兜底展示
    noteType: 'markdown' | 'code' | 'reference'
    // 块 2 阶段 4：backlinks / forwardLinks / linkedEntities 三字段已退役
    //（建联＝内容的函数——关系统一由 backlinkDerive 派生落库，不再经 properties 中转；
    //  存量 properties 旧值不主动清理，无 UI 露出）
    codeLanguage?: string
    codeOutput?: string
    folderId?: string
    tags?: string[]
    /** 置顶（批 3 I9）：侧栏置顶区 */
    pinned?: boolean
  }
}
