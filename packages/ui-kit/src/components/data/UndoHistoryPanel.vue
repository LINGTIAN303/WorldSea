<template>
  <Transition name="ws-fade">
    <div v-if="show" class="uhp-overlay" @click.self="close">
      <div class="uhp-panel" :style="{ width: modalResizable.width.value + 'px' }">
        <div class="uhp-header">
          <h3>撤销历史</h3>
          <button class="uhp-close" @click="close">✕</button>
        </div>
        <div class="uhp-body">
          <WsEmpty v-if="undoGroups.length === 0" preset="no-data" title="暂无撤销记录" />
          <div v-for="(group, i) in undoGroups" :key="i" class="uhp-item"
            :class="{ selected: selectedIndices.has(i) }" @click="toggleSelect(i)">
            <input type="checkbox" :checked="selectedIndices.has(i)" @click.stop />
            <div class="uhp-item-info">
              <span class="uhp-desc">{{ getDescription(group) }}</span>
              <span class="uhp-time">{{ formatTime(group.timestamp) }}</span>
            </div>
          </div>
        </div>
        <div class="uhp-footer">
          <span class="uhp-count">已选 {{ selectedIndices.size }} 项</span>
          <button class="uhp-btn" :disabled="selectedIndices.size === 0" @click="redoSelected">
            恢复选中 ({{ selectedIndices.size }})
          </button>
          <button class="uhp-btn uhp-btn-secondary" @click="close">关闭</button>
        </div>
        <div class="resize-handle-right" @mousedown="modalResizable.onResizeStart"></div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import WsEmpty from '../WsEmpty.vue'
import { useResizable } from '@worldsea/ui-kit'
import { useUndoRedo } from '@worldsea/entity-core'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ close: []; redo: [indices: number[]] }>()

const { undoStack, getUndoDescription } = useUndoRedo()
const modalResizable = useResizable({ panelId: 'modal-undo-history', defaultWidth: 400, minWidth: 260 })
const selectedIndices = ref<Set<number>>(new Set())

const undoGroups = computed(() => [...undoStack.value].reverse())

function getDescription(group: any) {
  return getUndoDescription(group)
}

function formatTime(ts?: number) {
  if (!ts) return ''
  const diff = Date.now() - ts
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前'
  if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前'
  return new Date(ts).toLocaleString()
}

function toggleSelect(i: number) {
  if (selectedIndices.value.has(i)) selectedIndices.value.delete(i)
  else selectedIndices.value.add(i)
}

function redoSelected() {
  if (selectedIndices.value.size === 0) return
  emit('redo', [...selectedIndices.value])
  selectedIndices.value = new Set()
  close()
}

function close() {
  selectedIndices.value = new Set()
  emit('close')
}
</script>

<style scoped>
.uhp-overlay { position: fixed; inset: 0; z-index: var(--z-overlay); background: var(--overlay); display: flex; align-items: center; justify-content: center; }
.uhp-panel { position: relative; max-height: 70vh; background: var(--content-bg, #fff); border-radius: 12px; box-shadow: 0 8px 40px rgba(0,0,0,0.15); display: flex; flex-direction: column; overflow: hidden; }
.uhp-header { display: flex; justify-content: space-between; align-items: center; padding: 14px 20px; border-bottom: 1px solid var(--border, #eee); }
.uhp-header h3 { margin: 0; font-size: var(--font-size-lg); }
.uhp-close { background: none; border: none; font-size: var(--font-size-xl); cursor: pointer; padding: 4px 8px; border-radius: 4px; }
.uhp-close:hover { background: var(--hover-bg, #f3f4f6); }
.uhp-body { padding: 8px 12px; overflow-y: auto; flex: 1; }
.uhp-item { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: var(--radius-sm); cursor: pointer; transition: background 0.1s; }
.uhp-item:hover { background: var(--hover-bg, #f3f4f6); }
.uhp-item.selected { background: var(--primary-light, #eef2ff); }
.uhp-item input[type="checkbox"] { margin: 0; accent-color: var(--primary, #4f46e5); flex-shrink: 0; }
.uhp-item-info { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.uhp-desc { font-size: var(--font-size-sm); color: var(--text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.uhp-time { font-size: var(--font-size-xs); color: var(--text-tertiary); }
.uhp-footer { display: flex; align-items: center; gap: 8px; padding: 10px 20px; border-top: 1px solid var(--border, #eee); }
.uhp-count { font-size: var(--font-size-sm); color: var(--text-secondary); flex: 1; }
.uhp-btn { padding: 6px 14px; border-radius: var(--radius-sm); border: 1px solid var(--primary, #4f46e5); background: var(--primary, #4f46e5); color: #fff; font-size: var(--font-size-sm); cursor: pointer; transition: opacity 0.12s; }
.uhp-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.uhp-btn:hover:not(:disabled) { opacity: 0.85; }
.uhp-btn-secondary { background: var(--bg, #fafafa); color: var(--text-color); border-color: var(--border, #ddd); }
.uhp-btn-secondary:hover { background: var(--hover-bg, #f3f4f6); }


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
