/**
 * @worldsea/memory-archive
 *
 * 可复用的对话上下文归档与检索框架。
 * 为 LLM Agent 提供"滑动窗口 + 归档检索"的持久记忆能力。
 *
 * 核心概念：
 * - 归档边界（ArchiveBoundary）：Agent 可见消息的起点
 * - 索引钩子（Hook）：归档记忆的轻量元数据索引
 * - 记忆文件（MemoryFile）：完整无损的对话上下文原文
 * - 检索引擎（RecallEngine）：支持 keyword/semantic/hybrid/list 四种检索模式
 */

// ===== 类型导出 =====
export type {
  AgentOutputType,
  AgentMessageSnapshot,
  Hook,
  ChunkTitle,
  MemoryFile,
  MemoryFileHeader,
  MemoryChunk,
  ArchiveIndex,
  ArchiveConfig,
  ArchiveResult,
  ArchiveTool,
  RecallMode,
  RecallParams,
  RecallResult,
  DecayParams,
  ArchiveMeta,
  ArchiveTriggerOptions,
  ArchiveEventName,
  ArchiveEventListener,
  TaskLogEntry,
} from './types'

// ===== 适配器接口导出 =====
export type {
  AgentBridge,
  ConfigAdapter,
  StorageAdapter,
  EmbeddingAdapter,
  LlmAdapter,
  FsOperations,
} from './adapters/index'

// ===== 核心模块导出 =====
export { ArchiveManager, type ArchiveManagerOptions } from './core/ArchiveManager'
export { ArchiveBoundary } from './core/ArchiveBoundary'
export { HookBuilder, type HookBuilderOptions } from './core/HookBuilder'
export { MemoryFileWriter, type MemoryFileWriterOptions } from './core/MemoryFileWriter'
export { RecallEngine, type RecallEngineOptions } from './core/RecallEngine'

// ===== 工具函数导出 =====
export { estimateTokens, countMessageTokens, countMessagesTokens } from './utils/tokenCounter'
export { chunkMessages, detectOutputType, extractChunkTitles, type ChunkingConfig } from './utils/chunker'
export { calculateDecayScore, shouldDeprecate, shouldHardDelete } from './utils/decay'
export { ReadWriteLock } from './utils/rwLock'
export { findSafeTruncatePoint, validateTruncatedMessages } from './utils/safeTruncate'

// ===== 内置适配器实现导出 =====
export { FsStorageAdapter, type FsStorageAdapterOptions } from './storage/FsStorageAdapter'
export { IdbStorageAdapter } from './storage/IdbStorageAdapter'
export { OpenAIEmbeddingAdapter, type OpenAIEmbeddingAdapterOptions } from './embedding/OpenAIEmbeddingAdapter'
export { RuleBasedLlmAdapter } from './embedding/RuleBasedLlmAdapter'
// H2.2 分词器适配器
export type { TokenizerAdapter } from './adapters/TokenizerAdapter'
export { SimpleTokenizerAdapter } from './adapters/SimpleTokenizerAdapter'

// ===== 默认配置 =====
export { DEFAULT_ARCHIVE_CONFIG } from './defaults'

// ===== 周期管理 =====
export { MetaStorage } from './scheduler/MetaStorage'
export { ArchiveScheduler, type ArchiveSchedulerOptions } from './scheduler/ArchiveScheduler'
