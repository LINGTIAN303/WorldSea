/**
 * HostEmbeddingAdapter - EmbeddingAdapter 接口的宿主实现
 *
 * 复用 worldsmith-agent 现有的 embedding service，为 memory-archive 框架提供向量嵌入能力。
 * 当 embedding API 未配置时，isReady() 返回 false，框架将跳过向量生成（等日任务补全）。
 *
 * 底层调用：
 * - isReady()  → getEmbeddingConfig() 检查 apiKey
 * - embed()    → generateEmbedding(text)
 * - embedBatch → generateEmbeddings(texts)
 */

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
