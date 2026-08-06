/** HostEmbeddingAdapter：EmbeddingAdapter 宿主实现（复用 embedding service，未配置跳过），详细见 docs/details/注释/web/memory-archive/adapters/HostEmbeddingAdapter.md */

import type { EmbeddingAdapter } from '@worldsmith/memory-archive/adapters'
import { getEmbeddingConfig, generateEmbedding, generateEmbeddings } from '@agent/index'

/**
 * 创建宿主 Embedding 适配器
 *
 * 使用全局 embedding 配置（localStorage: worldsmith_embedding_config）。
 * 用户需在设置面板中配置 embedding API（baseUrl/apiKey/model）。
 */
export function createHostEmbeddingAdapter(): EmbeddingAdapter {
  return {
    isReady(): boolean {
      const config = getEmbeddingConfig()
      return !!(config && config.apiKey)
    },

    async embed(text: string): Promise<number[]> {
      return generateEmbedding(text)
    },

    async embedBatch(texts: string[]): Promise<number[][]> {
      return generateEmbeddings(texts)
    },
  }
}
