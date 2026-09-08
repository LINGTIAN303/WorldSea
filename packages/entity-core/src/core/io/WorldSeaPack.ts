import type { Serializer, ImportStrategy, ImportReportItem } from '../serializers/types'
export type { Serializer, ImportStrategy, ImportReportItem } from '../serializers/types'

export const PACK_VERSION = 2

export interface WorldSeaManifest {
  version: number
  exportedAt: string
  appVersion?: string
  description?: string
}

export interface WorldSeaPack {
  manifest: WorldSeaManifest
  serializers: Record<string, unknown>
}

export interface ImportReport {
  success: boolean
  startedAt: string
  completedAt: string
  items: ImportReportItem[]
  strategy: ImportStrategy
}

export class SerializerRegistry {
  private serializers = new Map<string, Serializer>()

  register(s: Serializer): void {
    if (this.serializers.has(s.id)) {
      console.warn(`[SerializerRegistry] 覆盖已注册的序列化器: ${s.id}`)
    }
    this.serializers.set(s.id, s)
  }

  get(id: string): Serializer | undefined {
    return this.serializers.get(id)
  }

  getAll(): Serializer[] {
    return Array.from(this.serializers.values())
  }

  getSorted(): Serializer[] {
    const list = this.getAll()
    const visited = new Set<string>()
    const result: Serializer[] = []

    function visit(s: Serializer, stack: Set<string>) {
      if (visited.has(s.id)) return
      if (stack.has(s.id)) {
        throw new Error(`循环依赖: ${Array.from(stack).join(' → ')} → ${s.id}`)
      }
      stack.add(s.id)
      for (const depId of s.dependsOn) {
        const dep = list.find(x => x.id === depId)
        if (dep) visit(dep, stack)
      }
      stack.delete(s.id)
      visited.add(s.id)
      result.push(s)
    }

    for (const s of list) {
      if (!visited.has(s.id)) visit(s, new Set())
    }
    return result
  }

  unregister(id: string): void {
    this.serializers.delete(id)
  }

  clear(): void {
    this.serializers.clear()
  }
}

export const serializerRegistry = new SerializerRegistry()
