<template>
  <div class="set-card" v-show="match('插件 plugin 启用 禁用')">
    <div class="sc-head">插件管理</div>
    <div class="set-plugin-search"><input type="text" v-model="pluginSearch" placeholder="搜索插件..." class="set-input" /></div>
    <draggable v-if="!pluginSearch" :list="pluginList" item-key="id" ghost-class="sp-ghost" drag-class="sp-drag" handle=".sp-grip" @end="onPluginDragEnd" class="set-plugin-list">
      <template #item="{ element: p }">
        <div class="set-plugin-item">
          <span class="sp-grip" title="拖拽排序"><WsIcon name="grip" size="xs" /></span>
          <span v-if="p.source" class="sp-source">{{ p.source === 'builtin' ? '内置' : p.source === 'local' ? '本地' : '远程' }}</span>
          <label class="sp-toggle"><input type="checkbox" :checked="p.active" @change="onPluginToggle(p.id)" /><span class="sp-icon"><WsIcon v-if="hasIcon(p.icon)" :name="p.icon" size="sm" /><span v-else>{{ p.icon }}</span></span><span class="sp-label">{{ p.label }}</span></label>
        </div>
      </template>
    </draggable>
    <div v-else class="set-plugin-list">
      <div v-for="p in filteredPlugins" :key="p.id" class="set-plugin-item">
        <span v-if="p.source" class="sp-source">{{ p.source === 'builtin' ? '内置' : p.source === 'local' ? '本地' : '远程' }}</span>
        <label class="sp-toggle"><input type="checkbox" :checked="p.active" @change="onPluginToggle(p.id)" /><span class="sp-icon"><WsIcon v-if="hasIcon(p.icon)" :name="p.icon" size="sm" /><span v-else>{{ p.icon }}</span></span><span class="sp-label">{{ p.label }}</span></label>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useSettingsStore, useUIStore, usePluginStore } from '@worldsmith/entity-core'
import { hasIcon } from '@worldsmith/ui-kit'
import WsIcon from '../../WsIcon.vue'
import draggable from 'vuedraggable'
import { matchKeywords } from '../utils'

const props = defineProps<{ searchQuery?: string }>()
const emit = defineEmits<{ dirty: [] }>()

const store = useSettingsStore()
const uiStore = useUIStore()
const pluginStore = usePluginStore()

// 插件面板内部的搜索框（独立于全局 searchQuery）
const pluginSearch = ref('')

function match(keywords: string): boolean {
  return matchKeywords(props.searchQuery ?? '', keywords)
}

const pluginList = ref(store.plugins.map(p => ({ ...p })))

function syncPluginList() {
  const order = uiStore.sidebarOrder
  const sorted = [...store.plugins].sort((a, b) => {
    const va = pluginStore.views.find(v => v.pluginId === a.id)
    const vb = pluginStore.views.find(v => v.pluginId === b.id)
    const ia = va ? order.indexOf(va.id) : 999
    const ib = vb ? order.indexOf(vb.id) : 999
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
  })
  pluginList.value = sorted.map(p => ({ ...p }))
}

watch(() => [uiStore.sidebarOrder, store.plugins] as const, () => {
  syncPluginList()
}, { deep: true, immediate: true })

const filteredPlugins = computed(() => {
  if (!pluginSearch.value) return pluginList.value
  const q = pluginSearch.value.toLowerCase()
  return pluginList.value.filter(p =>
    p.label.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)
  )
})

function onPluginDragEnd() {
  const newOrder = pluginList.value
    .map(p => pluginStore.views.find(v => v.pluginId === p.id)?.id)
    .filter((id): id is string => !!id)
  const existing = new Set(newOrder)
  for (const id of uiStore.sidebarOrder) {
    if (!existing.has(id)) newOrder.push(id)
  }
  uiStore.sidebarOrder = newOrder
  emit('dirty')
}

function onPluginToggle(id: string) {
  store.togglePlugin(id)
  emit('dirty')
}

defineExpose({ resetPluginSearch: () => { pluginSearch.value = '' } })
</script>

<style scoped>
.set-card { background: var(--content-bg, var(--color-bg-surface)); border-radius: 10px; padding: 14px 16px; box-shadow: 0 1px 6px rgba(0,0,0,0.06), 0 0 0 1px var(--border, var(--color-border)); }
.sc-head { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--text-tertiary, var(--color-text-tertiary)); margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.5px; }

.set-input { padding: 4px 8px; font-size: var(--font-size-sm); border: 1px solid var(--border, var(--color-border)); border-radius: 6px; background: var(--bg, var(--color-bg-surface)); color: var(--text-color); }
.set-input:focus { outline: none; border-color: var(--primary, var(--color-primary)); }

.set-plugin-search { margin-bottom: 8px; }
.set-plugin-search .set-input { width: 100%; }
.set-plugin-list { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 2px; max-height: 320px; overflow-y: auto; }
.set-plugin-item { padding: 3px 0; display: flex; align-items: center; gap: 4px; }
.sp-grip { cursor: grab; color: var(--text-tertiary, #bbb); font-size: var(--font-size-base); line-height: 1; padding: 2px 2px; user-select: none; flex-shrink: 0; transition: color 0.1s; }
.sp-grip:hover { color: var(--text-secondary, #888); }
.sp-grip:active { cursor: grabbing; }
.sp-ghost { opacity: 0.4; background: var(--primary-light, color-mix(in srgb, var(--color-primary) 10%, transparent)); border-radius: 4px; }
.sp-drag { background: var(--content-bg, var(--color-bg-surface)); box-shadow: 0 4px 12px rgba(0,0,0,0.15); border-radius: 4px; }
.sp-source { font-size: var(--text-micro-font-size); color: var(--text-tertiary, var(--color-text-tertiary)); background: var(--bg-secondary, var(--color-bg-elevated)); padding: 1px 4px; border-radius: 3px; margin-right: 4px; }
.sp-toggle { display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: var(--font-size-sm); padding: 4px 6px; border-radius: 6px; transition: background 0.1s; }
.sp-toggle:hover { background: var(--hover-bg, var(--color-bg-hover)); }
.sp-toggle input { margin: 0; accent-color: var(--primary, var(--color-primary)); }
.sp-icon { font-size: var(--font-size-lg); }
.sp-label { font-size: var(--font-size-sm); }
</style>
