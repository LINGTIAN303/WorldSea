<template>
  <div class="module-card" @click="$emit('edit', module.id)">
    <div class="mc-header">
      <span class="mc-icon"><WsIcon :name="module.icon || 'settings'" size="md" /></span>
      <h3 class="mc-name">{{ module.name || '(未命名)' }}</h3>
    </div>
    <div class="mc-stats">
      <span class="mc-stat"><WsIcon name="item" size="xs" /> {{ module.entityTypes.length }} 实体</span>
      <span class="mc-stat"><WsIcon name="link" size="xs" /> {{ module.relationTypes.length }} 关系</span>
    </div>
    <div class="mc-actions">
      <button class="mc-btn mc-btn-edit" @click.stop="$emit('edit', module.id)">编辑</button>
      <button class="mc-btn mc-btn-publish" @click.stop="$emit('publish', module.id)">发布</button>
      <button class="mc-btn mc-btn-delete" @click.stop="$emit('delete', module.id)">删除</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { CustomModule } from '@worldsea/entity-core'
import { WsIcon } from '@worldsea/ui-kit'

defineProps<{ module: CustomModule }>()
defineEmits<{ edit: [id: string]; publish: [id: string]; delete: [id: string] }>()
</script>

<style scoped>
.module-card { border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 16px; cursor: pointer; transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s; background: var(--bg); }
.module-card:hover { border-color: var(--primary); box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
.mc-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.mc-icon { font-size: var(--font-size-2xl); }
.mc-name { font-size: var(--font-size-lg); font-weight: var(--font-weight-semibold); margin: 0; }
.mc-stats { display: flex; gap: 12px; margin-bottom: 12px; }
.mc-stat { font-size: var(--font-size-sm); color: var(--text-secondary); }
.mc-actions { display: flex; gap: 6px; }
.mc-btn { padding: 4px 10px; border-radius: var(--radius-xs); font-size: var(--font-size-sm); cursor: pointer; border: 1px solid var(--border-color); background: var(--bg); color: var(--text-secondary); }
.mc-btn:hover { background: var(--hover-bg); }
.mc-btn-publish { background: var(--primary); color: var(--on-accent); border-color: var(--primary); }
.mc-btn-delete { color: var(--danger, #e74c3c); }
</style>
