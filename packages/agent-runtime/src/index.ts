/** 端无关 Agent 运行时包入口（导出汇总与端特定代码注入说明），详细见 docs/details/注释/packages/agent-runtime/index.md */

// ═══ Agent 核心 ═══
export { createWorldSeaAgent, getToolsForSkills, ALL_TOOLS, ALL_TOOLS_MAP, TOOL_CATEGORIES, internalRegistry } from './agent'
export type { CreateAgentOptions } from './bridge-types'
export type { IAgentBackend } from './bridge'
export type { AgentEvent, AgentEventListener, AgentConfig, ToolDefinition, ToolParameter, PromptOptions, ImageAttachment, UsageData, ThinkingLevel, ChatMode, A2UIMessage, A2UIComponent, MessageBlock, TableBlock, ChoiceBlock, CodeBlockData, EntityCardBlock, AlertBlock, StatBlock, ListBlock, ProgressBlock, ComparisonBlock, TimelineBlock, ImageBlock, VideoBlock, AccordionBlock, ManuscriptBlock, ExportCorrectorConfig } from './bridge-types'
export type { WorldSeaToolContext, EntityLike, RelationLike, FileLike, FileContentLike } from './tools/types'

// ═══ 工具总线 ═══
export { DefaultToolBus } from './toolbus/toolbus'
export type { ToolBus } from './toolbus/toolbus'
export type { IToolContext, IToolStores, IEntityStore, IRelationStore, IFileStore, ISettingsStore, IUIStore, SessionSummary } from './toolbus/types'

// ═══ MCP ═══
export type { MCPConnectionConfig, MCPTransportType, MCPToolInfo, MCPConnectionState } from './mcp/types'

// ═══ 会话管理 ═══
export type { AgentSession, AgentMessage, AgentStateSnapshot, ToolCallRecord, ProviderMode, RuntimeModelInfo, ImageAttachment as SessionImageAttachment, FileAttachment, SessionUsage } from './session/types'
export { listSessions, getSession, saveSession, deleteSession, createSession, pinSession, unpinSession, renameSession, countSessions, setAgentCurrentProjectId, releaseAgentDb } from './session/manager'

// ═══ Provider 配置 ═══
export type { ProviderConfig, CloudProviderConfig, LocalProviderConfig, CustomProviderConfig, CloudProvider, LocalApiType, CustomApiType } from './providers/config'
export { DEFAULT_CLOUD_CONFIGS } from './providers/config'
export {
  getProviderManifest,
  getAllProviderManifests,
  getDomesticProviderIds,
  getProxyPathMap,
  getDefaultModelMap,
  getProviderLabelMap,
  getProviderIds,
  detectVisionSupport,
  detectThinkingSupport,
  resolveModelId,
  buildDirectEndpoint,
  buildModelsEndpoint,
  buildProxyEndpoint,
  registerProviderManifest,
} from './providers/provider-registry'
export type { ProviderManifest, ProviderCompatConfig, ApiType, ThinkingFormat, ThinkingLevelMap, VisionDetector, ThinkingDetector, EndpointConfig } from './providers/provider-registry'
// Phase 4 收尾：供应商配置解析器（原 @agent/providers/resolve）
export { resolveModel } from './providers/resolve'
export type { ResolvedModel } from './providers/resolve'
export { fetchModelsFromProvider, getCachedModels, refreshModels, getModelsWithBackgroundRefresh, getLastModelFetchInfo, clearModelCache, clearAllModelCache } from './providers/model-fetcher'
export type { FetchedModelEntry, ModelFetchInfo } from './providers/model-fetcher'
export { storeApiKey, loadApiKey, removeApiKey, hasApiKey } from './providers/key-store'

// ═══ 模型注册表 ═══
// 模型静态元数据（价格/上下文/能力等）+ 查询/筛选/成本计算工具
// 注：与 session/types.ts 的 RuntimeModelInfo（运行时快照）语义不同
// - ModelInfo：注册表条目，字段完整（id/name/contextLength/价格/能力等）
// - RuntimeModelInfo：运行时快照，字段精简（modelId/displayName/contextWindow）
export {
  MODEL_REGISTRY,
  getModelInfo,
  modelSupportsVision,
  getVisionModels,
  getModelsByProvider,
  getModelsByProviderAsync,
  getDefaultModelId,
  getModelPresets,
  calculateCost,
  getThinkingLevels,
} from './providers/model-registry'
export type { ModelInfo, CostBreakdown } from './providers/model-registry'

