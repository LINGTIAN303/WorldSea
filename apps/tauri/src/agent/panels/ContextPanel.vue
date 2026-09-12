<template>
  <div class="context-panel">
    <div class="cx-header">
      <h3 class="cx-title">上下文窗口</h3>
      <button
        class="cx-icon-btn"
        :class="{ spinning: loading }"
        type="button"
        title="刷新"
        :disabled="loading"
        @click="refresh()"
      >
        <WsIcon :name="loading ? 'loading' : 'refresh'" size="xs" />
      </button>
    </div>

    <div v-if="!sessionId" class="cx-empty">未选择会话</div>

    <template v-else>
      <div v-if="error" class="cx-error">{{ error }}</div>

      <!-- 占用总览：数字 + 比例条（归档阈值 / 触发点刻度） -->
      <div class="cx-gauge">
        <div class="cx-nums">
          <span class="cx-total">{{ fmtTokens(usage.totalTokens) }}</span>
          <span class="cx-slash">/</span>
          <span class="cx-window">{{ fmtTokens(usage.contextWindow) }} token</span>
          <span class="cx-pct" :class="levelClass">{{ pctOfWindow }}%</span>
        </div>
        <div class="cx-bar">
          <div class="cx-bar-fill" :class="levelClass" :style="{ width: barWidth }"></div>
          <div
            class="cx-mark cx-mark-archive"
            :style="{ left: archivePct + '%' }"
            title="归档阈值"
          ></div>
          <div
            class="cx-mark cx-mark-trigger"
            :style="{ left: triggerPct + '%' }"
            title="裁剪触发点（95% 阈值）"
          ></div>
        </div>
        <div class="cx-legend">
          <span>归档阈值 {{ fmtTokens(usage.archiveThreshold) }}（占用 {{ pctOfArchive }}%）</span>
          <span>触发点 {{ fmtTokens(usage.trimTrigger) }}</span>
        </div>
      </div>

      <!-- 构成明细 -->
      <div class="cx-grid">
        <div class="cx-item">
          <span class="cx-val">{{ fmtTokens(usage.historyTokens) }}</span>
          <span class="cx-label">历史</span>
        </div>
        <div class="cx-item">
          <span class="cx-val">{{ fmtTokens(usage.systemTokens) }}</span>
          <span class="cx-label">系统侧</span>
        </div>
        <div class="cx-item">
          <span class="cx-val">{{ usage.messageCount }}</span>
          <span class="cx-label">消息数</span>
        </div>
        <div class="cx-item">
          <span class="cx-val" :class="levelClass">{{ tierLabel }}</span>
          <span class="cx-label">压缩层级</span>
        </div>
      </div>

      <!-- 操作：立即压缩 -->
      <div class="cx-actions">
        <button
          class="cx-compact-btn"
          type="button"
          :disabled="compacting || isStreaming"
          :title="isStreaming ? '生成中，暂不可压缩' : '把可裁内容折叠为锚点（一次到底，受保护内容不动）'"
          @click="doCompact()"
        >
          <WsIcon name="collapse" size="xs" />
          {{ compacting ? '压缩中…' : '立即压缩' }}
        </button>
      </div>

      <div v-if="latestCompaction" class="cx-result" :class="{ 'is-err': !latestCompaction.ok }">
        {{ latestCompaction.text }}
      </div>

      <p class="cx-hint">
        压缩只影响模型上下文：聊天记录与不可变日志不受影响，折叠原文已外置、可按锚点取回。
        窗口总量取模型声明，未知型号回退 32K。
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * ContextPanel：丁1 加急「上下文窗口」执行区（与轨迹/会话日志并列）
 *
 * 数据面：`context_usage`（占用快照，与自动裁剪同源计量）+ `compact_context`
 * （手动压缩「一次到底」，返回压缩产出与压缩后最新占用）。
 * 刷新时机：挂载 / 切换会话 / 一次运行结束（isStreaming false 沿，延迟 500ms
 * 等归档写穿）/ 手动——与 SessionLogPanel 同款节奏，不轮询。
 */
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import { invoke } from '@/agent/composables/transport'
import { useAgentRust } from '@/agent/composables/useAgentRust'

// ── 后端镜像类型（camelCase 与 Rust serde 序列化一致）────

/** `agent_kernel::context_budget::ContextUsage` 镜像 */
interface ContextUsage {
  totalTokens: number
  historyTokens: number
  systemTokens: number
  messageCount: number
  contextWindow: number
  archiveThreshold: number
  trimTrigger: number
  tier: number
}

const EMPTY_USAGE: ContextUsage = {
  totalTokens: 0,
  historyTokens: 0,
  systemTokens: 0,
  messageCount: 0,
  contextWindow: 0,
  archiveThreshold: 0,
  trimTrigger: 0,
  tier: 0,
}

const { currentSessionId, isStreaming, compactContext, latestCompaction, clearCompactionHint } = useAgentRust()

const sessionId = computed(() => currentSessionId.value)
const usage = ref<ContextUsage>({ ...EMPTY_USAGE })
const loading = ref(false)
const compacting = ref(false)
const error = ref('')

// ── 展示派生 ────────────────────────────────────────

function pct(n: number, base: number): number {
  if (base <= 0) return 0
  return Math.round((n / base) * 100)
}

/** 相对窗口占用（可超 100：爆窗时如实显示） */
const pctOfWindow = computed(() => pct(usage.value.totalTokens, usage.value.contextWindow))
/** 相对归档阈值占用（用户最关心的「离自动裁剪线还有多远」） */
const pctOfArchive = computed(() => pct(usage.value.totalTokens, usage.value.archiveThreshold))
/** 进度条宽度（clamp 到 100，防溢出视觉） */
const barWidth = computed(() => `${Math.min(100, pctOfWindow.value)}%`)
const archivePct = computed(() => Math.min(100, pct(usage.value.archiveThreshold, usage.value.contextWindow)))
const triggerPct = computed(() => Math.min(100, pct(usage.value.trimTrigger, usage.value.contextWindow)))

