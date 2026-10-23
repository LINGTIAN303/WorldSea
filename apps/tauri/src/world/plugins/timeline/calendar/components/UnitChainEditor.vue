<template>
  <div class="uc-editor">
    <div v-for="(unit, level) in modelValue" :key="unit.id" class="uc-row">
      <div class="uc-head">
        <div class="uc-order">
          <button type="button" :disabled="level === 0" @click="move(level, -1)" title="上移">↑</button>
          <button type="button" :disabled="level === modelValue.length - 1" @click="move(level, 1)" title="下移">↓</button>
        </div>
        <input class="uc-control uc-name" :value="unit.name" placeholder="单位名" @input="patch(unit.id, { name: inputValue($event) })" />
        <select class="uc-control" :value="unit.kind" @change="changeKind(unit, inputValue($event))">
          <option value="numeric">数值</option>
          <option value="named">命名</option>
        </select>
        <code class="uc-id">{{ unit.id }}</code>
        <button type="button" class="uc-remove" :disabled="modelValue.length <= 1" @click="remove(level)">×</button>
      </div>

      <div class="uc-detail">
        <label v-if="level < modelValue.length - 1 && unit.kind === 'numeric'">
          1 个 = <input class="uc-control uc-number" type="number" min="1" :value="unit.factor ?? ''" @input="patchNumber(unit.id, 'factor', $event)" /> 个下一级
        </label>
        <label v-if="unit.kind === 'numeric'">
          起始 <input class="uc-control uc-number" type="number" :value="unit.start ?? 1" @input="patchNumber(unit.id, 'start', $event)" />
        </label>
        <label v-if="unit.kind === 'numeric'">
          数字
          <select class="uc-control" :value="unit.numeral ?? 'arabic'" @change="patch(unit.id, { numeral: inputValue($event) as 'arabic' | 'chinese' })">
            <option value="arabic">阿拉伯</option>
            <option value="chinese">中文</option>
          </select>
        </label>
        <label class="uc-format">
          片段 <input class="uc-control" :value="unit.format ?? ''" placeholder="如 第{value}纪元" @input="patch(unit.id, { format: inputValue($event) })" />
        </label>
        <label v-if="level < modelValue.length - 1" class="uc-leap-toggle">
          <input type="checkbox" :checked="!!unit.leap" @change="toggleLeap(unit.id, $event)" />
          单位闰
        </label>
      </div>

      <div v-if="unit.leap" class="uc-leap-row">
        <label>每 <input class="uc-control uc-number" type="number" min="1" :value="unit.leap.every" @input="patchLeap(unit.id, 'every', $event)" /> 个父级</label>
        <label>加 <input class="uc-control uc-number" type="number" min="1" :value="unit.leap.add" @input="patchLeap(unit.id, 'add', $event)" /></label>
        <label>跳过每 <input class="uc-control uc-number" type="number" min="1" :value="unit.leap.exceptEvery ?? ''" placeholder="—" @input="patchLeap(unit.id, 'exceptEvery', $event)" /></label>
        <label>补回每 <input class="uc-control uc-number" type="number" min="1" :value="unit.leap.butEvery ?? ''" placeholder="—" @input="patchLeap(unit.id, 'butEvery', $event)" /></label>
      </div>

      <NamedValuesEditor
        v-if="unit.kind === 'named'"
        :values="unit.values ?? []"
        :factor="unit.factor"
        :allow-unbounded="level === 0"
        @update:model-value="values => patch(unit.id, { values })"
      />
    </div>

    <button type="button" class="uc-add" @click="addUnit">＋ 添加单位</button>
  </div>
</template>

<script setup lang="ts">
import type { CalendarUnit, NamedUnitValue } from '../types'
import NamedValuesEditor from './NamedValuesEditor.vue'

const props = defineProps<{ modelValue: CalendarUnit[] }>()
const emit = defineEmits<{ 'update:modelValue': [value: CalendarUnit[]] }>()

function inputValue(e: Event): string {
  return (e.target as HTMLInputElement | HTMLSelectElement).value
}

function replace(next: CalendarUnit[]): void {
  emit('update:modelValue', next)
}

function patch(id: string, changes: Partial<CalendarUnit>): void {
  replace(props.modelValue.map(unit => unit.id === id ? { ...unit, ...changes } : unit))
}

