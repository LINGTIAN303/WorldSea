/**
 * memory-archive 宿主集成模块
 *
 * 提供 useMemoryArchive composable 和归档工具注册表。
 * 在应用入口（main.ts）或 App.vue 中调用 useMemoryArchive().init() 初始化。
 */

export { useMemoryArchive } from './useMemoryArchive'
export { useArchiveTriggers } from './useArchiveTriggers'
export { registerArchiveTools, getArchiveTools, clearArchiveTools } from './archiveToolsRegistry'
export {
  createWebFsOperations,
  createConfigAdapter,
  createHostEmbeddingAdapter,
  createHostLlmAdapter,
  createAgentBridgeImpl,
} from './adapters'
