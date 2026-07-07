import type { EntityCreateEvent, EntityUpdateEvent, EntityDeleteEvent, FieldChangeEvent, RelationCreateEvent, RelationDeleteEvent } from '../modules/runtime/events'

export type TriggerMethod = 'immediate' | 'pause' | 'sentence' | 'charCount'
export type PopupPosition = 'top-right' | 'bottom-right' | 'bottom-left' | 'top-center'

export interface SceneConfig {
  id: string
  label: string
  triggerSource: string
  recommendedMethod: TriggerMethod
  baseProbability: number
  position: PopupPosition
}

export const SCENE_CONFIGS: SceneConfig[] = [
  { id: 'entity_create', label: '实体创建', triggerSource: 'entity:create', recommendedMethod: 'immediate', baseProbability: 0.8, position: 'top-right' },
  { id: 'entity_delete', label: '实体删除', triggerSource: 'entity:delete', recommendedMethod: 'immediate', baseProbability: 0.9, position: 'top-center' },
  { id: 'field_short', label: '短文本编辑', triggerSource: 'field:change', recommendedMethod: 'pause', baseProbability: 0.5, position: 'bottom-right' },
  { id: 'field_long', label: '长文本编辑', triggerSource: 'field:change', recommendedMethod: 'sentence', baseProbability: 0.4, position: 'bottom-right' },
  { id: 'name_input', label: '名称输入', triggerSource: 'name:input', recommendedMethod: 'pause', baseProbability: 0.6, position: 'top-right' },
  { id: 'relation_create', label: '关系创建', triggerSource: 'relation:create', recommendedMethod: 'immediate', baseProbability: 0.3, position: 'bottom-left' },
  { id: 'relation_delete', label: '关系删除', triggerSource: 'relation:delete', recommendedMethod: 'immediate', baseProbability: 0.4, position: 'bottom-left' },
  { id: 'view_switch', label: '视图切换', triggerSource: 'view:switch', recommendedMethod: 'pause', baseProbability: 0.2, position: 'top-center' },
  { id: 'batch_edit', label: '批量编辑', triggerSource: 'batch:edit', recommendedMethod: 'immediate', baseProbability: 0.25, position: 'top-center' },
]

const SCENE_MAP = new Map(SCENE_CONFIGS.map(s => [s.id, s]))

export function getSceneConfig(sceneId: string): SceneConfig | undefined {
  return SCENE_MAP.get(sceneId)
}

export function getScenePosition(sceneId: string): PopupPosition {
  return SCENE_MAP.get(sceneId)?.position ?? 'top-right'
}

export interface TriggerContext {
  sceneId: string
  entityId: string
  changeType: 'create' | 'update' | 'delete' | 'field_change' | 'relation_create' | 'relation_delete' | 'view_switch' | 'name_input' | 'batch_edit'
  changedFields?: string[]
  oldValues?: Record<string, unknown>
  newValues?: Record<string, unknown>
  editDuration?: number
  currentView?: string
  fieldLength?: number
  /** 删除场景下预构建的 Persona 快照，避免实体已从 store 移除后无法构建 */
  prebuiltPersona?: { entityId: string; entityName: string; entityType: string; description: string; properties: Record<string, unknown>; relatedEntities: { name: string; type: string; relationType: string }[] }
}

const LONG_TEXT_THRESHOLD = 50

export function identifySceneFromEntityCreate(event: EntityCreateEvent): TriggerContext | null {
  if (event.source && event.source !== 'user') return null
  return {
    sceneId: 'entity_create',
    entityId: event.entityId,
    changeType: 'create',
  }
}

export function identifySceneFromEntityUpdate(event: EntityUpdateEvent): TriggerContext | null {
  if (event.source && event.source !== 'user') return null
  const changedFields = event.changedFields || []
  const hasName = changedFields.includes('name')
  const hasDesc = changedFields.includes('description')
  const hasProps = changedFields.includes('properties')
  let sceneId = 'field_short'
  if (hasName && !hasDesc && !hasProps) {
    sceneId = 'name_input'
  } else if (hasDesc) {
    sceneId = 'field_long'
  } else if (hasProps) {
    sceneId = 'field_short'
  }
  return {
    sceneId,
    entityId: event.entityId,
    changeType: 'update',
    changedFields: event.changedFields,
    oldValues: event.oldProperties,
    newValues: event.newProperties,
  }
}

export function identifySceneFromEntityDelete(event: EntityDeleteEvent): TriggerContext | null {
  if (event.source && event.source !== 'user') return null
  // BUG 4 修复：删除事件携带实体信息，在 context 中预构建 Persona 快照
  // 因为 entity:delete 事件在实体从 store 移除后才发射
  return {
    sceneId: 'entity_delete',
    entityId: event.entityId,
    changeType: 'delete',
    prebuiltPersona: {
      entityId: event.entityId,
      entityName: String(event.properties?.name || event.entityId.slice(0, 8)),
      entityType: event.entityType,
      description: String(event.properties?.description || ''),
      properties: (event.properties as Record<string, unknown>) || {},
      relatedEntities: [],
    },
  }
}

export function identifySceneFromFieldChange(event: FieldChangeEvent): TriggerContext | null {
  // BUG 5 修复：FieldChangeEvent 无 source 字段，暂不过滤
  // 但可通过事件来源上下文判断（formula 自动计算通常不经过用户交互路径）
  const valueLen = String(event.newValue ?? '').length
  const sceneId = valueLen >= LONG_TEXT_THRESHOLD ? 'field_long' : 'field_short'
  return {
    sceneId,
    entityId: event.entityId,
    changeType: 'field_change',
    changedFields: [event.field],
    oldValues: { [event.field]: event.oldValue },
    newValues: { [event.field]: event.newValue },
    fieldLength: valueLen,
  }
}

export function identifySceneFromRelationCreate(event: RelationCreateEvent): TriggerContext | null {
  if (event.source && event.source !== 'user') return null
  return {
    sceneId: 'relation_create',
    entityId: event.sourceId,
    changeType: 'relation_create',
  }
}

export function identifySceneFromRelationDelete(event: RelationDeleteEvent): TriggerContext | null {
  if (event.source && event.source !== 'user') return null
  return {
    sceneId: 'relation_delete',
    entityId: event.sourceId,
    changeType: 'relation_delete',
  }
}

export function identifySceneFromViewSwitch(viewName: string): TriggerContext {
  return {
    sceneId: 'view_switch',
    entityId: '',
    changeType: 'view_switch',
    currentView: viewName,
  }
}

export function identifySceneFromNameInput(entityId: string): TriggerContext {
  return {
    sceneId: 'name_input',
    entityId,
    changeType: 'name_input',
  }
}

export function identifySceneFromBatchEdit(entityIds: string[]): TriggerContext | null {
  if (entityIds.length === 0) return null
  return {
    sceneId: 'batch_edit',
    entityId: entityIds[0],
    changeType: 'batch_edit',
  }
}
