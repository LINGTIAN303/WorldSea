import type { EntityTypeSchema, FieldSchema } from '../types'
import type { RelationTypeSchema, RelationTypeSchemaV2 } from '../types'
import type { PluginView } from '../types'
import type { ViewChange, ViewChangeListener } from '../types'
import type { TraitRef, FacetDefinition } from '../types/trait'
import { entitySchemaRegistry } from './EntitySchema'
import { relationSchemaRegistry } from './RelationSchema'
import { fieldRegistry } from './FieldRegistry'
import { storage } from './StorageBackend'
import { facetRegistry, entitySchemaRegistryV2, compileEntitySchema } from './TraitRuntime'
import { relationshipRegistry } from './RelationshipRegistry'

export interface NodeTypeDefinition {
  type: string
  category: string
  label: string
  icon: string
  color: string
  pluginId: string
  description: string
  configSchema: Record<string, unknown>
  [key: string]: unknown
}

export interface WorkflowTemplateDefinition {
  id: string
  name: string
  description: string
  category: string
  [key: string]: unknown
}

export interface ExternalNodeRegistry {
  register(handler: NodeTypeDefinition): void
  unregister(type: string): boolean
  getAll(): NodeTypeDefinition[]
}

class PluginAPIImpl {
  private _views: PluginView[] = []
  private hooks = new Map<string, Array<{ pluginId: string; fn: Function }>>()
  private _workflowTemplates: Map<string, WorkflowTemplateDefinition> = new Map()
  private _nodeTypes: Map<string, NodeTypeDefinition> = new Map()
  private _externalNodeRegistry: ExternalNodeRegistry | null = null
  private currentPluginId = ''
  /** 视图生命周期订阅者（显示侧镜像据此增删；真源是 `_views`）。 */
  private viewListeners = new Set<ViewChangeListener>()

  setPluginId(id: string) {
    this.currentPluginId = id
  }

  /** 当前注册作用域所属的插件 id（作用域原语需要读回并存）。 */
  getPluginId(): string {
    return this.currentPluginId
  }

  /**
   * 在**指定插件作用域**内执行注册。`currentPluginId` 是全局单值，任何注册都会把它
   * 覆写成「最后一次 activate 的芽」——第二棵树（世界语义）的插件若直接注册，身份会错乱。
   * 本原语进入前备份、退出后恢复（同步语义；异步注册请在 await 前完成，或用 `registerViewFor`）。
   */
  withPluginScope<T>(pluginId: string, fn: () => T): T {
    const previous = this.currentPluginId
    this.currentPluginId = pluginId
    try {
      return fn()
    } finally {
      this.currentPluginId = previous
    }
  }

  setExternalNodeRegistry(registry: ExternalNodeRegistry): void {
    this._externalNodeRegistry = registry
    for (const [, nodeType] of this._nodeTypes) {
      registry.register(nodeType)
    }
  }

  /** @deprecated 使用 registerEntityV2 替代。旧版调用会自动包装为 V2 注册。 */
  registerEntityType(schema: EntityTypeSchema): void {
    // 自动包装为 V2：将旧版 fields 全部作为 ownFields
    this.registerEntityV2({
      type: schema.typeKey,
      label: schema.label,
      icon: schema.icon,
      traits: [],
      ownFields: schema.fields || [],
    })
  }

  /**
   * V2: 基于 Trait 的实体注册。
   * 编译 EntitySchemaV2，同时兼容旧版 entitySchemaRegistry 和 fieldRegistry。
   */
  registerEntityV2(params: {
    type: string
    label: string
    icon?: string
    traits: TraitRef[]
    ownFields: FieldSchema[]
    facets?: string[]
  }): void {
    const schemaV2 = compileEntitySchema({
      ...params,
      pluginId: this.currentPluginId,
    })
    entitySchemaRegistryV2.register(schemaV2)

    // 兼容旧版：同时注册到旧版 entitySchemaRegistry 和 fieldRegistry
    entitySchemaRegistry.register({
      typeKey: schemaV2.type,
      label: schemaV2.label,
      icon: schemaV2.icon,
      fields: schemaV2._compiledFields,
      pluginId: this.currentPluginId,
    })
    fieldRegistry.registerBuiltin(schemaV2.type, schemaV2._compiledFields)
  }

  /**
   * 注册 Facet 定义。
   */
  registerFacet(facet: FacetDefinition): void {
    facetRegistry.register(facet)
  }

  /** @deprecated 使用 registerRelationV2 替代。关系定义已统一到全局 relations/index.ts。 */
  registerRelationType(schema: RelationTypeSchema): void {
    relationSchemaRegistry.register({ ...schema, pluginId: this.currentPluginId })
  }

