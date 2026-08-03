/**
 * memory-archive 宿主适配器集合
 *
 * 提供 5 个适配器的创建函数，供 useMemoryArchive 组装使用。
 */

export { createWebFsOperations } from './WebFsOperations'
export { createConfigAdapter } from './ConfigAdapterImpl'
export { createHostEmbeddingAdapter } from './HostEmbeddingAdapter'
export { createHostLlmAdapter } from './HostLlmAdapter'
export { createAgentBridgeImpl, convertToSnapshot } from './AgentBridgeImpl'
export type { AgentBridgeImplOptions } from './AgentBridgeImpl'
// H2.2 中文分词器（宿主层附挂，框架零硬依赖）
export { ChineseTokenizerAdapter } from './ChineseTokenizerAdapter'
