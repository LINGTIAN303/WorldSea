<template>
  <div class="cd-wrapper" :class="{ disabled }" ref="wrapperRef">
    <button class="cd-trigger" @click="toggle" :disabled="disabled"
      role="combobox" aria-haspopup="listbox" :aria-expanded="isOpen" :aria-controls="listId"
      @keydown="onTriggerKeydown">
      <span class="cd-value">{{ selectedLabel || placeholder || '—' }}</span>
      <span class="cd-arrow" :class="{ open: isOpen }">▾</span>
    </button>
    <!-- 选项列表 Teleport 到 body，按触发按钮坐标定位，避免被父级 overflow/contain 容器裁剪 -->
    <Teleport to="body">
      <Transition name="ws-menu">
        <div v-if="isOpen" class="cd-dropdown" :id="listId" role="listbox" ref="dropdownRef"
          :style="{ left: pos.left + 'px', top: pos.top + 'px', minWidth: pos.width + 'px' }">
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
    </Teleport>
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
const dropdownRef = ref<HTMLDivElement>()
const optionRefs = ref<HTMLButtonElement[]>([])
const listId = `cd-list-${Math.random().toString(36).slice(2, 8)}`
// 选项列表固定定位坐标（相对视口）
const pos = ref({ left: 0, top: 0, width: 0 })

const selectedLabel = computed(() => {
  const opt = props.options.find(o => o.value === props.modelValue)
  return opt?.label || ''
})

// 打开时按触发按钮的视口坐标计算选项列表位置
function updatePosition() {
  const rect = wrapperRef.value?.getBoundingClientRect()
  if (!rect) return
  pos.value = { left: rect.left, top: rect.bottom + 2, width: rect.width }
}

function toggle() {
  if (props.disabled) return
  if (!isOpen.value) updatePosition()
  isOpen.value = !isOpen.value
  if (isOpen.value) nextTick(() => optionRefs.value[0]?.focus())
}

/** 触发按钮键盘：Enter/Space 开合，ArrowDown 打开并聚焦首项，Escape 关闭 */
function onTriggerKeydown(e: KeyboardEvent) {
  if (props.disabled) return
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    toggle()
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    if (!isOpen.value) { updatePosition(); isOpen.value = true }
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

// 点击外部关闭：需同时排除已 Teleport 到 body 的选项列表
function onClickOutside(e: MouseEvent) {
  const el = e.target as Node
  if (wrapperRef.value?.contains(el)) return
  if (dropdownRef.value?.contains(el)) return
  isOpen.value = false
}

// 页面滚动 / 视口变化时重定位，保证选项列表跟随触发按钮
function onViewportChange() {
  if (isOpen.value) updatePosition()
}

onMounted(() => {
  document.addEventListener('click', onClickOutside)
  window.addEventListener('scroll', onViewportChange, true)
  window.addEventListener('resize', onViewportChange)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onClickOutside)
  window.removeEventListener('scroll', onViewportChange, true)
  window.removeEventListener('resize', onViewportChange)
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
  background: var(--sf-control-bg);
  border: 1px solid var(--sf-control-edge);
  border-radius: calc(var(--radius-sm, 4px) * var(--sf-radius-scale));
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
/* 选项列表 Teleport 到 body，固定定位；z-index 抬高于工具栏/面板 */
.cd-dropdown {
  position: fixed;
  z-index: 2000;
  background: var(--sf-overlay-bg);
  border: 1px solid var(--sf-overlay-edge);
  border-radius: calc(var(--radius-sm, 4px) * var(--sf-radius-scale));
  box-shadow: var(--sf-overlay-shadow);
  backdrop-filter: var(--sf-overlay-filter, none);
  padding: 4px 0;
  max-height: 240px;
  overflow-y: auto;
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
  background: var(--sf-panel-bg-muted, rgba(0,0,0,0.05));
}
.cd-option.selected {
  background: var(--accent-bg, rgba(167,139,250,0.1));
  color: var(--accent);
  font-weight: var(--font-weight-semibold);
}
</style>