  /**
   * V2: 注册关系到全局 RelationshipRegistry。
   * 同时兼容旧版 relationSchemaRegistry。
   * 如果关系已在全局定义文件中注册，此方法会跳过重复注册。
   */
  registerRelationV2(schema: RelationTypeSchemaV2): void {
    // 如果全局已注册，跳过
    if (relationshipRegistry.has(schema.type)) return
    relationshipRegistry.register({ ...schema, pluginId: this.currentPluginId })

    // 兼容旧版：同时注册到 relationSchemaRegistry
    relationSchemaRegistry.register({
      typeKey: schema.type,
      label: schema.label,
      sourceTypes: schema.sourceTypes,
      targetTypes: schema.targetTypes,
      directed: !schema.symmetric,
      inverseType: schema.inverseType,
      properties: schema.properties,
      pluginId: this.currentPluginId,
    })
  }

  registerView(view: PluginView): void {
    view.pluginId = this.currentPluginId
    if (this._views.find((v) => v.id === view.id)) return
    this._views.push(view)
    this.notifyViewChange('registered', view)
  }

  getViews(): PluginView[] {
    return this._views
  }

  unregisterView(viewId: string): boolean {
    const idx = this._views.findIndex(v => v.id === viewId)
    if (idx === -1) return false
    const [removed] = this._views.splice(idx, 1)
    if (removed) this.notifyViewChange('unregistered', removed)
    return true
  }

  /**
   * 订阅视图生命周期（注册 / 反注册 / 清空），返回退订函数。
   * **真源变更的唯一广播口**——显示侧（pluginStore、侧栏顺序与选中态）由装配层订阅镜像，
   * 各调用点（activate / deactivate / 模块注册 / 拆树）不许各自同步。
   */
  onViewChange(listener: ViewChangeListener): () => void {
    this.viewListeners.add(listener)
    return () => {
      this.viewListeners.delete(listener)
    }
  }

  /** 派发视图变更（监听器抛错逐个隔离，不影响注册/反注册本身）。 */
  private notifyViewChange(kind: ViewChange['kind'], view: PluginView): void {
    for (const listener of [...this.viewListeners]) {
      try {
        listener({ kind, view })
      } catch (error) {
        console.error('[PluginAPI] 视图变更监听器抛错（已隔离）:', error)
      }
    }
  }

  /** 清空所有已注册的视图（项目切换时使用；逐条派发反注册事件） */
  clearViews(): void {
    const removed = this._views.splice(0)
    for (const view of removed) this.notifyViewChange('unregistered', view)
  }

  unregisterHooksByPlugin(pluginId: string): number {
    let count = 0
    for (const [name, entries] of this.hooks) {
      const before = entries.length
      const filtered = entries.filter(e => e.pluginId !== pluginId)
      this.hooks.set(name, filtered)
      count += before - filtered.length
    }
    return count
  }

  registerHook(name: string, fn: Function): void {
    if (!this.hooks.has(name)) this.hooks.set(name, [])
    this.hooks.get(name)!.push({ pluginId: this.currentPluginId, fn })
  }

  async runHooks(name: string, ...args: unknown[]): Promise<void> {
    const entries = this.hooks.get(name)
    if (!entries) return
    for (const entry of entries) await entry.fn(...args)
  }

  async getEntities(type?: string) {
    if (type) return storage.getEntitiesByType(type)
    return storage.getAllEntities()
  }

  async getRelations(filter?: {
    type?: string
    sourceId?: string
    targetId?: string
  }) {
    let relations = await storage.getAllRelations()
    if (filter?.type) relations = relations.filter(r => r.type === filter.type)
    if (filter?.sourceId) relations = relations.filter(r => r.sourceId === filter.sourceId)
    if (filter?.targetId) relations = relations.filter(r => r.targetId === filter.targetId)
    return relations
  }

  async getEntity(id: string) {
    return storage.getEntity(id)
  }

  registerNodeType(nodeType: NodeTypeDefinition): void {
    const entry = { ...nodeType, pluginId: this.currentPluginId }
    this._nodeTypes.set(nodeType.type, entry)
    if (this._externalNodeRegistry) {
      this._externalNodeRegistry.register(entry)
    }
  }

  unregisterNodeType(type: string): boolean {
    this._nodeTypes.delete(type)
    if (this._externalNodeRegistry) {
      return this._externalNodeRegistry.unregister(type)
    }
    return true
  }

  getNodeTypeRegistry(): NodeTypeDefinition[] {
    if (this._externalNodeRegistry) {
      return this._externalNodeRegistry.getAll()
    }
    return Array.from(this._nodeTypes.values())
  }

  registerWorkflowTemplate(template: WorkflowTemplateDefinition): void {
    this._workflowTemplates.set(template.id, { ...template })
  }

  unregisterWorkflowTemplate(templateId: string): boolean {
    return this._workflowTemplates.delete(templateId)
  }

  getWorkflowTemplates(): WorkflowTemplateDefinition[] {
    return Array.from(this._workflowTemplates.values())
  }
}

export const pluginAPI = new PluginAPIImpl()
export type PluginAPIType = typeof pluginAPI
