<template>
  <div class="module-runtime" v-if="page">
    <!-- 工具条区 -->
    <div class="mr-toolbar" v-if="hasToolbar"><RuntimeSlotRenderer :slot="page.toolbar" /></div>
    <!-- 视图区 -->
    <div class="mr-view"><RuntimeSlotRenderer :slot="page.view" /></div>
  </div>
  <div v-else class="module-runtime-fallback">
    <p>此模块尚未配置布局</p>
  </div>
</template>

<script setup lang="ts">
import { provide, inject, unref, onMounted, onBeforeUnmount, computed } from 'vue'
import { getModuleViewData } from '../../../../core/ModuleViewRegistry'
import { createModuleRuntimeContext, type ModuleRuntimeContext } from './ModuleRuntimeContext'
import RuntimeSlotRenderer from './RuntimeSlotRenderer.vue'
import { migrateToPageSchema } from '../pageMigration'
import { countComponents } from '../types/pageSchema'

// 视图组件由 ViewContainer 渲染，不传 viewId prop，改从注入的 moduleViewId 读取（注入值为 Ref）
const injectedViewId = inject<unknown>('moduleViewId', null)
const props = defineProps<{ viewId?: string }>()
const viewId = computed(() => props.viewId || String(unref(injectedViewId) ?? ''))

const viewData = getModuleViewData(viewId.value)
const module = viewData?.module
const page = module ? migrateToPageSchema(module.layoutSchema as unknown) : null

const hasToolbar = computed(() => page ? countComponents(page.toolbar) > 0 : false)

const ctx = module ? createModuleRuntimeContext(module) : null

provide<ModuleRuntimeContext | null>('moduleRuntimeContext', ctx)

onMounted(() => { ctx?.initialize() })
onBeforeUnmount(() => { ctx?.dispose() })
</script>

<style scoped>
.module-runtime { width: 100%; height: 100%; display: flex; flex-direction: column; }
.mr-toolbar { flex-shrink: 0; border-bottom: 1px solid var(--border-color); padding: 0 12px; min-height: 44px; display: flex; align-items: center; }
.mr-view { flex: 1; min-height: 0; padding: 12px; overflow: auto; }
.module-runtime-fallback { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-tertiary); }
</style>