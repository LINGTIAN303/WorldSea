<template>
  <div class="sc-head"><span>分组管理</span><span class="ds-type">{{ typeLabel }}</span></div>

  <div v-for="g in draft" :key="g.key" class="ds-group-block">
    <div class="set-row ds-group">
      <input class="set-input ds-group-name" :value="g.label" aria-label="分组名"
        @change="rename(g.key, ($event.target as HTMLInputElement).value)" />
      <span class="ds-count">{{ g.fieldKeys.length }} 字段</span>
      <button class="ds-btn" type="button" title="删除分组（字段回到未分组）" aria-label="删除分组"
        @click="remove(g.key)"><WsIcon name="delete" size="xs" /></button>
    </div>
    <!-- 这里的次序就是详情里的组内次序（组内独立排序，2026-10-08）；加入字段用下方「字段归属」 -->
    <div v-if="g.fieldKeys.length" class="ds-gf-list">
      <div v-for="(fk, i) in g.fieldKeys" :key="fk" class="set-row ds-gf-row">
        <span class="ds-label ds-gf-label">{{ labelOf(fk) }}</span>
        <button class="ds-btn" type="button" title="上移" aria-label="上移"
          :disabled="i === 0" @click="moveField(g.key, i, -1)"><WsIcon name="arrow-up" size="xs" /></button>
        <button class="ds-btn" type="button" title="下移" aria-label="下移"
          :disabled="i === g.fieldKeys.length - 1" @click="moveField(g.key, i, 1)"><WsIcon name="arrow-down" size="xs" /></button>
      </div>
    </div>
  </div>

  <div class="set-btn-row">
    <button class="set-btn" type="button" @click="add">＋ 新建分组</button>
    <button class="set-btn" type="button" :disabled="!dirty" @click="commit">保存分组</button>
    <button v-if="dirty" class="set-btn" type="button" @click="revert">放弃修改</button>
  </div>

  <div class="sc-sub">字段归属</div>
  <div v-for="f in fields" :key="f.key" class="set-row ds-assign">
    <span class="ds-label">{{ f.label }}</span>
    <select class="set-select" :value="groupOf(f.key)" @change="assign(f.key, ($event.target as HTMLSelectElement).value)">
      <option value="">未分组</option>
      <option v-for="g in draft" :key="g.key" :value="g.key">{{ g.label }}</option>
    </select>
  </div>
  <div class="set-hint">{{ HINT }}</div>
</template>

<script setup lang="ts">
/**
 * 设置 ·「实体详情」Tab 的分组编辑卡（父件负责落盘，本件只管草稿）。
 * 样式共用 apps/tauri/src/ui/settings/detail-settings.css（挂在 .ds-panel 下）。
 * 详细见 docs/details/注释/packages/plugin-sdk/实体详情内容形态.md §7.3
 *
 * 为什么唯独这卡是「草稿 + 显式保存」而别的卡即时落盘：
 * `normalizeGroups` 会把**空组丢掉**，即时写会让「＋ 新建分组」点完立刻消失，看起来像按钮坏了。
 */
import { ref, watch } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import type { DetailGroup } from '@worldsea/plugin-sdk'

const HINT = '未分组的字段在详情里归入「其它」；组内次序即上方箭头调整的顺序（与全局字段顺序相互独立）。'
  + ' 空组保存后不会出现在详情里。芽若声明过分组，这里改过一次即以你这版为准（整表替换）。'

const props = defineProps<{
  /** 已存的分组（父件从覆写或解析结果取，**不含合成的「其它」**） */
  groups: DetailGroup[]
  /** 可分组的字段＝非标题、未隐藏 */
  fields: { key: string; label: string }[]
  typeLabel: string
}>()

const emit = defineEmits<{ commit: [groups: DetailGroup[]] }>()

const draft = ref<DetailGroup[]>([])
const dirty = ref(false)

function clone(): DetailGroup[] {
  return props.groups.map(g => ({ ...g, fieldKeys: [...g.fieldKeys] }))
}

function revert() {
  draft.value = clone()
  dirty.value = false
}

// 种子变化（切类型 / 提交成功 / 覆写被清空）才重置草稿，编辑中不打扰
watch(() => [props.typeLabel, props.groups], revert, { immediate: true, deep: true })

/** 取一个没用过的组序号：按现有数量推会被「删一个再加一个」撞上同 key 与同名 */
function nextSlot(): number {
  const used = new Set(draft.value.map(g => g.key))
  let n = 1
  while (used.has(`g${n}`)) n++
  return n
}

function add() {
  const n = nextSlot()
  draft.value.push({ key: `g${n}`, label: `分组 ${n}`, fieldKeys: [] })
  dirty.value = true
}

function rename(key: string, label: string) {
  const g = draft.value.find(x => x.key === key)
  if (!g) return
  g.label = label.trim() || g.label
  dirty.value = true
}

function remove(key: string) {
  draft.value = draft.value.filter(g => g.key !== key)
  dirty.value = true
}

function groupOf(fieldKey: string): string {
  return draft.value.find(g => g.fieldKeys.includes(fieldKey))?.key ?? ''
}

/** 一个字段只属一个组：先摘干净再挂目标组 */
function assign(fieldKey: string, target: string) {
  for (const g of draft.value) g.fieldKeys = g.fieldKeys.filter(k => k !== fieldKey)
  const g = draft.value.find(x => x.key === target)
  if (g) g.fieldKeys.push(fieldKey)
  dirty.value = true
}

function labelOf(fieldKey: string): string {
  return props.fields.find(f => f.key === fieldKey)?.label ?? fieldKey
}

/** 组内调序（上移/下移一格）：改的就是详情里生效的组内次序（写回 commit 的 fieldKeys 顺序） */
function moveField(groupKey: string, index: number, delta: number) {
  const g = draft.value.find(x => x.key === groupKey)
  if (!g) return
  const to = index + delta
  if (to < 0 || to >= g.fieldKeys.length) return
  const arr = [...g.fieldKeys]
  ;[arr[index], arr[to]] = [arr[to], arr[index]]
  g.fieldKeys = arr
  dirty.value = true
}

function commit() {
  emit('commit', draft.value.map(g => ({ ...g, fieldKeys: [...g.fieldKeys] })))
  dirty.value = false
}
</script>
