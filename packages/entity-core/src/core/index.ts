export { WorldDatabase, db } from './database'
export type { ModuleInstance, ProjectSetting } from './database'

export { getProjectManager } from './ProjectManager'
export type { ProjectInfo, ProjectManagerClass } from './ProjectManager'

// 形象/视频资产导入（2026-10-25 形象图批计划 A 批）
export {
  resolveEntityDataDir,
  detectAssetKind,
  importAssetByDialog,
  importAssetByPath,
  importAssetByFile,
  ASSET_KIND_EXTS,
  ASSET_KIND_LABELS,
  ASSET_KIND_LIMITS,
  FILE_LINK_MAX_BYTES,
  ASSET_DIR_NAME,
  isAnimatedImageBytes,
  isAnimatedAsset,
} from './assetImport'
export type { AssetKind, AssetImportResult } from './assetImport'

// 区域运动坐标数学（2026-10-25 形象图批 D4）
export { computeDisplayBox, regionToClip, boxPointToRegion, trackToKeyframes, type DisplayBox } from './motionMath'

export { migrateIfNeeded } from './ProjectMigration'

export type { StorageBackend } from './StorageBackend'
export { isTauri, hasTauriInvoke, getStorageBackend, storage, StorageError, setStorageProjectDir, getFileStorageBackend } from './StorageBackend'
export { FileStorageBackend } from './FileStorageBackend'

export { entitySchemaRegistry } from './EntitySchema'
export { validateSchemaOverlay, applySchemaOverlay, setSchemaOverlays, getSchemaOverlay, schemaOverlayCount } from './schemaOverlay'
export type { EntitySchemaOverlay, SchemaOverlayBase, SchemaOverlayResult } from './schemaOverlay'

export { relationSchemaRegistry } from './RelationSchema'

export { fieldRegistry } from './FieldRegistry'
export type { FieldType, RegisteredField } from './FieldRegistry'

export { pluginAPI } from './PluginAPI'
export type { PluginAPIType, NodeTypeDefinition, WorkflowTemplateDefinition, ExternalNodeRegistry } from './PluginAPI'

export { inverseRegistry } from './inverseRegistry'

export {
  RelationTypes,
  RelationTypeLabels,
  InverseRelation,
  getRelationLabel,
} from './relationTypes'
export type { RelationType } from './relationTypes'

export {
  registerNodeType,
  getNodeTypeInfo,
  getNodeColor,
  getAllNodeTypes,
  registerEdgeType,
  getEdgeTypeInfo,
  getEdgeColor,
  getAllEdgeTypes,
} from './typeMappingRegistry'
export type { TypeInfo, EdgeTypeInfo } from './typeMappingRegistry'

export { customFieldSerializer } from './serializers/CustomFieldSerializer'
export { entitySerializer } from './serializers/EntitySerializer'
export { entityTypeSerializer } from './serializers/EntityTypeSerializer'
export { relationSerializer } from './serializers/RelationSerializer'
export { relationTypeSerializer } from './serializers/RelationTypeSerializer'
export { createViewSerializer } from './serializers/ViewSerializer'
export type { Serializer, ImportStrategy, ImportReportItem } from './serializers/types'

export {
  registerEventBus,
  getEventBus,
  registerValidationApi,
  getValidationApi,
  registerToastApi,
  getToastApi,
  registerConfirmApi,
  getConfirmApi,
  registerDialogApi,
  getDialogApi,
  registerSettingsApi,
  getSettingsApi,
} from './serviceProvider'
export type {
  EventBus,
  ValidationApi,
  ToastApi,
  ConfirmApi,
  DialogApi,
  SettingsApi,
} from './serviceProvider'

// 依赖注入服务接口（ProjectFS 解耦所需）
export { registerProjectSwitcherApi, getProjectSwitcherApi } from './ProjectSwitcherApi'
export type { ProjectSwitcherApi } from './ProjectSwitcherApi'

// 项目文件系统导出/导入（从根 src/core/ProjectFS.ts 迁移）
export {
  exportProjectToDir,
  importProjectFromDir,
} from './ProjectFS'
export type {
  ProjectManifest,
  ProjectCache,
  ExportProgressCallback,
  ImportProgressCallback,
} from './ProjectFS'

// 项目级附加扩展点（芽注册：目录导出文件 / 打包分区）
export { registerProjectExtraProvider, registerPackSerializer, getProjectExtraProviders } from './projectExtras'
export type { ProjectExtraFile, ProjectExtraProvider } from './projectExtras'

export {
  traitRegistry,
  facetRegistry,
  entitySchemaRegistryV2,
  defineTrait,
  defineFacet,
  defineEntity,
  compileEntitySchema,
} from './TraitRuntime'

// Phase 8a: 事件总线（从根 src/modules/runtime/events.ts 下沉）
export { eventBus } from './events'
export type {
  EntityCreateEvent,
  EntityUpdateEvent,
  EntityDeleteEvent,
  FieldChangeEvent,
  RelationCreateEvent,
  RelationDeleteEvent,
  NameInputEvent,
  TextInputEvent,
  BatchEditEvent,
  EventMap,
  EventName,
  EventHandler,
  Unsubscribe,
} from './events'

// Phase 8a: io 模块（从根 src/core/ 下沉）
export {
  serializerRegistry,
  SerializerRegistry,
  PACK_VERSION,
  PackageBuilder,
  ExportController,
  defaultFormatEncoder,
  ImportController,
  importController,
  getExportController,
  getImportController,
  exportData,
  parseImportData,
  importToDb,
  registerDownloader,
  getDownloader,
  registerPackValidator,
  getPackValidator,
  registerAppVersionProvider,
  getAppVersionProvider,
} from './io'
export type {
  WorldSeaManifest,
  WorldSeaPack,
  ImportReport,
  PackageManifest,
  FormatEncoder,
  HtmlExportOptions,
  ExportData,
  Downloader,
  PackValidator,
  ValidationReport,
  AppVersionProvider,
} from './io'

export {
  relationshipRegistry,
  defineRelation,
  syncToLegacyRegistry,
} from './RelationshipRegistry'

export {
  semanticHintRegistry,
  autoLinkStrategyRegistry,
  registerDefaultStrategies,
  potentialLinkIndex,
  indexPotentialLinks,
  refreshLinksForTarget,
  inferSemanticHintFromKey,
  inferDirectTargetFromKey,
  userFieldMappingStore,
} from './AutoLinkEngine'
export type { UserFieldMapping } from './AutoLinkEngine'

export { autoLinkDecisionStore } from './AutoLinkDecisions'
export type { AutoLinkDecision, AutoLinkDecisionValue } from './AutoLinkDecisions'

export { autoLinkRuntime, recordAutoLinkEvent, clearAutoLinkEvents } from './AutoLinkRuntime'
export type { AutoLinkRuntimeEvent, AutoLinkRuntimeEventKind } from './AutoLinkRuntime'

// 公式引擎（从 src/modules/runtime/ 下沉）
export { evaluateFormula, extractFieldRefs } from './formula'
export {
  registerFormulaAutoRecalc,
  unregisterFormulaAutoRecalc,
  getComputedFormulas,
} from './formula-auto'
