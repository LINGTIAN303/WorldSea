<template>
  <div class="module-runtime" v-if="schema">
    <SlotRenderer :slot="schema.layout" :components="schema.components" />
  </div>
  <div v-else class="module-runtime-fallback">
    <p>此模块尚未配置布局</p>
  </div>
</template>

<script setup lang="ts">
import { provide, onMounted, onBeforeUnmount } from 'vue'
import { getModuleViewData } from '../../../../core/ModuleViewRegistry'
import { createModuleRuntimeContext, type ModuleRuntimeContext } from './ModuleRuntimeContext'
import SlotRenderer from './SlotRenderer.vue'

const props = defineProps<{ viewId: string }>()

const viewData = getModuleViewData(props.viewId)
const module = viewData?.module
const schema = module?.layoutSchema

const ctx = module ? createModuleRuntimeContext(module) : null

provide<ModuleRuntimeContext | null>('moduleRuntimeContext', ctx)

onMounted(() => { ctx?.initialize() })
onBeforeUnmount(() => { ctx?.dispose() })
</script>

<style scoped>
.module-runtime { width: 100%; height: 100%; display: flex; flex-direction: column; }
.module-runtime-fallback { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-tertiary); }
</style>
