<template>
  <div v-if="agents.length > 0" class="sub-agent-section">
    <div
      class="sub-agent-toggle"
      role="button"
      tabindex="0"
      @click="emit('update:expanded', !expanded)"
      @keydown.enter="emit('update:expanded', !expanded)"
      @keydown.space.prevent="emit('update:expanded', !expanded)"
    >
      <span class="toggle-icon">
        <WsIcon :name="expanded ? 'chevron-down' : 'chevron-right'" size="xs" />
      </span>
      <span class="toggle-label">子 Agent ({{ agents.length }})</span>
      <span v-if="activeCount > 0" class="active-badge">{{ activeCount }} 运行中</span>
    </div>
    <Transition name="ws-slide-down">
      <div v-if="expanded" class="sub-agent-panels">
        <SubAgentPanel
          v-for="agent in agents"
          :key="agent.id"
          :agent="agent"
          @toggle-visible="emit('toggle-visible', $event)"
          @remove="emit('remove', $event)"
        />
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import WsIcon from '../../ui/WsIcon.vue'
import SubAgentPanel from '../SubAgentPanel.vue'
import type { SubAgentState } from '../composables/useOrchestrator'

const props = defineProps<{
  /** 子 Agent 列表 */
  agents: SubAgentState[]
  /** 是否展开 */
  expanded: boolean
  /** 运行中的子 Agent 数量 */
  activeCount: number
}>()

const emit = defineEmits<{
  (e: 'update:expanded', value: boolean): void
  (e: 'toggle-visible', agentId: string): void
  (e: 'remove', agentId: string): void
}>()
</script>

<style scoped>
.sub-agent-section {
  flex-shrink: 0;
  border-top: 1px solid var(--agent-border);
  background: var(--agent-bg);
}

.sub-agent-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  cursor: pointer;
  user-select: none;
  font-size: var(--font-size-sm);
  color: var(--agent-text-secondary);
  transition: color 0.15s, background 0.15s;
}

.sub-agent-toggle:hover {
  color: var(--agent-text);
  background: var(--agent-hover-bg);
}

.toggle-icon {
  font-size: var(--font-size-xs);
  transition: transform 0.2s;
}

.toggle-label {
  font-weight: var(--font-weight-medium);
  font-family: var(--agent-font);
}

.active-badge {
  font-size: var(--font-size-xs);
  padding: 1px 6px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--agent-primary) 15%, transparent);
  color: var(--agent-primary);
  animation: ws-pulse 1.5s infinite;
}

.sub-agent-panels {
  max-height: 300px;
  overflow-y: auto;
  border-top: 1px solid var(--agent-border);
}
</style>
