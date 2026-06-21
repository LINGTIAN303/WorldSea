/**
 * worldsmith-agent 包入口
 *
 * 统一导出所有公开 API，包括：
 * - Agent 创建和配置
 * - 工具定义和类型
 * - 会话管理
 * - 上下文构建和注入
 * - Skill 注册管理
 * - Provider 配置和 Key 存储
 * - Embedding（向量嵌入）服务
 * - 图像生成和持久化
 * - 日志和限流
 */

export { createWorldSmithAgent, getToolsForSkills, ALL_TOOLS, TOOL_CATEGORIES, internalRegistry, setActiveCliAgentConnection, getActiveCliAgentConnection } from './agent'
export type { CreateAgentOptions } from './bridge-types'
export { CoreBackend } from './bridge'
export { HybridBackend, createHybridBackend } from './hybrid-backend'
export type { CliAgentConnection, HybridBackendConfig } from './hybrid-backend'
export type { IAgentBackend } from './bridge'
export type { AgentEvent, AgentEventListener, AgentConfig, ToolDefinition, ToolParameter, PromptOptions, ImageAttachment, UsageData, ThinkingLevel, ChatMode, A2UIMessage, A2UIComponent, MessageBlock, TableBlock, ChoiceBlock, CodeBlockData, EntityCardBlock, AlertBlock, StatBlock, ListBlock, ProgressBlock, ComparisonBlock, TimelineBlock, ImageBlock, VideoBlock, AccordionBlock, ManuscriptBlock, ExportCorrectorConfig } from './bridge-types'
export type { WorldSmithToolContext, EntityLike, RelationLike } from './tools/types'
export { DefaultToolBus } from './toolbus/toolbus'
export type { ToolBus } from './toolbus/toolbus'
export type { IToolContext, IToolStores, IEntityStore, IRelationStore, IFileStore, ISettingsStore, IUIStore, SessionSummary } from './toolbus/types'
export { MCPManager } from './mcp/mcp-manager'
export { MCPToolAdapter } from './mcp/mcp-adapter'
export type { MCPConnectionConfig, MCPTransportType, MCPToolInfo, MCPConnectionState } from './mcp/types'
export type { AgentSession, AgentMessage, AgentStateSnapshot, ToolCallRecord, ProviderMode, ModelInfo, ImageAttachment as SessionImageAttachment, FileAttachment, SessionUsage } from './session/types'
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
export { fetchModelsFromProvider, getCachedModels, refreshModels, getModelsWithBackgroundRefresh, clearModelCache, clearAllModelCache } from './providers/model-fetcher'
export type { FetchedModelEntry } from './providers/model-fetcher'
export { storeApiKey, loadApiKey, removeApiKey, hasApiKey } from './providers/key-store'
export { listSessions, getSession, saveSession, deleteSession, createSession, pinSession, unpinSession, renameSession, countSessions, setAgentCurrentProjectId, releaseAgentDb } from './session/manager'
export { buildContextInjection, invalidateContextCache } from './context/builder'
export { buildSystemPrompt, buildSharedBaseLayer } from './context/injector'
export { buildProjectSummary, formatSummaryForPrompt, truncateMessages } from './context/summary'
export { logger, setLogLevel } from './utils/logger'
export { checkRateLimit, recordRequest, recordUsage, getUsageSummary } from './utils/rate-limit'
export { SKILL_REGISTRY, getEnabledSkills, getAllSkills, toggleSkill, resolveToolNames, ALWAYS_AVAILABLE_TOOLS } from './skills/registry'
export type { SkillMeta } from './skills/registry'
export { resolvePluginToolNames, buildPluginCapabilityPrompt, registerPluginCapability, getPluginCapability, getAllPluginCapabilities, resolveRelatedPlugins } from './skills/plugin-bridge'
export type { PluginCapability } from './skills/plugin-bridge'
export { outputTools, outputTable, outputChoice, outputCode, outputEntityCard, outputAlert, outputStat, outputList, outputProgress, outputComparison, outputTimeline, outputImage, outputAccordion, outputManuscript } from './tools/output-tools'
export { manuscriptClone } from './tools/manuscript-tools'
export { sessionTools, sessionInfo, sessionList, sessionRead } from './tools/session-tools'
export { recallMemory, formatMemoryForPrompt } from './tools/memory'
export { generateEmbedding, generateEmbeddings, cosineSimilarity, clearEmbeddingCache, getEmbeddingConfig, saveEmbeddingConfig } from './embedding/service'
export type { EmbeddingConfig } from './embedding/service'
export { putVector, putVectors, getVector, deleteVector, getCollection, searchSimilar, deleteCollection, getCollectionSize } from './embedding/vector-store'
export type { VectorRecord, SearchResult as VectorSearchResult } from './embedding/vector-store'
export { indexEntity, indexEntities, removeEntityIndex, indexMemoryEntry, removeMemoryIndex, syncEntityIndex, semanticSearch, semanticSearchEntities, semanticSearchMemory, isEmbeddingReady, getEmbeddingStats } from './embedding/index'
export type { SemanticSearchResult } from './embedding/index'
export { EMBEDDING_PRESETS } from './embedding/service'
export { storeImages, getImages, removeImages, type StoredImage } from './tools/vision-tools'
export { imageGenTools } from './tools/image-gen-tools'
export { persistImage, getImage, getByPath, getImagesByPathPrefix, getAllImages, deleteImage, deleteImagesByPrefix, getImageCount, srcToBlob, downloadBlob, blobToDataUrl, onImagePersisted } from './stores/image-persistence'
export type { PersistedImage, ImagePersistedEvent } from './stores/image-persistence'
export { videoGenTools } from './tools/video-gen-tools'
export { planTools } from './tools/plan-tools'
export { nativeTools } from './tools/native-tools'
export { persistVideo, getVideo, getVideosByPathPrefix, getAllVideos, deleteVideo, getVideoCount, urlToBlob, blobToDataUrl as videoBlobToDataUrl } from './stores/video-persistence'
export type { PersistedVideo } from './stores/video-persistence'

/* ─── Group Chat ─── */
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

/* ─── Governor（Agent 包调控器） ─── */
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
