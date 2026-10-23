<template>
  <div class="tp-input">
    <div class="tp-toolbar">
      <label class="tp-precision">
        <span>精度</span>
        <select :value="precision" @change="onPrecisionChange">
          <option v-for="(unit, index) in calendar.units" :key="unit.id" :value="index + 1">到{{ unit.name }}</option>
        </select>
      </label>
      <button type="button" class="tp-mode-btn" @click="toggleMode">
        {{ mode === 'structured' ? '文本输入' : '结构化输入' }}
      </button>
    </div>

    <div v-if="mode === 'structured'" class="tp-fields">
      <label v-for="(unit, level) in visibleUnits" :key="unit.id" class="tp-field">
        <span class="tp-field-label">{{ unit.name }}</span>
        <select
          v-if="unit.kind === 'named'"
          class="tp-control"
          :value="String(values[level] ?? '')"
          @change="onNamedChange(level, $event)"
        >
          <option v-for="item in unit.values ?? []" :key="item.id" :value="item.id">{{ item.name }}</option>
        </select>
        <input
          v-else
          class="tp-control"
          type="number"
          :value="values[level]"
          :min="unit.start ?? 1"
          @input="onNumberChange(level, $event)"
        />
      </label>
    </div>

    <div v-else class="tp-text">
      <input
        v-model="textDraft"
        class="tp-control tp-text-input"
        :placeholder="placeholder || '按当前历法输入日期'"
        @blur="commitText"
        @keydown.enter.prevent="commitText"
      />
    </div>

    <div class="tp-preview">
      <span v-if="error" class="tp-error">{{ error }}</span>
      <span v-else class="tp-value">{{ preview }}</span>
      <span v-if="localCertainty !== 'exact'" class="tp-badge">{{ certaintyLabel }}</span>
      <button v-if="showCertainty" type="button" class="tp-mode-btn" @click="cycleCertainty">
        {{ certaintyLabel }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { Calendar, Certainty, TimePoint } from '../types'
import { encodeValue, unitStart } from '../math'
import { parseTimePoint } from '../parse'
import { formatTimePoint } from '../format'
import { CERTAINTY_LABELS } from '../fuzzy'

const props = withDefaults(defineProps<{
  modelValue: string
  calendar: Calendar
  certainty?: Certainty
  showCertainty?: boolean
  placeholder?: string
}>(), {
  certainty: 'exact',
  showCertainty: false,
  placeholder: '',
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'update:certainty': [value: Certainty]
}>()

const mode = ref<'structured' | 'text'>('structured')
const values = ref<(number | string)[]>([])
const precision = ref(1)
const textDraft = ref('')
const error = ref('')
const localCertainty = ref<Certainty>(props.certainty)
let syncing = false

const visibleUnits = computed(() => props.calendar.units.slice(0, precision.value))
const certaintyLabel = computed(() => CERTAINTY_LABELS[localCertainty.value])

function defaults(): (number | string)[] {
  return props.calendar.units.map(unit => encodeValue(unit, unitStart(unit)))
}

function applyModel(text: string): void {
  const parsed = parseTimePoint(text, props.calendar)
  if (parsed) {
    values.value = [...parsed.point.values]
    precision.value = Math.max(1, Math.min(parsed.point.values.length, props.calendar.units.length))
    localCertainty.value = parsed.point.certainty
    if (parsed.point.certainty !== props.certainty) emit('update:certainty', parsed.point.certainty)
    error.value = ''
  } else if (text.trim()) {
    values.value = defaults()
    precision.value = 1
    localCertainty.value = props.certainty
    error.value = '无法按当前历法解析'
  } else {
    values.value = defaults()
    precision.value = 1
    localCertainty.value = props.certainty
    error.value = ''
  }
  textDraft.value = text
}

function buildPoint(): TimePoint | null {
  if (!props.calendar.units.length) return null
  const depth = Math.max(1, Math.min(precision.value, props.calendar.units.length))
  const list: (number | string)[] = []
  for (let level = 0; level < depth; level++) {
    const unit = props.calendar.units[level]
    const value = values.value[level]
    list.push(value === undefined || value === '' ? encodeValue(unit, unitStart(unit)) : value)
  }
  return { calendarId: props.calendar.id, values: list, certainty: 'exact' }
}

const preview = computed(() => {
  const point = buildPoint()
  return point ? formatTimePoint(point, props.calendar) : ''
})

function emitText(): void {
  const point = buildPoint()
  if (!point) return
  const text = formatTimePoint(point, props.calendar)
  textDraft.value = text
  error.value = ''
  syncing = true
  emit('update:modelValue', text)
  nextTick(() => { syncing = false })
}

function onPrecisionChange(e: Event): void {
  const next = Number((e.target as HTMLSelectElement).value) || 1
  precision.value = Math.max(1, Math.min(next, props.calendar.units.length))
  const base = defaults()
  for (let i = 0; i < precision.value; i++) {
    if (values.value[i] === undefined) values.value[i] = base[i]
  }
  emitText()
}

function onNamedChange(level: number, e: Event): void {
  values.value[level] = (e.target as HTMLSelectElement).value
  emitText()
}

function onNumberChange(level: number, e: Event): void {
  const raw = (e.target as HTMLInputElement).value
  const unit = props.calendar.units[level]
  if (!raw.trim()) {
    values.value[level] = encodeValue(unit, unitStart(unit))
  } else {
    const number = Number(raw)
    values.value[level] = Number.isFinite(number) ? number : unitStart(unit)
  }
  emitText()
}

function toggleMode(): void {
  if (mode.value === 'structured') {
    textDraft.value = formatTimePoint(buildPoint()!, props.calendar)
    mode.value = 'text'
    return
  }
  commitText()
  if (!error.value) mode.value = 'structured'
}

function commitText(): void {
  const parsed = parseTimePoint(textDraft.value, props.calendar)
  if (!parsed) {
    error.value = '无法按当前历法解析'
    syncing = true
    emit('update:modelValue', textDraft.value)
    nextTick(() => { syncing = false })
    return
  }
  values.value = [...parsed.point.values]
  precision.value = Math.max(1, Math.min(parsed.point.values.length, props.calendar.units.length))
  localCertainty.value = parsed.point.certainty
  if (parsed.point.certainty !== props.certainty) emit('update:certainty', parsed.point.certainty)
  error.value = ''
  emitText()
}

function cycleCertainty(): void {
  const order: Certainty[] = ['exact', 'approx', 'before', 'after', 'legend']
  const index = order.indexOf(localCertainty.value)
  localCertainty.value = order[(index + 1) % order.length]
  emit('update:certainty', localCertainty.value)
}

watch(() => props.modelValue, value => {
  if (!syncing) applyModel(value)
}, { immediate: true })

watch(() => props.certainty, value => { localCertainty.value = value })

watch(() => props.calendar, () => {
  if (!syncing) applyModel(props.modelValue)
})
</script>

<style scoped>
.tp-input { display: flex; flex-direction: column; gap: 6px; }
.tp-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.tp-precision { display: flex; align-items: center; gap: 4px; font-size: var(--font-size-xs); color: var(--text-secondary); }
.tp-precision select, .tp-control {
  padding: 5px 8px; border: 1px solid var(--border-color); border-radius: var(--radius-sm);
  background: var(--input-bg); color: var(--text-color); font-size: var(--font-size-sm); outline: none;
}
.tp-precision select:focus, .tp-control:focus { border-color: var(--primary); box-shadow: 0 0 0 2px var(--color-primary-subtle); }
.tp-mode-btn {
  border: 1px dashed var(--border-color); background: transparent; color: var(--text-tertiary);
  border-radius: var(--radius-xs); padding: 3px 8px; font-size: var(--font-size-xs); cursor: pointer;
}
.tp-mode-btn:hover { border-color: var(--primary); color: var(--primary); }
.tp-fields { display: flex; flex-wrap: wrap; gap: 6px; }
.tp-field { display: flex; flex-direction: column; gap: 2px; min-width: 84px; flex: 1 1 84px; }
.tp-field-label { font-size: var(--font-size-xs); color: var(--text-tertiary); }
.tp-text { display: flex; }
.tp-text-input { width: 100%; }
.tp-preview { display: flex; align-items: center; gap: 6px; min-height: 20px; font-size: var(--font-size-xs); }
.tp-value { color: var(--primary); }
.tp-error { color: var(--danger); }
.tp-badge { padding: 1px 6px; border-radius: var(--radius-xs); background: var(--warning-light); color: var(--warning); }
</style>
