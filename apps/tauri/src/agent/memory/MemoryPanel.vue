<script setup lang="ts">
/**
 * MemoryPanel：Tauri 端记忆面板（阶段 4 MVP）
 *
 * 4 视图：记忆清单（列表）/ 检索 / 详情 / 手动归档。
 * 数据源：Rust 记忆后端（MemoryCenterAccessor），经 useMemoryCenterRust 调 memory_* 命令。
 * 会话隔离：依赖父级传入的当前会话 ID（prop sessionId），无会话时提示先创建会话。
 */
import { ref, watch, onMounted } from 'vue'
import {
  useMemoryCenterRust,
  type RustMemoryRecallResult,
  type RustMemoryChunkContent,
} from './useMemoryCenterRust'

const props = defineProps<{ sessionId: string | null }>()

// 解构 composable：使 ref 成为 setup 顶层绑定，模板可自动解包（嵌套对象属性 vue-tsc 不解包）
const {
  memoryList,
  isListLoading,
  isArchiving,
  archiveBoundary,
  listMemory,
  recallMemory,
  archiveMemory,
  loadChunk,
  getBoundary,
} = useMemoryCenterRust()

// ─── 视图状态 ────────────────────────────────────────────
/** 当前视图：list（清单） / detail（详情） */
const view = ref<'list' | 'detail'>('list')
/** 选中用于详情展示的记忆条目 */
const activeMemory = ref<RustMemoryRecallResult | null>(null)
/** 详情加载的记忆块内容 */
const activeChunk = ref<RustMemoryChunkContent | null>(null)
/** 检索关键词 */
const keyword = ref('')
/** 错误/提示信息 */
const notice = ref('')
let noticeTimer: ReturnType<typeof setTimeout> | null = null

/** 展示临时提示（几秒后自动消失） */
function flash(msg: string) {
  notice.value = msg
  if (noticeTimer) clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => {
    notice.value = ''
  }, 3000)
}

/** 当前会话是否可用 */
function hasSession(): boolean {
  return Boolean(props.sessionId)
}

/** 刷新记忆清单（空关键词=全量） */
async function refreshList() {
  if (!hasSession()) return
  try {
    await listMemory(props.sessionId!, keyword.value.trim() || undefined)
  } catch (err) {
    flash(`加载记忆失败: ${err}`)
  }
}

/** 触发检索（关键词模式） */
async function onSearch() {
  if (!hasSession()) return
  const q = keyword.value.trim()
  if (!q) {
    await refreshList()
    return
  }
  try {
    await recallMemory(props.sessionId!, q)
  } catch (err) {
    flash(`检索失败: ${err}`)
  }
}

/** 打开详情视图（加载记忆块完整内容） */
async function openDetail(item: RustMemoryRecallResult) {
  if (!hasSession()) return
  activeMemory.value = item
  activeChunk.value = null
  view.value = 'detail'
  try {
    const chunk = await loadChunk(props.sessionId!, item.hook_id, item.hook_id)
    activeChunk.value = chunk
  } catch (err) {
    flash(`加载详情失败: ${err}`)
  }
}

/** 返回清单视图 */
function backToList() {
  view.value = 'list'
  activeMemory.value = null
  activeChunk.value = null
}

/** 手动触发归档（Rust 侧消费缓冲轮次，未达阈值返回 null） */
async function onArchive() {
  if (!hasSession()) return
  try {
    const result = await archiveMemory(props.sessionId!)
    if (result) {
      flash(`归档成功：${result.chunk_count} 块 / ${result.token_count} token`)
      await refreshList()
    } else {
      flash('暂无达到阈值的待归档内容')
    }
  } catch (err) {
    flash(`归档失败: ${err}`)
  }
}

/** 从摘要中提取标题（首行） */
function titleOf(item: RustMemoryRecallResult): string {
  const line = item.summary.split('\n').find((l) => l.trim())
  return line?.trim() || item.hook_id.slice(0, 8)
}