// ═══ 上下文构建 ═══
export { buildContextInjection, invalidateContextCache } from './context/builder'
export { buildSystemPrompt, buildSharedBaseLayer } from './context/injector'
export { buildProjectSummary, formatSummaryForPrompt, truncateMessages } from './context/summary'

// ═══ 工具与日志 ═══
export { logger, setLogLevel } from './utils/logger'
export { checkRateLimit, recordRequest, recordUsage, getUsageSummary } from './utils/rate-limit'

// ═══ 技能系统 ═══
export { SKILL_REGISTRY, getEnabledSkills, getAllSkills, toggleSkill, resolveToolNames, ALWAYS_AVAILABLE_TOOLS } from './skills/registry'
export type { SkillMeta } from './skills/registry'
// Skills Store：远程技能源下载/安装/卸载/更新 + 本地导入
export { downloadRemoteManifest, installSkill, installSkillAndReload, uninstallSkill, uninstallSkillAndReload, getInstalledVersions, checkUpdates, importLocalSkill, importLocalSkillAndReload, hasSkillsInvoke, createSkillAndReload } from './skills/skills-store'
export type { InstallResult, InstalledMeta, RemoteSkillEntry, RemoteManifest, InstallSkillOptions, ImportLocalOptions, CreateSkillOutcome } from './skills/skills-store'
// S2 协议基座（2026-09-18）：创建/导入组装层 + 协议校验器 + 扫描警告
export { buildSkillTemplate, composeSkillMd, buildSidecarJson, sidecarJsonFromMeta, validateSkillMdText, isCreatableSkillId } from './skills/creator'
export type { SkillCreateInput, SkillCreateTemplate } from './skills/creator'
export { validateSkillFrontmatter, isSkillCompliant, isValidSkillName } from './skills/validator'
export type { SkillValidationIssue, SkillValidationLevel } from './skills/validator'
export { getInstalledScanWarnings, mergeInstalledOverBuiltin } from './skills/registry'
export { parseWorldSeaSkillSidecar, WORLDSEA_SKILL_SIDECAR_FILE } from './skills/sidecar'
export type { WorldSeaSkillSidecar } from './skills/sidecar'
// 多平台互通：Claude Code / Cursor / WorldSea 格式双向转换
export { detectPlatform, importClaudeCodeSkill, importCursorRule, importWorldSeaYaml, autoImportSkill, exportToClaudeCodeSkill, exportToCursorRule, exportToSkillYaml } from './skills/platform-adapters'
export type { SkillPlatform, ImportResult } from './skills/platform-adapters'
export { resolvePluginToolNames, buildPluginCapabilityPrompt, registerPluginCapability, getPluginCapability, getAllPluginCapabilities, resolveRelatedPlugins } from './skills/plugin-bridge'
export type { PluginCapability } from './skills/plugin-bridge'

// ═══ 工具导出 ═══
export { outputTools, outputTable, outputChoice, outputCode, outputEntityCard, outputAlert, outputStat, outputList, outputProgress, outputComparison, outputTimeline, outputImage, outputAccordion, outputManuscript } from './tools/output-tools'
export { manuscriptClone } from './tools/manuscript-tools'
export { sessionTools, sessionInfo, sessionList, sessionRead } from './tools/session-tools'
export { recallMemory, formatMemoryForPrompt, memoryTools } from './tools/memory'
export { imageGenTools } from './tools/image-gen-tools'
export { planTools } from './tools/plan-tools'
export { nativeTools } from './tools/native-tools'
export { videoGenTools } from './tools/video-gen-tools'
export { storeImages, getImages, removeImages, visionTools, type StoredImage } from './tools/vision-tools'
// Phase 1 端分离：CLI/Web/Tauri 共用的工具集（之前未从主入口导出，现已补齐）
export { codingAgentTools, CODING_AGENT_TOOL_NAMES, LEGACY_TO_CODING_MAP } from './tools/coding-agent-tools'
export { entityCrudTools } from './tools/entity-crud'
export { relationManageTools } from './tools/relation-manage'
export { contentSearchTools } from './tools/content-search'
export { fileTools } from './tools/file-tools'
export { gitTools } from './tools/git-tools'
export { sysTools } from './tools/sys-tools'
export { kbTools } from './tools/kb-tools'
export { personaTools } from './tools/persona'
export { schemaTools } from './tools/schema-tools'
export { algoTools, LEGACY_ALGO_MAP } from './tools/algo-tools'
export { projectTools } from './tools/project-io'
export { crawlTools } from './tools/crawl-tool'
export { docConvertTools } from './tools/doc-convert-tool'
export { pluginTools } from './tools/plugin-tools'
export { pkgTools } from './tools/pkg-tools'
export { webSearchTools } from './tools/web-search'
export { webFetchTools } from './tools/web-fetch'
export { orchestratorTools } from './tools/orchestrator-tools'
// 工具元数据注册中心（CLI/Tauri 安全守卫依赖）
export { initToolMetaRegistry, getToolMeta, resetToolMetaCache } from './tools/tool-meta-registry'
// 工具总线内部链注册（CLI Agent 依赖）
export { InternalChainRegistry } from './toolbus/internal-registry'

