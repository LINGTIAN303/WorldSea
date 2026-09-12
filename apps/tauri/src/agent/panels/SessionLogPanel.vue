<template>
  <div class="session-log-panel">
    <div class="slp-header">
      <h3 class="slp-title">会话日志</h3>
      <div class="slp-header-actions">
        <button
          class="slp-icon-btn"
          :class="{ spinning: loading }"
          :disabled="loading || !sessionId"
          title="刷新"
          aria-label="刷新"
          @click="refresh()"
        >
          <WsIcon name="refresh" :size="14" :stroke-width="1.7" />
        </button>
      </div>
    </div>

    <!-- 统计条：日志总量 / 活跃视图 / 已移出视图 / 检查点 -->
    <div v-if="sessionId" class="slp-stats">
      <span class="slp-stat" title="日志总量：历次写入过的消息版本总数（含已移出视图的）">
        <b>{{ stats.logLen }}</b>日志
      </span>
      <span class="slp-stat slp-stat-live" title="活跃视图：当前在模型上下文里的条数">
        <b>{{ stats.liveLen }}</b>活跃
      </span>
      <span class="slp-stat slp-stat-out" title="已移出视图：内容仍完整保留在日志中，坐标不变">
        <b>{{ stats.droppedLen }}</b>已移出
      </span>
      <span class="slp-stat" title="检查点：历次视图同步事件（追加 / 裁剪 / 修订）">
        <b>{{ stats.eventCount }}</b>检查点
      </span>
    </div>

    <!-- 视图切换：轨迹（日志条目）/ 检查点（事件留痕） -->
    <div v-if="sessionId" class="slp-seg" role="tablist">
      <button
        class="slp-seg-btn"
        :class="{ active: view === 'log' }"
        role="tab"
        :aria-selected="view === 'log'"
        @click="view = 'log'"
      >轨迹</button>
      <button
        class="slp-seg-btn"
        :class="{ active: view === 'events' }"
        role="tab"
        :aria-selected="view === 'events'"
        @click="view = 'events'"
      >检查点</button>
    </div>

    <div class="slp-body">
      <div v-if="!sessionId" class="slp-empty">未选择会话</div>
      <div v-else-if="loading && rows.length === 0 && events.length === 0" class="slp-empty">加载中…</div>
      <template v-else>
        <!-- 局部失败不替换列表：顶部错误条 + 可重试 -->
        <div v-if="error" class="slp-error-strip">
          <WsIcon name="warning" :size="12" :stroke-width="1.7" />
          <span class="slp-error-text">{{ error }}</span>
          <button class="slp-link-btn" @click="refresh()">重试</button>
        </div>

        <!-- 轨迹：不可变日志条目（含已移出视图的历史，只读） -->
        <template v-if="view === 'log'">
          <div v-if="rows.length === 0" class="slp-empty">
            {{ error ? '读取失败，请重试' : '本会话暂无日志（尚未持久化）' }}
          </div>
          <div
            v-for="row in rows"
            :key="row.entry.logOffset"
            class="slp-entry"
            :class="{ 'slp-entry-out': !row.live }"
          >
            <div
              class="slp-entry-head"
              role="button"
              tabindex="0"
              :aria-expanded="expanded.has(row.entry.logOffset)"
              @click="toggleExpanded(row.entry.logOffset)"
              @keydown.enter.prevent="toggleExpanded(row.entry.logOffset)"
              @keydown.space.prevent="toggleExpanded(row.entry.logOffset)"
            >
              <span class="slp-offset" :title="`稳定坐标（锚点） #${row.entry.logOffset} —— 一经分配永不变动`">
                #{{ row.entry.logOffset }}
              </span>
              <span class="slp-role" :class="`slp-role-${roleKind(row.entry.message.role)}`">
                <WsIcon :name="roleIcon(row.entry.message.role)" :size="11" :stroke-width="1.7" />
                {{ roleLabel(row.entry.message.role) }}
              </span>
              <span class="slp-time">{{ fmtTime(row.entry.recordedAt) }}</span>
              <span v-if="!row.live" class="slp-badge slp-badge-out" title="已移出活跃视图：内容完整保留在日志中">
                已移出
              </span>
              <span
                v-if="row.foldBadge"
                class="slp-badge slp-badge-fold"
                title="检查点：上下文压缩的折叠形（原文已外置，可查看）"
              >{{ row.foldBadge }}</span>
              <span v-else-if="row.rawHash" class="slp-badge slp-badge-raw" title="超长内容已截断：完整原文已外置">
                原文
              </span>
              <WsIcon
                class="slp-chevron"
                :class="{ open: expanded.has(row.entry.logOffset) }"
                name="chevron-down"
                :size="12"
                :stroke-width="1.7"
              />
            </div>

            <div v-if="row.foldSummary" class="slp-fold">
              <span class="slp-fold-meta">{{ row.foldSummary }}</span>
              <button class="slp-link-btn" @click="openRaw(row.foldRaw)">查看原文</button>
            </div>

            <div class="slp-content" :class="{ expanded: expanded.has(row.entry.logOffset) }">
              {{ row.entry.message.content }}
            </div>

            <div v-if="expanded.has(row.entry.logOffset)" class="slp-detail">
              <span v-if="row.entry.message.tool_call_id" class="slp-detail-item">
                tool_call: {{ row.entry.message.tool_call_id }}
              </span>
              <span v-if="(row.entry.message.tool_calls?.length ?? 0) > 0" class="slp-detail-item">
                工具调用 ×{{ row.entry.message.tool_calls?.length }}
              </span>
              <button
                v-if="row.rawHash && !row.fold"
                class="slp-link-btn"
                @click="openRaw(row.rawHash)"
              >查看截断前原文</button>
            </div>
          </div>
          <button
            v-if="logFull && rows.length > 0"
            class="slp-more"
            :disabled="loading"
            @click="loadMoreLog()"
          >加载更多（已 {{ rows.length }} / {{ stats.logLen }}）</button>
        </template>

        <!-- 检查点：会话事件留痕（initial / append / trim / revise / noop） -->
        <template v-else>
          <div v-if="events.length === 0" class="slp-empty">暂无检查点（尚无视图同步事件）</div>
          <div v-for="ev in events" :key="ev.eventSeq" class="slp-event">
            <span class="slp-ev-kind" :class="`slp-ev-${ev.eventKind}`">{{ kindLabel(ev.eventKind) }}</span>
            <span class="slp-ev-scale">
              <span v-if="ev.added > 0" class="slp-sc-add" title="新进日志条数">+{{ ev.added }}</span>
              <span v-if="ev.dropped > 0" class="slp-sc-drop" title="移出活跃视图条数（内容保留在日志）">−{{ ev.dropped }}</span>
              <span class="slp-sc-kept" title="视图最终条数">={{ ev.kept }}</span>
            </span>
            <span class="slp-time">{{ fmtFullTime(ev.createdAt) }}</span>
          </div>
          <button
            v-if="eventsFull && events.length > 0"
            class="slp-more"
            :disabled="loading"
            @click="loadMoreEvents()"
          >加载更多（已 {{ events.length }} / {{ stats.eventCount }}）</button>
        </template>
      </template>
    </div>

    <!-- 外置原文查看（只读；与 memory_read_raw 工具同语义，分段取回） -->
    <Teleport to="body">
      <div v-if="rawView.open" class="slp-raw-backdrop" @click="closeRaw()"></div>
      <div v-if="rawView.open" class="slp-raw-modal" role="dialog" aria-label="外置原文">
        <div class="slp-raw-head">
          <span class="slp-raw-title">外置原文</span>
          <code class="slp-raw-hash">raw/{{ rawView.hash }}</code>
          <span class="slp-raw-meta">{{ rawView.content.length }} / {{ rawView.totalChars }} 字符</span>
          <button
            class="slp-icon-btn"
            :disabled="!rawView.content"
            :title="copied ? '已复制' : '复制全文'"
            aria-label="复制全文"
            @click="copyRaw()"
          >
            <WsIcon :name="copied ? 'check' : 'copy'" :size="14" :stroke-width="1.7" />
          </button>
          <button class="slp-icon-btn" title="关闭" aria-label="关闭" @click="closeRaw()">
            <WsIcon name="close" :size="14" :stroke-width="1.7" />
          </button>
        </div>
        <div v-if="rawView.loading" class="slp-empty">加载中…</div>
        <div v-else-if="rawView.error" class="slp-empty slp-error">{{ rawView.error }}</div>
        <pre v-else class="slp-raw-content">{{ rawView.content }}</pre>
        <div v-if="!rawView.loading && !rawView.error && rawView.truncated" class="slp-raw-foot">
          <button class="slp-more" @click="loadMoreRaw()">加载更多</button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
