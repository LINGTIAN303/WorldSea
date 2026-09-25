import type { PluginInstance } from '@worldsea/entity-core/types'
import { pluginAPI, usePluginStore, entitySchemaRegistry, relationSchemaRegistry } from '@worldsea/entity-core'
import { PluginSandbox } from './PluginSandbox'

interface PluginRegistration {
  entityTypes: string[]
  relationTypes: string[]
  views: string[]
  hooks: string[]
  nodeTypes: string[]
  workflowTemplates: string[]
}

export class PluginManager {
  private loaded = new Map<string, PluginInstance>()
  private registrations = new Map<string, PluginRegistration>()
  /** 全局预注册的实体类型——即使芽未激活，元数据也可查询 */
  private preRegisteredTypes = new Map<string, { type: string; label: string; pluginId: string; active: boolean }>()

  /**
   * 全局预注册所有官方芽的实体类型元数据（26 芽；剪除「自定义模块」后，模块自造类型不再存在）。
   * 确保即使芽未激活，关系查询和类型引用也不会断裂。
   * 应在应用启动时调用一次。
   */
  preRegisterAllEntityTypes(): void {
    const knownTypes: Array<{ type: string; label: string; pluginId: string }> = [
      { type: 'character', label: '角色', pluginId: 'official.characters' },
      { type: 'region', label: '区域', pluginId: 'official.regions' },
      { type: 'event', label: '事件', pluginId: 'official.timeline' },
      { type: 'organization', label: '组织', pluginId: 'official.organizations' },
      { type: 'concept', label: '概念', pluginId: 'official.concepts' },
      { type: 'item', label: '道具', pluginId: 'official.items' },
      { type: 'building', label: '建筑', pluginId: 'official.buildings' },
      { type: 'species', label: '物种', pluginId: 'official.species' },
      { type: 'magic', label: '技能', pluginId: 'official.magic' },
      { type: 'language', label: '语言', pluginId: 'official.languages' },
      { type: 'culture', label: '文化', pluginId: 'official.culture' },
      { type: 'conflict', label: '冲突', pluginId: 'official.conflict' },
      { type: 'inspiration', label: '素材', pluginId: 'official.inspiration' },
      { type: 'plant', label: '植物', pluginId: 'official.plants' },
      { type: 'combat_stat', label: '战力', pluginId: 'official.combat_stats' },
      { type: 'manuscript', label: '正文', pluginId: 'official.manuscript' },
      { type: 'outline_node', label: '大纲节点', pluginId: 'official.outline' },
      { type: 'notebook', label: '笔记', pluginId: 'official.notebook' },
      { type: 'tactical_board', label: '战术板', pluginId: 'official.tactical-board' },
      { type: 'pipeline', label: '编排', pluginId: 'official.workflow' },
    ]
    for (const entry of knownTypes) {
      this.preRegisteredTypes.set(entry.type, { ...entry, active: false })
    }
  }

  /** 查询实体类型是否已预注册（无论芽是否激活） */
  isTypePreRegistered(type: string): boolean {
    return this.preRegisteredTypes.has(type)
  }

  /** 查询实体类型对应的芽是否已激活 */
  isTypeActive(type: string): boolean {
    return this.preRegisteredTypes.get(type)?.active ?? false
  }

  /** 项目切换前调用：清空已激活状态，允许重新 activate 重播种官方类型（registerEntityV2 双写旧版+V2） */
  resetForProjectSwitch(): void {
    this.loaded.clear()
    this.registrations.clear()
  }

