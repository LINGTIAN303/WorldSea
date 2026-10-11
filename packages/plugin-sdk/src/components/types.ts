export interface FormFieldDef {
  key: string
  label: string
  /** schema 原始 fieldType——控件层统一归一，这里不再做「不认识就当天」的白名单收口 */
  type: 'text' | 'textarea' | 'richtext' | 'select' | 'multiSelect' | 'tags' | 'color' | 'number' | 'boolean' | 'date' | 'entityRef' | 'formula' | 'url' | 'email' | 'image'
  required?: boolean
  placeholder?: string
  options?: { value: string; label: string }[]
  rows?: number
  source?: 'builtin' | 'user' | 'shared'
  refType?: string
  relationType?: string
  autoLink?: boolean | { targetType: string; relationType: string; searchField?: string; createIfMissing?: boolean }
}

export interface RelationTabDef {
  id: string
  label: string
  icon?: string
  relationType: string
  targetLabel?: string
  targetIcon?: string
  showProperty?: string
  reverseDirection?: boolean
}

export interface CardFieldDef {
  key: string
  label?: string
  type?: 'text' | 'tag' | 'icon' | 'badge'
  classMap?: Record<string, string>
}

export interface CustomTabDef {
  id: string
  label: string
  icon?: string
}

export interface FilterDef {
  key: string
  label: string
  options?: { value: string; label: string }[]
  dynamic?: boolean
}
