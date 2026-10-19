import type { EntitySchemaV2, FieldSchema, TraitDefinition, TraitField } from '@worldsea/entity-core'
import type {
  FieldMatrixModel,
  FieldMatrixSources,
  FieldSourceKind,
  MatrixEntity,
  MatrixField,
} from './types'

const TOP_LEVEL_NOTES: Record<string, string> = {
  title: '顶层 `name`（`title` 与 `name` 同义）',
  description: '顶层 `description`',
  tags: '顶层 `tags`',
  coverImage: '顶层 `coverImage`',
}

interface SourceMeta {
  kind: FieldSourceKind
  label: string
}

function sourceMeta(source: string): SourceMeta {
  if (source === 'own') return { kind: 'own', label: '芽自有' }
  if (source === 'user') return { kind: 'user', label: '用户自定义' }
  if (source === 'system') return { kind: 'system', label: '系统' }
  if (source.startsWith('facet:')) return { kind: 'facet', label: `Facet · ${source.slice(6)}` }
  if (source.startsWith('own+replace')) {
    const trait = source.match(/trait:([^)]+)/)?.[1] ?? ''
    return { kind: 'replace', label: `芽自有 · 覆盖 ${trait}` }
  }
  if (source.startsWith('trait:')) {
    const trait = source.slice(6).replace('+override', '')
    return { kind: 'trait', label: `Trait · ${trait}${source.endsWith('+override') ? '（覆写）' : ''}` }
  }
  return { kind: 'own', label: '芽自有' }
}

function toMatrixField(
  entityType: string,
  field: FieldSchema & { semanticHint?: string },
  source: string,
): MatrixField {
  const meta = sourceMeta(source)
  const notes: string[] = []
  if (TOP_LEVEL_NOTES[field.key]) notes.push(TOP_LEVEL_NOTES[field.key])
  if (field.placeholder) notes.push(`占位：${field.placeholder}`)
  if (field.defaultValue !== undefined) notes.push(`默认 \`${String(field.defaultValue)}\``)
  if (field.autoLink) notes.push(`AutoLink → \`${field.autoLink.targetType}\` / \`${field.autoLink.relationType}\``)
  if (field.semanticHint) notes.push(`semanticHint：\`${field.semanticHint}\``)
  if (field.refType) notes.push(`refType：\`${field.refType}\``)
  if (source.startsWith('own+replace')) notes.push('覆盖同名 trait 字段')
  if (source.endsWith('+override')) notes.push('Trait 字段覆写')
  if (field.fieldType === 'multi-select') notes.push('归一类型：`multiSelect`')
  if (entityType === 'event' && field.key === 'parentId') notes.push('事件树以属性为准，不建关系边')

  const options = field.options?.map(option => ({ value: option.value, label: option.label }))
  const search = [
    entityType,
    field.key,
    field.label,
    field.fieldType,
    meta.label,
    notes.join(' '),
    options?.map(option => `${option.value} ${option.label}`).join(' ') ?? '',
  ].join(' ').toLowerCase()

  return {
    key: field.key,
    label: field.label,
    fieldType: field.fieldType,
    required: Boolean(field.required),
    sourceKind: meta.kind,
    sourceLabel: meta.label,
    options,
    notes,
    search,
  }
}

function buildEntity(
  schema: EntitySchemaV2,
  traitMap: Map<string, TraitDefinition>,
  userFields: FieldSchema[],
): MatrixEntity {
  const fields: MatrixField[] = []
  const sources = new Map<string, string>()

  for (const ref of schema.traits) {
    const trait = traitMap.get(ref.traitId)
    if (!trait) continue
    for (const field of trait.fields) {
      const override = ref.fieldOverrides?.[field.key]
      const merged: TraitField = override ? { ...field, ...override } : { ...field }
      if (sources.has(merged.key)) continue
      const source = `trait:${ref.traitId}${override ? '+override' : ''}`
      sources.set(merged.key, source)
      fields.push(toMatrixField(schema.type, merged, source))
    }
  }

  for (const field of schema.ownFields) {
    const index = fields.findIndex(item => item.key === field.key)
    const source = index >= 0 ? `own+replace(${sources.get(field.key)})` : 'own'
    if (index >= 0) fields[index] = toMatrixField(schema.type, field, source)
    else {
      fields.push(toMatrixField(schema.type, field, source))
      sources.set(field.key, source)
    }
  }

  for (const field of userFields) {
    if (fields.some(item => item.key === field.key)) continue
    fields.push(toMatrixField(schema.type, field, 'user'))
  }

  return {
    type: schema.type,
    label: schema.label,
    pluginId: schema.pluginId ?? '',
    traits: [...schema._traitIds],
    facets: [...(schema.facets ?? [])],
    fields,
  }
}

export function buildMatrixModel(sources: FieldMatrixSources): FieldMatrixModel {
  const traitMap = new Map(sources.traits.map(trait => [trait.id, trait]))
  const entities = sources.schemas.map(schema =>
    buildEntity(schema, traitMap, sources.userFields(schema.type)),
  )
  const views = sources.views.map(view => ({
    id: view.id,
    label: view.label,
    icon: view.icon,
    pluginId: view.pluginId ?? '',
    toolbar: view.toolbar ?? 'bar',
    entityTypes: sources.schemas
      .filter(schema => schema.pluginId === view.pluginId)
      .map(schema => schema.type),
  }))
  const instances = entities.reduce((sum, entity) => sum + entity.fields.length, 0)

  return {
    entities,
    traits: sources.traits.map(trait => ({
      id: trait.id,
      label: trait.label,
      usage: sources.schemas.filter(schema => schema._traitIds.includes(trait.id)).length,
      fields: trait.fields,
    })),
    facets: sources.facets.map(facet => ({
      id: facet.id,
      label: facet.label,
      hostTypes: facet.hostTypes,
      fields: facet.fields.map(field => toMatrixField(`facet:${facet.id}`, field, `facet:${facet.id}`)),
    })),
    relations: sources.relations.map(relation => ({
      type: relation.type,
      label: relation.label,
      sourceTypes: relation.sourceTypes,
      targetTypes: relation.targetTypes,
      inverseType: relation.inverseType,
      inverseLabel: relation.inverseLabel,
      symmetric: relation.symmetric,
      domain: relation.domain,
      propertyCount: relation.properties?.length ?? 0,
    })),
    views,
    stats: {
      buds: new Set(sources.schemas.map(schema => schema.pluginId).filter(Boolean)).size,
      entities: sources.schemas.length,
      instances,
      keys: new Set(entities.flatMap(entity => entity.fields.map(field => field.key))).size,
      traits: sources.traits.length,
      facets: sources.facets.length,
    },
  }
}
