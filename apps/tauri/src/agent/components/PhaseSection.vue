<script setup lang="ts">
/**
 * PhaseSection：主 Agent ReAct 执行阶段折叠卡（对话区消息下方）。
 * [D] 2026-08-20：已完成阶段自动折叠为摘要条（保留阶段标题+状态），当前进行阶段展开 + 粘性顶部。
 * 消费 useAgentRust 的 deepSegments（Rust DeepPhaseChanged 事件驱动构建）。
 */
import { ref, computed } from 'vue'
import type { DeepSegment } from '@worldsmith/shared-composables/agent/useAgent'
import { WsIcon } from '@worldsmith/ui-kit'

const props = defineProps<{
  segments: DeepSegment[]
}>()

/** 仅 phase 段参与展示（thinking 段 Tauri 端不构建） */
const phases = computed(() => props.segments.filter((s) => s.type === 'phase'))
const activePhase = computed(() => phases.value.find((s) => s.status === 'active'))
const doneCount = computed(() => phases.value.filter((s) => s.status === 'done').length)

/** 每个已完成阶段的独立折叠状态 */
const doneCollapsed = ref<Set<string>>(new Set())
function toggleDone(id: string) {
  const s = new Set(doneCollapsed.value)
  if (s.has(id)) s.delete(id); else s.add(id)
  doneCollapsed.value = s
}

/** 工具状态 → chip 修饰类 */
function toolState(status?: string): string {
  if (status === 'running') return 'running'
  if (status === 'completed') return 'done'
  return 'other'
}
</script>

<template>
  <div v-if="phases.length > 0" class="phase-section">
    <!-- 进行阶段（粘性顶部） -->
    <div v-if="activePhase" class="phase-item active sticky-top">
      <span class="phase-dot live" />
      <span class="phase-label">{{ activePhase.label }}</span>
      <span class="phase-tools">
        <span v-for="t in activePhase.tools" :key="t.id" class="tool-chip" :class="toolState(t.status)">
          <WsIcon name="wrench" :size="10" :stroke-width="1.7" />
          {{ t.name }}
        </span>
      </span>
      <span class="phase-tag">进行中</span>
    </div>

    <!-- 已完成阶段汇总：自动折叠为摘要条 -->
    <div class="phase-summary">
      <span class="phase-icon"><WsIcon name="sparkle" :size="13" :stroke-width="1.7" /></span>
      <span class="phase-title">执行过程</span>
      <span class="phase-status">{{ doneCount }} 个阶段完成</span>
      <div class="done-phases">
        <div
          v-for="seg in phases.filter((s) => s.status === 'done')"
          :key="seg.id"
          class="done-item"
          :class="{ collapsed: doneCollapsed.has(seg.id) }"
        >
          <button class="done-bar" @click="toggleDone(seg.id)" :aria-expanded="!doneCollapsed.has(seg.id)">
            <WsIcon :name="doneCollapsed.has(seg.id) ? 'chevron-right' : 'chevron-down'" :size="10" :stroke-width="1.7" />
            <span class="done-label">{{ seg.label }}</span>
            <span class="done-tag">完成</span>
          </button>
          <div v-show="!doneCollapsed.has(seg.id)" class="done-tools">
            <span v-for="t in seg.tools" :key="t.id" class="tool-chip done">
              <WsIcon name="wrench" :size="10" :stroke-width="1.7" />
              {{ t.name }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.phase-section {
  max-width: var(--chat-max-w);
  margin: 0 auto 8px;
  padding: 0 var(--chat-gutter);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  border: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 0;
}

/* 进行阶段 - 粘性顶部 */
.sticky-top {
  position: sticky;
  top: -1px;
  z-index: 2;
}
.phase-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: var(--radius-sm);
  background: var(--accent-soft);
  border: 1px solid var(--accent-soft-border);
  margin: 0 6px;
}
.phase-item.active {
  background: var(--accent-soft);
  border-color: var(--accent-soft-border);
}
.phase-dot {
  width: var(--dot-sm);
  height: var(--dot-sm);
  border-radius: 50%;
  background: var(--text-muted);
  flex-shrink: 0;
}
.phase-dot.live {
  background: var(--accent);
  animation: pulse var(--dur-pulse) ease-in-out infinite;
}
.phase-label {
  font-size: var(--fs-sm);
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}
.phase-tools {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 0;
}
.tool-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 7px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border);
  background: var(--bg-surface);
  font-size: var(--fs-xs);
  color: var(--text-muted);
}
.tool-chip.running {
  border-color: var(--accent-soft-border);
  color: var(--accent);
}
.tool-chip.done {
  color: var(--success);
  border-color: var(--border);
}
.phase-tag {
  flex-shrink: 0;
  font-size: var(--fs-xs);
  color: var(--accent);
}

/* 已完成阶段汇总 */
.phase-summary {
  padding: 4px 10px;
}
.phase-icon {
  display: inline-flex;
  color: var(--accent);
  vertical-align: middle;
}
.phase-title {
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--text-primary);
  margin-left: 6px;
  vertical-align: middle;
}
.phase-status {
  font-size: var(--fs-xs);
  color: var(--text-muted);
  margin-left: 8px;
  vertical-align: middle;
}
.done-phases {
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.done-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.done-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 5px 8px;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  text-align: left;
  font-size: var(--fs-xs);
  color: var(--text-secondary);
  transition: background 0.12s;
}
.done-bar:hover {
  background: var(--bg-muted);
}
.done-label {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.done-tag {
  flex-shrink: 0;
  font-size: var(--fs-2xs);
  color: var(--text-muted);
}
.done-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 2px 8px 4px 24px;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}
</style>