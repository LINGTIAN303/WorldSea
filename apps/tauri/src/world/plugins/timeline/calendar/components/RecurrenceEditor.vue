<template>
  <div class="re-input">
    <label class="re-toggle">
      <input type="checkbox" :checked="enabled" @change="toggleEnabled" />
      <span>启用周期</span>
    </label>

    <template v-if="enabled">
      <div class="re-row">
        <span>每</span>
        <input v-model.number="every" class="re-control re-number" type="number" min="1" @change="emitRule" />
        <select v-model="unit" class="re-control" @change="emitRule">
          <option v-for="item in calendar.units" :key="item.id" :value="item.id">{{ item.name }}</option>
        </select>
      </div>
      <div class="re-row re-stack">
        <span class="re-label">结束</span>
        <TimePointInput
          :model-value="until"
          :calendar="calendar"
          placeholder="留空 = 无限"
          @update:model-value="onUntil"
        />
      </div>
      <div class="re-row re-stack">
        <span class="re-label">例外</span>
        <textarea
          v-model="exceptionsText"
          class="re-control re-textarea"
          placeholder="每行一个日期"
          @blur="emitRule"
        />
      </div>
    </template>

    <span v-if="error" class="re-error">{{ error }}</span>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import type { Calendar } from '../types'
import { parseTimePoint } from '../parse'
import TimePointInput from './TimePointInput.vue'

const props = defineProps<{
  modelValue: string
  calendar: Calendar
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const enabled = ref(false)
const unit = ref('year')
const every = ref(1)
const until = ref('')
const exceptionsText = ref('')
const error = ref('')

function defaultUnit(): string {
  return props.calendar.units.find(item => item.id === 'year')?.id ?? props.calendar.units[0]?.id ?? 'year'
}

function load(text: string): void {
  error.value = ''
  if (!text.trim()) {
    enabled.value = false
    unit.value = defaultUnit()
    every.value = 1
    until.value = ''
    exceptionsText.value = ''
    return
  }
  try {
    const rule = JSON.parse(text) as { unit?: string; every?: number; until?: string; exceptions?: string[] }
    const requested = rule.unit ?? defaultUnit()
    enabled.value = true
    unit.value = props.calendar.units.some(item => item.id === requested) ? requested : defaultUnit()
    every.value = Math.max(1, Number(rule.every) || 1)
    until.value = rule.until ?? ''
    exceptionsText.value = (rule.exceptions ?? []).join('\n')
  } catch {
    enabled.value = false
    error.value = '周期规则不是合法 JSON'
  }
}

function validate(): boolean {
  const texts = [until.value, ...exceptionsText.value.split('\n')]
    .map(item => item.trim())
    .filter(Boolean)
  for (const text of texts) {
    if (!parseTimePoint(text, props.calendar)) {
      error.value = `无法解析日期：${text}`
      return false
    }
  }
  error.value = ''
  return true
}

function emitRule(): void {
  if (!enabled.value) {
    emit('update:modelValue', '')
    return
  }
  if (!validate()) return
  const exceptions = exceptionsText.value.split('\n').map(item => item.trim()).filter(Boolean)
  const rule: Record<string, unknown> = { unit: unit.value, every: Math.max(1, Number(every.value) || 1) }
  if (until.value.trim()) rule.until = until.value.trim()
  if (exceptions.length) rule.exceptions = exceptions
  emit('update:modelValue', JSON.stringify(rule))
}

function toggleEnabled(e: Event): void {
  enabled.value = (e.target as HTMLInputElement).checked
  if (enabled.value) {
    unit.value = defaultUnit()
    every.value = 1
  }
  emitRule()
}

function onUntil(value: string): void {
  until.value = value
  emitRule()
}

watch(() => props.modelValue, load, { immediate: true })
watch(() => props.calendar, () => {
  if (!props.calendar.units.some(item => item.id === unit.value)) unit.value = defaultUnit()
})
</script>

<style scoped>
.re-input { display: flex; flex-direction: column; gap: 6px; }
.re-toggle { display: flex; align-items: center; gap: 6px; font-size: var(--font-size-sm); color: var(--text-secondary); }
.re-row { display: flex; align-items: center; gap: 6px; font-size: var(--font-size-sm); }
.re-stack { align-items: stretch; flex-direction: column; gap: 2px; }
.re-label { font-size: var(--font-size-xs); color: var(--text-tertiary); }
.re-control {
  padding: 5px 8px; border: 1px solid var(--border-color); border-radius: var(--radius-sm);
  background: var(--input-bg); color: var(--text-color); font-size: var(--font-size-sm); outline: none;
}
.re-control:focus { border-color: var(--primary); box-shadow: 0 0 0 2px var(--color-primary-subtle); }
.re-number { width: 64px; }
.re-textarea { min-height: 48px; resize: vertical; font-family: inherit; }
.re-error { color: var(--danger); font-size: var(--font-size-xs); }
</style>
