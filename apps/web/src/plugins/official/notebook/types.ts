import type { Entity } from '@worldsmith/entity-core'

export interface NotebookEntity extends Entity {
  type: 'notebook'
  properties: {
    content: string
    wordCount?: string
    sortOrder?: string
    noteType: 'markdown' | 'code' | 'canvas' | 'reference'
    backlinks?: string[]
    forwardLinks?: string[]
    linkedEntities?: string[]
    codeLanguage?: string
    codeOutput?: string
    folderId?: string
    tags?: string[]
  }
}
