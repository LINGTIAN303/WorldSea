<template>
  <div class="context-menu-renderer" v-if="visible" :style="menuStyle">
    <div v-for="item in menuItems" :key="item.label" class="cm-item" @click="onItemClick(item)">
      {{ item.label }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, inject } from 'vue'
import type { ModuleRuntimeContext } from '../ModuleRuntimeContext'

const props = defineProps<{ config: Record<string, unknown>; componentId: string }>()
const ctx = inject<ModuleRuntimeContext | null>('moduleRuntimeContext', null)

const visible = ref(false)
const menuStyle = ref<Record<string, string>>({})

const menuItems = computed(() => (props.config.items as Array<{ label: string; action?: string }>) || [])

function show(x: number, y: number) {
  visible.value = true
  menuStyle.value = { left: x + 'px', top: y + 'px' }
}

function onItemClick(item: { label: string; action?: string }) {
  visible.value = false
  if (item.action) ctx?.emit(`context:${item.action}`)
}

defineExpose({ show })
</script>

<style scoped>
.context-menu-renderer { position: fixed; z-index: var(--z-dropdown); background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); padding: 4px 0; min-width: 120px; }
.cm-item { padding: 6px 12px; font-size: var(--font-size-sm); cursor: pointer; }
.cm-item:hover { background: var(--hover-bg); }
</style>
