<script setup lang="ts">
/**
 * TuiSelect：Tauri 端自定义下拉选择器（替代原生 select）
 *
 * 组件式用法：
 *   <TuiSelect v-model="level" :options="[{value:'off',label:'关闭'},...]" />
 * 视觉与全局令牌一致；点击外部 / Esc 关闭，支持 disabled。
 * 详细why请见 docs/details/注释/tauri/components/TuiSelect.md
 */
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import TuiIcon from './TuiIcon.vue'

export interface TuiSelectOption {
  value: string
  label: string
}

const props = withDefaults(
  defineProps<{
    modelValue: string
    options: TuiSelectOption[]
    disabled?: boolean
    /** 触发按钮尺寸：sm 用于 header 工具栏，md 用于表单 */
    size?: 'sm' | 'md'
    placeholder?: string
  }>(),
  { disabled: false, size: 'md', placeholder: '请选择' },
)

const emit = defineEmits<{
  (e: 'update:modelValue', v: string): void
}>()

const open = ref(false)
const rootEl = ref<HTMLElement | null>(null)
/** 键盘导航高亮索引（-1 表示未高亮，仅在键盘操作时出现） */
const activeIdx = ref(-1)

/** 当前高亮选项的 DOM id（供触发钮 aria-activedescendant 指向，屏幕阅读器感知键盘导航位置） */
const activeId = () => (activeIdx.value >= 0 ? `tui-select-opt-${activeIdx.value}` : undefined)

const current = () => props.options.find((o) => o.value === props.modelValue)

function toggle() {
  if (!props.disabled) {
    open.value = !open.value
    activeIdx.value = -1
  }
}

/** 键盘打开菜单：↓ 打开并高亮当前值，↑ 打开并高亮末项 */
function openByKey(dir: -1 | 1) {
  if (props.disabled || open.value) return
  open.value = true
  const cur = props.options.findIndex((o) => o.value === props.modelValue)
  activeIdx.value = dir === 1 ? (cur >= 0 ? cur : 0) : props.options.length - 1
}

function pick(opt: TuiSelectOption) {
  emit('update:modelValue', opt.value)
  open.value = false
  activeIdx.value = -1
  // 回焦触发按钮：鼠标点击选中的 li 会随 v-if 移除导致焦点落入 body（批次90 5.4）
  ;(rootEl.value?.querySelector('.tui-select__trigger') as HTMLElement)?.focus()
}

function onDocClick(e: MouseEvent) {
  if (open.value && rootEl.value && !rootEl.value.contains(e.target as Node)) {
    open.value = false
  }
}

function onKeydown(e: KeyboardEvent) {
  if (!open.value) return
  // Tab：关闭菜单并放行默认 Tab（焦点离开下拉，避免残留菜单）（批次90 1.2）
  if (e.key === 'Tab') {
    open.value = false
    activeIdx.value = -1
    return
  }
  // Esc：关闭并回焦触发按钮（键盘可达）
  if (e.key === 'Escape') {
    open.value = false
    ;(rootEl.value?.querySelector('.tui-select__trigger') as HTMLElement)?.focus()
    return
  }
  // 菜单内键盘导航：↑↓ 移动高亮，Enter 选中
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    const n = props.options.length
    if (n === 0) return
    const dir = e.key === 'ArrowDown' ? 1 : -1
    activeIdx.value =
      activeIdx.value === -1
        ? (dir === 1 ? 0 : n - 1)
        : (activeIdx.value + dir + n) % n
  } else if (e.key === 'Enter') {
    e.preventDefault()
    if (activeIdx.value >= 0 && props.options[activeIdx.value]) {
      pick(props.options[activeIdx.value])
    }
  }
}

onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onKeydown)
})

// 外部改变值时关闭下拉
watch(
  () => props.modelValue,
  () => {
    open.value = false
  },
)
</script>