function patchNumber(id: string, key: 'factor' | 'start', e: Event): void {
  const raw = (e.target as HTMLInputElement).value.trim()
  patch(id, { [key]: raw ? Number(raw) : undefined })
}

function changeKind(unit: CalendarUnit, kind: string): void {
  if (kind === unit.kind) return
  if (kind === 'named') {
    const values: NamedUnitValue[] = unit.values?.length
      ? unit.values
      : [{ id: `v-${Date.now()}`, name: `${unit.name || '取值'}一` }]
    patch(unit.id, { kind: 'named', values })
  } else {
    patch(unit.id, { kind: 'numeric', values: undefined })
  }
}

function toggleLeap(id: string, e: Event): void {
  const checked = (e.target as HTMLInputElement).checked
  patch(id, { leap: checked ? { every: 4, add: 1 } : undefined })
}

function patchLeap(id: string, key: 'every' | 'add' | 'exceptEvery' | 'butEvery', e: Event): void {
  const unit = props.modelValue.find(item => item.id === id)
  const leap = { ...(unit?.leap ?? { every: 4, add: 1 }) }
  const raw = (e.target as HTMLInputElement).value.trim()
  if (key === 'exceptEvery' || key === 'butEvery') {
    if (raw) leap[key] = Number(raw)
    else delete leap[key]
  } else {
    leap[key] = Math.max(1, Number(raw) || 1)
  }
  patch(id, { leap })
}

function move(level: number, delta: number): void {
  const next = [...props.modelValue]
  const target = level + delta
  if (target < 0 || target >= next.length) return
  ;[next[level], next[target]] = [next[target], next[level]]
  replace(next)
}

function remove(level: number): void {
  if (props.modelValue.length <= 1) return
  const next = props.modelValue.filter((_, index) => index !== level)
  const last = next[next.length - 1]
  if (last && last.kind === 'numeric') next[next.length - 1] = { ...last, factor: undefined }
  replace(next)
}

function addUnit(): void {
  const oldLast = props.modelValue[props.modelValue.length - 1]
  // 新单位追加到末尾后，旧末尾不再是标量基，必须补一个默认长度
  const next = props.modelValue.map(unit =>
    unit.id === oldLast?.id && !unit.factor ? { ...unit, factor: 10 } : unit,
  )
  next.push({
    id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    name: '新单位', kind: 'numeric', start: 1,
    format: `{value}新单位`,
  })
  replace(next)
}
</script>

<style scoped>
.uc-editor { display: flex; flex-direction: column; gap: 8px; }
.uc-row { display: flex; flex-direction: column; gap: 6px; padding: 8px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); }
.uc-head { display: flex; align-items: center; gap: 6px; }
.uc-order { display: flex; gap: 2px; }
.uc-order button, .uc-remove {
  border: 1px solid var(--border-color); background: var(--input-bg); color: var(--text-secondary);
  border-radius: var(--radius-xs); width: 22px; height: 22px; cursor: pointer; font-size: var(--font-size-xs);
}
.uc-order button:disabled, .uc-remove:disabled { opacity: 0.3; cursor: default; }
.uc-remove { color: var(--danger); }
.uc-control {
  padding: 4px 7px; border: 1px solid var(--border-color); border-radius: var(--radius-xs);
  background: var(--input-bg); color: var(--text-color); font-size: var(--font-size-xs); outline: none;
}
.uc-control:focus { border-color: var(--primary); }
.uc-name { flex: 1; min-width: 80px; }
.uc-id { font-size: var(--font-size-2xs, 10px); color: var(--text-tertiary); }
.uc-detail { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: var(--font-size-xs); color: var(--text-secondary); }
.uc-detail label { display: flex; align-items: center; gap: 4px; }
.uc-number { width: 56px; }
.uc-format { flex: 1 1 180px; }
.uc-format input { flex: 1; }
.uc-leap-toggle { margin-left: auto; }
.uc-leap-row { display: flex; flex-wrap: wrap; gap: 8px; font-size: var(--font-size-xs); color: var(--text-secondary); }
.uc-leap-row label { display: flex; align-items: center; gap: 4px; }
.uc-add { align-self: flex-start; border: 1px dashed var(--border-color); background: transparent; color: var(--text-tertiary); border-radius: var(--radius-xs); padding: 4px 10px; font-size: var(--font-size-xs); cursor: pointer; }
.uc-add:hover { border-color: var(--primary); color: var(--primary); }
</style>
