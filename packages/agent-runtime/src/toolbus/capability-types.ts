export type Platform = 'web' | 'tauri' | 'cli'

export type CapabilityCategory = 'crud' | 'query' | 'transform' | 'render' | 'animation' | 'io'

export interface AvailabilitySpec {
  platforms: Platform[]
  chain: ('internal' | 'cli' | 'mcp')[]
  requiresUI?: boolean
  requiresWasm?: boolean
  requiresPinia?: boolean
  fallback?: string
}

export interface FieldDefinition {
  key: string
  label: string
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'richtext'
  required: boolean
  defaultValue?: unknown
  description: string
  enum?: string[]
  belongsToPlugin?: string
}

export interface SchemaContextSpec {
  entityType?: string
  resolveFields?: (ctx: import('./types').IToolContext) => FieldDefinition[]
  fieldPolicy: 'strict' | 'prefer-defined' | 'open'
}

export interface CapabilityDeclaration {
  id: string
  name: string
  description: string
  category: CapabilityCategory
  parameters: Record<string, import('../bridge-types').ToolParameter>
  availability: AvailabilitySpec
  schemaContext?: SchemaContextSpec
  execute: (args: Record<string, unknown>, ctx: import('./types').IToolContext) => Promise<string>
}

export interface LibraryDescriptor {
  id: string
  name: string
  version: string
  capabilities: CapabilityDeclaration[]
}

export interface SkillCapabilityBinding {
  internal: string[]
  cli: string[]
  mcp: string[]
}

export interface SkillSchemaContext {
  entityTypes: string[]
  fieldPolicy: 'strict' | 'prefer-defined' | 'open'
}
