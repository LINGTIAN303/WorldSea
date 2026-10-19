import type {
  EntitySchemaV2,
  FacetDefinition,
  FieldSchema,
  PluginView,
  RelationTypeSchemaV2,
  TraitDefinition,
  TraitField,
} from '@worldsea/entity-core'

export type FieldSourceKind = 'trait' | 'own' | 'replace' | 'user' | 'facet' | 'system'

export interface MatrixOption {
  value: string
  label: string
}

export interface MatrixField {
  key: string
  label: string
  fieldType: string
  required: boolean
  sourceKind: FieldSourceKind
  sourceLabel: string
  options?: MatrixOption[]
  notes: string[]
  search: string
}

export interface MatrixEntity {
  type: string
  label: string
  pluginId: string
  traits: string[]
  facets: string[]
  fields: MatrixField[]
}

export interface MatrixTrait {
  id: string
  label: string
  usage: number
  fields: TraitField[]
}

export interface MatrixFacet {
  id: string
  label: string
  hostTypes: string[]
  fields: MatrixField[]
}

export interface MatrixRelation {
  type: string
  label: string
  sourceTypes: string[]
  targetTypes: string[]
  inverseType: string
  inverseLabel: string
  symmetric: boolean
  domain?: string
  propertyCount: number
}

export interface MatrixView {
  id: string
  label: string
  icon: string
  pluginId: string
  toolbar: string
  entityTypes: string[]
}

export interface FieldMatrixSources {
  schemas: EntitySchemaV2[]
  traits: TraitDefinition[]
  facets: FacetDefinition[]
  relations: RelationTypeSchemaV2[]
  views: PluginView[]
  userFields: (type: string) => FieldSchema[]
}

export interface FieldMatrixStats {
  buds: number
  entities: number
  instances: number
  keys: number
  traits: number
  facets: number
}

export interface FieldMatrixModel {
  entities: MatrixEntity[]
  traits: MatrixTrait[]
  facets: MatrixFacet[]
  relations: MatrixRelation[]
  views: MatrixView[]
  stats: FieldMatrixStats
}
