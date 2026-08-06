/**
 * useMemoryCenterRust：Tauri 端记忆面板适配层（Rust IPC）
 *
 * 阶段 4 迁移：将 Web 端 ArchivePanel 的 TS memory-archive 后端替换为
 * Rust 记忆后端（MemoryCenterAccessor，经 agent-commands + Tauri memory_* 命令暴露）。
 *
 * 职责：invoke `memory_list` / `memory_recall` / `memory_archive` /
 * `memory_load_chunk` / `memory_boundary`，并维护记忆列表响应式状态。
 * 会话隔离：每个会话独立记忆后端，命令以 `sessionId` 定位。
 */

import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'

// ─── Rust 端类型镜像（snake_case，与 agent-runtime 序列化一致）──────────────

/** Rust `agent_runtime::memory::MemoryRecallResult` 镜像（记忆列表/检索条目） */
export interface RustMemoryRecallResult {
  /** 钩子 ID */
  hook_id: string
  /** 摘要（LLM 生成，2K-5K） */
  summary: string
  /** 相关度评分（0.0-1.0） */
  score: number
  /** 匹配字段（keywords/summary/embedding 等） */
  matched_fields: string[]
  /** 归档时间戳（Unix 毫秒） */
  created_at: number
  /** 访问次数 */
  access_count: number
  /** 关键词标签 */
  keywords: string[]
  /** 用户标签 */
  tags: string[]
  /** 永久保留标记 */
  pinned: boolean
}

/** Rust `agent_runtime::memory::MemoryArchiveResult` 镜像（归档结果） */
export interface RustMemoryArchiveResult {
  /** 钩子 ID */
  hook_id: string
  /** 记忆文件 ID */
  file_id: string
  /** 归档的 token 数 */
  token_count: number
  /** 归档的分块数 */
  chunk_count: number
  /** 归档后新的边界索引 */
  new_boundary_index: number
  /** 摘要生成方式（llm/rule/none，lowercase） */
  summary_method: 'llm' | 'rule' | 'none'
}

/** Rust `agent_runtime::memory::MemoryChunkContent` 镜像（记忆块完整内容） */
export interface RustMemoryChunkContent {
  /** 块 ID */
  chunk_id: string
  /** 主题标题 */
  title: string
  /** 输出类型（text/tool_call/entity_op/code/analysis/creative/other） */
  output_type:
    | 'text'
    | 'tool_call'
    | 'entity_op'
    | 'code'
    | 'analysis'
    | 'creative'
    | 'other'
  /** 用户消息锚点 */
  user_message_anchor: string
  /** token 数 */
  token_count: number
  /** 完整消息快照 */
  messages: Array<{
    role: string
    content: string
    tool_call_id?: string | null
    tool_name?: string | null
    timestamp: number
  }>
}

// ─── 模块级单例状态 ────────────────────────────────────────────

/** 记忆列表（当前已加载，前端按时间倒序展示） */
const memoryList = ref<RustMemoryRecallResult[]>([])
/** 是否正在加载记忆列表 */
const isListLoading = ref(false)
/** 是否正在归档 */
const isArchiving = ref(false)
/** 最近一次归档结果 */
const lastArchiveResult = ref<RustMemoryArchiveResult | null>(null)
/** 当前归档边界 */
const archiveBoundary = ref<number>(0)

// ─── 命令封装：记忆列表 ────────────────────────────────────

/**
 * 拉取记忆列表（空关键词=全量），可选关键词过滤
 *
 * @param sessionId 会话 ID（记忆后端按会话隔离）
 * @param keyword 可选关键词（空串=全量清单）
 * @param limit 返回条数上限（默认 50）
 */
async function listMemory(
  sessionId: string,
  keyword?: string,
  limit?: number,
): Promise<RustMemoryRecallResult[]> {
  isListLoading.value = true
  try {
    const list = await invoke<RustMemoryRecallResult[]>('memory_list', {
      sessionId,
      keyword: keyword || null,
      limit: limit ?? null,
    })
    memoryList.value = list
    return list
  } finally {
    isListLoading.value = false
  }
}

// ─── 命令封装：记忆检索 ────────────────────────────────────

/**
 * 关键词检索记忆
 *
 * @param sessionId 会话 ID
 * @param query 检索关键词
 * @param topK 返回条数上限（默认 5）
 */
async function recallMemory(
  sessionId: string,
  query: string,
  topK?: number,
): Promise<RustMemoryRecallResult[]> {
  const list = await invoke<RustMemoryRecallResult[]>('memory_recall', {
    sessionId,
    query,
    topK: topK ?? null,
  })
  // 检索结果同步进列表（供详情视图回看）
  memoryList.value = list
  return list
}

// ─── 命令封装：手动归档 ────────────────────────────────────

/**
 * 手动触发归档（消费缓冲轮次）
 *
 * 对应 Rust `memory_archive`（ArchiveSource::Manual）。未达阈值时返回 null。
 *
 * @param sessionId 会话 ID
 */
async function archiveMemory(sessionId: string): Promise<RustMemoryArchiveResult | null> {
  isArchiving.value = true
  try {
    const result = await invoke<RustMemoryArchiveResult | null>('memory_archive', {
      sessionId,
    })
    lastArchiveResult.value = result
    if (result) {
      archiveBoundary.value = result.new_boundary_index
    }
    return result
  } finally {
    isArchiving.value = false
  }
}

// ─── 命令封装：加载记忆块内容 ────────────────────────────────────

/**
 * 加载记忆块完整内容
 *
 * @param sessionId 会话 ID
 * @param hookId 钩子 ID
 * @param chunkId 块 ID
 */
async function loadChunk(
  sessionId: string,
  hookId: string,
  chunkId: string,
): Promise<RustMemoryChunkContent | null> {
  return invoke<RustMemoryChunkContent | null>('memory_load_chunk', {
    sessionId,
    hookId,
    chunkId,
  })
}

// ─── 命令封装：归档边界 ────────────────────────────────────

/**
 * 获取当前归档边界
 *
 * @param sessionId 会话 ID
 */
async function getBoundary(sessionId: string): Promise<number> {
  const boundary = await invoke<number>('memory_boundary', { sessionId })
  archiveBoundary.value = boundary
  return boundary
}

// ─────────────────────────────────────────────────────────────────────────────
// Vue Composable（模块级单例）
// ─────────────────────────────────────────────────────────────────────────────

/** Tauri 端记忆面板 composable（模块级单例，invoke memory_* 命令） */
export function useMemoryCenterRust() {
  return {
    // ── 状态（返回裸 ref，模板自动解包）──
    memoryList,
    isListLoading,
    isArchiving,
    lastArchiveResult,
    archiveBoundary,

    // ── 命令 ──
    listMemory,
    recallMemory,
    archiveMemory,
    loadChunk,
    getBoundary,
  }
}