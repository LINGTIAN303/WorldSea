export type { FieldSchema, EntityTypeSchema, Entity } from './entity'

export type { RelationTypeSchema, RelationTypeSchemaV2, Relation } from './relation'

export type { ProjectFile, ProjectFileContent } from './file'

export type {
  PluginPermission,
  PluginCapabilityDeclaration,
  PluginDependency,
  PluginManifest,
  PluginView,
  PluginInstance,
  PluginPermissionName,
  ViewChange,
  ViewChangeListener,
} from './plugin'
export { KNOWN_PERMISSIONS } from './plugin'

export type {
  SemanticHintName,
  SemanticHint,
  TraitDefinition,
  TraitField,
  TraitRef,
  FacetDefinition,
  EntitySchemaV2,
  EntityV2,
  TraitPreset,
  AutoLinkStrategy,
} from './trait'

export type { EntityTemplate, WorldTemplate } from './template'

export type { Artifact, ArtifactVersion } from './artifact'
