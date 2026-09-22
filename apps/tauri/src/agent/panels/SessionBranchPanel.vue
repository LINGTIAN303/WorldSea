<!--
  SessionBranchPanel：历史与分支抽屉（UX-a 会话分支第二入口）
  边界时间轴（时间 + 用户消息摘要 + 检查点标记 + 用途标签）+ 检查点段（会话锚点 / 任务断点）+
  手动打点。分叉 / 回滚统一走 useSessionBranch 的确认封装（与消息行入口同文案同路径）。
  显隐由 useSessionBranch 的模块级 panelOpen 驱动（SessionSidebar 入口与消息行共用）。
-->
<template>
  <Teleport to="body">
    <div v-if="panelOpen" class="sbp-backdrop" @click="closeBranchPanel()"></div>
    <aside v-if="panelOpen" class="sbp-drawer" aria-label="历史与分支">
      <header class="sbp-head">
        <span class="sbp-title">历史与分支</span>
        <button
          type="button"
          class="sbp-btn"
          title="在当前请求边界打一个检查点"
          :disabled="busy"
          @click="onCreateCheckpoint"
        >打点</button>
        <button type="button" class="sbp-btn" @click="closeBranchPanel()">关闭</button>
      </header>

      <div class="sbp-body">
        <!-- 检查点段 -->
        <section class="sbp-sec">
          <div class="sbp-sec-title">检查点</div>
          <div v-if="sessionAnchors.length === 0 && taskResumes.length === 0" class="sbp-empty">
            暂无检查点——每 10 个请求自动打点，或点右上「打点」
          </div>
          <div v-for="cp in sessionAnchors" :key="cp.id" class="sbp-cp">
            <span class="sbp-cp-time">{{ fmtTime(cp.created_at_ms) }}</span>
            <span class="sbp-cp-seq">#{{ anchorSeq(cp) }}</span>
            <span class="sbp-tag sbp-tag-cp">会话锚点</span>
          </div>
          <div v-for="cp in taskResumes" :key="`t-${cp.id}`" class="sbp-cp">
            <span class="sbp-cp-time">{{ fmtTime(cp.created_at_ms) }}</span>
            <span class="sbp-cp-seq">{{ shortId(cp.id) }}</span>
            <span class="sbp-tag">任务断点</span>
          </div>
        </section>

        <!-- 边界时间轴（降序：最新在前） -->
        <section class="sbp-sec">
          <div class="sbp-sec-title">请求边界</div>
          <div v-if="boundaries.length === 0" class="sbp-empty">暂无请求边界（发送一条消息后出现）</div>
          <div v-for="b in boundaries" :key="b.requestSeq" class="sbp-row">
            <div class="sbp-row-main">
              <div class="sbp-row-top">
                <span class="sbp-seq">#{{ b.requestSeq }}</span>
                <span class="sbp-time">{{ fmtTime(b.capturedAtMs) }}</span>
                <span v-if="b.purpose !== 'main'" class="sbp-tag">{{ b.purpose }}</span>
                <span v-if="b.checkpointId" class="sbp-tag sbp-tag-cp">检查点</span>
              </div>
              <div class="sbp-text" :title="b.userText ?? ''">{{ b.userText || '（无用户消息）' }}</div>
            </div>
            <div class="sbp-row-actions">
              <button type="button" class="sbp-btn" :disabled="busy" @click="onFork(b)">分叉</button>
              <button type="button" class="sbp-btn" :disabled="busy" @click="onRewind(b)">回滚</button>
            </div>
          </div>
          <!-- 长会话分页：窗口拉满才显示（更早的边界逐页加载） -->
          <div v-if="hasMoreBoundaries" class="sbp-more">
            <button type="button" class="sbp-btn" :disabled="busy" @click="loadMoreBoundaries">
              加载更早的边界
            </button>
          </div>
        </section>
      </div>
    </aside>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { useAgentRust } from '@/agent/composables/useAgentRust'
import {
  useSessionBranch,
  createCheckpointConfirmed,
  forkAtConfirmed,
  rewindAtConfirmed,
  type CheckpointRef,
  type RequestBoundaryDto,
} from '@/agent/composables/useSessionBranch'

const { currentSessionId } = useAgentRust()
const { panelOpen, boundaries, checkpoints, closeBranchPanel, loadBoundaries, loadCheckpoints } =
  useSessionBranch()

const busy = ref(false)

/** 会话锚点（会话锚点 = 请求边界指针；任务断点单列） */
const sessionAnchors = computed<CheckpointRef[]>(() =>
  checkpoints.value.filter((c) => c.anchor.kind === 'request_boundary'),
)
const taskResumes = computed<CheckpointRef[]>(() =>
  checkpoints.value.filter((c) => c.anchor.kind === 'task_progress'),
)