/**
 * SessionLogPanel：A1 R3 前端 session 日志（历史）面板（设计文档 §10.3 立项项）
 *
 * 只读呈现三件事（不承担编辑）：
 * 1. **轨迹** —— 不可变日志条目（`session_log`），含已移出活跃视图的历史
 *    （内容仍在、坐标不变）；每条带稳定坐标 `#offset` 与角色/时间/状态标记。
 * 2. **检查点** —— 上下文压缩的折叠形（`meta.fold`，原文已外置）与视图同步
 *    事件留痕（`session_events`：追加 / 裁剪 / 修订 / 无变化）。
 * 3. **原文取回** —— 折叠 / 截断内容的完整原文按坐标分段读回（`memory_read_raw`，
 *    与模型工具同语义：只收坐标、不返回半截）。
 *
 * 排序：轨迹按日志坐标升序（时间线顺序；被裁历史在头部区域，向「加载更多」延伸）。
 * 刷新时机：挂载 / 切换会话 / 一次运行结束（isStreaming false 沿，延迟 500ms 等写穿）/ 手动。
 */
import { ref, computed, watch, onMounted, onUnmounted, reactive } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import { invoke } from '@/agent/composables/transport'
import { useAgentRust } from '@/agent/composables/useAgentRust'

// ── 后端镜像类型（snake_case / camelCase 与 Rust 序列化一致）────

