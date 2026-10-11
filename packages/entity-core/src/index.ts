// @worldsea/entity-core - Entity engine core package
// 内置关系定义注册（side-effect）：原载入点（src/App.vue → 后迁入 governor 启动模块）随端分离
// 迁移与旧结构下线消失，而新端启动装配从未接过 ⇒ relationshipRegistry 长期空表，
// 徽章等「注册表驱动」的面静默失效。接在包入口一处，app / 各包 / 测试 import 本包即一致
// （2026-10-08 修复）。加载后同步 V2 → 旧版 registry（relationSchemaRegistry 仍有消费者，
// 如 canvas-engine 图数据标签）——即老载入点的同款两步。
import './relations'
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
  // Phase 5a: ProjectFS 依赖注入服务接口
  registerProjectSwitcherApi,
  getProjectSwitcherApi,
  // Phase 5a: 项目文件系统导出/导入
  exportProjectToDir,
  importProjectFromDir,
  // Trait System V2
  traitRegistry,
  facetRegistry,
  entitySchemaRegistryV2,
  defineTrait,
  defineFacet,
  defineEntity,
  compileEntitySchema,
  // Relationship Registry V2
  relationshipRegistry,
  defineRelation,
  syncToLegacyRegistry,
  // AutoLink Engine
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
  // Phase 8a: 事件总线
  eventBus,
  // Phase 8a: io 模块
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
  // Phase 3: 公式引擎
  evaluateFormula,
  extractFieldRefs,
  registerFormulaAutoRecalc,
  unregisterFormulaAutoRecalc,
  getComputedFormulas,
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
  // Phase 5a: ProjectFS 依赖注入服务接口
  ProjectSwitcherApi,
  // Phase 5a: 项目文件系统导出/导入
  ProjectManifest,
  ProjectCache,
  ExportProgressCallback,
  ImportProgressCallback,
  // Phase 8a: 事件总线类型
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
  // Phase 8a: io 模块类型
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
export {
  registerIngestNormalizer,
  unregisterIngestNormalizer,
  normalizeIngestEntity,
  normalizeIngestEntities,
  type EntityIngestNormalizer,
} from './core/IngestNormalizers'
export * from './stores'
export * from './composables'
