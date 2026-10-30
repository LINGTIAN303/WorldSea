<script setup lang="ts">
/**
 * TuiSegmented：Tauri 端分段选择器（互斥选项组）
 *
 * 组件式用法：
 *   <TuiSegmented v-model="mode" :options="[{value:'cloud',label:'云端'},...]" />
 * 用于互斥且短列表的选择（模式切换、级别选择），比下拉更直观。
 * 详细why请见 docs/details/注释/tauri/components/TuiSegmented.md
 *
 * iconMode（可选，默认关闭）：图标常驻 + 单级文字模式。
 * - 每个选项可带 icon（WsIcon 名）；开启后所有项图标常驻显示。
 * - 文字单级：默认仅当前选中项露文字，悬停某具体项时该项露文字、其余（含当前）仅图标。
 * - 无 icon 的选项始终显示文字（如待移除的过渡项）。
 * 关闭时行为与普通分段滑块一致（全部显示文字）。
 */
export interface TuiSegmentedOption {
  value: string
  label: string
  /** 图标名（WsIcon），仅在 iconMode 下渲染 */
  icon?: string
}

import { ref } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'

const props = withDefaults(
  defineProps<{
    modelValue: string
    options: TuiSegmentedOption[]
    disabled?: boolean
    /** 图标常驻 + 单级文字（默认关闭，不影响普通用法） */
    iconMode?: boolean
  }>(),
  { disabled: false, iconMode: false },
)

/** 当前被悬停的选项 value；null 表示未悬停（此时由当前项露文字） */
const hoveredValue = ref<string | null>(null)

function onItemEnter(v: string) {
  if (props.iconMode) hoveredValue.value = v
}

function onItemLeave() {
  if (props.iconMode) hoveredValue.value = null
}

/** 单级文字判定：悬停中→悬停项露字；否则当前项露字；无图标项恒露字 */
function showLabel(opt: TuiSegmentedOption): boolean {
  if (!props.iconMode) return true
  if (!opt.icon) return true
  if (hoveredValue.value) return hoveredValue.value === opt.value
  return opt.value === props.modelValue
}

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
    :class="{ 'is-disabled': disabled, 'is-icon-mode': iconMode }"
    @keydown="onKeydown"
  >
    <button
      v-for="opt in options"
      :key="opt.value"
      type="button"
      class="tui-seg__item"
      :class="{
        'is-active': opt.value === modelValue,
        'has-icon': !!opt.icon,
        'label-on': showLabel(opt),
      }"
      role="radio"
      :aria-checked="opt.value === modelValue"
      :tabindex="opt.value === modelValue ? 0 : -1"
      :disabled="disabled"
      @click="emit('update:modelValue', opt.value)"
      @mouseenter="onItemEnter(opt.value)"
      @mouseleave="onItemLeave"
    >
      <WsIcon v-if="opt.icon" :name="opt.icon" size="sm" class="tui-seg__icon" />
      <span class="tui-seg__label"><span class="tui-seg__label-text">{{ opt.label }}</span></span>
    </button>
  </div>
</template>

<style scoped>
.tui-seg {
  display: inline-flex;
  padding: 3px;
  gap: 2px;
  background: var(--sf-panel-bg-muted);
  border: 1px solid var(--sf-panel-edge);
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
  transform: scale(var(--sf-press-scale, var(--press-scale)));
}
.tui-seg__item.is-active {
  background: var(--sf-control-bg);
  color: var(--text-primary);
  font-weight: 500;
  box-shadow: var(--sf-control-shadow);
}
.tui-seg__item:disabled {
  cursor: not-allowed;
  opacity: var(--disabled-opacity);
}

/* ── iconMode 图标常驻 + 单级文字（可选）──
   图标常驻显示；文字用 grid-template-columns 0fr→1fr 平滑展开/收起，
   仅当前项（或悬停项）露文字，其余仅图标。
   紧凑布局：容器无 gap，纯图标项收窄 padding 靠拢，露文字项保留正常 padding。 */
.tui-seg.is-icon-mode {
  gap: 0;
}
.tui-seg.is-icon-mode .tui-seg__item {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding-left: 6px;
  padding-right: 6px;
}
.tui-seg.is-icon-mode .tui-seg__item.label-on {
  padding-left: 10px;
  padding-right: 10px;
}
.tui-seg.is-icon-mode :deep(.tui-seg__icon) {
  flex-shrink: 0;
}
.tui-seg.is-icon-mode .tui-seg__label {
  display: grid;
  grid-template-columns: 0fr;
  transition: grid-template-columns var(--dur-slow) var(--ease);
}
.tui-seg.is-icon-mode .tui-seg__label-text {
  overflow: hidden;
  white-space: nowrap;
}
/* 露文字：当前项（默认）或悬停项（mousedenter 置 label-on）；无图标项恒露字 */
.tui-seg.is-icon-mode .tui-seg__item.label-on .tui-seg__label,
.tui-seg.is-icon-mode .tui-seg__item:not(.has-icon) .tui-seg__label {
  grid-template-columns: 1fr;
}

/* 尊重系统「减弱动效」偏好：文字直接切换，不做宽度动画 */
:root[data-anim-overlays='off'] .tui-seg.is-icon-mode .tui-seg__label {
  transition: none;
}
</style>