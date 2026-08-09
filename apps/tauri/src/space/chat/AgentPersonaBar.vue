<template>
  <div class="persona-bar">
    <div class="persona-avatar">{{ agentName.charAt(0) }}</div>
    <div class="persona-info">
      <span class="persona-name">{{ agentName }}</span>
      <span v-if="statusMessage" class="persona-status">{{ statusMessage }}</span>
    </div>
    <span class="persona-mood" :title="moodLabel">{{ moodIcon }}</span>
  </div>
</template>

<script setup lang="ts">
import { useAgentPersona } from '../composables/useAgentPersona'

const { agentName, moodIcon, moodLabel, statusMessage } = useAgentPersona()
</script>

<style scoped>
.persona-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface-elevated);
}

.persona-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--color-primary);
  color: var(--color-text-inverse);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-size-xl);
  font-weight: 700;
  flex-shrink: 0;
}

.persona-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.persona-name {
  font-size: var(--font-size-base);
  font-weight: 600;
  color: var(--color-text);
}

.persona-status {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.persona-mood {
  font-size: var(--font-size-base);
  flex-shrink: 0;
}
</style>