  async activate(plugin: PluginInstance): Promise<void> {
    if (this.loaded.has(plugin.manifest.id)) {
      console.warn(`[PluginManager] 芽 "${plugin.manifest.id}" 已激活`)
      return
    }

    pluginAPI.setPluginId(plugin.manifest.id)

    const safeAPI = PluginSandbox.createSafeAPI(
      pluginAPI as unknown as Record<string, unknown>,
      plugin.manifest,
    )

    const beforeEntities = new Set(entitySchemaRegistry.getAll().map(s => s.typeKey))
    const beforeRelations = new Set(relationSchemaRegistry.getAll().map(s => s.typeKey))
    const beforeViews = new Set(pluginAPI.getViews().map(v => v.id))
    const beforeNodeTypes = new Set(pluginAPI.getNodeTypeRegistry().map(n => n.type))
    const beforeTemplates = new Set(pluginAPI.getWorkflowTemplates().map(t => t.id))

    await plugin.activate(safeAPI)

    const afterEntities = entitySchemaRegistry.getAll().map(s => s.typeKey)
    const afterRelations = relationSchemaRegistry.getAll().map(s => s.typeKey)
    const afterViews = pluginAPI.getViews().map(v => v.id)
    const afterNodeTypes = pluginAPI.getNodeTypeRegistry().map(n => n.type)
    const afterTemplates = pluginAPI.getWorkflowTemplates().map(t => t.id)

    const registeredEntityTypes = afterEntities.filter(t => !beforeEntities.has(t))
    const registeredRelationTypes = afterRelations.filter(t => !beforeRelations.has(t))
    const registeredViews = afterViews.filter(v => !beforeViews.has(v))
    const registeredNodeTypes = afterNodeTypes.filter(t => !beforeNodeTypes.has(t))
    const registeredTemplates = afterTemplates.filter(t => !beforeTemplates.has(t))

    this.registrations.set(plugin.manifest.id, {
      entityTypes: registeredEntityTypes,
      relationTypes: registeredRelationTypes,
      views: registeredViews,
      hooks: [],
      nodeTypes: registeredNodeTypes,
      workflowTemplates: registeredTemplates,
    })

    this.loaded.set(plugin.manifest.id, plugin)

    // 更新预注册类型的激活状态
    for (const type of registeredEntityTypes) {
      const entry = this.preRegisteredTypes.get(type)
      if (entry) entry.active = true
    }

    const store = usePluginStore()
    store.registerPlugin(plugin.manifest)

    // 视图镜像不在本处推送：真源（pluginAPI.registerView）派发生命周期事件，
    // 由 `viewSync` 的单一订阅写 pluginStore + uiStore（任何调用方注册的视图都同一路径）

    console.log(`[PluginManager] 已激活: ${plugin.manifest.name} v${plugin.manifest.version}`)
  }

  async deactivate(pluginId: string): Promise<void> {
    const plugin = this.loaded.get(pluginId)
    if (!plugin) return

    if (plugin.deactivate) {
      await plugin.deactivate()
    }

    const reg = this.registrations.get(pluginId)
    if (reg) {
      // 实体类型不再注销——全局预注册保证关系查询不断裂
      // 仅标记为未激活
      for (const type of reg.entityTypes) {
        const entry = this.preRegisteredTypes.get(type)
        if (entry) entry.active = false
      }
      // 关系类型仍可注销（关系注册中心Phase 3重构时改为全局保留）
      for (const type of reg.relationTypes) {
        relationSchemaRegistry.unregister(type)
      }
      for (const viewId of reg.views) {
        pluginAPI.unregisterView(viewId)
      }
      for (const nodeType of reg.nodeTypes) {
        pluginAPI.unregisterNodeType(nodeType)
      }
      for (const templateId of reg.workflowTemplates) {
        pluginAPI.unregisterWorkflowTemplate(templateId)
      }
      this.registrations.delete(pluginId)
    }

    this.loaded.delete(pluginId)
    console.log(`[PluginManager] 已停用: ${plugin.manifest.name}`)
  }

  async deactivateAll(): Promise<void> {
    const ids = Array.from(this.loaded.keys())
    for (const id of ids) {
      await this.deactivate(id)
    }
  }

  async reload(pluginId: string): Promise<void> {
    const plugin = this.loaded.get(pluginId)
    if (!plugin) return
    await this.deactivate(pluginId)
    await this.activate(plugin)
  }

  isLoaded(id: string): boolean {
    return this.loaded.has(id)
  }

  getLoaded(): PluginInstance[] {
    return Array.from(this.loaded.values())
  }

  getRegistration(pluginId: string): PluginRegistration | undefined {
    return this.registrations.get(pluginId)
  }

  getAllRegistrations(): Map<string, PluginRegistration> {
    return new Map(this.registrations)
  }
}

export const pluginManager = new PluginManager()
