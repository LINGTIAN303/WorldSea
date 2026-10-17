# 阅读包：entity-core

> 生成物（`node scripts/architecture/context.mjs entity-core`）——**可能滞后于代码**，实时口径以命令输出为准。
> kind: ts · roots: packages/entity-core/src · manifest: packages/entity-core/package.json

## 文件清单（91 个 / 共 14778 行）

> 2026-09-25 手工校准：`types/module.ts`(98) / `core/serializers/ModuleSerializer.ts`(50) / `stores/customModuleStore.ts`(44) / `types/layoutSchema.ts`(42) / `core/ModuleStoreApi.ts`(30) 五条随「自定义模块」整体剪除移除（公开契约面同步删 `createModuleSerializer` / `registerModuleStoreApi` / `getModuleStoreApi`）。生成物口径以重跑 `node scripts/architecture/context.mjs entity-core` 为准。

| 行数 | 文件 |
|---|---|
| 942 | packages/entity-core/src/core/FileStorageBackend.ts |
| 734 | packages/entity-core/src/core/AutoLinkEngine.ts |
| 617 | packages/entity-core/src/relations/index.ts |
| 614 | packages/entity-core/src/core/StorageBackend.ts |
| 538 | packages/entity-core/src/stores/settingsStore.ts |
| 420 | packages/entity-core/src/core/ProjectManager.ts |
| 366 | packages/entity-core/src/composables/useTheme.ts |
| 357 | packages/entity-core/src/core/ProjectFS.ts |
| 338 | packages/entity-core/src/agent-descriptor.ts |
| 329 | packages/entity-core/src/stores/entityStore.ts |
| 296 | packages/entity-core/src/composables/useUndoRedo.ts |
| 288 | packages/entity-core/src/core/FieldRegistry.ts |
| 286 | packages/entity-core/src/core/formula.ts |
| 273 | packages/entity-core/src/core/RelationshipRegistry.ts |
| 247 | packages/entity-core/src/core/TraitRuntime.ts |
| 244 | packages/entity-core/src/traits/index.ts |
| 242 | packages/entity-core/src/core/io/PackageBuilder.ts |
| 239 | packages/entity-core/src/core/PluginAPI.ts |
| 237 | packages/entity-core/src/core/ProjectMigration.ts |
| 217 | packages/entity-core/src/core/io/ExportController.ts |
| 212 | packages/entity-core/src/composables/useFsWatcher.ts |
| 204 | packages/entity-core/src/composables/useEntityImage.ts |
| 194 | packages/entity-core/src/stores/artifactStore.ts |
| 193 | packages/entity-core/src/types/trait.ts |
| 192 | packages/entity-core/src/core/events.ts |
| 185 | packages/entity-core/src/core/index.ts |
| 181 | packages/entity-core/src/stores/fontStore.ts |
| 175 | packages/entity-core/src/composables/useEntityTemplates.ts |
| 175 | packages/entity-core/src/index.ts |
| 173 | packages/entity-core/src/core/io/ImportController.ts |
| 163 | packages/entity-core/src/core/typeMappingRegistry.ts |
| 156 | packages/entity-core/src/composables/useOrphanCleanup.ts |
| 150 | packages/entity-core/src/stores/fileStore.ts |
| 150 | packages/entity-core/src/stores/__tests__/entityStore.spec.ts |
| 147 | packages/entity-core/src/core/io/io_export.ts |
| 144 | packages/entity-core/src/composables/useTrash.ts |
| 144 | packages/entity-core/src/stores/relationStore.ts |
| 139 | packages/entity-core/src/composables/useDataDiagnostics.ts |
| 138 | packages/entity-core/src/stores/uiStore.ts |
| 136 | packages/entity-core/src/core/database.ts |
| 135 | packages/entity-core/src/composables/useStorageStats.ts |
| 134 | packages/entity-core/src/core/relationTypes.ts |
| 132 | packages/entity-core/src/composables/useConsistencyChecker.ts |
| 129 | packages/entity-core/src/composables/useBidirectional.ts |
| 127 | packages/entity-core/src/core/formula-auto.ts |
| 127 | packages/entity-core/src/stores/fieldOrderStore.ts |
| 125 | packages/entity-core/src/core/serviceProvider.ts |
| 116 | packages/entity-core/src/composables/useSessionCleanup.ts |
| 115 | packages/entity-core/src/composables/useAdvancedSearch.ts |
| 115 | packages/entity-core/src/composables/useImageResolver.ts |
| 104 | packages/entity-core/src/composables/useVersionSnapshot.ts |
| 97 | packages/entity-core/src/composables/useFileSystemProject.ts |
| 93 | packages/entity-core/src/composables/useSmartFieldLink.ts |
| 92 | packages/entity-core/src/composables/useCascadeDelete.ts |
| 91 | packages/entity-core/src/core/EntitySchema.ts |
| 89 | packages/entity-core/src/facets/index.ts |
| 87 | packages/entity-core/src/stores/templateStore.ts |
| 85 | packages/entity-core/src/composables/useAutoBackup.ts |
| 81 | packages/entity-core/src/core/io/ioServices.ts |
| 81 | packages/entity-core/src/stores/trashStore.ts |
| 80 | packages/entity-core/src/core/io/WorldSeaPack.ts |
| 75 | packages/entity-core/src/types/plugin.ts |
| 74 | packages/entity-core/src/stores/__tests__/artifactStore.spec.ts |
| 70 | packages/entity-core/src/composables/useArtifacts.ts |
| 69 | packages/entity-core/src/composables/useDirtyTracker.ts |
| 64 | packages/entity-core/src/core/io/index.ts |
| 63 | packages/entity-core/src/composables/useAutoCleanup.ts |
| 63 | packages/entity-core/src/composables/useAutoCreateEntity.ts |
| 62 | packages/entity-core/src/core/serializers/EntitySerializer.ts |
| 62 | packages/entity-core/src/types/relation.ts |
| 53 | packages/entity-core/src/core/serializers/RelationSerializer.ts |
| 53 | packages/entity-core/src/stores/personaStore.ts |
| 53 | packages/entity-core/src/types/index.ts |
| 52 | packages/entity-core/src/composables/useTypeMapping.ts |
| 49 | packages/entity-core/src/types/entity.ts |
| 48 | packages/entity-core/src/composables/useEdgeDedup.ts |
| 47 | packages/entity-core/src/stores/pluginStore.ts |
| 45 | packages/entity-core/src/core/serializers/CustomFieldSerializer.ts |
| 36 | packages/entity-core/src/core/serializers/RelationTypeSerializer.ts |
| 35 | packages/entity-core/src/composables/index.ts |
| 35 | packages/entity-core/src/core/serializers/EntityTypeSerializer.ts |
| 35 | packages/entity-core/src/types/artifact.ts |
| 32 | packages/entity-core/src/stores/index.ts |
| 32 | packages/entity-core/src/types/template.ts |
| 31 | packages/entity-core/src/core/inverseRegistry.ts |
| 31 | packages/entity-core/src/core/serializers/ViewSerializer.ts |
| 29 | packages/entity-core/src/core/RelationSchema.ts |
| 20 | packages/entity-core/src/core/ProjectSwitcherApi.ts |
| 19 | packages/entity-core/src/core/serializers/types.ts |
| 18 | packages/entity-core/src/types/file.ts |
| 13 | packages/entity-core/src/core/serializers/index.ts |

