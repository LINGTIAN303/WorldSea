<template>
  <div v-if="manuscripts.length" class="manuscript-shelf">
    <div class="shelf-header" role="button" tabindex="0" :aria-expanded="expanded" @click="expanded = !expanded" @keydown.enter.prevent="expanded = !expanded" @keydown.space.prevent="expanded = !expanded">
      <WsIcon :name="expanded ? 'chevron-down' : 'chevron-right'" size="xs" />
      <span class="shelf-title">文境集</span>
      <span class="shelf-count">{{ manuscripts.length }}</span>
    </div>
    <Transition name="shelf-expand">
      <div v-if="expanded" class="shelf-grid">
        <div
          v-for="ms in manuscripts"
          :key="ms.id"
          class="shelf-thumb"
          :class="{ 'layout-vertical': ms.layout === 'vertical' }"
          :title="ms.title || '文稿'"
          :aria-label="`跳转到文稿 ${ms.title || '未命名'}`"
          role="button"
          tabindex="0"
          @click="scrollToManuscript(ms.id)"
          @keydown.enter.prevent="scrollToManuscript(ms.id)"
          @keydown.space.prevent="scrollToManuscript(ms.id)"
        >
          <div class="thumb-preview">{{ ms.content.slice(0, 24) }}</div>
          <div class="thumb-label">{{ ms.title || '文稿' }}</div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import type { ManuscriptBlock, AgentMessage } from '@worldsea/agent-runtime'

const props = defineProps<{ messages: AgentMessage[] }>()
const expanded = ref(true)

const manuscripts = computed(() => {
  const result: ManuscriptBlock[] = []
  for (const msg of props.messages) {
    if (!msg.blocks) continue
    for (const block of msg.blocks) {
      if (block.type === 'manuscript') {
        result.push(block)
      }
    }
  }
  return result
})

function scrollToManuscript(id: string) {
  const el = document.querySelector(`[data-manuscript-id="${id}"]`)
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('shelf-highlight')
    setTimeout(() => el.classList.remove('shelf-highlight'), 1500)
  }
}
</script>

<style scoped>
.manuscript-shelf {
  padding: 6px 12px;
  border-top: 1px solid var(--agent-border);
}

.shelf-header {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  padding: 4px 0;
  font-size: 11px;
  color: var(--agent-text-secondary, #aaa);
  user-select: none;
}
.shelf-header:hover {
  color: var(--agent-text, #e0e0e0);
}

.shelf-title {
  font-weight: 600;
  letter-spacing: 0.05em;
}

.shelf-count {
  font-size: 10px;
  padding: 0 4px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--agent-accent, #b388ff) 15%, transparent);
  color: var(--agent-accent, #b388ff);
}

.shelf-grid {
  display: flex;
  gap: 6px;
  padding: 6px 0;
  overflow-x: auto;
}

.shelf-thumb {
  flex-shrink: 0;
  width: 72px;
  padding: 6px 8px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--agent-accent, #b388ff) 6%, transparent);
  border: 1px solid color-mix(in srgb, var(--agent-accent, #b388ff) 15%, transparent);
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease, opacity 0.15s ease, filter 0.15s ease;
}
.shelf-thumb:hover {
  background: color-mix(in srgb, var(--agent-accent, #b388ff) 12%, transparent);
  border-color: color-mix(in srgb, var(--agent-accent, #b388ff) 35%, transparent);
}

.shelf-thumb.layout-vertical {
  writing-mode: vertical-rl;
  height: 72px;
  width: auto;
}

.thumb-preview {
  font-size: 10px;
  line-height: 1.4;
  opacity: 0.6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.thumb-label {
  font-size: 10px;
  font-weight: 600;
  margin-top: 4px;
  opacity: 0.8;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.shelf-expand-enter-active,
.shelf-expand-leave-active {
  transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease, opacity 0.2s ease, filter 0.2s ease;
  overflow: hidden;
}
.shelf-expand-enter-from,
.shelf-expand-leave-to {
  opacity: 0;
  max-height: 0;
}
.shelf-expand-enter-to,
.shelf-expand-leave-from {
  opacity: 1;
  max-height: 120px;
}

:global(.shelf-highlight) {
  box-shadow: 0 0 0 2px var(--agent-primary, #6c5ce7), 0 4px 24px color-mix(in srgb, var(--agent-accent, #b388ff) 30%, transparent) !important;
  transition: box-shadow 0.3s ease;
}
</style>
