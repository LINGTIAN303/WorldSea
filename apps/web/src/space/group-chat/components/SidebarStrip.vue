<template>
  <div class="sidebar-strip">
    <div
      class="strip-zone"
      :class="{ active: activePanel === 'groups' }"
      @click="$emit('toggle', 'groups')"
      title="群列表"
    >
      <WsIcon class="strip-icon" name="menu" size="sm" />
    </div>
    <div class="strip-divider"></div>
    <div
      class="strip-zone"
      :class="{ active: activePanel === 'friends' }"
      @click="$emit('toggle', 'friends')"
      title="好友列表"
    >
      <WsIcon class="strip-icon" name="heart" size="sm" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { WsIcon } from '@worldsmith/ui-kit'

export type PanelType = 'groups' | 'friends' | null

defineProps<{
  activePanel: PanelType
}>()

defineEmits<{
  toggle: [panel: PanelType]
}>()
</script>

<style scoped>
.sidebar-strip {
  width: 40px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--color-surface-elevated);
  border-right: 1px solid var(--color-border);
  user-select: none;
}

.strip-zone {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s;
}

.strip-zone:hover {
  background: var(--color-surface);
}

.strip-zone.active {
  background: var(--color-surface);
  position: relative;
}

.strip-zone.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 20%;
  bottom: 20%;
  width: 3px;
  border-radius: 0 2px 2px 0;
  background: var(--color-primary);
}

.strip-icon {
  color: var(--color-text-secondary);
  transition: color 0.15s;
}

.strip-zone.active .strip-icon {
  color: var(--color-primary);
}

.strip-divider {
  height: 1px;
  margin: 0 8px;
  background: var(--color-border);
  flex-shrink: 0;
}
</style>
