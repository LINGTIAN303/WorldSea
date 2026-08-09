<template>
  <div class="cd-wrapper" :class="{ disabled }" ref="wrapperRef">
    <button class="cd-trigger" @click="toggle" :disabled="disabled"
      role="combobox" aria-haspopup="listbox" :aria-expanded="isOpen" :aria-controls="listId"
      @keydown="onTriggerKeydown">
      <span class="cd-value">{{ selectedLabel || placeholder || '—' }}</span>
      <span class="cd-arrow" :class="{ open: isOpen }">▾</span>
    </button>
    <Transition name="ws-menu">
      <div v-if="isOpen" class="cd-dropdown" :id="listId" role="listbox">
        <button
          v-for="(opt, i) in options"
          :key="opt.value"
          ref="optionRefs"
          class="cd-option"
          role="option"
          :aria-selected="opt.value === modelValue"
          :class="{ selected: opt.value === modelValue }"
          :style="{ animationDelay: i * 30 + 'ms' }"
          @click="select(opt.value)"
          @keydown="(e) => onOptionKeydown(e, i)">
          {{ opt.label }}
        </button>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onBeforeUnmount } from 'vue'

interface Props {
  modelValue: string
  options: { value: string; label: string }[]
  placeholder?: string
  disabled?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  placeholder: '',
  disabled: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const isOpen = ref(false)
const wrapperRef = ref<HTMLDivElement>()
const optionRefs = ref<HTMLButtonElement[]>([])
const listId = `cd-list-${Math.random().toString(36).slice(2, 8)}`

const selectedLabel = computed(() => {
  const opt = props.options.find(o => o.value === props.modelValue)
  return opt?.label || ''
})

function toggle() {
  if (props.disabled) return
  isOpen.value = !isOpen.value
}

/** 触发按钮键盘：Enter/Space 开合，ArrowDown 打开并聚焦首项，Escape 关闭 */
function onTriggerKeydown(e: KeyboardEvent) {
  if (props.disabled) return
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    toggle()
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    if (!isOpen.value) isOpen.value = true
    nextTick(() => optionRefs.value[0]?.focus())
  } else if (e.key === 'Escape' && isOpen.value) {
    isOpen.value = false
  }
}

/** 选项键盘：方向键导航，Enter/Space 选择，Home/End 跳转，Escape 关闭 */
function onOptionKeydown(e: KeyboardEvent, idx: number) {
  const count = optionRefs.value.length
  let target = -1
  if (e.key === 'ArrowDown') target = (idx + 1) % count
  else if (e.key === 'ArrowUp') target = (idx - 1 + count) % count
  else if (e.key === 'Home') target = 0
  else if (e.key === 'End') target = count - 1
  else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    select(props.options[idx].value)
    return
  } else if (e.key === 'Escape') {
    isOpen.value = false
    return
  }
  if (target >= 0) {
    e.preventDefault()
    optionRefs.value[target]?.focus()
  }
}

function select(value: string) {
  emit('update:modelValue', value)
  isOpen.value = false
}

function onClickOutside(e: MouseEvent) {
  if (wrapperRef.value && !wrapperRef.value.contains(e.target as Node)) {
    isOpen.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', onClickOutside)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onClickOutside)
})
</script>

<style scoped>
.cd-wrapper {
  position: relative;
  display: inline-block;
}
.cd-wrapper.disabled {
  opacity: 0.5;
  pointer-events: none;
}
.cd-trigger {
  display: flex;
  align-items: center;
  gap: 4px;
  background: var(--input-bg, #fff);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 4px 8px;
  cursor: pointer;
  color: var(--text);
  font-size: inherit;
  font-family: inherit;
  min-width: 60px;
}
.cd-trigger:disabled {
  cursor: not-allowed;
}
.cd-value {
  flex: 1;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cd-arrow {
  transition: transform 0.15s ease;
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
}
.cd-arrow.open {
  transform: rotate(180deg);
}
.cd-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 100;
  background: var(--modal-bg, #fff);
  border: 1px solid var(--border);
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  min-width: 100%;
  padding: 4px 0;
  margin-top: 2px;
}
.cd-option {
  display: block;
  width: 100%;
  padding: 6px 12px;
  border: none;
  background: none;
  text-align: left;
  cursor: pointer;
  font-size: inherit;
  font-family: inherit;
  color: var(--text);
  white-space: nowrap;
}
.cd-option:hover {
  background: var(--hover-bg, rgba(0,0,0,0.05));
}
.cd-option.selected {
  background: var(--accent-bg, rgba(167,139,250,0.1));
  color: var(--accent);
  font-weight: var(--font-weight-semibold);
}


</style>
