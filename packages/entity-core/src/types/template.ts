export interface EntityTemplate {
  id: string
  name: string
  icon: string
  entityType: string
  defaultProperties: Record<string, string>
  defaultTags?: string[]
  source: 'builtin' | 'custom'
  relatedTemplates?: Array<{
    relationType: string
    template: EntityTemplate
    asSource: boolean
  }>
}

export interface WorldTemplate {
  id: string
  name: string
  description: string
  icon: string
  entityTemplates: Array<{
    template: EntityTemplate
    count: number
  }>
  relationTemplates: Array<{
    sourceIndex: number
    targetIndex: number
    relationType: string
  }>
  source: 'builtin' | 'custom'
}
