<template>
  <div :ref="panelRef" class="nb-typo-panel" :style="panelStyle">
    <div class="nb-typo-title">排版偏好</div>

    <div class="nb-typo-row">
      <span class="nb-typo-label">字号</span>
      <div class="nb-typo-seg">
        <button
          v-for="opt in FONT_OPTIONS" :key="opt.value"
          class="nb-typo-seg-btn" :class="{ active: nbFontSize === opt.value }"
          @click="nbFontSize = opt.value"
        >{{ opt.label }}</button>
      </div>
    </div>

    <div class="nb-typo-row">
      <span class="nb-typo-label">行距</span>
      <div class="nb-typo-seg">
        <button
          v-for="opt in LINE_HEIGHT_OPTIONS" :key="opt.value"
          class="nb-typo-seg-btn" :class="{ active: nbLineHeight === opt.value }"
          @click="nbLineHeight = opt.value"
        >{{ opt.label }}</button>
      </div>
    </div>

    <div class="nb-typo-row">
      <span class="nb-typo-label">引号风格</span>
      <div class="nb-typo-seg">
        <button
          v-for="opt in QUOTE_STYLE_OPTIONS" :key="opt.value"
          class="nb-typo-seg-btn" :class="{ active: nbQuoteStyle === opt.value }"
          @click="nbQuoteStyle = opt.value"
        >{{ opt.label }}</button>
      </div>
    </div>
    <p class="nb-typo-hint">引号风格供「一键排版」使用；偏好仅作用于笔记本编辑与预览。</p>
  </div>
</template>

<script setup lang="ts">
/**
 * 笔记本排版偏好面板（批2）：工具栏「Aa」按钮触发的就地小卡（fixed 定位，锚在按钮下方
 * 右对齐；定位/点击外部关闭与正文写作 TypographyPanel 同款，独立实现——锚定小逻辑多处
 * 重复已登记挂账，待 UI 层统一时归一）。偏好走 useNotePrefs（worldsea_nb_* 键域），
 * 默认值 = 既有呈现（--font-size-base / 1.75）。
 */
import { nbFontSize, nbLineHeight, nbQuoteStyle } from '../composables/useNotePrefs'
import { useAnchoredPanel } from '@/composables/useAnchoredPanel'

const props = defineProps<{ anchor: HTMLElement | null }>()
const emit = defineEmits<{ close: [] }>()

const { panelRef, panelStyle } = useAnchoredPanel(() => props.anchor, () => emit('close'), { bottomGuard: 260 })

// 字号默认 14 = 既有呈现（prose.css 的 --font-size-base）
const FONT_OPTIONS = [
  { value: 13, label: '小' },
  { value: 14, label: '标准' },
  { value: 16, label: '中' },
  { value: 18, label: '大' },
  { value: 20, label: '特大' },
]
const LINE_HEIGHT_OPTIONS = [
  { value: 1.6, label: '紧凑' },
  { value: 1.75, label: '标准' },
  { value: 2.0, label: '宽松' },
]
const QUOTE_STYLE_OPTIONS: Array<{ value: 'off' | 'curly' | 'corner'; label: string }> = [
  { value: 'off', label: '不统一' },
  { value: 'curly', label: '“弯”' },
  { value: 'corner', label: '「直」' },
]
</script>

<style scoped>
.nb-typo-panel {
  position: fixed;
  z-index: var(--z-popover, 400);
  width: 280px;
  padding: 12px;
  background: var(--modal-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-mid);
  box-shadow: var(--shadow-md);
}
.nb-typo-title {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--text-color);
  margin-bottom: 10px;
}
.nb-typo-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 0;
}
.nb-typo-label { font-size: var(--font-size-sm); color: var(--text-secondary); flex-shrink: 0; }
.nb-typo-seg {
  display: flex;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-xs);
  overflow: hidden;
}
.nb-typo-seg-btn {
  padding: 3px 8px;
  border: none;
  background: transparent;
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  cursor: pointer;
  white-space: nowrap;
}
.nb-typo-seg-btn + .nb-typo-seg-btn { border-left: 1px solid var(--border-color); }
.nb-typo-seg-btn:hover { background: var(--hover-bg); }
.nb-typo-seg-btn.active { background: var(--primary-light); color: var(--primary); font-weight: var(--font-weight-medium); }
.nb-typo-hint {
  margin: 8px 0 0;
  font-size: var(--font-size-2xs);
  color: var(--text-tertiary);
  line-height: 1.5;
}
</style>