/** 边界列表分页窗口（长会话：默认 200 条，「加载更多」按页递增——避免一次拉全量） */
const BOUNDARY_PAGE = 200
const boundaryLimit = ref(BOUNDARY_PAGE)
/** 后端返回条数达到窗口上限 → 可能还有更早的边界 */
const hasMoreBoundaries = computed(() => boundaries.value.length >= boundaryLimit.value)

/** 按当前分页窗口刷新两表（失败仅告警——面板可空态自处） */
async function reload(): Promise<void> {
  const sid = currentSessionId.value
  if (!sid) return
  await loadBoundaries(sid, boundaryLimit.value).catch((err) =>
    console.warn('[SessionBranchPanel] 边界加载失败:', err),
  )
  await loadCheckpoints(sid).catch((err) =>
    console.warn('[SessionBranchPanel] 检查点加载失败:', err),
  )
}

/** 打开抽屉 / 切换会话时刷新（分页窗口重置为首页） */
watch(
  [panelOpen, currentSessionId],
  ([open, sid]) => {
    if (!open || !sid) return
    boundaryLimit.value = BOUNDARY_PAGE
    void reload()
  },
  { immediate: true },
)

/** 加载更早的边界（窗口 +1 页） */
function loadMoreBoundaries(): void {
  boundaryLimit.value += BOUNDARY_PAGE
  void reload()
}

function anchorSeq(cp: CheckpointRef): string {
  return cp.anchor.kind === 'request_boundary' ? String(cp.anchor.request_seq) : '—'
}

function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 8)}…` : id
}

function fmtTime(ms: number): string {
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

async function refreshAfter(): Promise<void> {
  await reload()
}

async function onFork(b: RequestBoundaryDto): Promise<void> {
  const sid = currentSessionId.value
  if (!sid || busy.value) return
  busy.value = true
  try {
    await forkAtConfirmed(sid, b.requestSeq)
  } finally {
    busy.value = false
  }
}

async function onRewind(b: RequestBoundaryDto): Promise<void> {
  const sid = currentSessionId.value
  if (!sid || busy.value) return
  busy.value = true
  try {
    await rewindAtConfirmed(sid, b.requestSeq)
    await refreshAfter()
  } finally {
    busy.value = false
  }
}

async function onCreateCheckpoint(): Promise<void> {
  const sid = currentSessionId.value
  if (!sid || busy.value) return
  busy.value = true
  try {
    const ok = await createCheckpointConfirmed(sid)
    if (ok) await refreshAfter()
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.sbp-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.25);
  z-index: 10010;
}
.sbp-drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(380px, 92vw);
  display: flex;
  flex-direction: column;
  background: var(--bg-surface);
  border-left: 1px solid var(--border);
  box-shadow: -8px 0 28px rgba(0, 0, 0, 0.2);
  z-index: 10011;
}
.sbp-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
}
.sbp-title {
  flex: 1;
  font-size: var(--fs-md);
  font-weight: 600;
  color: var(--text-primary);
}
.sbp-btn {
  padding: 3px 10px;
  font-size: var(--fs-xs);
  color: var(--text-secondary);
  background: var(--bg-muted);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.sbp-btn:hover:not(:disabled) {
  color: var(--text-primary);
  border-color: var(--accent);
}
.sbp-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.sbp-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 12px 16px;
}
.sbp-sec {
  margin-top: 10px;
}
.sbp-sec-title {
  font-size: var(--fs-xs);
  font-weight: 600;
  color: var(--text-muted);
  margin-bottom: 6px;
}
.sbp-empty {
  font-size: var(--fs-xs);
  color: var(--text-muted);
  padding: 6px 0;
}
.sbp-cp {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  font-size: var(--fs-xs);
  color: var(--text-secondary);
}
.sbp-cp-time {
  font-variant-numeric: tabular-nums;
}
.sbp-cp-seq {
  color: var(--accent);
  font-variant-numeric: tabular-nums;
}
.sbp-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid var(--border);
}
.sbp-row-main {
  flex: 1;
  min-width: 0;
}
.sbp-row-top {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-2xs);
  color: var(--text-muted);
}
.sbp-seq {
  color: var(--accent);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.sbp-time {
  font-variant-numeric: tabular-nums;
}
.sbp-tag {
  padding: 0 5px;
  border-radius: var(--radius-sm);
  background: var(--bg-muted);
  color: var(--text-muted);
}
.sbp-tag-cp {
  color: var(--success);
}
.sbp-text {
  margin-top: 2px;
  font-size: var(--fs-xs);
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  word-break: break-all;
}
.sbp-row-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}
.sbp-more {
  padding: 8px 0;
  text-align: center;
}
</style>