/** `agent_commands::SessionLogStats` 镜像 */
interface SessionLogStats {
  logLen: number
  liveLen: number
  droppedLen: number
  eventCount: number
}

/** `agent_kernel::types::OrchestratorMessage` 镜像（字段为 snake_case） */
interface LogMessage {
  role: 'user' | 'assistant' | 'toolresult' | 'tool_result' | 'system'
  content: string
  tool_calls?: Array<{ id: string; name: string; args: unknown }>
  tool_call_id?: string
  meta?: Record<string, unknown>
}

/** `agent_commands::SessionLogEntry` 镜像 */
interface SessionLogEntry {
  logOffset: number
  message: LogMessage
  recordedAt: number
}

/** `agent_commands::SessionEventRecord` 镜像 */
interface SessionEventRecord {
  eventSeq: number
  eventKind: string
  added: number
  dropped: number
  kept: number
  createdAt: number
}

/** `agent_kernel::anchor::FoldMeta` 镜像（字段为 snake_case） */
interface FoldMeta {
  state: 'placeholder' | 'filled'
  raw: string
  orig_bytes: number
  orig_count: number
  orig_tokens: number
}

/** `agent_commands::RawSlice` 镜像 */
interface RawSlice {
  contentHash: string
  content: string
  totalChars: number
  from: number
  truncated: boolean
  nextFrom: number | null
}

const PAGE_LOG = 100
const PAGE_EVENTS = 200
/** 原文单次取回字符数（UI 分段：首屏 32K，避免一次性渲染超大文本） */
const RAW_CHUNK = 32 * 1024

const { currentSessionId, isStreaming } = useAgentRust()

const view = ref<'log' | 'events'>('log')
const stats = ref<SessionLogStats>({ logLen: 0, liveLen: 0, droppedLen: 0, eventCount: 0 })
const entries = ref<SessionLogEntry[]>([])
const events = ref<SessionEventRecord[]>([])
const liveOffsets = ref<number[]>([])
const loading = ref(false)
const error = ref('')
const expanded = ref<Set<number>>(new Set())
/** 末页是否为满页（false = 已到尾部，隐藏「加载更多」） */
const logFull = ref(false)
const eventsFull = ref(false)

const sessionId = computed(() => currentSessionId.value)

/** 活跃坐标集合（O(1) 判定「活跃 / 已移出视图」） */
const liveSet = computed(() => new Set(liveOffsets.value))

