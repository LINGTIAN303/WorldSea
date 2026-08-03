<template>
  <div class="block-code">
    <div class="block-toggle" @click="expanded = !expanded">
      <span class="block-icon">💻</span>
      <span class="block-title">代码: {{ block.language }}</span>
      <span class="block-meta">{{ lineCount }}行</span>
      <span class="block-arrow">{{ expanded ? '▾ 点击收起' : '▸ 点击展开' }}</span>
    </div>
    <Transition name="block-expand">
      <div v-if="expanded" class="block-content">
        <div class="code-header">
          <span class="code-lang">{{ block.language }}</span>
          <button class="code-copy" @click="copyCode">复制</button>
        </div>
        <pre class="code-body"><code>{{ block.code }}</code></pre>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { CodeBlockData } from '@agent/index'

const props = defineProps<{
  block: CodeBlockData
}>()

const expanded = ref(false)

const lineCount = computed(() => props.block.code.split('\n').length)

function copyCode(): void {
  navigator.clipboard.writeText(props.block.code).catch(() => {})
}
</script>

<style scoped>
.block-code { margin: 4px 0; }
.block-toggle {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px; border-radius: 14px; cursor: pointer;
  background: rgba(108,92,231,0.08); border: 1px solid rgba(108,92,231,0.2);
  transition: border-color 0.15s; font-size: 12px;
}
.block-toggle:hover { border-color: rgba(108,92,231,0.5); }
.block-icon { font-size: 13px; }
.block-title { font-size: 12px; color: var(--agent-accent, #b388ff); font-weight: 500; }
.block-meta { font-size: 11px; color: var(--agent-text-tertiary, #888); }
.block-arrow { font-size: 11px; color: var(--agent-text-tertiary, #888); }
.block-content {
  margin-top: 4px; border: 1px solid rgba(108,92,231,0.2);
  border-radius: 8px; overflow: hidden;
}
.code-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 4px 10px; background: rgba(255,255,255,0.04);
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
.code-lang { font-size: 11px; color: var(--agent-text-tertiary, #888); text-transform: uppercase; }
.code-copy {
  font-size: 11px; padding: 2px 8px; border-radius: 3px;
  border: 1px solid rgba(108,92,231,0.3); background: transparent;
  color: var(--agent-accent, #b388ff); cursor: pointer;
}
.code-copy:hover { background: rgba(108,92,231,0.1); }
.code-body {
  padding: 10px 12px; margin: 0;
  font-family: 'Fira Code', 'Consolas', monospace; font-size: 12px;
  color: var(--agent-text-secondary, #ccc); white-space: pre-wrap;
  overflow-x: auto; line-height: 1.5;
}
.block-expand-enter-active, .block-expand-leave-active {
  transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease, opacity 0.2s ease, filter 0.2s ease; overflow: hidden;
}
.block-expand-enter-from, .block-expand-leave-to {
  opacity: 0;
}
</style>
