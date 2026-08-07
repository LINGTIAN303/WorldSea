<script setup lang="ts">
/**
 * TuiSegmented：Tauri 端分段选择器（互斥选项组）
 *
 * 组件式用法：
 *   <TuiSegmented v-model="mode" :options="[{value:'cloud',label:'云端'},...]" />
 * 用于互斥且短列表的选择（模式切换、级别选择），比下拉更直观。
 * 详细why请见 docs/details/注释/tauri/components/TuiSegmented.md
 */
export interface TuiSegmentedOption {
  value: string
  label: string
}

const props = withDefaults(
  defineProps<{
    modelValue: string
    options: TuiSegmentedOption[]
    disabled?: boolean
  }>(),
  { disabled: false },
)

const emit = defineEmits<{
  (e: 'update:modelValue', v: string): void
}>()

/** 键盘导航：←/→ 循环切换选项并激活（方向键与 tablist 方向语义一致） */
function onKeydown(e: KeyboardEvent) {
  if (props.disabled || props.options.length === 0) return
  const cur = props.options.findIndex((o) => o.value === props.modelValue)
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    e.preventDefault()
    const dir = e.key === 'ArrowRight' ? 1 : -1
    const next = cur < 0 ? (dir === 1 ? 0 : props.options.length - 1) : (cur + dir + props.options.length) % props.options.length
    emit('update:modelValue', props.options[next].value)
    // 选中后回焦到容器内对应按钮，保持键盘操作位置感
    const btns = (e.currentTarget as HTMLElement).querySelectorAll('button.tui-seg__item')
    ;(btns[next] as HTMLElement | undefined)?.focus()
  } else if (e.key === 'Home') {
    e.preventDefault()
    emit('update:modelValue', props.options[0].value)
    ;((e.currentTarget as HTMLElement).querySelector('button.tui-seg__item') as HTMLElement | null)?.focus()
  } else if (e.key === 'End') {
    e.preventDefault()
    const last = props.options.length - 1
    emit('update:modelValue', props.options[last].value)
    const btns = (e.currentTarget as HTMLElement).querySelectorAll('button.tui-seg__item')
    ;(btns[last] as HTMLElement | undefined)?.focus()
  }
}
</script>

<template>
  <div
    class="tui-seg"
    role="radiogroup"
    :class="{ 'is-disabled': disabled }"
    @keydown="onKeydown"
  >
    <button
      v-for="opt in options"
      :key="opt.value"
      type="button"
      class="tui-seg__item"
      :class="{ 'is-active': opt.value === modelValue }"
      role="radio"
      :aria-checked="opt.value === modelValue"
      :tabindex="opt.value === modelValue ? 0 : -1"
      :disabled="disabled"
      @click="emit('update:modelValue', opt.value)"
    >
      {{ opt.label }}
    </button>
  </div>
</template>

<style scoped>
.tui-seg {
  display: inline-flex;
  padding: 3px;
  gap: 2px;
  background: var(--bg-muted);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  transition: border-color var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease);
}
/* 容器焦点反馈：键盘导航到分段组时柔和 accent 光环（与全局输入控件 focus 语言一致） */
.tui-seg:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.tui-seg__item {
  flex: 1;
  padding: 5px 14px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  font-size: var(--fs-md);
  color: var(--text-secondary);
  cursor: pointer;
  white-space: nowrap;
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease);
}
/* 聚焦反馈统一由容器 :focus-within 光环呈现，避免与全局 outline 双环 */
.tui-seg__item:focus-visible {
  outline: none;
}
.tui-seg__item:hover:not(:disabled):not(.is-active) {
  color: var(--text-primary);
}
/* 按压反馈：非选中项按下微沉（批次89） */
.tui-seg__item:active:not(:disabled):not(.is-active) {
  transform: scale(var(--press-scale));
}
.tui-seg__item.is-active {
  background: var(--bg-surface);
  color: var(--text-primary);
  font-weight: 500;
  box-shadow: var(--shadow-sm);
}
.tui-seg__item:disabled {
  cursor: not-allowed;
  opacity: var(--disabled-opacity);
}
</style>
