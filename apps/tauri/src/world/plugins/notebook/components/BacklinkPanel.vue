<template>
  <div class="backlink-panel">
    <div class="bl-header">
      <span class="bl-title">反向链接 ({{ links.length }})</span>
      <!-- 块 2 阶段 4：「创建链接」picker 已退役——建联唯一入口＝正文 `[[`（保存后派生落库） -->
    </div>
    <div v-if="links.length" class="bl-list">
      <div v-for="link in links" :key="link.id" class="bl-item" role="button" tabindex="0" :aria-label="`打开 ${link.name}`" @click="$emit('navigate', link.id)" @keydown.enter.prevent="$emit('navigate', link.id)" @keydown.space.prevent="$emit('navigate', link.id)">
        {{ link.name }}
      </div>
    </div>
    <div v-else class="bl-empty">暂无反向链接</div>
  </div>
</template>

<script setup lang="ts">
import type { Entity } from '@worldsea/entity-core'

defineProps<{ links: Entity[] }>()
defineEmits<{ navigate: [id: string] }>()
</script>

<style scoped>
.backlink-panel { border-top: 1px solid var(--color-border-subtle); padding: 8px 16px; }
.bl-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
.bl-title { font-size: var(--font-size-xs); font-weight: var(--font-weight-semibold); color: var(--color-text-tertiary); text-transform: uppercase; }
.bl-list { max-height: 200px; overflow-y: auto; }
.bl-item { font-size: var(--font-size-sm); color: var(--color-primary); cursor: pointer; padding: 2px 0; }
.bl-item:hover { text-decoration: underline; }
.bl-empty { font-size: var(--font-size-xs); color: var(--color-text-tertiary); }
</style>