/** 层级色档：0–1 正常 / 2–3 预警 / 4 触线 */
const levelClass = computed(() => {
  const t = usage.value.tier
  if (t >= 4) return 'lv-high'
  if (t >= 2) return 'lv-mid'
  return 'lv-ok'
})

const TIER_NAMES = ['正常', 'Snip', 'MicroCompact', 'Collapse', 'AutoCompact']
const tierLabel = computed(() => {
  const t = Math.min(usage.value.tier, 4)
  return t === 0 ? '正常' : `L${t} ${TIER_NAMES[t]}`
})

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// ── 数据拉取 ────────────────────────────────────────

async function refresh(): Promise<void> {
  const sid = currentSessionId.value
  if (!sid) return
  loading.value = true
  try {
    const u = await invoke<ContextUsage>('context_usage', { sessionId: sid })
    if (sid !== currentSessionId.value) return
    usage.value = u
    error.value = ''
  } catch (e) {
    if (sid === currentSessionId.value) error.value = `读取上下文占用失败：${errText(e)}`
  } finally {
    if (sid === currentSessionId.value) loading.value = false
  }
}

/** 手动压缩「一次到底」：与 /compact 指令共用实现（useAgentRust.compactContext），
 *  回执文案与提示条同源（latestCompaction），成功后就地刷新占用 */
async function doCompact(): Promise<void> {
  const sid = currentSessionId.value
  if (!sid || compacting.value || isStreaming.value) return
  compacting.value = true
  try {
    const r = await compactContext(sid)
    if (sid !== currentSessionId.value) return
    if (r.usage) usage.value = r.usage
  } finally {
    compacting.value = false
  }
}

// ── 刷新时机（与 SessionLogPanel 同款节奏）────────────

function resetLocal(): void {
  usage.value = { ...EMPTY_USAGE }
  error.value = ''
  clearCompactionHint()
}

watch(currentSessionId, (sid) => {
  resetLocal()
  if (sid) refresh()
})

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
.context-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* ── 头部 ── */

.cx-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 2px 6px;
}

.cx-title {
  font-size: var(--fs-md);
  font-weight: 600;
  margin: 0;
}

.cx-icon-btn {
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
.cx-icon-btn:hover:not(:disabled) {
  background: var(--bg-muted);
  color: var(--text-primary);
}
.cx-icon-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.cx-icon-btn.spinning :deep(.ws-icon) {
  animation: cx-spin 0.9s linear infinite;
}
@keyframes cx-spin {
  to { transform: rotate(360deg); }
}

.cx-empty,
.cx-error {
  padding: 10px 2px;
  font-size: var(--fs-xs);
  color: var(--text-muted);
}
.cx-error { color: var(--danger, var(--warning)); }

/* ── 占用总览 ── */

.cx-gauge {
  padding: 4px 2px 8px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 8px;
}

.cx-nums {
  display: flex;
  align-items: baseline;
  gap: 5px;
  margin-bottom: 6px;
}

.cx-total {
  font-size: var(--fs-lg, 16px);
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}
.cx-slash,
.cx-window {
  font-size: var(--fs-xs);
  color: var(--text-secondary);
}
.cx-pct {
  margin-left: auto;
  font-size: var(--fs-sm);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.lv-ok { color: var(--success); }
.lv-mid { color: var(--warning); }
.lv-high { color: var(--danger, #dc2626); }

.cx-bar {
  position: relative;
  height: 8px;
  border-radius: 4px;
  background: var(--bg-muted);
  overflow: hidden;
}
.cx-bar-fill {
  height: 100%;
  border-radius: 4px;
  background: var(--accent);
  transition: width 0.25s ease;
}
.cx-bar-fill.lv-mid { background: var(--warning); }
.cx-bar-fill.lv-high { background: var(--danger, #dc2626); }

/* 阈值刻度线（归档阈值 / 触发点） */
.cx-mark {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  border-radius: 1px;
}
.cx-mark-archive { background: color-mix(in srgb, var(--text-primary) 55%, transparent); }
.cx-mark-trigger { background: var(--danger, #dc2626); }

.cx-legend {
  display: flex;
  justify-content: space-between;
  margin-top: 4px;
  font-size: var(--fs-2xs);
  color: var(--text-muted);
}

/* ── 构成明细 ── */

.cx-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px;
  padding: 0 2px 8px;
}

.cx-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 6px 4px;
  border-radius: var(--radius-md);
  background: var(--bg-muted);
  border: 1px solid var(--border);
}

.cx-val {
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.cx-label {
  margin-top: 2px;
  font-size: var(--fs-2xs);
  color: var(--text-muted);
}

/* ── 操作行 ── */

.cx-actions {
  display: flex;
  padding: 0 2px;
}

.cx-compact-btn {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-primary);
  font-size: var(--fs-xs);
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
}
.cx-compact-btn:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-soft);
}
.cx-compact-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.cx-result {
  margin: 6px 2px 0;
  font-size: var(--fs-2xs);
  color: var(--text-secondary);
  background: var(--bg-muted);
  border-radius: var(--radius-sm);
  padding: 4px 6px;
  line-height: 1.5;
}

.cx-hint {
  margin: 8px 2px 0;
  font-size: var(--fs-2xs);
  color: var(--text-muted);
  line-height: 1.6;
}
</style>