## 公开契约面（src/index.ts 的导出）

- WorldDatabase
- db
- isTauri
- getStorageBackend
- storage
- getProjectManager
- migrateIfNeeded
- entitySchemaRegistry
- relationSchemaRegistry
- fieldRegistry
- pluginAPI
- inverseRegistry
- RelationTypes
- RelationTypeLabels
- InverseRelation
- getRelationLabel
- registerNodeType
- getNodeTypeInfo
- getNodeColor
- getAllNodeTypes
- registerEdgeType
- getEdgeTypeInfo
- getEdgeColor
- getAllEdgeTypes
- customFieldSerializer
- entitySerializer
- entityTypeSerializer
- relationSerializer
- relationTypeSerializer
- createViewSerializer
- registerEventBus
- getEventBus
- registerValidationApi
- getValidationApi
- registerToastApi
- getToastApi
- registerConfirmApi
- getConfirmApi
- registerDialogApi
- getDialogApi
- registerSettingsApi
- getSettingsApi
- registerProjectSwitcherApi
- getProjectSwitcherApi
- // Phase 5a: 项目文件系统导出/导入
  exportProjectToDir
- importProjectFromDir
- // Trait System V2
  traitRegistry
- facetRegistry
- entitySchemaRegistryV2
- defineTrait
- defineFacet
- defineEntity
- compileEntitySchema
- // Relationship Registry V2
  relationshipRegistry
- defineRelation
- syncToLegacyRegistry
- // AutoLink Engine
  semanticHintRegistry
- autoLinkStrategyRegistry
- registerDefaultStrategies
- potentialLinkIndex
- indexPotentialLinks
- refreshLinksForTarget
- inferSemanticHintFromKey
- inferDirectTargetFromKey
- userFieldMappingStore
- // Phase 8a: 事件总线
  eventBus
- // Phase 8a: io 模块
  serializerRegistry
- SerializerRegistry
- PACK_VERSION
- PackageBuilder
- ExportController
- defaultFormatEncoder
- ImportController
- importController
- getExportController
- getImportController
- exportData
- … re-export：./types / ./stores / ./composables

## 依赖与被依赖

- 依赖（requires）：（无）
- 被依赖：（无）

## 测试位置（2 个）

- packages/entity-core/src/stores/__tests__/entityStore.spec.ts（150 行）
- packages/entity-core/src/stores/__tests__/artifactStore.spec.ts（74 行）

## 文档指针（19 处）

- docs/details/注释/packages/entity-core/composables/useFileSystemProject.md
- docs/details/注释/packages/entity-core/composables/useFsWatcher.md
- docs/details/注释/packages/entity-core/composables/useImageResolver.md
- docs/details/注释/packages/entity-core/core/events.md
- docs/details/注释/packages/entity-core/core/FileStorageBackend.md
- docs/details/注释/packages/entity-core/core/formula-auto.md
- docs/details/注释/packages/entity-core/core/formula.md
- docs/details/注释/packages/entity-core/core/io/ExportController.md
- …（其余 11 处省略）
