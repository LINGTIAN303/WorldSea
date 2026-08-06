import { ref } from 'vue'
import type { FieldSchema } from '../types'

export type FieldType = FieldSchema['fieldType']

export interface RegisteredField extends FieldSchema {
  source: 'builtin' | 'user' | 'shared'
  entityType: string
  order: number
  sharedFrom?: string
}

const STORAGE_KEY = 'worldsmith_field_registry'

class FieldRegistryClass {
  private fields = new Map<string, Map<string, RegisteredField>>()
  private _version = ref(0)

  get version() { return this._version }

  private bump() { this._version.value++ }

  registerBuiltin(entityType: string, fieldDefs: FieldSchema[]): void {
    if (!this.fields.has(entityType)) {
      this.fields.set(entityType, new Map())
    }
    const typeMap = this.fields.get(entityType)!
    const existingCount = Array.from(typeMap.values()).filter(f => f.source === 'builtin').length
    let orderBase = existingCount
    for (const f of fieldDefs) {
      const existing = typeMap.get(f.key)
      if (existing?.source === 'builtin') {
        typeMap.set(f.key, { ...existing, label: f.label, fieldType: f.fieldType, options: f.options, placeholder: f.placeholder, required: f.required })
        continue
      }
      const reg: RegisteredField = {
        ...f,
        source: 'builtin',
        entityType,
        order: existing?.order ?? orderBase,
      }
      typeMap.set(f.key, reg)
      orderBase++
    }
    this.bump()
  }

  addUserField(entityType: string, field: FieldSchema): boolean {
    if (!this.fields.has(entityType)) {
      this.fields.set(entityType, new Map())
    }
    const typeMap = this.fields.get(entityType)!
    if (typeMap.has(field.key)) {
      console.warn(`[FieldRegistry] 字段 "${field.key}" 已存在于 ${entityType}`)
      return false
    }
    const maxOrder = this.getMaxOrder(entityType)
    const reg: RegisteredField = {
      ...field,
      source: 'user',
      entityType,
      order: maxOrder + 1,
    }
    typeMap.set(field.key, reg)
    this.persist()
    this.bump()
    return true
  }

  shareFieldTo(sourceEntityType: string, key: string, targetEntityType: string): boolean {
    const sourceMap = this.fields.get(sourceEntityType)
    if (!sourceMap) return false
    const sourceField = sourceMap.get(key)
    if (!sourceField) return false

    if (!this.fields.has(targetEntityType)) {
      this.fields.set(targetEntityType, new Map())
    }
    const targetMap = this.fields.get(targetEntityType)!
    if (targetMap.has(key)) {
      console.warn(`[FieldRegistry] 字段 "${key}" 已存在于 ${targetEntityType}`)
      return false
    }

    const maxOrder = this.getMaxOrder(targetEntityType)
    const shared: RegisteredField = {
      key: sourceField.key,
      label: sourceField.label,
      fieldType: sourceField.fieldType,
      source: 'shared',
      entityType: targetEntityType,
      order: maxOrder + 1,
      sharedFrom: `${sourceEntityType}/${key}`,
      options: sourceField.options ? [...sourceField.options] : undefined,
      defaultValue: sourceField.defaultValue,
      placeholder: sourceField.placeholder,
    }
    targetMap.set(key, shared)
    this.persist()
    this.bump()
    return true
  }

  getFields(entityType: string): RegisteredField[] {
    const typeMap = this.fields.get(entityType)
    if (!typeMap) return []
    return Array.from(typeMap.values()).sort((a, b) => a.order - b.order)
  }

  getField(entityType: string, key: string): RegisteredField | undefined {
    return this.fields.get(entityType)?.get(key)
  }

  setOrder(entityType: string, orderedKeys: string[]): void {
    const typeMap = this.fields.get(entityType)
    if (!typeMap) return
    const keySet = new Set(orderedKeys)
    for (let i = 0; i < orderedKeys.length; i++) {
      const field = typeMap.get(orderedKeys[i])
      if (field) {
        typeMap.set(orderedKeys[i], { ...field, order: i })
      }
    }
    let nextOrder = orderedKeys.length
    for (const [key, field] of typeMap) {
      if (!keySet.has(key)) {
        typeMap.set(key, { ...field, order: nextOrder++ })
      }
    }
    this.persist()
    this.bump()
  }