/** 行视图模型：预计算折叠 / 原文坐标与展示串（模板不做空值收窄与重复解析） */
interface LogRow {
  entry: SessionLogEntry
  live: boolean
  fold: FoldMeta | null
  rawHash: string | null
  /** 折叠徽标文案（'' = 非折叠形） */
  foldBadge: string
  /** 折叠摘要（'' = 非折叠形） */
  foldSummary: string
  /** 折叠原文坐标（'' = 非折叠形） */
  foldRaw: string
}
const rows = computed<LogRow[]>(() =>
  entries.value.map((entry) => {
    const fold = foldOf(entry.message)
    return {
      entry,
      live: liveSet.value.has(entry.logOffset),
      fold,
      rawHash: rawHashOf(entry.message),
      foldBadge: fold ? (fold.state === 'placeholder' ? '检查点·待回填' : '检查点') : '',
      foldSummary: fold
        ? `原文 ${fmtBytes(fold.orig_bytes)} · ${fold.orig_count} 条 · 约 ${fold.orig_tokens} token`
        : '',
      foldRaw: fold ? fold.raw : '',
    }
  }),
)

// ── 解析：折叠 meta 与截断标注 ────────────────────────

/** 截断标注锚点（与 kernel `raw_context::EXTERNALIZED_MARKER` 一致） */
const RAW_MARKER = '原文已外置：raw/'

function foldOf(m: LogMessage): FoldMeta | null {
  const v = m.meta?.fold as Partial<FoldMeta> | undefined
  if (!v || typeof v !== 'object' || typeof v.raw !== 'string') return null
  return {
    state: v.state === 'filled' ? 'filled' : 'placeholder',
    raw: v.raw,
    orig_bytes: Number(v.orig_bytes) || 0,
    orig_count: Number(v.orig_count) || 0,
    orig_tokens: Number(v.orig_tokens) || 0,
  }
}

/** 内容中的外置坐标（折叠形优先取 FoldMeta.raw） */
function rawHashOf(m: LogMessage): string | null {
  const fold = foldOf(m)
  if (fold) return fold.raw
  const idx = m.content.indexOf(RAW_MARKER)
  if (idx < 0) return null
  const hit = m.content.slice(idx + RAW_MARKER.length).match(/^[0-9a-f]{16}/)
  return hit ? (hit[0] ?? null) : null
}

// ── 展示辅助 ─────────────────────────────────────────

function roleKind(role: LogMessage['role']): string {
  if (role === 'toolresult' || role === 'tool_result') return 'tool'
  return role
}
function roleLabel(role: LogMessage['role']): string {
  switch (role) {
    case 'user': return '用户'
    case 'assistant': return '助手'
    case 'system': return '系统'
    default: return '工具'
  }
}
function roleIcon(role: LogMessage['role']): string {
  switch (role) {
    case 'user': return 'user'
    case 'assistant': return 'bot'
    case 'system': return 'settings'
    default: return 'wrench'
  }
}

function kindLabel(kind: string): string {
  switch (kind) {
    case 'initial': return '初始'
    case 'append': return '追加'
    case 'trim': return '裁剪'
    case 'revise': return '修订'
    case 'noop': return '无变化'
    default: return kind
  }
}

