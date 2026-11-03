<template>
  <!-- 上下文编辑区：作用于当前选中目标（图片槽 / 启用 / 填充 / 焦点 / 暗化 / 模糊） -->
  <div class="bg-editor">
    <div class="bg-editor__head">{{ TARGET_LABELS[target] }}</div>
    <template v-if="target === 'content-toolbar'">
      <p class="set-hint">工具条背景仅在使用随流工具条（bar）的视图生效；悬浮胶囊与隐藏工具条不套背景。</p>
      <p class="set-hint bg-editor__mode" :class="{ 'bg-error': currentToolbarMode !== 'bar' }">{{ toolbarModeText }}</p>
    </template>

    <!-- 大背景是独立面，选中后在编辑区给完整 16:9 预览 -->
    <div v-if="target === 'canvas'" class="bg-editor__preview">
      <BackgroundLayer target="canvas" :scope="previewScope" :preview-theme="previewTheme" preview />
      <span v-if="!canvasPreviewHasSource" class="bg-editor__preview-empty">{{ readOnly ? '跟随全局，暂无图片' : '未选择图片' }}</span>
    </div>

    <!-- 亮/暗图片槽 -->
    <div v-for="theme in BACKGROUND_THEMES" :key="theme" class="bg-slot" :class="`bg-slot--${theme}`">
      <span class="bg-slot__label">{{ theme === 'light' ? '亮色图' : '暗色图' }}</span>
      <div class="bg-slot__thumb" :style="thumbStyle(theme)">
        <span v-if="!thumbSrc(theme)" class="bg-slot__placeholder">无</span>
      </div>
      <div class="bg-slot__actions">
        <button class="set-btn bg-slot__pick" :disabled="readOnly || picking !== null" @click="emit('pick', theme)">
          {{ picking === theme ? '正在导入…' : selected.paths[theme] ? '替换图片' : '选择图片' }}
        </button>
        <button
          v-if="selected.paths[theme]"
          class="set-btn bg-slot__remove"
          :disabled="readOnly || picking !== null"
          @click="emit('remove', theme)"
        >移除</button>
      </div>
      <p v-if="missingFor(theme)" class="set-hint bg-error">背景文件不可用，请重新选择。</p>
    </div>
    <p v-if="error" class="set-hint bg-error">{{ error }}</p>

    <!-- 启用 -->
    <div class="set-row">
      <span>启用背景</span>
      <label class="set-toggle">
        <input
          type="checkbox"
          aria-label="启用背景"
          :checked="selected.enabled"
          :disabled="readOnly || !hasAnyPath"
          @change="emit('toggle', ($event.target as HTMLInputElement).checked)"
        />
        <span class="set-toggle-slider"></span>
      </label>
    </div>

    <!-- 参数：分区目标固定 cover/居中，不展示填充与焦点 -->
    <div v-if="caps.fit" class="set-row">
      <span>填充</span>
      <select class="set-select bg-fit" aria-label="填充方式" :value="selected.fit" :disabled="readOnly || !hasAnyPath" @change="emit('fit', $event)">
        <option value="cover">铺满</option>
        <option value="contain">完整</option>
        <option value="tile">平铺</option>
      </select>
    </div>
    <div v-if="caps.focus" class="set-row">
      <span>焦点</span>
      <div class="bg-focus" role="group" aria-label="背景焦点">
        <button
          v-for="cell in FOCUS_CELLS"
          :key="cell.key"
          class="bg-focus__cell"
          :class="{ on: selected.focusX === cell.x && selected.focusY === cell.y }"
          :disabled="readOnly || !hasAnyPath || selected.fit === 'tile'"
          :aria-label="cell.label"
          @click="emit('focus', cell.x, cell.y)"
        ></button>
      </div>
    </div>
    <div class="set-row">
      <span>暗化</span>
      <div class="set-range-wrap">
        <input type="range" aria-label="暗化" min="0" max="80" step="1" class="set-range bg-dim" :value="selected.dim" :disabled="readOnly || !hasAnyPath" @input="emit('dim', $event)" @change="emit('persist')" />
        <span class="set-range-val">{{ selected.dim }}%</span>
      </div>
    </div>
    <div class="set-row">
      <span>模糊</span>
      <div class="set-range-wrap">
        <input type="range" aria-label="模糊" min="0" max="30" step="1" class="set-range bg-blur" :value="selected.blur" :disabled="readOnly || !hasAnyPath" @input="emit('blur', $event)" @change="emit('persist')" />
        <span class="set-range-val">{{ selected.blur }}px</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import BackgroundLayer from '../../../layout/BackgroundLayer.vue'
import type { ToolbarMode } from '../BackgroundTargetMap.vue'
import { BACKGROUND_TARGET_LABELS } from '../backgroundTargets'
import {
  BACKGROUND_THEMES,
  type BackgroundTarget,
  type BackgroundTargetConfig,
  type BackgroundTheme,
  type FocusStep,
} from '@worldsea/style-kit'

const TARGET_LABELS = BACKGROUND_TARGET_LABELS
const FOCUS_CELLS: Array<{ key: string; x: FocusStep; y: FocusStep; label: string }> = [
  { key: 'tl', x: 0, y: 0, label: '左上' },
  { key: 'tc', x: 50, y: 0, label: '上中' },
  { key: 'tr', x: 100, y: 0, label: '右上' },
  { key: 'ml', x: 0, y: 50, label: '左中' },
  { key: 'mc', x: 50, y: 50, label: '居中' },
  { key: 'mr', x: 100, y: 50, label: '右中' },
  { key: 'bl', x: 0, y: 100, label: '左下' },
  { key: 'bc', x: 50, y: 100, label: '下中' },
  { key: 'br', x: 100, y: 100, label: '右下' },
]

defineProps<{
  target: BackgroundTarget
  selected: BackgroundTargetConfig
  caps: { fit: boolean; focus: boolean }
  readOnly: boolean
  hasAnyPath: boolean
  picking: BackgroundTheme | null
  previewScope: 'global' | 'project'
  previewTheme: BackgroundTheme
  canvasPreviewHasSource: boolean
  currentToolbarMode: ToolbarMode
  toolbarModeText: string
  error: string
  thumbSrc: (theme: BackgroundTheme) => string
  thumbStyle: (theme: BackgroundTheme) => Record<string, string> | undefined
  missingFor: (theme: BackgroundTheme) => boolean
}>()

const emit = defineEmits<{
  pick: [theme: BackgroundTheme]
  remove: [theme: BackgroundTheme]
  toggle: [on: boolean]
  fit: [event: Event]
  focus: [x: FocusStep, y: FocusStep]
  dim: [event: Event]
  blur: [event: Event]
  /** 滑杆松手（change）时触发落盘，与拖动中的 input 区分 */
  persist: []
}>()
</script>
