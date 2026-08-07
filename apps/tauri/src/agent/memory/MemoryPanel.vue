<script setup lang="ts">
/**
 * MemoryPanel：Tauri 端记忆面板（阶段 4 MVP）
 *
 * 4 视图：记忆清单（列表）/ 检索 / 详情 / 手动归档。
 * 数据源：Rust 记忆后端（MemoryCenterAccessor），经 useMemoryCenterRust 调 memory_* 命令。
 * 会话隔离：依赖父级传入的当前会话 ID（prop sessionId），无会话时提示先创建会话。
 */
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import {
  useMemoryCenterRust,
  type RustMemoryRecallResult,
  type RustMemoryChunkContent,
} from './useMemoryCenterRust'
import TuiButton from '../../components/ui/TuiButton.vue'
import TuiEmpty from '../../components/ui/TuiEmpty.vue'
import TuiIcon from '../../components/ui/TuiIcon.vue'
import { formatDateTime } from '../../components/ui/format'

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
/** 提示信息（成功/错误，弱提示几秒后自动消失） */
const notice = ref('')
/** 提示类型：error → danger 语义，默认 success（批次59：修复错误以 accent 渲染的语义冲突） */
const noticeType = ref<'success' | 'error'>('success')
let noticeTimer: ReturnType<typeof setTimeout> | null = null

/** 展示临时提示（几秒后自动消失）；type 缺省 success，错误信息传入 'error' 走 danger 语义 */
function flash(msg: string, type: 'success' | 'error' = 'success') {
  notice.value = msg
  noticeType.value = type
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
    flash(`加载记忆失败: ${err}`, 'error')
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
    flash(`检索失败: ${err}`, 'error')
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
    flash(`加载详情失败: ${err}`, 'error')
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
    flash(`归档失败: ${err}`, 'error')
  }
}

/** 记忆列表方向键导航：↑/↓ 移动焦点到相邻条目（批次90 1.1） */
function onListKeydown(e: KeyboardEvent, el: HTMLElement) {
  const items = Array.from(el.querySelectorAll<HTMLElement>('.mp-item'))
  if (items.length === 0) return
  const idx = items.indexOf(document.activeElement as HTMLElement)
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    items[Math.min(idx + 1, items.length - 1)]?.focus()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    items[Math.max(idx - 1, 0)]?.focus()
  }
}

