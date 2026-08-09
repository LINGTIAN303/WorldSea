<script setup lang="ts">
/**
 * PhaseSection：主 Agent ReAct 执行阶段折叠卡（对话区消息下方）。
 * 消费 useAgentRust 的 deepSegments（Rust DeepPhaseChanged 事件驱动构建），
 * 展示阶段标签 + 工具 chips + 状态，生成中实时更新、结束后保留供回顾。
 */
import { ref, computed } from 'vue'
import type { DeepSegment } from '@worldsmith/shared-composables/agent/useAgent'
import { WsIcon } from '@worldsmith/ui-kit'

const props = defineProps<{
  segments: DeepSegment[]
}>()

/** 折叠态：默认展开展示过程，用户可收起 */
const collapsed = ref(false)

/** 仅 phase 段参与展示（thinking 段 Tauri 端不构建） */
const phases = computed(() => props.segments.filter((s) => s.type === 'phase'))
const activePhase = computed(() => phases.value.find((s) => s.status === 'active'))
const doneCount = computed(() => phases.value.filter((s) => s.status === 'done').length)

/** 工具状态 → chip 修饰类：running 呼吸强调 / completed 弱成功 / 其他弱化 */
function toolState(status?: string): string {
  if (status === 'running') return 'running'
  if (status === 'completed') return 'done'
  return 'other'
}
</script>

<template>
  <div v-if="phases.length > 0" class="phase-section">
    <div
      class="phase-bar"
      role="button"
      tabindex="0"
      title="执行过程（Agent 阶段轨迹）"
      :aria-expanded="!collapsed"
      aria-controls="phase-list"
      @click="collapsed = !collapsed"
      @keydown.enter="collapsed = !collapsed"
      @keydown.space.prevent="collapsed = !collapsed"
    >
      <span class="phase-icon"><WsIcon name="sparkle" :size="13" :stroke-width="1.7" /></span>
      <span class="phase-title">执行过程</span>
      <span class="phase-status" role="status">
        <span v-if="activePhase" class="live-dot" />
        <template v-if="activePhase">进行中 · 第 {{ phases.length }} 阶段</template>
        <template v-else>{{ doneCount }} 个阶段完成</template>
      </span>
      <span class="phase-chevron">
        <WsIcon :name="collapsed ? 'chevron-right' : 'chevron-down'" :size="13" :stroke-width="1.7" />
      </span>
    </div>
    <!-- 阶段列表：外层 Transition 负责折叠过渡（v-show 在 TransitionGroup 上不生效，批次89 4.1 修复），
         内层 TransitionGroup 负责阶段增删/状态切换平滑过渡 -->
    <Transition name="phase-wrap">
      <TransitionGroup v-if="!collapsed" name="phase" tag="div" id="phase-list" class="phase-list">
        <div
          v-for="seg in phases"
          :key="seg.id"
          class="phase-item"
          :class="{ active: seg.status === 'active', done: seg.status === 'done' }"
        >
          <span class="phase-dot" :class="{ live: seg.status === 'active' }" />
          <span class="phase-label">{{ seg.label }}</span>
          <span class="phase-tools">
            <span v-for="t in seg.tools" :key="t.id" class="tool-chip" :class="toolState(t.status)">
              <WsIcon name="wrench" :size="10" :stroke-width="1.7" />
              {{ t.name }}
            </span>
          </span>
          <span v-if="seg.status === 'active'" class="phase-tag">进行中</span>
          <span v-else class="phase-tag done">完成</span>
        </div>
      </TransitionGroup>
    </Transition>
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
}
.phase-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 10px;
  cursor: pointer;
  user-select: none;
  color: var(--text-secondary);
}
.phase-bar:hover {
  background: var(--bg-muted);
  border-radius: var(--radius-md);
}
.phase-icon {
  display: inline-flex;
  color: var(--accent);
}
.phase-title {
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--text-primary);
}
.phase-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-xs);
  color: var(--text-muted);
}
.live-dot {
  width: var(--dot-sm);
  height: var(--dot-sm);
  border-radius: 50%;
  background: var(--accent);
  animation: pulse var(--dur-pulse) ease-in-out infinite;
}
.phase-chevron {
  margin-left: auto;
  display: inline-flex;
  color: var(--text-muted);
}
.phase-list {
  padding: 0 10px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.phase-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: var(--radius-sm);
  background: var(--bg-muted);
  border: 1px solid transparent;
  /* 状态切换（active→done）平滑过渡（批次89 8.4） */
  transition: opacity var(--dur-base) var(--ease), background var(--dur-base) var(--ease),
    border-color var(--dur-base) var(--ease);
}
/* 已完成阶段整体弱化：让进行中阶段成为视觉焦点（弱提示原则） */
.phase-item.done {
  opacity: 0.72;
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
}
.phase-tools {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 0;
}
/* 工具 chip：带 running/done 状态属「状态徽标」语义 → pill（区别于代码标识 tag 的 radius-sm） */
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
  margin-left: auto;
  flex-shrink: 0;
  font-size: var(--fs-xs);
  color: var(--accent);
}
.phase-tag.done {
  color: var(--text-muted);
}

/* 折叠过渡：与 SubAgentSection 折叠同一运动语言（批次89 4.1） */
.phase-wrap-enter-active,
.phase-wrap-leave-active {
  transition: opacity var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out);
}
.phase-wrap-enter-from {
  opacity: 0;
  transform: translateY(-4px);
}
.phase-wrap-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

/* 阶段列表过渡：新阶段淡入上滑、移除/重排平滑 */
.phase-enter-active {
  transition: opacity var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out);
}
.phase-leave-active {
  transition: opacity var(--dur-fast) var(--ease);
}
.phase-move {
  transition: transform var(--dur-base) var(--ease-out);
}
.phase-enter-from {
  opacity: 0;
  transform: translateY(-4px);
}
.phase-leave-to {
  opacity: 0;
}
</style>
