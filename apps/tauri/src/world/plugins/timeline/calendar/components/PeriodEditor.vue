<template>
  <div class="pe-editor">
    <div v-for="(period, index) in periods" :key="period.id" class="pe-row">
      <div class="pe-head">
        <input class="pe-control pe-name" :value="period.name" placeholder="期段名（王朝 / 战争 / 时代）" @input="patch(index, { name: inputValue($event) })" />
        <input class="pe-color" type="color" :value="period.color || '#4f46e5'" @input="patch(index, { color: inputValue($event) })" />
        <select class="pe-control" :value="period.parentId ?? ''" @change="patch(index, { parentId: inputValue($event) || undefined })">
          <option value="">无父级</option>
          <option v-for="other in periods" :key="other.id" :value="other.id" :disabled="other.id === period.id">{{ other.name }}</option>
        </select>
        <button type="button" class="pe-remove" @click="remove(index)">×</button>
      </div>
      <div class="pe-range">
        <input class="pe-control" :value="period.start" placeholder="开始（如 第三纪元147年）" @input="patch(index, { start: inputValue($event) })" />
        <span>~</span>
        <input class="pe-control" :value="period.end" placeholder="结束" @input="patch(index, { end: inputValue($event) })" />
      </div>
      <span v-if="errors[index]" class="pe-error">{{ errors[index] }}</span>
    </div>
    <button type="button" class="pe-add" @click="add">＋ 添加期段</button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Calendar, CalendarPeriod } from '../types'
import { parseTimePoint } from '../parse'

const props = defineProps<{
  modelValue?: CalendarPeriod[]
  calendar: Calendar
}>()

const emit = defineEmits<{ 'update:modelValue': [value: CalendarPeriod[]] }>()

const periods = computed(() => props.modelValue ?? [])

const errors = computed(() => periods.value.map(period => {
  const startText = (period.start ?? '').trim()
  const endText = (period.end ?? '').trim()
  if (!startText || !endText) return '缺少起止日期'
  const start = parseTimePoint(startText, props.calendar)
  const end = parseTimePoint(endText, props.calendar)
  if (!start || !end) return '起止日期无法按当前历法解析'
  return ''
}))

function inputValue(e: Event): string {
  return (e.target as HTMLInputElement | HTMLSelectElement).value
}

function replace(next: CalendarPeriod[]): void {
  emit('update:modelValue', next)
}

function patch(index: number, changes: Partial<CalendarPeriod>): void {
  replace(periods.value.map((item, i) => i === index ? { ...item, ...changes } : item))
}

function add(): void {
  replace([...periods.value, {
    id: `p-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    name: `期段${periods.value.length + 1}`,
    start: '',
    end: '',
    color: '#4f46e5',
  }])
}

function remove(index: number): void {
  replace(periods.value.filter((_, i) => i !== index))
}
</script>

<style scoped>
.pe-editor { display: flex; flex-direction: column; gap: 6px; }
.pe-row { display: flex; flex-direction: column; gap: 4px; padding: 6px 8px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); }
.pe-head, .pe-range { display: flex; align-items: center; gap: 6px; }
.pe-control {
  padding: 4px 7px; border: 1px solid var(--border-color); border-radius: var(--radius-xs);
  background: var(--input-bg); color: var(--text-color); font-size: var(--font-size-xs); outline: none;
}
.pe-control:focus { border-color: var(--primary); }
.pe-name { flex: 1; min-width: 100px; }
.pe-range input { flex: 1; min-width: 80px; }
.pe-color { width: 28px; height: 26px; padding: 1px; border: 1px solid var(--border-color); border-radius: var(--radius-xs); background: var(--input-bg); }
.pe-remove { border: 1px solid var(--border-color); background: var(--input-bg); color: var(--danger); border-radius: var(--radius-xs); width: 22px; height: 22px; cursor: pointer; }
.pe-error { color: var(--danger); font-size: var(--font-size-xs); }
.pe-add { align-self: flex-start; border: 1px dashed var(--border-color); background: transparent; color: var(--text-tertiary); border-radius: var(--radius-xs); padding: 4px 10px; font-size: var(--font-size-xs); cursor: pointer; }
.pe-add:hover { border-color: var(--primary); color: var(--primary); }
</style>
