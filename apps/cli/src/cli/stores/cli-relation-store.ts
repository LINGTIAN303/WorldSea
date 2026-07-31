import type { IRelationStore } from '@worldsmith/agent-runtime'
import type { RelationLike } from '@worldsmith/agent-runtime'
import { readJson, writeJson } from './json-store'

export class CliRelationStore implements IRelationStore {
  private dataPath: string
  private _relations: RelationLike[] = []

  constructor(dataPath: string) {
    this.dataPath = dataPath
    this.loadAll()
  }

  private loadAll(): void {
    this._relations = readJson<RelationLike[]>(this.dataPath, 'relations', [])
  }

  private save(): void {
    writeJson(this.dataPath, 'relations', this._relations)
  }

  get relations(): RelationLike[] { return this._relations }

  async add(relation: RelationLike): Promise<string> {
    this._relations.push(relation)
    this.save()
    return relation.id
  }

  async update(id: string, changes: Partial<RelationLike>): Promise<void> {
    const idx = this._relations.findIndex(r => r.id === id)
    if (idx === -1) return
    this._relations[idx] = { ...this._relations[idx], ...changes, updatedAt: new Date().toISOString() }
    this.save()
  }

  async remove(id: string): Promise<void> {
    this._relations = this._relations.filter(r => r.id !== id)
    this.save()
  }

  async getAllRelations(): Promise<RelationLike[]> {
    return [...this._relations]
  }

  async loadByEntity(_entityId: string): Promise<void> {}
}
