<template>
  <DynamicEntityView v-if="resolved" :module="resolved.module" :view-config="resolved.viewConfig" />
  <div v-else class="cmv-empty">模块视图加载中...</div>
</template>

<script setup lang="ts">
import { computed, inject, ref, type Ref } from 'vue'
import { DynamicEntityView } from '@worldsmith/plugin-sdk'
import { getModuleViewData } from '../../core/ModuleViewRegistry'

const viewIdRef = inject<Ref<string | null>>('moduleViewId', ref(null))
const viewId = computed(() => viewIdRef.value || '')
const resolved = computed(() => viewId.value ? getModuleViewData(viewId.value) || null : null)
</script>

<style scoped>
.cmv-empty { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-tertiary); padding: 40px; }
</style>