<template>
  <div ref="rootEl" class="tui-select" :class="[`is-${size}`, { 'is-open': open, 'is-disabled': disabled }]">
    <button
      type="button"
      class="tui-select__trigger"
      :disabled="disabled"
      :aria-expanded="open"
      aria-haspopup="listbox"
      :aria-activedescendant="open ? activeId() : undefined"
      @click="toggle"
      @keydown.down.prevent="openByKey(1)"
      @keydown.up.prevent="openByKey(-1)"
    >
      <span class="tui-select__value" :class="{ 'is-empty': !current() }">
        {{ current()?.label ?? placeholder }}
      </span>
      <TuiIcon name="chevronDown" :size="14" class="tui-select__caret" />
    </button>

    <Transition name="tui-select">
      <ul v-if="open" class="tui-select__menu" role="listbox">
        <li
          v-for="(opt, i) in options"
          :key="opt.value"
          :id="`tui-select-opt-${i}`"
          class="tui-select__opt"
          :class="{ 'is-active': opt.value === modelValue, 'is-focus': i === activeIdx }"
          role="option"
          :aria-selected="opt.value === modelValue"
          @click="pick(opt)"
          @mouseenter="activeIdx = i"
        >
          <span>{{ opt.label }}</span>
          <TuiIcon v-if="opt.value === modelValue" name="check" :size="13" class="tui-select__check" />
        </li>
      </ul>
    </Transition>
  </div>
</template>

<style scoped>
.tui-select {
  position: relative;
  display: inline-block;
}
.tui-select__trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  color: var(--text-primary);
  font-size: var(--fs-md);
  cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease);
}
.tui-select__trigger:hover:not(:disabled) {
  border-color: var(--accent);
}
/* 按压反馈：触发钮微沉（批次89） */
.tui-select__trigger:active:not(:disabled) {
  transform: scale(var(--press-scale));
}
.tui-select.is-open .tui-select__trigger {
  border-color: var(--accent);
}
.tui-select__trigger:disabled {
  background: var(--bg-muted);
  color: var(--text-muted);
  cursor: not-allowed;
  opacity: var(--disabled-opacity);
}
.tui-select.is-sm .tui-select__trigger {
  height: 28px;
  padding: 0 8px;
  font-size: var(--fs-sm);
}
.tui-select.is-md .tui-select__trigger {
  height: 34px;
  padding: 0 10px;
}
.tui-select__value {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 160px;
}
.tui-select__value.is-empty {
  color: var(--text-muted);
}
.tui-select__caret {
  color: var(--text-muted);
  transition: transform var(--dur-fast) var(--ease);
}
.tui-select.is-open .tui-select__caret {
  transform: rotate(180deg);
}

.tui-select__menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: var(--z-dropdown);
  list-style: none;
  margin: 0;
  padding: 4px;
  min-width: 100%;
  max-height: 240px;
  overflow-y: auto;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
}
.tui-select__opt {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  font-size: var(--fs-md);
  color: var(--text-secondary);
  cursor: pointer;
  white-space: nowrap;
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}
.tui-select__opt:hover {
  background: var(--bg-muted);
  color: var(--text-primary);
}
.tui-select__opt.is-active {
  color: var(--accent);
  background: var(--accent-soft);
}
/* 键盘导航高亮：柔和强调，鼠标悬停同步（is-active 之上仍可见区分） */
.tui-select__opt.is-focus {
  background: var(--bg-active);
  color: var(--text-primary);
}
.tui-select__opt.is-active.is-focus {
  background: var(--accent-soft);
  color: var(--accent);
  box-shadow: inset 0 0 0 1px var(--accent-soft-border);
}
.tui-select__check {
  color: var(--accent);
  flex-shrink: 0;
}

.tui-select-enter-active,
.tui-select-leave-active {
  transition: opacity var(--dur-fast) var(--ease), transform var(--dur-fast) var(--ease);
}
.tui-select-enter-from,
.tui-select-leave-to {
  opacity: 0;
  transform: translateY(-3px);
}
</style>