/** 时间戳 → 本地时间文本 */
function fmtTime(ts: number): string {
  if (!ts) return '-'
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes(),
  ).padStart(2, '0')}`
}

// 会话切换时刷新清单
watch(
  () => props.sessionId,
  () => {
    backToList()
    refreshList()
  },
)

onMounted(async () => {
  await refreshList()
  if (hasSession()) {
    try {
      await getBoundary(props.sessionId!)
    } catch {
      /* 边界读取失败不阻塞面板 */
    }
  }
})
</script>

<template>
  <div class="memory-panel">
    <header class="mp-head">
      <div class="mp-title">
        <span class="mp-dot" />
        <span>记忆库</span>
        <span v-if="memoryList.length" class="mp-count">{{ memoryList.length }}</span>
      </div>
      <div class="mp-actions">
        <input
          v-model="keyword"
          class="mp-search"
          placeholder="检索记忆…"
          @keydown.enter="onSearch"
        />
        <button
          class="mp-archive"
          :disabled="!sessionId || isArchiving"
          title="手动归档（消费缓冲轮次）"
          @click="onArchive"
        >{{ isArchiving ? '归档中…' : '归档' }}</button>
      </div>
    </header>

    <div v-if="notice" class="mp-notice">{{ notice }}</div>

    <div v-if="!sessionId" class="mp-empty">请先创建会话，再查看该会话的记忆</div>

    <template v-else-if="view === 'list'">
      <div class="mp-bar">
        <span>归档边界</span>
        <span class="mp-boundary">{{ archiveBoundary }}</span>
        <button class="mp-refresh" @click="refreshList">刷新</button>
      </div>

      <div v-if="isListLoading" class="mp-empty">加载中…</div>
      <div v-else-if="memoryList.length === 0" class="mp-empty">
        <p>暂无记忆</p>
        <p class="mp-hint">对话达到归档阈值后自动落库，或点击「归档」手动触发</p>
      </div>
      <ul v-else class="mp-list">
        <li
          v-for="item in memoryList"
          :key="item.hook_id"
          class="mp-item"
          @click="openDetail(item)"
        >
          <div class="mp-item-title">{{ titleOf(item) }}</div>
          <div class="mp-item-summary">{{ item.summary }}</div>
          <div class="mp-item-meta">
            <span>{{ fmtTime(item.created_at) }}</span>
            <span v-if="item.score > 0" class="mp-tag">相关 {{ item.score.toFixed(2) }}</span>
            <span v-if="item.pinned" class="mp-tag mp-pin">置顶</span>
          </div>
        </li>
      </ul>
    </template>

    <template v-else-if="view === 'detail'">
      <div class="mp-bar">
        <button class="mp-back" @click="backToList">← 返回</button>
        <span class="mp-detail-title">{{ activeMemory ? titleOf(activeMemory) : '' }}</span>
      </div>

      <div v-if="!activeChunk" class="mp-empty">加载详情中…</div>
      <div v-else class="mp-detail">
        <div class="mp-detail-meta">
          <span>块 ID：{{ activeChunk.chunk_id }}</span>
          <span>{{ activeChunk.messages.length }} 条消息</span>
          <span>{{ activeChunk.token_count }} token</span>
        </div>
        <div class="mp-chunk">
          <div
            v-for="(m, i) in activeChunk.messages"
            :key="i"
            class="mp-msg"
            :class="m.role"
          >
            <div class="mp-msg-role">{{ m.role === 'user' ? '你' : 'Agent' }}</div>
            <div class="mp-msg-content">{{ m.content }}</div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.memory-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  font-family: system-ui, -apple-system, sans-serif;
}
.mp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid #e5e5e5;
}
.mp-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
  color: #333;
}
.mp-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #1a73e8;
}
.mp-count {
  font-size: 12px;
  font-weight: 400;
  color: #999;
  background: #f0f0f0;
  border-radius: 10px;
  padding: 1px 8px;
}
.mp-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.mp-search {
  padding: 6px 10px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 13px;
  outline: none;
  width: 180px;
}
.mp-search:focus {
  border-color: #1a73e8;
}
.mp-archive {
  padding: 6px 12px;
  border: none;
  border-radius: 6px;
  background: #1a73e8;
  color: #fff;
  font-size: 13px;
  cursor: pointer;
}
.mp-archive:disabled {
  background: #ccc;
  cursor: not-allowed;
}
.mp-archive:hover:not(:disabled) {
  background: #1765cc;
}
.mp-notice {
  padding: 6px 16px;
  font-size: 12px;
  color: #1a73e8;
  background: #e8f0fe;
}
.mp-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  color: #999;
  font-size: 13px;
  padding: 24px;
}
.mp-hint {
  font-size: 12px;
  color: #bbb;
}
.mp-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-bottom: 1px solid #f0f0f0;
  font-size: 12px;
  color: #666;
}
.mp-boundary {
  font-weight: 600;
  color: #1a73e8;
}
.mp-refresh {
  margin-left: auto;
  padding: 2px 10px;
  border: 1px solid #ddd;
  border-radius: 6px;
  background: transparent;
  font-size: 12px;
  color: #666;
  cursor: pointer;
}
.mp-refresh:hover {
  border-color: #1a73e8;
  color: #1a73e8;
}
.mp-list {
  list-style: none;
  margin: 0;
  padding: 8px 0;
  overflow-y: auto;
  flex: 1;
}
.mp-item {
  padding: 10px 16px;
  border-bottom: 1px solid #f5f5f5;
  cursor: pointer;
  transition: background 0.15s;
}
.mp-item:hover {
  background: #f5f5f5;
}
.mp-item-title {
  font-size: 14px;
  font-weight: 600;
  color: #333;
  margin-bottom: 4px;
}
.mp-item-summary {
  font-size: 12px;
  color: #666;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.mp-item-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  font-size: 11px;
  color: #999;
}
.mp-tag {
  padding: 1px 6px;
  border-radius: 4px;
  background: #f0f0f0;
  color: #666;
}
.mp-pin {
  background: #fef7e0;
  color: #b06000;
}
.mp-back {
  padding: 2px 10px;
  border: 1px solid #ddd;
  border-radius: 6px;
  background: transparent;
  font-size: 12px;
  color: #666;
  cursor: pointer;
}
.mp-back:hover {
  border-color: #1a73e8;
  color: #1a73e8;
}
.mp-detail-title {
  font-weight: 600;
  color: #333;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mp-detail {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
}
.mp-detail-meta {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: #999;
  margin-bottom: 12px;
}
.mp-chunk {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.mp-msg {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.mp-msg-role {
  font-size: 11px;
  color: #999;
}
.mp-msg-content {
  background: #f5f5f5;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
}
.mp-msg.user .mp-msg-content {
  background: #e8f0fe;
}
</style>