function fmtTime(ts: number): string {
  const d = new Date(ts * 1000)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`
}
function fmtFullTime(ts: number): string {
  const d = new Date(ts * 1000)
  const mm = (d.getMonth() + 1).toString().padStart(2, '0')
  const dd = d.getDate().toString().padStart(2, '0')
  return `${mm}-${dd} ${fmtTime(ts)}`
}
function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function toggleExpanded(offset: number): void {
  const next = new Set(expanded.value)
  if (next.has(offset)) next.delete(offset)
  else next.add(offset)
  expanded.value = next
}

// ── 取数 ────────────────────────────────────────────

function resetLocal(): void {
  stats.value = { logLen: 0, liveLen: 0, droppedLen: 0, eventCount: 0 }
  entries.value = []
  events.value = []
  liveOffsets.value = []
  expanded.value = new Set()
  logFull.value = false
  eventsFull.value = false
  error.value = ''
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** 首屏加载：统计 + 首页日志 + 首页事件 + 活跃坐标（并发一取） */
async function refresh(): Promise<void> {
  const sid = currentSessionId.value
  if (!sid) {
    resetLocal()
    return
  }
  loading.value = true
  error.value = ''
  try {
    const [st, log, evs, live] = await Promise.all([
      invoke<SessionLogStats>('session_log_stats', { sessionId: sid }),
      invoke<SessionLogEntry[]>('load_session_log', { sessionId: sid, fromOffset: 0, limit: PAGE_LOG }),
      invoke<SessionEventRecord[]>('load_session_events', { sessionId: sid, fromSeq: 0, limit: PAGE_EVENTS }),
      invoke<number[]>('load_live_offsets', { sessionId: sid }),
    ])
    // 会话在请求期间可能被切走：丢弃过期结果（否则旧会话数据串进新视图）
    if (sid !== currentSessionId.value) return
    stats.value = st
    entries.value = log
    events.value = evs
    liveOffsets.value = live
    logFull.value = log.length === PAGE_LOG
    eventsFull.value = evs.length === PAGE_EVENTS
    expanded.value = new Set()
  } catch (e) {
    if (sid === currentSessionId.value) error.value = `读取会话日志失败：${errText(e)}`
  } finally {
    if (sid === currentSessionId.value) loading.value = false
  }
}

async function loadMoreLog(): Promise<void> {
  const sid = currentSessionId.value
  if (!sid || loading.value) return
  const last = entries.value[entries.value.length - 1]
  const from = last ? last.logOffset + 1 : 0
  loading.value = true
  try {
    const more = await invoke<SessionLogEntry[]>('load_session_log', {
      sessionId: sid,
      fromOffset: from,
      limit: PAGE_LOG,
    })
    if (sid !== currentSessionId.value) return
    entries.value = entries.value.concat(more)
    logFull.value = more.length === PAGE_LOG
  } catch (e) {
    if (sid === currentSessionId.value) error.value = `读取会话日志失败：${errText(e)}`
  } finally {
    if (sid === currentSessionId.value) loading.value = false
  }
}

async function loadMoreEvents(): Promise<void> {
  const sid = currentSessionId.value
  if (!sid || loading.value) return
  const last = events.value[events.value.length - 1]
  const from = last ? last.eventSeq + 1 : 0
  loading.value = true
  try {
    const more = await invoke<SessionEventRecord[]>('load_session_events', {
      sessionId: sid,
      fromSeq: from,
      limit: PAGE_EVENTS,
    })
    if (sid !== currentSessionId.value) return
    events.value = events.value.concat(more)
    eventsFull.value = more.length === PAGE_EVENTS
  } catch (e) {
    if (sid === currentSessionId.value) error.value = `读取会话事件失败：${errText(e)}`
  } finally {
    if (sid === currentSessionId.value) loading.value = false
  }
}

// ── 原文取回（弹窗）─────────────────────────────────

const rawView = reactive({
  open: false,
  hash: '',
  loading: false,
  error: '',
  content: '',
  totalChars: 0,
  truncated: false,
  nextFrom: null as number | null,
})
const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | null = null

async function openRaw(hash: string | null): Promise<void> {
  if (!hash) return
  rawView.open = true
  rawView.hash = hash
  rawView.loading = true
  rawView.error = ''
  rawView.content = ''
  rawView.totalChars = 0
  rawView.truncated = false
  rawView.nextFrom = null
  try {
    const slice = await invoke<RawSlice>('memory_read_raw', { contentHash: hash, from: 0, maxChars: RAW_CHUNK })
    if (rawView.hash !== hash) return
    rawView.content = slice.content
    rawView.totalChars = slice.totalChars
    rawView.truncated = slice.truncated
    rawView.nextFrom = slice.nextFrom
  } catch (e) {
    if (rawView.hash === hash) rawView.error = `原文取回失败：${errText(e)}`
  } finally {
    if (rawView.hash === hash) rawView.loading = false
  }
}

async function loadMoreRaw(): Promise<void> {
  if (rawView.loading || rawView.nextFrom == null) return
  const hash = rawView.hash
  const from = rawView.nextFrom
  rawView.loading = true
  try {
    const slice = await invoke<RawSlice>('memory_read_raw', { contentHash: hash, from, maxChars: RAW_CHUNK })
    if (rawView.hash !== hash) return
    rawView.content += slice.content
    rawView.totalChars = slice.totalChars
    rawView.truncated = slice.truncated
    rawView.nextFrom = slice.nextFrom
  } catch (e) {
    if (rawView.hash === hash) rawView.error = `原文取回失败：${errText(e)}`
  } finally {
    if (rawView.hash === hash) rawView.loading = false
  }
}

function closeRaw(): void {
  rawView.open = false
  rawView.loading = false
  rawView.error = ''
}

async function copyRaw(): Promise<void> {
  try {
    await navigator.clipboard.writeText(rawView.content)
    copied.value = true
    if (copiedTimer) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => { copied.value = false }, 1500)
  } catch {
    // 剪贴板不可用（权限/环境）：静默降级，不阻断查看
  }
}

function onModalKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') closeRaw()
}
watch(
  () => rawView.open,
  (open) => {
    if (open) window.addEventListener('keydown', onModalKey)
    else window.removeEventListener('keydown', onModalKey)
  },
)
onUnmounted(() => {
  window.removeEventListener('keydown', onModalKey)
  if (copiedTimer) clearTimeout(copiedTimer)
})

// ── 刷新时机 ────────────────────────────────────────

watch(currentSessionId, (sid) => {
  resetLocal()
  if (sid) refresh()
})

/** 一次运行结束（写穿发生在 AgentEnd）→ 延迟刷新；不轮询 */
let settleTimer: ReturnType<typeof setTimeout> | null = null
watch(isStreaming, (now, prev) => {
  if (!now && prev) {
    if (settleTimer) clearTimeout(settleTimer)
    settleTimer = setTimeout(() => {
      if (currentSessionId.value) refresh()
    }, 500)
  }
})
onUnmounted(() => {
  if (settleTimer) clearTimeout(settleTimer)
})

onMounted(() => {
  if (currentSessionId.value) refresh()
})
</script>

<style scoped>
.session-log-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* ── 头部 ── */

.slp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 2px 6px;
}

.slp-title {
  font-size: var(--fs-md);
  font-weight: 600;
  margin: 0;
}

.slp-header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.slp-icon-btn {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
}
.slp-icon-btn:hover:not(:disabled) {
  background: var(--bg-muted);
  color: var(--text-primary);
}
.slp-icon-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.slp-icon-btn.spinning :deep(.ws-icon) {
  animation: slp-spin 0.9s linear infinite;
}
@keyframes slp-spin {
  to { transform: rotate(360deg); }
}

/* ── 统计条 ── */

.slp-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 2px 6px;
}

.slp-stat {
  font-size: var(--fs-2xs);
  color: var(--text-secondary);
  background: var(--bg-muted);
  border-radius: var(--radius-sm);
  padding: 2px 6px;
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.slp-stat b {
  font-size: var(--fs-xs);
  font-weight: 600;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}
.slp-stat-out b { color: var(--warning); }
.slp-stat-live b { color: var(--success); }

/* ── 视图切换 ── */

.slp-seg {
  display: flex;
  gap: 2px;
  padding: 2px 2px 6px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 6px;
}

.slp-seg-btn {
  flex: 1;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  padding: 4px 0;
  font-size: var(--fs-xs);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}
.slp-seg-btn:hover { background: var(--bg-muted); color: var(--text-primary); }
.slp-seg-btn.active {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}

/* ── 主体 ── */

.slp-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 2px;
}

.slp-empty {
  text-align: center;
  color: var(--text-muted);
  padding: 18px 8px;
  font-size: var(--fs-xs);
}
.slp-error { color: var(--danger); word-break: break-all; }

.slp-error-strip {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 8px;
  margin-bottom: 6px;
  border: 1px solid var(--danger-soft);
  background: var(--danger-soft);
  border-radius: var(--radius-sm);
  color: var(--danger);
  font-size: var(--fs-xs);
}
.slp-error-text {
  flex: 1;
  word-break: break-all;
}

.slp-link-btn {
  border: none;
  background: transparent;
  color: var(--accent);
  font-size: var(--fs-xs);
  cursor: pointer;
  padding: 1px 4px;
  border-radius: var(--radius-sm);
}
.slp-link-btn:hover { background: var(--accent-soft); }

.slp-more {
  width: 100%;
  border: 1px dashed var(--border);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--fs-xs);
  padding: 5px 0;
  border-radius: var(--radius-sm);
  cursor: pointer;
  margin: 4px 0 8px;
}
.slp-more:hover:not(:disabled) { color: var(--accent); border-color: var(--accent-soft-border); }
.slp-more:disabled { opacity: 0.6; cursor: default; }

/* ── 日志条目 ── */

.slp-entry {
  border-left: 2px solid transparent;
  border-radius: var(--radius-sm);
  padding: 4px 6px 4px 8px;
  margin-bottom: 2px;
}
.slp-entry:hover { background: var(--bg-muted); }
.slp-entry-out { border-left-color: var(--border-strong); }

.slp-entry-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 5px;
  cursor: pointer;
  user-select: none;
}

.slp-offset {
  font-size: var(--fs-2xs);
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 0 4px;
}

.slp-role {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: var(--fs-2xs);
  border-radius: var(--radius-sm);
  padding: 1px 5px;
  color: var(--text-secondary);
  background: var(--bg-muted);
}
.slp-role-user { color: var(--info); background: var(--info-soft); }
.slp-role-assistant { color: var(--accent); background: var(--accent-soft); }
.slp-role-tool { color: var(--text-secondary); background: var(--bg-muted); }
.slp-role-system { color: var(--warning); background: var(--warning-soft); }

.slp-time {
  font-size: var(--fs-2xs);
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  margin-left: auto;
}

.slp-badge {
  font-size: var(--fs-2xs);
  border-radius: var(--radius-sm);
  padding: 1px 5px;
  white-space: nowrap;
}
.slp-badge-out { color: var(--text-muted); background: var(--bg-surface); border: 1px solid var(--border); }
.slp-badge-fold { color: var(--accent); background: var(--accent-soft); }
.slp-badge-raw { color: var(--warning); background: var(--warning-soft); }

.slp-chevron {
  color: var(--text-muted);
  transition: transform 0.15s;
  flex-shrink: 0;
}
.slp-chevron.open { transform: rotate(180deg); }

.slp-fold {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 0 0 2px;
}
.slp-fold-meta {
  font-size: var(--fs-2xs);
  color: var(--text-muted);
}

.slp-content {
  margin-top: 3px;
  font-size: var(--fs-xs);
  color: var(--text-secondary);
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.slp-content.expanded {
  display: block;
  overflow: visible;
  color: var(--text-primary);
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 6px 8px;
  max-height: 420px;
  overflow-y: auto;
}

.slp-detail {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 4px 0 0 2px;
}
.slp-detail-item {
  font-size: var(--fs-2xs);
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

/* ── 检查点事件 ── */

.slp-event {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 6px;
  border-radius: var(--radius-sm);
}
.slp-event:hover { background: var(--bg-muted); }

.slp-ev-kind {
  font-size: var(--fs-2xs);
  border-radius: var(--radius-sm);
  padding: 1px 6px;
  min-width: 40px;
  text-align: center;
  color: var(--text-secondary);
  background: var(--bg-muted);
}
.slp-ev-initial { color: var(--info); background: var(--info-soft); }
.slp-ev-append { color: var(--success); background: var(--success-soft); }
.slp-ev-trim { color: var(--warning); background: var(--warning-soft); }
.slp-ev-revise { color: var(--accent); background: var(--accent-soft); }
.slp-ev-noop { color: var(--text-muted); background: var(--bg-surface); border: 1px solid var(--border); }

.slp-ev-scale {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--fs-2xs);
  font-variant-numeric: tabular-nums;
}
.slp-sc-add { color: var(--success); }
.slp-sc-drop { color: var(--warning); }
.slp-sc-kept { color: var(--text-muted); }

/* ── 原文弹窗 ── */

.slp-raw-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  z-index: 10020;
}
.slp-raw-modal {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: min(760px, calc(100vw - 64px));
  height: min(70vh, 640px);
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
  z-index: 10021;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.slp-raw-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
}
.slp-raw-title {
  font-size: var(--fs-xs);
  font-weight: 600;
  color: var(--text-primary);
}
.slp-raw-hash {
  font-size: var(--fs-2xs);
  color: var(--text-secondary);
  background: var(--bg-muted);
  border-radius: var(--radius-sm);
  padding: 1px 5px;
}
.slp-raw-meta {
  font-size: var(--fs-2xs);
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  margin-left: auto;
}
.slp-raw-content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  margin: 0;
  padding: 10px 12px;
  font-size: var(--fs-xs);
  line-height: 1.5;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
}
.slp-raw-foot {
  border-top: 1px solid var(--border);
  padding: 6px 10px;
}
</style>
