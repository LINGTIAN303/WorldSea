<template>
  <div class="template-grid">
    <div
      v-for="tpl in templates"
      :key="tpl.id"
      class="template-card"
      :class="{ active: activeTemplate === tpl.id }"
      role="radio"
      tabindex="0"
      :aria-checked="activeTemplate === tpl.id"
      :aria-label="tpl.name"
      @click="$emit('apply', tpl.id)"
      @keydown.enter.prevent="$emit('apply', tpl.id)"
      @keydown.space.prevent="$emit('apply', tpl.id)"
    >
      <div class="tpl-icon"><WsIcon :name="tpl.icon" size="md" /></div>
      <div class="tpl-name">{{ tpl.name }}</div>
      <div class="tpl-desc">{{ tpl.desc }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { WsIcon } from '@worldsmith/ui-kit'
import type { GroupChatTemplate } from './types'

defineProps<{
  templates: GroupChatTemplate[]
  activeTemplate: string | null
}>()

defineEmits<{
  apply: [id: string]
}>()
</script>

<style scoped>
.template-grid {
  display: flex;
  gap: 8px;
  margin-bottom: 20px;
}

.template-card {
  flex: 1;
  padding: 10px 8px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  cursor: pointer;
  text-align: center;
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s;
}

.template-card:hover {
  border-color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 4%, transparent);
}

.template-card.active {
  border-color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 8%, transparent);
}

.tpl-icon {
  font-size: 18px;
  margin-bottom: 4px;
}

.tpl-name {
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--color-text);
}

.tpl-desc {
  font-size: var(--fs-2xs);
  color: var(--color-text-tertiary);
  margin-top: 2px;
}
</style>