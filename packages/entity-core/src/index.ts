// @worldsea/entity-core — 实体引擎核心包
// 包入口挂载内置关系定义注册（side-effect）：原载入点随端分离迁移消失，新端启动装配
// 从未接过 ⇒ relationshipRegistry 长期空表、徽章等注册表驱动面静默失效（2026-10-08 修复）。
// 接在包入口一处，app / 各包 / 测试 import 本包即一致；加载后同步 V2 → 旧版 registry
// （relationSchemaRegistry 仍有消费者，如 canvas-engine 图数据标签）——老载入点同款两步。
import './relations'
// 节点 ↔ 节点横向关系（2026-10-18 Q3-A）：单独文件注册，避免继续膨胀已冻结的 relations/index.ts
import './relations/outlineLateral'
import { syncToLegacyRegistry } from './core/RelationshipRegistry'
syncToLegacyRegistry()
export * from './types'
export {
  WorldDatabase,
  db,
  isTauri,
  getStorageBackend,
  getFileStorageBackend,
  storage,
  getProjectManager,
  migrateIfNeeded,
  entitySchemaRegistry,
  relationSchemaRegistry,
  fieldRegistry,
  pluginAPI,
  inverseRegistry,
  RelationTypes,
  RelationTypeLabels,
  InverseRelation,
  getRelationLabel,
  registerNodeType,
  getNodeTypeInfo,
  getNodeColor,
  getAllNodeTypes,
  registerEdgeType,
  getEdgeTypeInfo,
  getEdgeColor,
  getAllEdgeTypes,
  customFieldSerializer,
  entitySerializer,
  entityTypeSerializer,
  relationSerializer,
  relationTypeSerializer,
  createViewSerializer,
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
  // ProjectFS 依赖注入服务接口
  registerProjectSwitcherApi,
  getProjectSwitcherApi,
  // 项目文件系统导出/导入
  exportProjectToDir,
  importProjectFromDir,
  // Trait 系统 V2
  traitRegistry,
  facetRegistry,
  entitySchemaRegistryV2,
  defineTrait,
  defineFacet,
  defineEntity,
  compileEntitySchema,
  // 关系注册表 V2
  relationshipRegistry,
  defineRelation,
  syncToLegacyRegistry,
  // AutoLink 引擎
  semanticHintRegistry,
  autoLinkStrategyRegistry,
  registerDefaultStrategies,
  potentialLinkIndex,
  indexPotentialLinks,
  refreshLinksForTarget,
  inferSemanticHintFromKey,
  inferDirectTargetFromKey,
  userFieldMappingStore,
  autoLinkDecisionStore,
  // 事件总线
  eventBus,
  // io 模块
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
  // 公式引擎
  evaluateFormula,
  extractFieldRefs,
  registerFormulaAutoRecalc,
  unregisterFormulaAutoRecalc,
  getComputedFormulas,
  // 实体 schema 项目级覆盖（批7）
  validateSchemaOverlay,
  applySchemaOverlay,
  setSchemaOverlays,
  getSchemaOverlay,
  schemaOverlayCount,
} from './core'

// 触发 13 个原子 Trait 注册（副作用导入，必须在 core 导出之后）
// 不触发此导入会导致 traitRegistry 为空，芽 registerEntityV2 时全部 warn
import './traits'

export type {
  ModuleInstance,
  ProjectSetting,
  ProjectInfo,
  StorageBackend,
  RegisteredField,
  PluginAPIType,
  NodeTypeDefinition,
  WorkflowTemplateDefinition,
  ExternalNodeRegistry,
  RelationType,
  TypeInfo,
  EdgeTypeInfo,
  Serializer,
  ImportStrategy,
  ImportReportItem,
  EventBus,
  ValidationApi,
  ToastApi,
  ConfirmApi,
  DialogApi,
  SettingsApi,
  // ProjectFS 依赖注入服务接口
  ProjectSwitcherApi,
  // 项目文件系统导出/导入
  ProjectManifest,
  ProjectCache,
  ExportProgressCallback,
  ImportProgressCallback,
  // 事件总线类型
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
  // io 模块类型
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
} from './core'
export type {
  PotentialLink,
  UserFieldMapping,
} from './core/AutoLinkEngine'
export type { AutoLinkDecision, AutoLinkDecisionValue } from './core/AutoLinkDecisions'
export type { EntitySchemaOverlay, SchemaOverlayBase, SchemaOverlayResult } from './core/schemaOverlay'
export {
  registerIngestNormalizer,
  unregisterIngestNormalizer,
  normalizeIngestEntity,
  normalizeIngestEntities,
  type EntityIngestNormalizer,
} from './core/IngestNormalizers'
export * from './stores'
export * from './composables'
