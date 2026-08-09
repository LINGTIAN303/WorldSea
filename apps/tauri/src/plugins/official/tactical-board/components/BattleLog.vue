<template>
  <div class="bl-panel">
    <div class="bl-title">战斗日志</div>
    <div class="bl-list" ref="listRef">
      <div v-for="(entry, i) in log" :key="i" class="bl-entry" :class="'bl-' + entry.type">
        <span class="bl-turn">R{{ entry.turn }}</span>
        <span class="bl-text">{{ entry.text }}</span>
      </div>
      <WsEmpty v-if="log.length === 0" preset="no-data" title="暂无战斗记录" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { WsEmpty } from '@worldsmith/ui-kit'
import type { BattleLogEntry } from '../composables/useBattleManager'

const props = defineProps<{
  log: BattleLogEntry[]
}>()

const listRef = ref<HTMLElement | null>(null)

watch(
  () => props.log.length,
  () => {
    nextTick(() => {
      if (listRef.value) {
        listRef.value.scrollTop = listRef.value.scrollHeight
      }
    })
  },
)
</script>

<style scoped>
.bl-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.bl-title {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 8px 12px 4px;
}

.bl-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 8px 8px;
  min-height: 0;
}

.bl-entry {
  display: flex;
  gap: 6px;
  padding: 3px 4px;
  font-size: var(--font-size-xs);
  line-height: 1.4;
  border-radius: var(--radius-2xs);
}

.bl-entry:hover {
  background: color-mix(in srgb, var(--color-text-secondary) 5%, transparent);
}

.bl-turn {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
  flex-shrink: 0;
  min-width: 22px;
}

.bl-text {
  color: var(--color-text-primary);
  word-break: break-all;
}

.bl-move .bl-text { color: var(--color-primary); }
.bl-attack .bl-text { color: var(--color-danger); }
.bl-skill .bl-text { color: var(--color-primary-hover); }
.bl-system .bl-text { color: var(--color-text-secondary); }
.bl-victory .bl-text { color: var(--color-success); font-weight: var(--font-weight-semibold); }
</style>