// ═══ Embedding（向量嵌入） ═══
export { generateEmbedding, generateEmbeddings, cosineSimilarity, clearEmbeddingCache, getEmbeddingConfig, saveEmbeddingConfig } from './embedding/service'
export type { EmbeddingConfig } from './embedding/service'
export { putVector, putVectors, getVector, deleteVector, getCollection, searchSimilar, deleteCollection, getCollectionSize } from './embedding/vector-store'
export type { VectorRecord, SearchResult as VectorSearchResult } from './embedding/vector-store'
export { indexEntity, indexEntities, removeEntityIndex, indexMemoryEntry, removeMemoryIndex, syncEntityIndex, semanticSearch, semanticSearchEntities, semanticSearchMemory, isEmbeddingReady, getEmbeddingStats } from './embedding/index'
export type { SemanticSearchResult } from './embedding/index'
export { EMBEDDING_PRESETS } from './embedding/service'

// ═══ 图像/视频持久化 ═══
export { persistImage, getImage, getByPath, getImagesByPathPrefix, getAllImages, deleteImage, deleteImagesByPrefix, getImageCount, srcToBlob, downloadBlob, blobToDataUrl, onImagePersisted } from './stores/image-persistence'
export type { PersistedImage, ImagePersistedEvent } from './stores/image-persistence'
export { persistVideo, getVideo, getVideosByPathPrefix, getAllVideos, deleteVideo, getVideoCount, urlToBlob, blobToDataUrl as videoBlobToDataUrl } from './stores/video-persistence'
export type { PersistedVideo } from './stores/video-persistence'

// ═══ Group Chat ═══
export type {
  AgentProfile,
  AgentPersonality,
  SpeakingDesireConfig,
  ProviderSlot,
  ProviderSlotEntry,
  LoadBalanceStrategy,
  TurnStrategy,
  GroupChatMessage,
  GroupChatSession,
  RateLimitConfig,
} from './group-chat/types'
export { ProviderPool } from './group-chat/provider-pool'
export { FlowController } from './group-chat/flow-control'
export { GroupChatMessageBus } from './group-chat/message-bus'
export type { GroupChatEvent, GroupChatEventListener } from './group-chat/message-bus'
export { TurnEngine } from './group-chat/turn-engine'
export type { TurnResult } from './group-chat/turn-engine'
export { evaluateSpeakingDesire, computeTopicRelevance, createLuckState, updateLuck } from './group-chat/speaking-desire'
export type { SpeakingDesireContext, SpeakingDesireResult, LuckState } from './group-chat/speaking-desire'
export { runModerator } from './group-chat/moderator'
export { listAgentProfiles, getAgentProfile, saveAgentProfile, deleteAgentProfile } from './session/manager'
export { listGroupSessions, getGroupSession, saveGroupSession, deleteGroupSession } from './session/manager'

// ═══ Governor（Agent 包调控器） ═══
export {
  createAgentGovernor,
  createWebAgentGovernor,
  createCliAgentGovernor,
  bootAgentGovernor,
  initAgentGovernor,
  getAgentGovernor,
  detectAgentEnvironment,
  detectAgentOrWebEnvironment,
} from './governor'
export type { AgentGovernor } from './governor'
export { agentModules, cliAgentModules, webAgentModules } from './governor-modules'

// ═══ ExecutionAdapter 接口与工厂注册 ═══
export type {
  ExecutionAdapter,
  ExecOptions,
  ExecResult,
  PtyOptions,
  ShellInfo,
  ShellSessionInfo,
  ShellExecResult,
} from './execution/adapter'
export {
  isNodeEnv,
  isTauri,
  getWsUrl,
  registerExecutionAdapterFactory,
  createExecutionAdapter,
  resetExecutionAdapter,
} from './execution/index'
export type { ExecutionAdapterFactory } from './execution/index'
