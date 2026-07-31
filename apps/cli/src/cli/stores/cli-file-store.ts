import type { IFileStore } from '@worldsmith/agent-runtime'
import type { FileLike, FileContentLike } from '@worldsmith/agent-runtime'
import { readJson, writeJson } from './json-store'
import * as fs from 'fs'
import * as path from 'path'

export class CliFileStore implements IFileStore {
  private dataPath: string
  private _files: FileLike[] = []

  constructor(dataPath: string) {
    this.dataPath = dataPath
    this.loadAll()
  }

  private loadAll(): void {
    this._files = readJson<FileLike[]>(this.dataPath, 'files', [])
  }

  private save(): void {
    writeJson(this.dataPath, 'files', this._files)
  }

  get files(): FileLike[] { return this._files }

  async add(name: string, filePath: string, mimeType: string, size: number, content: string, entityId?: string, tags?: string[]): Promise<string> {
    const id = `file-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const file: FileLike = {
      id, name, path: filePath, mimeType, size, entityId,
      tags: tags || [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    this._files.push(file)
    this.save()
    writeJson(this.dataPath, `file_contents/${id}`, { id, textContent: content })
    return id
  }

  async getById(id: string): Promise<FileLike | undefined> {
    return this._files.find(f => f.id === id)
  }

  async getByPath(p: string): Promise<FileLike | undefined> {
    return this._files.find(f => f.path === p)
  }

  async getByEntity(entityId: string): Promise<FileLike[]> {
    return this._files.filter(f => f.entityId === entityId)
  }

  async getContent(id: string): Promise<FileContentLike | undefined> {
    const data = readJson<{ id: string; textContent: string } | null>(this.dataPath, `file_contents/${id}`, null)
    return data ? { id: data.id, textContent: data.textContent } : undefined
  }

  async update(id: string, changes: Partial<FileLike>): Promise<void> {
    const idx = this._files.findIndex(f => f.id === id)
    if (idx === -1) return
    this._files[idx] = { ...this._files[idx], ...changes, updatedAt: new Date().toISOString() }
    this.save()
  }

  async remove(id: string): Promise<void> {
    this._files = this._files.filter(f => f.id !== id)
    this.save()
    const contentPath = path.join(this.dataPath, `file_contents/${id}.json`)
    try { fs.unlinkSync(contentPath) } catch {}
  }

  async associateEntity(fileId: string, entityId: string): Promise<void> {
    const idx = this._files.findIndex(f => f.id === fileId)
    if (idx === -1) return
    this._files[idx].entityId = entityId
    this.save()
  }

  async disassociateEntity(fileId: string): Promise<void> {
    const idx = this._files.findIndex(f => f.id === fileId)
    if (idx === -1) return
    this._files[idx].entityId = undefined
    this.save()
  }

  async getAllFiles(): Promise<FileLike[]> {
    return [...this._files]
  }
}
