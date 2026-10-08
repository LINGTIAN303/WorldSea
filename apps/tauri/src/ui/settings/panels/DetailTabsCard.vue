<template>
  <div class="sc-head"><span>Tab 管理</span><span class="ds-type">{{ typeLabel }}</span></div>

  <div v-for="(row, i) in draft" :key="row.id" class="set-row ds-tab-row">
    <WsIcon :name="row.icon || 'outline'" size="xs" class="ds-tab-icon" />
    <span class="ds-label ds-tab-label">{{ row.label }}</span>
    <span v-if="row.pinned" class="ds-count" title="信息与关联是兜底入口，不可隐藏">固定</span>
    <button class="ds-btn" type="button" title="上移" aria-label="上移" :disabled="i === 0" @click="move(i, -1)"><WsIcon name="arrow-up" size="xs" /></button>
    <button class="ds-btn" type="button" title="下移" aria-label="下移" :disabled="i === draft.length - 1" @click="move(i, 1)"><WsIcon name="arrow-down" size="xs" /></button>
    <input
      class="ds-tab-toggle"
      type="checkbox"
      :checked="row.visible"
      :disabled="row.pinned"
      :title="row.pinned ? '不可隐藏' : row.visible ? '隐藏此页' : '显示此页'"
      :aria-label="`显示「${row.label}」`"
      @change="toggle(i, !row.visible)"
    />
  </div>

  <div class="set-btn-row">
    <button class="set-btn" type="button" :disabled="!dirty" @click="commit">保存</button>
    <button v-if="dirty" class="set-btn" type="button" @click="revert">放弃修改</button>
    <button class="set-btn" type="button" :disabled="!hasOverride" @click="resetDefault">恢复默认</button>
  </div>
  <div class="set-hint">{{ HINT }}</div>
</template>

<script setup lang="ts">
/**
 * 设置 ·「实体详情」Tab 的 Tab 管理卡（2026-10-08 Tab 优化批 C）。
 *
 * 草稿制（与分组管理卡同款）：草稿在本件、落盘走 `detailLayoutStore.setTabOverride`。
 * 候选全集来自 `resolveDetailTabs`——**只应用 order、不应用 hidden**（隐藏项也要列出才能恢复）；
 * 可见性由覆写里的 hidden 集合还原。`info`/`relations` 钉底禁隐（与组装单点的 PINNED 同源）。
 * 芽级声明（custom/extras）从 `world/detailTabDeclarations.ts` 单一真源读取。
 */
import { computed, ref, watch } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import { entitySchemaRegistry, useDetailLayoutStore } from '@worldsea/entity-core'
import { resolveDetailTabs, PINNED_TAB_IDS } from '@worldsea/plugin-sdk'
import { DETAIL_TAB_DECLARATIONS } from '../../../world/detailTabDeclarations'

const props = defineProps<{
  entityType: string
  typeLabel: string
}>()

const store = useDetailLayoutStore()

interface TabRow {
  id: string
  label: string
  icon: string
  visible: boolean
  pinned: boolean
}

const draft = ref<TabRow[]>([])
const dirty = ref(false)

function build(): TabRow[] {
  const decl = DETAIL_TAB_DECLARATIONS[props.entityType]
  const schema = entitySchemaRegistry.get(props.entityType)
  const hasCover = !!schema?.fields.some(f => f.key === 'coverImage')
  const override = store.tabOverrides[props.entityType]
  const all = resolveDetailTabs({
    hasCover,
    customTabs: decl?.custom,
    extras: decl?.extras,
    override: { order: override?.order },
  })
  const hidden = new Set(override?.hidden ?? [])
  return all.map(t => ({
    id: t.id,
    label: t.label,
    icon: t.icon ?? '',
    visible: !hidden.has(t.id),
    pinned: PINNED_TAB_IDS.includes(t.id),
  }))
}

function revert(): void {
  draft.value = build()
  dirty.value = false
}

// 切实体类型才重置草稿，编辑中不打扰
watch(() => props.entityType, revert, { immediate: true })

const hasOverride = computed(() => !!store.tabOverrides[props.entityType])

function move(index: number, delta: number): void {
  const to = index + delta
  if (to < 0 || to >= draft.value.length) return
  const arr = [...draft.value]
  ;[arr[index], arr[to]] = [arr[to], arr[index]]
  draft.value = arr
  dirty.value = true
}

/** 翻「当前草稿值」而非读事件 checked（单向绑定 checkbox 的形状陷阱，本仓有前例） */
function toggle(index: number, visible: boolean): void {
  const row = draft.value[index]
  if (!row || row.pinned) return
  row.visible = visible
  dirty.value = true
}

function commit(): void {
  store.setTabOverride(props.entityType, {
    order: draft.value.map(r => r.id),
    hidden: draft.value.filter(r => !r.visible && !r.pinned).map(r => r.id),
  })
  dirty.value = false
}

function resetDefault(): void {
  store.clearTabOverride(props.entityType)
  revert()
}

const HINT = '「信息」「关联」为兜底入口，固定不可隐藏；保存后在详情标签条生效，ALT+←/→ 可循环切页。'
</script>
