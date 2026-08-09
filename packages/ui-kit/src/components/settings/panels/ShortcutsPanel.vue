<template>
  <div class="set-card" v-show="match('快捷键 keyboard shortcut 键盘')">
    <div class="sc-head">快捷键</div>
    <div class="set-hint" style="margin-bottom:8px">点击快捷键开始记录，按下新的组合键即可修改</div>
    <div v-for="grp in shortcutGroups" :key="grp.scope" v-show="match('快捷键 ' + scopeLabel(grp.scope))" class="ss-group">
      <h5 class="ss-scope">{{ scopeLabel(grp.scope) }}</h5>
      <div v-for="s in grp.items" :key="s.id" v-show="match(s.description + ' ' + s.id)" class="ss-row">
        <span class="ss-desc">{{ s.description }}</span>
        <div class="ss-keys-area">
          <span v-if="recording !== s.id" class="ss-keys" @click="startRecord(s.id)">
            <kbd v-for="k in getDisplayKeys(s)" :key="k" class="ss-kbd">{{ fmt(k) }}</kbd>
            <span class="ss-edit-icon"><WsIcon name="edit" size="xs" /></span>
          </span>
          <span v-else class="ss-recording" @click="cancelRecord">按下新的组合键...</span>
          <button v-if="hasOverride(s.id)" class="ss-reset" @click.stop="resetKey(s.id)">↺</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useSettingsStore } from '@worldsmith/entity-core'
import { useShortcuts, formatKeyForDisplay } from '@worldsmith/ui-kit'
import WsIcon from '../../WsIcon.vue'
import { matchKeywords, DEFAULT_SHORTCUTS, SCOPE_ORDER, scopeLabel, type ShortcutItem } from '../utils'

const props = defineProps<{ searchQuery?: string }>()
const emit = defineEmits<{ dirty: [] }>()

const store = useSettingsStore()
const { updateKeys } = useShortcuts()

function match(keywords: string): boolean {
  return matchKeywords(props.searchQuery ?? '', keywords)
}

const allShortcuts = computed(() => DEFAULT_SHORTCUTS)

const shortcutGroups = computed(() => {
  return SCOPE_ORDER
    .map(scope => ({
      scope,
      items: allShortcuts.value.filter(s => s.scope === scope),
    }))
    .filter(g => g.items.length > 0)
})

const recording = ref<string | null>(null)

function fmt(k: string): string {
  return formatKeyForDisplay(k)
}

function getDisplayKeys(s: ShortcutItem): string[] {
  return store.getShortcut(s.id)
}

function hasOverride(id: string): boolean {
  return id in store.shortcutOverrides
}

function startRecord(id: string) {
  recording.value = id
}

function cancelRecord() {
  recording.value = null
}

function resetKey(id: string) {
  store.resetShortcut(id)
  const defaults = store.SHORTCUT_DEFAULTS as Record<string, string[]>
  if (defaults[id]) {
    updateKeys(id, defaults[id])
  }
  emit('dirty')
}

function onRecordKeydown(e: KeyboardEvent) {
  if (!recording.value) return
  e.preventDefault()
  e.stopPropagation()

  const keys: string[] = []
  if (e.ctrlKey || e.metaKey) keys.push('ctrl')
  if (e.altKey) keys.push('alt')
  if (e.shiftKey) keys.push('shift')

  const main = e.key.toLowerCase()
  if (!['control', 'meta', 'alt', 'shift'].includes(main)) {
    const special: Record<string, string> = {
      'escape': 'escape', 'enter': 'enter', ' ': 'space',
      'delete': 'delete', 'backspace': 'backspace', 'tab': 'tab',
    }
    keys.push(special[main] || main)
  }

  if (keys.length > 0) {
    store.setShortcut(recording.value, keys)
    updateKeys(recording.value, keys)
    emit('dirty')
    recording.value = null
  }
}

onMounted(() => {
  document.addEventListener('keydown', onRecordKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onRecordKeydown)
})
</script>

<style scoped>
.set-card { background: var(--content-bg, var(--color-bg-surface)); border-radius: var(--radius-md); padding: 14px 16px; box-shadow: 0 1px 6px rgba(0,0,0,0.06), 0 0 0 1px var(--border, var(--color-border)); }
.sc-head { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--text-tertiary, var(--color-text-tertiary)); margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
.set-hint { font-size: var(--font-size-xs); color: var(--text-tertiary, var(--color-text-tertiary)); margin: -2px 0 4px; }

.ss-group { margin-bottom: 10px; }
.ss-scope { font-size: var(--font-size-xs); font-weight: var(--font-weight-semibold); color: var(--text-tertiary, var(--color-text-tertiary)); margin: 0 0 4px; text-transform: uppercase; letter-spacing: 0.5px; }
.ss-row { display: flex; justify-content: space-between; align-items: center; padding: 4px 6px; border-radius: 4px; font-size: var(--font-size-sm); }
.ss-row:hover { background: var(--hover-bg, var(--color-bg-hover)); }
.ss-desc { color: var(--text-color); font-size: var(--font-size-sm); }
.ss-keys-area { display: flex; align-items: center; gap: 4px; }
.ss-keys { display: flex; align-items: center; gap: 3px; cursor: pointer; padding: 2px 6px; border: 1px solid transparent; border-radius: 4px; transition: border-color 0.1s; }
.ss-keys:hover { border-color: var(--primary, var(--color-primary)); }
.ss-keys:hover .ss-edit-icon { opacity: 1; }
.ss-edit-icon { font-size: var(--font-size-xs); opacity: 0.3; margin-left: 2px; }
.ss-kbd { display: inline-flex; align-items: center; padding: 1px 5px; font-size: var(--font-size-xs); font-family: inherit; background: var(--bg-secondary, var(--color-bg-elevated)); border: 1px solid var(--border, var(--color-border)); border-radius: 3px; box-shadow: 0 1px 0 var(--border, var(--color-border)); color: var(--text-color); }
.ss-recording { font-size: var(--font-size-sm); color: var(--primary, var(--color-primary)); font-weight: var(--font-weight-medium); padding: 2px 8px; animation: ws-pulse 0.8s infinite; cursor: pointer; }
.ss-reset { font-size: var(--font-size-base); background: none; border: none; cursor: pointer; color: var(--text-tertiary, var(--color-text-tertiary)); padding: 2px; border-radius: 3px; }
.ss-reset:hover { color: var(--danger, var(--color-danger)); background: var(--hover-bg); }
</style>
