<template>
  <div class="nv-editor">
    <div v-for="(item, index) in values" :key="item.id" class="nv-row">
      <input
        class="nv-control nv-name"
        :value="item.name"
        placeholder="名称（如 一月 / 第一纪元）"
        @input="patch(index, { name: ($event.target as HTMLInputElement).value })"
      />
      <input
        class="nv-control nv-length"
        type="number"
        min="1"
        :value="item.length ?? ''"
        :placeholder="allowUnbounded && index === values.length - 1 ? '无界' : (factor ? String(factor) : '长度')"
        :title="allowUnbounded && index === values.length - 1 ? '留空 = 无界' : '该取值包含多少下一级单位'"
        @input="patchLength(index, $event)"
      />
      <label class="nv-leap-toggle" title="该值专属闰规则（如二月闰日）">
        <input type="checkbox" :checked="!!item.leap" @change="toggleLeap(index, $event)" />
        <span>闰</span>
      </label>
      <button type="button" class="nv-remove" :disabled="values.length <= 1" @click="remove(index)">×</button>
      <div v-if="item.leap" class="nv-leap-row">
        <label>每 <input class="nv-control nv-number" type="number" min="1" :value="item.leap.every" @input="patchLeap(index, 'every', $event)" /> 个父级</label>
        <label>加 <input class="nv-control nv-number" type="number" min="1" :value="item.leap.add" @input="patchLeap(index, 'add', $event)" /></label>
        <label>跳过每 <input class="nv-control nv-number" type="number" min="1" :value="item.leap.exceptEvery ?? ''" placeholder="—" @input="patchLeap(index, 'exceptEvery', $event)" /></label>
        <label>补回每 <input class="nv-control nv-number" type="number" min="1" :value="item.leap.butEvery ?? ''" placeholder="—" @input="patchLeap(index, 'butEvery', $event)" /></label>
      </div>
    </div>
    <button type="button" class="nv-add" @click="add">＋ 添加取值</button>
  </div>
</template>

<script setup lang="ts">
import type { NamedUnitValue } from '../types'

const props = withDefaults(defineProps<{
  values: NamedUnitValue[]
  factor?: number
  allowUnbounded?: boolean
}>(), {
  factor: undefined,
  allowUnbounded: false,
})

const emit = defineEmits<{ 'update:modelValue': [value: NamedUnitValue[]] }>()

function nextId(): string {
  return `v-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

function replace(next: NamedUnitValue[]): void {
  emit('update:modelValue', next)
}

function patch(index: number, changes: Partial<NamedUnitValue>): void {
  replace(props.values.map((item, i) => i === index ? { ...item, ...changes } : item))
}

function patchLength(index: number, e: Event): void {
  const raw = (e.target as HTMLInputElement).value.trim()
  patch(index, { length: raw ? Number(raw) : undefined })
}

function toggleLeap(index: number, e: Event): void {
  const checked = (e.target as HTMLInputElement).checked
  patch(index, { leap: checked ? { every: 4, add: 1 } : undefined })
}

function patchLeap(index: number, key: 'every' | 'add' | 'exceptEvery' | 'butEvery', e: Event): void {
  const raw = (e.target as HTMLInputElement).value.trim()
  const item = props.values[index]
  const leap = { ...(item.leap ?? { every: 4, add: 1 }) }
  if (key === 'exceptEvery' || key === 'butEvery') {
    if (raw) leap[key] = Number(raw)
    else delete leap[key]
  } else {
    leap[key] = Math.max(1, Number(raw) || 1)
  }
  patch(index, { leap })
}

function add(): void {
  replace([...props.values, { id: nextId(), name: `取值${props.values.length + 1}` }])
}

function remove(index: number): void {
  if (props.values.length <= 1) return
  replace(props.values.filter((_, i) => i !== index))
}
</script>

<style scoped>
.nv-editor { display: flex; flex-direction: column; gap: 6px; padding: 6px 8px; background: var(--hover-bg); border-radius: var(--radius-sm); }
.nv-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.nv-control {
  padding: 4px 7px; border: 1px solid var(--border-color); border-radius: var(--radius-xs);
  background: var(--input-bg); color: var(--text-color); font-size: var(--font-size-xs); outline: none;
}
.nv-control:focus { border-color: var(--primary); }
.nv-name { flex: 1 1 120px; min-width: 90px; }
.nv-length { width: 72px; }
.nv-number { width: 56px; }
.nv-leap-toggle { display: flex; align-items: center; gap: 2px; font-size: var(--font-size-xs); color: var(--text-tertiary); }
.nv-remove { border: none; background: transparent; color: var(--danger); cursor: pointer; font-size: var(--font-size-sm); }
.nv-remove:disabled { opacity: 0.3; cursor: default; }
.nv-leap-row { flex-basis: 100%; display: flex; flex-wrap: wrap; gap: 8px; font-size: var(--font-size-xs); color: var(--text-secondary); }
.nv-leap-row label { display: flex; align-items: center; gap: 4px; }
.nv-add { align-self: flex-start; border: 1px dashed var(--border-color); background: transparent; color: var(--text-tertiary); border-radius: var(--radius-xs); padding: 3px 8px; font-size: var(--font-size-xs); cursor: pointer; }
.nv-add:hover { border-color: var(--primary); color: var(--primary); }
</style>
