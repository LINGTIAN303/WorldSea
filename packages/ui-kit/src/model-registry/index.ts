/** 模型注册表模块出口：供应商/模型元数据 + 动态拉取 + Key 加密存储（自 agent-runtime 抽出，2026-09-27 E8） */

export { MODEL_REGISTRY, getModelInfo, modelSupportsVision, getVisionModels, getModelsByProvider, getModelsByProviderAsync, getDefaultModelId, getModelPresets, calculateCost, getThinkingLevels } from './model-registry'
export type { ModelInfo, CostBreakdown } from './model-registry'
export { getProviderManifest, getAllProviderManifests, getDomesticProviderIds, getProxyPathMap, getDefaultModelMap, getProviderLabelMap, detectVisionSupport, detectThinkingSupport, resolveModelId, buildDirectEndpoint, buildModelsEndpoint, buildProxyEndpoint, registerProviderManifest, getProviderIds } from './provider-registry'
export type { ProviderManifest, ProviderCompatConfig, ApiType, ThinkingFormat, ThinkingLevelMap, VisionDetector, ThinkingDetector, EndpointConfig } from './provider-registry'
export { fetchModelsFromProvider, getCachedModels, refreshModels, getModelsWithBackgroundRefresh, getLastModelFetchInfo, clearModelCache, clearAllModelCache } from './model-fetcher'
export type { FetchedModelEntry, ModelFetchInfo } from './model-fetcher'
export { storeApiKey, loadApiKey, removeApiKey, hasApiKey } from './key-store'
export type { ProviderConfig, CloudProviderConfig, LocalProviderConfig, CustomProviderConfig, CloudProvider, LocalApiType, CustomApiType, ProviderMode } from './config'
export { DEFAULT_CLOUD_CONFIGS, DEFAULT_LOCAL_CONFIG } from './config'