/** 从摘要中提取标题（首行） */
function titleOf(item: RustMemoryRecallResult): string {
  const line = item.summary.split('\n').find((l) => l.trim())
  return line?.trim() || item.hook_id.slice(0, 8)
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
onBeforeUnmount(() => {
  if (noticeTimer) clearTimeout(noticeTimer)
})
</script>

<template>
  <div class="memory-panel">
    <header class="mp-head">
      <div class="mp-title">
        <!-- 圆点仅在加载/有记忆时显示：空态下无状态含义（批次87 #23） -->
        <span v-if="sessionId && (isListLoading || memoryList.length)" class="mp-dot" />
        <span>记忆库</span>
        <span v-if="memoryList.length" class="mp-count">{{ memoryList.length }}</span>
      </div>
      <div class="mp-actions">
        <div class="mp-search-wrap">
          <TuiIcon name="search" :size="13" class="mp-search-icon" />
          <input
            v-model="keyword"
            class="mp-search"
            aria-label="检索记忆"
            placeholder="检索记忆…"
            @keydown.enter="onSearch"
          />
          <button
            v-show="keyword"
            class="mp-search-clear"
            title="清空检索"
            aria-label="清空检索"
            @click="keyword = ''"
          >
            <TuiIcon name="close" :size="11" />
          </button>
        </div>
        <TuiButton variant="primary" size="sm" :loading="isArchiving" :disabled="!sessionId" title="手动归档（消费缓冲轮次）" @click="onArchive">
          归档
        </TuiButton>
      </div>
    </header>

    <Transition name="fade">
      <div v-if="notice" class="mp-notice" :class="noticeType">{{ notice }}</div>
    </Transition>

    <TuiEmpty v-if="!sessionId" icon="memory" title="尚未选择会话" hint="请先创建会话，再查看该会话的记忆" fill />

    <!-- 列表/详情视图切换：淡入过渡（批次90 8.5），避免内容区瞬换；单根容器满足 Transition 约束 -->
    <Transition name="fade" mode="out-in">
      <div v-if="view === 'list'" key="list" class="mp-view">
        <div class="mp-bar">
          <span>归档边界</span>
          <span class="mp-boundary">{{ archiveBoundary }}</span>
          <TuiButton class="mp-refresh-btn" variant="ghost" size="sm" @click="refreshList">刷新</TuiButton>
        </div>

        <TuiEmpty v-if="isListLoading" icon="memory" title="加载中…" fill>
          <span class="mp-loading-dot" aria-hidden="true" />
        </TuiEmpty>
        <TuiEmpty
          v-else-if="memoryList.length === 0"
          icon="memory"
          title="暂无记忆"
          hint="对话达到归档阈值后自动落库，或点击「归档」手动触发"
          fill
        />
        <ul v-else class="mp-list" @keydown="(e) => onListKeydown(e, e.currentTarget as HTMLElement)">
          <li
            v-for="item in memoryList"
            :key="item.hook_id"
            class="mp-item"
            role="button"
            tabindex="0"
            title="查看记忆详情"
            @click="openDetail(item)"
            @keydown.enter="openDetail(item)"
            @keydown.space.prevent="openDetail(item)"
          >
            <div class="mp-item-title">{{ titleOf(item) }}</div>
            <div class="mp-item-summary">{{ item.summary }}</div>
            <div class="mp-item-meta">
              <span>{{ formatDateTime(item.created_at) }}</span>
              <span v-if="item.score > 0" class="mp-tag">相关 {{ item.score.toFixed(2) }}</span>
              <span v-if="item.pinned" class="mp-tag mp-pin">置顶</span>
            </div>
          </li>
        </ul>
      </div>
    </Transition>

    <Transition name="fade" mode="out-in">
      <div v-if="view === 'detail'" key="detail" class="mp-view">
        <div class="mp-bar">
          <TuiButton variant="ghost" size="sm" icon="arrowLeft" @click="backToList">返回</TuiButton>
          <span class="mp-detail-title">{{ activeMemory ? titleOf(activeMemory) : '' }}</span>
        </div>

        <TuiEmpty v-if="!activeChunk" icon="memory" title="加载详情中…" fill />
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
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.memory-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  font-family: var(--font-sans);
}
.mp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border);
}
.mp-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--fs-lg);
  font-weight: 600;
  color: var(--text-primary);
}
.mp-dot {
  width: var(--dot-md);
  height: var(--dot-md);
  border-radius: 50%;
  background: var(--accent);
}
/* 加载态圆点：补全样式（批次101 P1，与 thinking-dot/lcs-dot 同语言：pulse 呼吸） */
.mp-loading-dot {
  width: var(--dot-md);
  height: var(--dot-md);
  border-radius: 50%;
  background: var(--accent);
  animation: pulse var(--dur-pulse) ease-in-out infinite;
  margin: 0 auto;
}
.mp-count {
  font-size: var(--fs-sm);
  font-weight: 400;
  color: var(--text-muted);
  background: var(--bg-muted);
  border-radius: var(--radius-pill);
  padding: 1px 8px;
}
.mp-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.mp-search-wrap {
  position: relative;
}
.mp-search-icon {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-58%);
  color: var(--text-muted);
  pointer-events: none;
}
.mp-search {
  height: var(--input-sm-h);
  padding: 0 26px 0 28px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  font-size: var(--fs-md);
  outline: none;
  width: 170px;
  background: var(--bg-muted);
  color: var(--text-primary);
  transition: border-color var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease);
}
.mp-search::placeholder {
  color: var(--text-muted);
}
.mp-search:focus {
  border-color: var(--accent);
  background: var(--bg-surface);
}
/* 检索清空按钮：有输入才显示，弱化圆形（与 SessionList 搜索清空同一语言） */
.mp-search-clear {
  position: absolute;
  right: 5px;
  top: 50%;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 50%;
  background: var(--bg-active);
  color: var(--text-muted);
  cursor: pointer;
  transition: color var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease);
}
.mp-search-clear:hover {
  color: var(--text-primary);
  background: var(--border-strong);
}
/* 按压反馈（批次89） */
.mp-search-clear:active {
  transform: scale(var(--press-scale));
}
/* 提示条：统一 box 形态（radius-sm + border），success 默认 / error 走 danger 语义（批次59） */
.mp-notice {
  margin: 8px 16px 0;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--success-soft);
  color: var(--success);
  font-size: var(--fs-sm);
  background: var(--success-soft);
}
.mp-notice.error {
  border-color: var(--danger-soft);
  color: var(--danger);
  background: var(--danger-soft);
}
/* 视图切换容器：撑满面板、纵向布局，保持列表滚动区正确（批次90 8.5 包单根） */
.mp-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.mp-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border);
  font-size: var(--fs-sm);
  color: var(--text-secondary);
}
.mp-boundary {
  font-weight: 600;
  color: var(--accent);
}
.mp-refresh-btn {
  margin-left: auto;
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
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease);
}
.mp-item:hover {
  background: var(--bg-muted);
}
/* hover 时标题强调色变化：明确的点击反馈（弱化视觉，不打断浏览） */
.mp-item:hover .mp-item-title {
  color: var(--accent);
}
.mp-item-title {
  font-size: var(--fs-base);
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
  transition: color var(--dur-fast) var(--ease);
}
.mp-item-summary {
  font-size: var(--fs-sm);
  color: var(--text-secondary);
  line-height: var(--lh-md);
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
  font-size: var(--fs-xs);
  color: var(--text-muted);
}
.mp-tag {
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  background: var(--bg-muted);
  color: var(--text-secondary);
}
.mp-pin {
  background: var(--bg-muted);
  color: var(--text-secondary);
}
.mp-detail-title {
  font-weight: 600;
  color: var(--text-primary);
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
  font-size: var(--fs-sm);
  color: var(--text-muted);
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
/* 消息块左缘色条：Agent accent / 用户弱色，快速辨识角色归属 */
.mp-msg.agent {
  border-left: 3px solid var(--accent);
  padding-left: 10px;
}
.mp-msg.user {
  border-left: 3px solid var(--border-strong);
  padding-left: 10px;
}
.mp-msg-role {
  font-size: var(--fs-xs);
  color: var(--text-muted);
}
.mp-msg-content {
  background: var(--bg-muted);
  padding: 8px 12px;
  border-radius: var(--radius-md);
  font-size: var(--fs-md);
  line-height: var(--lh-base);
  white-space: pre-wrap;
}
.mp-msg.user .mp-msg-content {
  background: var(--accent-soft);
}
</style>