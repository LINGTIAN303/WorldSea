<template>
  <div class="bg-card">
    <div class="sc-head">背景</div>

    <div class="bg-preview">
      <WorkspaceBackground preview />
      <span v-if="!hasBackground" class="bg-preview__empty">未选择图片</span>
    </div>

    <div class="bg-actions">
      <button class="set-btn" :disabled="picking" @click="onPick">
        {{ picking ? '正在导入…' : hasBackground ? '替换图片' : '选择图片' }}
      </button>
      <button v-if="hasBackground" class="set-btn" :disabled="picking" @click="onRemove">移除</button>
    </div>
    <p v-if="missing" class="set-hint bg-error">背景文件不可用，请重新选择。</p>
    <p v-else-if="error" class="set-hint bg-error">{{ error }}</p>

    <div class="set-row">
      <span>启用背景</span>
      <label class="set-toggle">
        <input type="checkbox" aria-label="启用背景" :checked="background.enabled" :disabled="!hasBackground" @change="onToggle(($event.target as HTMLInputElement).checked)" />
        <span class="set-toggle-slider"></span>
      </label>
    </div>

    <div class="set-row">
      <span>填充</span>
      <select class="set-select" aria-label="填充方式" :value="background.fit" :disabled="!hasBackground" @change="onFit">
        <option value="cover">铺满</option>
        <option value="contain">完整</option>
        <option value="tile">平铺</option>
      </select>
    </div>

    <div class="set-row">
      <span>焦点</span>
      <div class="bg-focus" role="group" aria-label="背景焦点">
        <button
          v-for="cell in FOCUS_CELLS"
          :key="cell.key"
          class="bg-focus__cell"
          :class="{ on: background.focusX === cell.x && background.focusY === cell.y }"
          :disabled="!hasBackground || background.fit === 'tile'"
          :aria-label="cell.label"
          @click="onFocus(cell.x, cell.y)"
        ></button>
      </div>
    </div>

    <div class="set-row">
      <span>暗化</span>
      <div class="set-range-wrap">
        <input type="range" aria-label="暗化" min="0" max="80" step="1" class="set-range" :value="background.dim" :disabled="!hasBackground" @input="onDim" @change="flush" />
        <span class="set-range-val">{{ background.dim }}%</span>
      </div>
    </div>

    <div class="set-row">
      <span>模糊</span>
      <div class="set-range-wrap">
        <input type="range" aria-label="模糊" min="0" max="30" step="1" class="set-range" :value="background.blur" :disabled="!hasBackground" @input="onBlur" @change="flush" />
        <span class="set-range-val">{{ background.blur }}px</span>
      </div>
    </div>

    <p class="set-hint">背景作用于工作台画布，区域缝隙与玻璃表面会透出；首页仍使用「设置 → 首页」里的项目封面。暗化过低会降低文字可读性。</p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useBackground, type BackgroundFit, type FocusStep } from '@worldsea/style-kit'
import { pickAndSaveWorkspaceBackground, removeWorkspaceBackground } from '@worldsea/entity-core/core'
import WorkspaceBackground from '../../layout/WorkspaceBackground.vue'

const { background, missing, setEnabled, setImage, clear, setFit, setFocus, setDim, setBlur, flush } = useBackground()
const picking = ref(false)
const error = ref('')
const hasBackground = computed(() => !!background.value.src)
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

async function onPick() {
  if (picking.value) return
  picking.value = true
  error.value = ''
  try {
    const oldPath = background.value.path
    const result = await pickAndSaveWorkspaceBackground()
    if (result === null) return
    if (!result.ok || !result.path || !result.src) {
      error.value = result.reason ?? '背景导入失败'
      return
    }
    setImage({ path: result.path, src: result.src })
    if (oldPath && oldPath !== result.path) void removeWorkspaceBackground(oldPath)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    picking.value = false
  }
}

function onRemove() {
  const oldPath = background.value.path
  clear()
  error.value = ''
  if (oldPath) void removeWorkspaceBackground(oldPath)
}

function onToggle(on: boolean) {
  setEnabled(on)
}
function onFit(event: Event) {
  setFit((event.target as HTMLSelectElement).value as BackgroundFit)
  flush()
}
function onFocus(x: FocusStep, y: FocusStep) {
  setFocus(x, y)
  flush()
}
function onDim(event: Event) {
  setDim(Number((event.target as HTMLInputElement).value))
}
function onBlur(event: Event) {
  setBlur(Number((event.target as HTMLInputElement).value))
}
</script>

<style scoped>
.bg-preview {
  position: relative;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border-radius: calc(var(--radius-md) * var(--sf-radius-scale));
  border: 1px solid var(--sf-panel-edge);
  background: var(--bg-app);
}
.bg-preview__empty {
  position: absolute; inset: 0; z-index: 1;
  display: flex; align-items: center; justify-content: center;
  font-size: var(--fs-xs); color: var(--text-muted);
}
.bg-actions { display: flex; gap: 6px; margin-top: 8px; }
.bg-actions .set-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.bg-error { color: var(--danger); }
.bg-focus {
  display: grid;
  grid-template-columns: repeat(3, 18px);
  grid-template-rows: repeat(3, 18px);
  gap: 3px;
}
.bg-focus__cell {
  padding: 0; cursor: pointer;
  border: 1px solid var(--sf-control-edge);
  border-radius: 2px;
  background: var(--sf-control-bg);
}
.bg-focus__cell.on { border-color: var(--accent); background: var(--accent-soft); }
.bg-focus__cell:disabled { opacity: 0.4; cursor: not-allowed; }
/* .set-select / .set-range* 仅在 AppearancePanel scoped 内定义，子组件不继承，故就地补一份 */
.set-select { padding: 4px 8px; font-size: var(--font-size-sm); border: 1px solid var(--border, var(--color-border)); border-radius: var(--radius-sm); background: var(--bg, var(--color-bg-surface)); color: var(--text-color); cursor: pointer; }
.set-select:focus { outline: none; border-color: var(--primary, var(--color-primary)); }
.set-range-wrap { display: flex; align-items: center; gap: 8px; }
.set-range { width: 100px; accent-color: var(--primary, var(--color-primary)); }
.set-range-val { font-size: var(--font-size-sm); color: var(--text-secondary); min-width: 28px; text-align: right; font-family: monospace; }
</style>
