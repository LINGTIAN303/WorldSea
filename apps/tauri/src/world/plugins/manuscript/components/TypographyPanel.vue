<template>
  <div ref="panelRef" class="ms-typo-panel" :style="panelStyle">
    <div class="ms-typo-title">排版偏好</div>

    <div class="ms-typo-row">
      <span class="ms-typo-label">字号</span>
      <div class="ms-typo-seg">
        <button
          v-for="opt in FONT_OPTIONS" :key="opt.value"
          class="ms-typo-seg-btn" :class="{ active: msFontSize === opt.value }"
          @click="msFontSize = opt.value"
        >{{ opt.label }}</button>
      </div>
    </div>

    <div class="ms-typo-row">
      <span class="ms-typo-label">行距</span>
      <div class="ms-typo-seg">
        <button
          v-for="opt in LINE_HEIGHT_OPTIONS" :key="opt.value"
          class="ms-typo-seg-btn" :class="{ active: msLineHeight === opt.value }"
          @click="msLineHeight = opt.value"
        >{{ opt.label }}</button>
      </div>
    </div>

    <div class="ms-typo-row">
      <span class="ms-typo-label">页宽</span>
      <div class="ms-typo-seg">
        <button
          v-for="opt in PAGE_WIDTH_OPTIONS" :key="opt.value"
          class="ms-typo-seg-btn" :class="{ active: msPageWidth === opt.value }"
          @click="msPageWidth = opt.value"
        >{{ opt.label }}</button>
      </div>
    </div>

    <div class="ms-typo-row">
      <span class="ms-typo-label">段首缩进</span>
      <TuiCheckbox v-model="msIndent" :label="msIndent ? '缩进两字' : '不缩进'" />
    </div>

    <div class="ms-typo-row">
      <span class="ms-typo-label">打字机滚动</span>
      <TuiCheckbox v-model="msTypewriter" :label="msTypewriter ? '光标居中' : '关闭'" />
    </div>

    <div class="ms-typo-row">
      <span class="ms-typo-label">段落淡出</span>
      <TuiCheckbox v-model="msParaDim" :label="msParaDim ? '当前段外变淡' : '关闭'" />
    </div>

    <div class="ms-typo-row">
      <span class="ms-typo-label">引号风格</span>
      <div class="ms-typo-seg">
        <button
          v-for="opt in QUOTE_STYLE_OPTIONS" :key="opt.value"
          class="ms-typo-seg-btn" :class="{ active: msQuoteStyle === opt.value }"
          @click="msQuoteStyle = opt.value"
        >{{ opt.label }}</button>
      </div>
    </div>
    <p class="ms-typo-hint">引号风格供「一键排版」使用；段首缩进仅改变显示，不改内容。</p>
  </div>
</template>

<script setup lang="ts">
/**
 * 排版偏好面板（批1）：编辑器头部「Aa」按钮触发的就地小卡（fixed 定位，锚在按钮下方右对齐）。
 * 全部偏好走 settingsStore localStorage 持久化；段首缩进/页宽为呈现层（CSS 变量，
 * ManuscriptView 绑定），不改文档内容；段落淡出切换后需 refreshParaDim 强制重算装饰。
 */
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import TuiCheckbox from '@/components/ui/TuiCheckbox.vue'
import {
  msFontSize, msLineHeight, msPageWidth, msIndent, msQuoteStyle,
  msTypewriter, msParaDim,
} from '../composables/useWritingPrefs'
import { refreshParaDim } from '../composables/paraDimExtension'

const props = defineProps<{ anchor: HTMLElement | null; editor: Editor | null }>()
const emit = defineEmits<{ close: [] }>()

// 字号默认 14 = 既有呈现（--font-size-md 未定义，继承 body 的 --fs-base）
const FONT_OPTIONS = [
  { value: 13, label: '小' },
  { value: 14, label: '标准' },
  { value: 16, label: '中' },
  { value: 18, label: '大' },
  { value: 20, label: '特大' },
]
const LINE_HEIGHT_OPTIONS = [
  { value: 1.6, label: '紧凑' },
  { value: 1.8, label: '标准' },
  { value: 2.0, label: '宽松' },
]
// 页宽默认 full = 既有呈现（正文原本无宽度上限）
const PAGE_WIDTH_OPTIONS = [
  { value: 'full', label: '全宽' },
  { value: 'standard', label: '标准' },
  { value: 'wide', label: '宽' },
]
const QUOTE_STYLE_OPTIONS: Array<{ value: 'off' | 'curly' | 'corner'; label: string }> = [
  { value: 'off', label: '不统一' },
  { value: 'curly', label: '“弯”' },
  { value: 'corner', label: '「直」' },
]

// 段落淡出：装饰只在事务时重算，开关切换后强制刷新一次
watch(msParaDim, () => {
  if (props.editor) refreshParaDim(props.editor)
})

const panelRef = ref<HTMLElement | null>(null)
const panelStyle = ref<{ top: string; right: string }>({ top: '0px', right: '0px' })

function position() {
  const rect = props.anchor?.getBoundingClientRect()
  if (!rect) return
  panelStyle.value = {
    top: `${Math.min(rect.bottom + 6, window.innerHeight - 320)}px`,
    right: `${window.innerWidth - rect.right}px`,
  }
}

function onDocMousedown(e: MouseEvent) {
  const t = e.target as Node
  if (panelRef.value?.contains(t)) return
  if (props.anchor?.contains(t)) return
  emit('close')
}

onMounted(() => {
  position()
  document.addEventListener('mousedown', onDocMousedown)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocMousedown)
})
</script>

<style scoped>
.ms-typo-panel {
  position: fixed;
  z-index: var(--z-popover, 400);
  width: 280px;
  padding: 12px;
  background: var(--modal-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-mid);
  box-shadow: var(--shadow-md);
}
.ms-typo-title {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--text-color);
  margin-bottom: 10px;
}
.ms-typo-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 0;
}
.ms-typo-label { font-size: var(--font-size-sm); color: var(--text-secondary); flex-shrink: 0; }
.ms-typo-seg {
  display: flex;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-xs);
  overflow: hidden;
}
.ms-typo-seg-btn {
  padding: 3px 8px;
  border: none;
  background: transparent;
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  cursor: pointer;
  white-space: nowrap;
}
.ms-typo-seg-btn + .ms-typo-seg-btn { border-left: 1px solid var(--border-color); }
.ms-typo-seg-btn:hover { background: var(--hover-bg); }
.ms-typo-seg-btn.active { background: var(--primary-light); color: var(--primary); font-weight: var(--font-weight-medium); }
.ms-typo-hint {
  margin: 8px 0 0;
  font-size: var(--font-size-2xs);
  color: var(--text-tertiary);
  line-height: 1.5;
}
</style>