  removeField(entityType: string, key: string): boolean {
    const typeMap = this.fields.get(entityType)
    if (!typeMap) return false
    const field = typeMap.get(key)
    if (!field || field.source === 'builtin') return false
    typeMap.delete(key)
    this.removeSharedReferences(entityType, key)
    this.persist()
    this.bump()
    return true
  }

  updateUserField(entityType: string, key: string, changes: Partial<FieldSchema>): boolean {
    const typeMap = this.fields.get(entityType)
    if (!typeMap) return false
    const field = typeMap.get(key)
    if (!field || field.source === 'builtin') return false
    typeMap.set(key, { ...field, ...changes })
    this.syncSharedFields(entityType, key)
    this.persist()
    this.bump()
    return true
  }

  getEntityTypes(): string[] {
    return Array.from(this.fields.keys())
  }

  exportData(): Record<string, RegisteredField[]> {
    const data: Record<string, RegisteredField[]> = {}
    for (const [entityType, typeMap] of this.fields) {
      const userFields = Array.from(typeMap.values()).filter(f => f.source !== 'builtin')
      if (userFields.length > 0) {
        data[entityType] = userFields
      }
    }
    return data
  }

  importData(data: Record<string, RegisteredField[]>): void {
    for (const [entityType, fields] of Object.entries(data)) {
      if (!this.fields.has(entityType)) {
        this.fields.set(entityType, new Map())
      }
      const typeMap = this.fields.get(entityType)!
      for (const f of fields) {
        if (typeMap.has(f.key) && typeMap.get(f.key)!.source === 'builtin') continue
        typeMap.set(f.key, { ...f, entityType })
      }
    }
    this.persist()
    this.bump()
  }

  loadPersisted(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const data: Record<string, RegisteredField[]> = JSON.parse(raw)
      let dirty = false
      for (const [entityType, fields] of Object.entries(data)) {
        if (!entityType) { dirty = true; continue }
        if (!this.fields.has(entityType)) {
          this.fields.set(entityType, new Map())
        }
        const typeMap = this.fields.get(entityType)!
        for (const f of fields) {
          if (typeMap.has(f.key) && typeMap.get(f.key)!.source === 'builtin') continue
          typeMap.set(f.key, { ...f, entityType })
        }
      }
      if (dirty) this.persist()
    } catch { /* ignore */ }
  }

  resetToBuiltin(entityType?: string): void {
    if (entityType) {
      const typeMap = this.fields.get(entityType)
      if (!typeMap) return
      const toDelete: string[] = []
      for (const [key, f] of typeMap) {
        if (f.source !== 'builtin') toDelete.push(key)
      }
      for (const key of toDelete) {
        typeMap.delete(key)
        this.removeSharedReferences(entityType, key)
      }
      let i = 0
      for (const [, f] of typeMap) {
        f.order = i++
      }
    } else {
      for (const [et, typeMap] of this.fields) {
        const toDelete: string[] = []
        for (const [key, f] of typeMap) {
          if (f.source !== 'builtin') toDelete.push(key)
        }
        for (const key of toDelete) {
          typeMap.delete(key)
          this.removeSharedReferences(et, key)
        }
        let i = 0
        for (const [, f] of typeMap) {
          f.order = i++
        }
      }
    }
    this.persist()
    this.bump()
  }

  private persist(): void {
    const data = this.exportData()
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  }

  private getMaxOrder(entityType: string): number {
    const typeMap = this.fields.get(entityType)
    if (!typeMap || typeMap.size === 0) return -1
    return Math.max(...Array.from(typeMap.values()).map(f => f.order))
  }

  private removeSharedReferences(sourceEntityType: string, key: string): void {
    const refId = `${sourceEntityType}/${key}`
    for (const [, typeMap] of this.fields) {
      for (const [k, f] of typeMap) {
        if (f.source === 'shared' && f.sharedFrom === refId) {
          typeMap.delete(k)
        }
      }
    }
  }

  private syncSharedFields(sourceEntityType: string, key: string): void {
    const sourceField = this.fields.get(sourceEntityType)?.get(key)
    if (!sourceField) return
    const refId = `${sourceEntityType}/${key}`
    for (const [, typeMap] of this.fields) {
      for (const [k, f] of typeMap) {
        if (f.source === 'shared' && f.sharedFrom === refId) {
          typeMap.set(k, {
            ...f,
            label: sourceField.label,
            fieldType: sourceField.fieldType,
            options: sourceField.options ? [...sourceField.options] : undefined,
            placeholder: sourceField.placeholder,
          })
        }
      }
    }
  }
}

export const fieldRegistry = new FieldRegistryClass()
