<template>
  <div class="vh-overlay" v-if="show" @click.self="close">
    <div class="vh-modal" :style="{ width: modalResizable.width.value + 'px' }">
      <div class="vh-header">
        <h3><WsIcon name="timeline" size="sm" /> 最近修改</h3>
        <p class="vh-hint">按修改时间排列的实体列表</p>
        <button class="vh-close" @click="close">✕</button>
      </div>
      <div class="vh-body">
        <select v-model="typeFilter" class="vh-select">
          <option value="">全部类型</option>
          <option v-for="t in allTypes" :key="t.type" :value="t.type"><WsIcon :name="entitySchemaRegistry.getIconName(t.type)" size="xs" /> {{ t.label }}</option>
        </select>
        <div class="vh-list" v-if="filtered.length">
          <div v-for="e in filtered" :key="e.id" class="vh-item">
            <WsIcon class="vh-icon" :name="typeIcon(e.type)" size="sm" />
            <span class="vh-name">{{ e.name }}</span>
            <span class="vh-type">{{ typeLabel(e.type) }}</span>
            <span class="vh-time">{{ relativeTime(e.updatedAt) }}</span>
            <button class="vh-btn" @click="viewEntity(e)"><WsIcon name="image" size="xs" /></button>
          </div>
        </div>
        <div v-else class="vh-empty">无数据</div>
      </div>
      <div class="resize-handle-right" @mousedown="modalResizable.onResizeStart"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useEntityStore } from '@worldsmith/entity-core'
import { useResizable } from '@worldsmith/ui-kit'
import { entitySchemaRegistry } from '@worldsmith/entity-core'
import WsIcon from '../WsIcon.vue'
import type { Entity } from '@worldsmith/entity-core'

defineProps<{ show: boolean }>()
const emit = defineEmits<{ close: [] }>()

const entityStore = useEntityStore()
const modalResizable = useResizable({ panelId: 'modal-version-history', defaultWidth: 520, minWidth: 320 })
const allTypes = computed(() => entitySchemaRegistry.getAll())
const typeFilter = ref('')

const filtered = computed(() => {
  let items = entityStore.entities
  if (typeFilter.value) items = items.filter(e => e.type === typeFilter.value)
  return items
    .slice()
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 50)
})

function typeIcon(type: string) { return entitySchemaRegistry.getIconName(type) }

function typeLabel(type: string) { return entitySchemaRegistry.getLabel(type) }

function relativeTime(d: string) {
  try {
    const now = Date.now()
    const diff = now - new Date(d).getTime()
    const seconds = Math.floor(diff / 1000)
    if (seconds < 60) return '刚刚'
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}分钟前`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}小时前`
    const days = Math.floor(hours / 24)
    if (days < 2) return '昨天'
    if (days < 30) return `${days}天前`
    const months = Math.floor(days / 30)
    if (months < 12) return `${months}个月前`
    const years = Math.floor(months / 12)
    return `${years}年前`
  } catch {
    return d
  }
}

function viewEntity(e: Entity) {
  typeFilter.value = ''
  emit('close')
  window.dispatchEvent(new CustomEvent('ws-navigate', { detail: { view: e.type, entityId: e.id } }))
}

function close() { typeFilter.value = ''; emit('close') }
</script>

<style scoped>
.vh-overlay { position: fixed; inset: 0; z-index: var(--z-overlay); background: rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; }
.vh-modal { position: relative; max-height: 80vh; background: var(--content-bg); border-radius: 12px; box-shadow: 0 8px 40px rgba(0,0,0,0.15); display: flex; flex-direction: column; overflow: hidden; }
.vh-header { display: flex; align-items: center; gap: 12px; padding: 14px 20px; border-bottom: 1px solid var(--border); }
.vh-header h3 { margin: 0; font-size: var(--font-size-lg); }
.vh-hint { font-size: var(--font-size-sm); color: var(--text-tertiary); flex: 1; }
.vh-close { background: none; border: none; font-size: var(--font-size-xl); cursor: pointer; padding: 4px 8px; border-radius: 4px; }
.vh-body { padding: 12px 20px; overflow-y: auto; flex: 1; }
.vh-select { width: 100%; padding: 6px 10px; border: 1px solid var(--border); border-radius: 4px; margin-bottom: 12px; }
.vh-list { display: flex; flex-direction: column; }
.vh-item { display: flex; align-items: center; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--border); font-size: var(--font-size-sm); }
.vh-icon { font-size: var(--font-size-md); }
.vh-name { flex: 1; font-weight: var(--font-weight-semibold); }
.vh-type { font-size: var(--font-size-xs); color: var(--text-tertiary); background: var(--bg); padding: 1px 5px; border-radius: 3px; }
.vh-time { font-size: var(--font-size-xs); color: var(--text-tertiary); white-space: nowrap; }
.vh-btn { background: none; border: none; cursor: pointer; padding: 2px 6px; border-radius: 4px; font-size: var(--font-size-base); }
.vh-btn:hover { background: var(--hover-bg); }
.vh-empty { text-align: center; padding: 40px; color: var(--text-tertiary, var(--color-text-tertiary)); }
.resize-handle-right {
  position: absolute;
  right: 0;
  top: 0;
  width: 6px;
  height: 100%;
  cursor: col-resize;
  z-index: 10;
  background: transparent;
  transition: background 0.15s;
}
.resize-handle-right:hover,
.resize-handle-right:active {
  background: var(--primary);
  opacity: 0.3;
}
</style>