/**
 * 供应商配置解析器
 *
 * 将用户配置的 ProviderConfig 解析为统一的 ResolvedModel 结构，
 * 供 LLM 调用层使用。不同模式有不同的解析逻辑：
 * - cloud: 从内置配置中取 provider / modelId / apiKey
 * - local: 从 endpoint 构建 baseUrl，继承 apiType
 * - custom: 直接透传用户配置的 baseUrl / apiKey / contextWindow / maxTokens
 */

import type { ProviderConfig } from './config'

/** 解析后的模型配置，统一了三种模式的输出格式 */
export interface ResolvedModel {
  provider: string
  modelId: string
  baseUrl?: string
  apiKey?: string
  apiType?: string
  contextWindow?: number
  maxTokens?: number
}

/**
 * 解析供应商配置为统一的模型信息结构
 * @param config 用户配置的 ProviderConfig
 * @returns ResolvedModel，包含构建 API 请求所需的所有信息
 */
export function resolveModel(config: ProviderConfig): ResolvedModel {
  switch (config.mode) {
    case 'cloud':
      return {
        provider: config.provider,
        modelId: config.modelId,
        apiKey: config.apiKey,
      }
    case 'local':
      return {
        provider: config.apiType,
        modelId: config.modelId,
        baseUrl: config.endpoint,
        apiType: config.apiType,
      }
    case 'custom':
      return {
        provider: config.apiType,
        modelId: config.modelId,
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        apiType: config.apiType,
        contextWindow: config.contextWindow,
        maxTokens: config.maxTokens,
      }
  }
}
