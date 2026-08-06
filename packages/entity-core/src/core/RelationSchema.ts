import type { RelationTypeSchema } from '../types'

class RelationSchemaRegistry {
  private schemas = new Map<string, RelationTypeSchema>()

  register(schema: RelationTypeSchema): void {
    this.schemas.set(schema.typeKey, schema)
  }

  get(type: string): RelationTypeSchema | undefined {
    return this.schemas.get(type)
  }

  getAll(): RelationTypeSchema[] {
    return Array.from(this.schemas.values())
  }

  unregister(type: string): void {
    this.schemas.delete(type)
  }

  /** 清空所有已注册的 schema（项目切换时使用） */
  clear(): void {
    this.schemas.clear()
  }
}

export const relationSchemaRegistry = new RelationSchemaRegistry()
