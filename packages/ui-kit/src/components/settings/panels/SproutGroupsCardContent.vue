<template>
  <div class="set-card deck-card" v-show="match('激活分组 分组 预设 启用 保存 应用')">
    <div class="sc-head">
      <div class="sc-head-left">
        <span>激活分组</span>
        <span class="sp-sub">启用范围预设</span>
      </div>
    </div>
    <p class="set-hint">保存当前启用的芽为预设；应用后只启用组内芽，组外停用。</p>

    <div class="sg-save-row">
      <input
        v-model="groupName"
        type="text"
        class="set-input"
        :placeholder="`分组名（当前启用 ${activeSproutIds.length} 个）`"
        maxlength="20"
        @keyup.enter="saveGroup"
      />
      <button type="button" class="set-btn" @click="saveGroup">保存当前启用</button>
    </div>

    <div v-if="store.sproutGroups.length === 0" class="set-hint">暂无分组。启用几个芽后保存为一个分组。</div>
    <div v-else class="sg-list">
      <div v-for="g in store.sproutGroups" :key="g.id" class="sg-item" :class="{ on: isActiveSetEqual(g.sproutIds) }">
        <button type="button" class="sg-main" :title="`应用分组「${g.name}」：仅启用组内 ${g.sproutIds.length} 个芽`" @click="applyGroup(g)">
          <span class="sg-name">{{ g.name }}</span>
          <span class="sg-count">{{ g.sproutIds.length }} 个芽</span>
        </button>
        <button type="button" class="sg-del" :aria-label="`删除分组 ${g.name}`" title="删除分组" @click="removeGroup(g)">✕</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useSettingsStore, type SproutGroup } from '@worldsea/entity-core'
import { toastSuccess, toastWarn } from '@worldsea/ui-kit'
import { matchKeywords } from '../utils'

const props = defineProps<{ searchQuery?: string }>()
const emit = defineEmits<{ dirty: [] }>()

const store = useSettingsStore()
const groupName = ref('')

const activeSproutIds = computed(() => store.sprouts.filter(p => p.active).map(p => p.id))
const activeIdSet = computed(() => new Set(activeSproutIds.value))

function match(keywords: string): boolean {
  return matchKeywords(props.searchQuery ?? '', keywords)
}

function isActiveSetEqual(ids: string[]): boolean {
  if (ids.length !== activeIdSet.value.size) return false
  return ids.every(id => activeIdSet.value.has(id))
}

function saveGroup() {
  const name = groupName.value.trim()
  if (!name) {
    toastWarn('请先输入分组名')
    return
  }
  if (activeSproutIds.value.length === 0) {
    toastWarn('当前没有启用的芽：先勾选要启用的芽，再保存分组')
    return
  }
  const group = store.saveSproutGroup(name, activeSproutIds.value)
  groupName.value = ''
  emit('dirty')
  toastSuccess(`已保存分组「${group.name}」（${group.sproutIds.length} 个芽）`)
}

function applyGroup(group: SproutGroup) {
  store.applySproutGroup(group.id)
  emit('dirty')
  toastSuccess(`已应用分组「${group.name}」（启用 ${group.sproutIds.length} 个芽）`)
}

function removeGroup(group: SproutGroup) {
  store.removeSproutGroup(group.id)
  emit('dirty')
}
</script>

<style scoped>
.sc-head-left {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}
.sp-sub {
  font-size: var(--text-micro-font-size, 10px);
  font-weight: var(--font-weight-normal, 400);
  color: var(--text-tertiary, var(--color-text-tertiary));
  text-transform: none;
  letter-spacing: normal;
  white-space: nowrap;
}
.sg-save-row {
  display: flex;
  gap: 6px;
  margin: 8px 0 10px;
}
.sg-save-row .set-input {
  flex: 1;
  min-width: 0;
}
.sg-list {
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--border, var(--color-border));
}
.sg-item {
  display: flex;
  align-items: center;
  gap: 4px;
  border-bottom: 1px solid var(--border, var(--color-border));
}
.sg-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 6px;
  border: none;
  background: transparent;
  color: var(--text-color);
  cursor: pointer;
  text-align: left;
  border-radius: var(--radius-sm);
}
.sg-main:hover {
  background: var(--hover-bg, var(--color-bg-hover));
}
.sg-item.on .sg-main {
  color: var(--primary, var(--color-primary));
  font-weight: var(--font-weight-medium, 500);
}
.sg-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--font-size-sm);
}
.sg-count {
  flex-shrink: 0;
  font-size: var(--text-micro-font-size, 10px);
  color: var(--text-tertiary, var(--color-text-tertiary));
}
.sg-del {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-tertiary, var(--color-text-tertiary));
  cursor: pointer;
}
.sg-del:hover {
  background: var(--hover-bg, var(--color-bg-hover));
  color: var(--danger, var(--color-danger));
}
</style>
