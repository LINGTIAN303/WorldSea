import type { IEntityStore } from '@worldsmith/agent-runtime'
import type { EntityLike } from '@worldsmith/agent-runtime'
import { readJson, writeJson } from './json-store'

export class CliEntityStore implements IEntityStore {
  private dataPath: string
  private _entities: EntityLike[] = []
  private _typeCounts: Map<string, number> = new Map()

  constructor(dataPath: string) {
    this.dataPath = dataPath
    this.loadAll()
  }

  private loadAll(): void {
    this._entities = readJson<EntityLike[]>(this.dataPath, 'entities', [])
    this.recalcCounts()
  }

  private save(): void {
    writeJson(this.dataPath, 'entities', this._entities)
  }

  private recalcCounts(): void {
    this._typeCounts = new Map()
    for (const e of this._entities) {
      this._typeCounts.set(e.type, (this._typeCounts.get(e.type) || 0) + 1)
    }
  }

  get entities(): EntityLike[] { return this._entities }
  get typeCounts(): Map<string, number> { return this._typeCounts }

  async add(entity: EntityLike): Promise<string> {
    this._entities.push(entity)
    this.recalcCounts()
    this.save()
    return entity.id
  }

  async update(id: string, changes: Partial<EntityLike>): Promise<void> {
    const idx = this._entities.findIndex(e => e.id === id)
    if (idx === -1) return
    this._entities[idx] = { ...this._entities[idx], ...changes, updatedAt: new Date().toISOString() }
    this.recalcCounts()
    this.save()
  }

  async remove(id: string): Promise<void> {
    this._entities = this._entities.filter(e => e.id !== id)
    this.recalcCounts()
    this.save()
  }

  async getById(id: string): Promise<EntityLike | undefined> {
    return this._entities.find(e => e.id === id)
  }

  async getAllEntities(): Promise<EntityLike[]> {
    return [...this._entities]
  }

  async loadByType(_type: string): Promise<void> {}
}
