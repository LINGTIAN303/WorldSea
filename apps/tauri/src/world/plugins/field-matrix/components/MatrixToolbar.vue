<template>
  <!-- 顶栏并入 App 壳工具条：控件按类型分发到统一落点（2026-10-19） -->
  <Teleport to="#view-toolbar-search">
    <input
      ref="searchRef"
      class="fm-tb-search"
      type="search"
      :value="query"
      placeholder="搜索字段 / 中文名 / 芽 / 选项…"
      aria-label="搜索字段、中文名、芽或选项"
      title="按 / 聚焦搜索"
      autocomplete="off"
      @input="emit('update:query', ($event.target as HTMLInputElement).value)"
    >
  </Teleport>

  <Teleport to="#view-toolbar-filter-body">
    <label class="fm-tb-check">
      <input
        type="checkbox"
        :checked="onlyRequired"
        @change="emit('update:onlyRequired', ($event.target as HTMLInputElement).checked)"
      >
      <span>只看必填</span>
    </label>
    <label class="fm-tb-check">
      <input
        type="checkbox"
        :checked="onlyOwn"
        @change="emit('update:onlyOwn', ($event.target as HTMLInputElement).checked)"
      >
      <span>只看芽自有</span>
    </label>
    <select
      class="fm-tb-select"
      :value="typeFilter"
      aria-label="按字段类型筛选"
      @change="emit('update:typeFilter', ($event.target as HTMLSelectElement).value)"
    >
      <option value="">全部类型</option>
      <option v-for="option in typeOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
    </select>
  </Teleport>

  <Teleport to="#view-toolbar-actions">
    <span class="fm-tb-stats" aria-label="统计">
      <b>{{ stats.buds }}</b> 芽 · <b>{{ stats.entities }}</b> 实体 · <b>{{ stats.instances }}</b> 字段
    </span>
    <select class="fm-tb-select fm-tb-jump" aria-label="快速跳转" @change="onJump">
      <option value="">快速跳转…</option>
      <option v-for="option in jumpOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
    </select>
    <TuiButton variant="secondary" size="sm" @click="emit('clear')">清空</TuiButton>
    <TuiButton
      class="fm-tb-rail"
      variant="secondary"
      size="sm"
      :icon="sidebarCollapsed ? 'panel-right-open' : 'panel-right-close'"
      :title="sidebarCollapsed ? '展开目录' : '收起目录'"
      @click="emit('toggle-sidebar')"
    >目录</TuiButton>
  </Teleport>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { TuiButton } from '@worldsea/ui-kit'
import type { FieldMatrixStats } from '../model/types'

defineProps<{
  stats: FieldMatrixStats
  query: string
  onlyRequired: boolean
  onlyOwn: boolean
  typeFilter: string
  typeOptions: { value: string; label: string }[]
  jumpOptions: { value: string; label: string }[]
  sidebarCollapsed: boolean
}>()

const emit = defineEmits<{
  'update:query': [value: string]
  'update:onlyRequired': [value: boolean]
  'update:onlyOwn': [value: boolean]
  'update:typeFilter': [value: string]
  clear: []
  jump: [value: string]
  'toggle-sidebar': []
}>()

const searchRef = ref<HTMLInputElement | null>(null)

function onJump(event: Event) {
  const target = event.target as HTMLSelectElement
  if (target.value) emit('jump', target.value)
  target.value = ''
}

function onKeydown(event: KeyboardEvent) {
  const tag = document.activeElement?.tagName ?? ''
  if (event.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) {
    event.preventDefault()
    searchRef.value?.focus()
    searchRef.value?.select()
  }
  if (event.key === 'Escape' && document.activeElement === searchRef.value) {
    emit('update:query', '')
    emit('update:onlyRequired', false)
    emit('update:onlyOwn', false)
    emit('update:typeFilter', '')
    searchRef.value?.blur()
  }
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
.fm-tb-search {
  width: clamp(170px, 20vw, 300px);
  height: 28px;
  padding: 0 10px;
  font-family: inherit;
  font-size: var(--font-size-sm);
  color: var(--text-color);
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  outline: none;
  min-width: 0;
}
.fm-tb-search:focus {
  border-color: var(--color-primary);
  box-shadow: var(--shadow-focus-ring);
}
.fm-tb-search::placeholder {
  color: var(--text-tertiary);
}
.fm-tb-check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
}
.fm-tb-check input {
  margin: 0;
  accent-color: var(--color-primary);
}
.fm-tb-select {
  height: 28px;
  padding: 0 8px;
  font-family: inherit;
  font-size: var(--font-size-sm);
  color: var(--text-color);
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
}
.fm-tb-jump {
  display: none;
  max-width: 150px;
}
.fm-tb-stats {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  white-space: nowrap;
}
.fm-tb-stats b {
  font-weight: 600;
  color: var(--text-color);
  font-variant-numeric: tabular-nums;
}
/* 窄窗让位：统计收起，跳转出现；展开/收起退化为图标 */
@media (max-width: 1280px) {
  .fm-tb-stats { display: none; }
  .fm-tb-jump { display: inline-block; }
  .fm-tb-rail { display: none; }
}
</style>
