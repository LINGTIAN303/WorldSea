<template>
  <div v-if="show" class="shortcut-overlay" @click.self="$emit('close')">
    <div class="shortcut-modal" :style="{ width: modalResizable.width.value + 'px' }">
      <div class="sh-header">
        <h3><WsIcon name="settings" size="sm" /> 键盘快捷键</h3>
        <button class="sh-close" @click="$emit('close')">✕</button>
      </div>
      <div class="sh-body">
        <div v-for="group in grouped" :key="group.scope" class="sh-group">
          <h4 class="sh-scope-label">{{ scopeLabel(group.scope) }}</h4>
          <div v-for="s in group.items" :key="s.id" class="sh-row">
            <span class="sh-desc">{{ s.description }}</span>
            <span class="sh-keys">
              <kbd v-for="k in s.keys" :key="k" class="sh-kbd">{{ formatKey(k) }}</kbd>
            </span>
          </div>
        </div>
      </div>
      <div class="sh-footer">
        <span class="sh-hint">按 <kbd class="sh-kbd">?</kbd> 再次打开此面板</span>
      </div>
      <div class="resize-handle-right" @mousedown="modalResizable.onResizeStart"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount } from 'vue'
import { useShortcuts, formatKeyForDisplay, useResizable } from '@worldsmith/ui-kit'
import WsIcon from '../WsIcon.vue'

defineProps<{ show: boolean }>()
const emit = defineEmits<{ close: [] }>()

const { getAll, register, unregister } = useShortcuts()
const modalResizable = useResizable({ panelId: 'modal-shortcut-help', defaultWidth: 480, minWidth: 320 })

onMounted(() => {
  register({ id: 'help.shortcuts.close', keys: ['?'], description: '关闭快捷键帮助', scope: 'modal', handler: () => emit('close') })
  register({ id: 'help.shortcuts.close-esc', keys: ['escape'], description: '关闭快捷键帮助', scope: 'modal', handler: () => emit('close') })
})

onBeforeUnmount(() => {
  unregister('help.shortcuts.close')
  unregister('help.shortcuts.close-esc')
})

const SCOPE_ORDER = ['global', 'view', 'editor', 'modal']

const grouped = computed(() => {
  const all = getAll()
  return SCOPE_ORDER
    .map(scope => ({
      scope,
      items: all.filter(s => s.scope === scope),
    }))
    .filter(g => g.items.length > 0)
})

function scopeLabel(scope: string): string {
  return { global: '全局', view: '当前视图', editor: '编辑器', modal: '弹窗' }[scope] || scope
}

function formatKey(k: string): string {
  return formatKeyForDisplay(k)
}
</script>

<style scoped>
.shortcut-overlay {
  position: fixed; inset: 0; z-index: var(--z-overlay);
  background: var(--overlay);
  display: flex; align-items: center; justify-content: center;
  backdrop-filter: blur(2px);
}
.shortcut-modal {
  position: relative;
  max-height: 85vh;
  background: var(--bg, #fff);
  border-radius: 12px;
  box-shadow: 0 8px 40px rgba(0,0,0,0.15);
  display: flex; flex-direction: column;
  overflow: hidden;
}
.sh-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 14px 20px;
  border-bottom: 1px solid var(--border, #eee);
}
.sh-header h3 { margin: 0; font-size: var(--font-size-lg); }
.sh-close {
  background: none; border: none; font-size: var(--font-size-xl);
  cursor: pointer; padding: 4px 8px; border-radius: 4px;
}
.sh-body { padding: 12px 20px; overflow-y: auto; flex: 1; }
.sh-group { margin-bottom: 16px; }
.sh-scope-label {
  font-size: var(--font-size-xs); font-weight: var(--font-weight-semibold); text-transform: uppercase;
  color: var(--text-tertiary, var(--color-text-tertiary));
  margin: 0 0 6px; letter-spacing: 0.5px;
}
.sh-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 6px 8px; border-radius: 4px;
  font-size: var(--font-size-sm);
}
.sh-row:hover { background: var(--hover-bg, #f3f4f6); }
.sh-desc { color: var(--text-color, #333); }
.sh-keys { display: flex; gap: 4px; }
.sh-kbd {
  display: inline-flex; align-items: center;
  padding: 2px 7px;
  font-size: var(--font-size-xs); font-family: inherit;
  background: var(--bg-secondary, #f3f4f6);
  border: 1px solid var(--border, #d1d5db);
  border-radius: 4px;
  box-shadow: 0 1px 0 var(--border, #d1d5db);
  color: var(--text-color, #333);
  white-space: nowrap;
}
.sh-footer {
  padding: 10px 20px;
  border-top: 1px solid var(--border, #eee);
  text-align: center;
  font-size: var(--font-size-sm); color: var(--text-tertiary, var(--color-text-tertiary));
}
.sh-hint kbd { margin: 0 2px; }
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