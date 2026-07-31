<template>
  <Teleport to="body">
    <Transition name="corrector">
      <div v-if="show" class="corrector-overlay" @click.self="onOverlayClick">
        <div class="corrector-panel">
          <div class="corrector__header">
            <h2 class="corrector__title">导出校正器</h2>
            <button class="corrector__close" @click="emit('close')">
              <WsIcon name="close" size="xs" />
            </button>
          </div>

          <div class="corrector__body">
            <div class="corrector__left">
              <div class="preview-canvas-wrap">
                <canvas ref="previewCanvasRef" />
                <div v-if="isRendering" class="preview-loading">渲染中...</div>
              </div>
              <div class="preview-info">
                <span>{{ previewWidth }} × {{ previewHeight }}px</span>
                <span class="preview-sep">·</span>
                <span class="preview-dpr">{{ devicePixelRatio }}x</span>
                <span v-if="isFixedMode" class="preview-tag">固定尺寸</span>
                <span v-else class="preview-tag">自适应</span>
                <button v-if="gifMode" class="preview-play-btn" @click="playGifPreview">▶ 预览动画</button>
              </div>
            </div>

            <ExportControlPanel
              :config="localConfig"
              :is-fixed-mode="isFixedMode"
              :aspect-ratios="aspectRatios"
              :writing-mode="writingMode"
              :base-font-size="baseFontSize"
              @select-ratio="selectRatio"
              @width-input="onWidthInput"
              @height-input="onHeightInput"
              @toggle-shadow="toggleShadow"
            />
          </div>

          <ExportActionBar
            :gif-mode="gifMode"
            :output-format="localConfig.outputFormat"
            @manual-render="manualRender"
            @reset="resetConfig"
            @save="saveConfig"
            @export-png="exportPng"
            @export-gif="exportGif"
          />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import WsIcon from '../../ui/WsIcon.vue'
import type { ManuscriptBlock, ExportCorrectorConfig } from '@agent/index'
import ExportControlPanel from './export-corrector/ExportControlPanel.vue'
import ExportActionBar from './export-corrector/ExportActionBar.vue'
import { useExportCorrector, aspectRatios } from './export-corrector/useExportCorrector'

const props = withDefaults(defineProps<{
  show: boolean
  block: ManuscriptBlock
  modelValue: ExportCorrectorConfig
  gifMode?: boolean
  writingMode: 'horizontal' | 'vertical'
  baseFontSize: number
  textColor: string
  bgColor: string | undefined
  bgImageUrl: string | null
  textShadow: string
}>(), {
  gifMode: false,
  bgColor: undefined,
  bgImageUrl: null,
})

const emit = defineEmits<{
  'update:modelValue': [value: ExportCorrectorConfig]
  'close': []
  'export:png': [config: ExportCorrectorConfig]
  'export:gif': [config: ExportCorrectorConfig]
}>()

// 预览 canvas 引用，由 composable 直接读写
const previewCanvasRef = ref<HTMLCanvasElement | null>(null)

const {
  localConfig,
  isRendering,
  devicePixelRatio,
  isFixedMode,
  previewWidth,
  previewHeight,
  manualRender,
  selectRatio,
  onWidthInput,
  onHeightInput,
  toggleShadow,
  resetConfig,
  saveConfig,
  onOverlayClick,
  exportPng,
  exportGif,
  playGifPreview,
} = useExportCorrector(props, emit, previewCanvasRef)
</script>

<style scoped>
.corrector-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(4px);
}
.corrector-panel {
  background: var(--modal-bg, #1a1a2e);
  border: 1px solid var(--modal-border, rgba(255,255,255,0.1));
  border-radius: 12px;
  width: 95vw;
  max-width: 1200px;
  height: 88vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 16px 64px rgba(0,0,0,0.5);
}
.corrector__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  border-bottom: 1px solid rgba(255,255,255,0.08);
}
.corrector__title {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
}
.corrector__close {
  width: 28px; height: 28px;
  border: none; background: transparent;
  border-radius: 6px;
  cursor: pointer;
  color: var(--text-tertiary, #888);
  display: flex; align-items: center; justify-content: center;
}
.corrector__close:hover {
  background: rgba(255,255,255,0.1);
  color: var(--text-primary, #fff);
}
.corrector__body {
  flex: 1;
  display: flex;
  gap: 0;
  overflow: hidden;
}
.corrector__left {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 20px;
  min-width: 0;
}
.preview-canvas-wrap {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  min-height: 200px;
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 8px;
  background: var(--bg-tertiary, #12121e);
  overflow: hidden;
}
.preview-canvas-wrap canvas {
  display: block;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.preview-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--text-tertiary, #888);
  background: rgba(0,0,0,0.4);
}
.preview-info {
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-tertiary, #888);
  display: flex;
  align-items: center;
  gap: 6px;
}
.preview-sep { opacity: 0.4; }
.preview-tag {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(255,255,255,0.06);
}
.preview-play-btn {
  font-size: 11px;
  padding: 2px 10px;
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 4px;
  background: rgba(255,255,255,0.06);
  cursor: pointer;
  color: inherit;
}
.preview-play-btn:hover {
  background: rgba(255,255,255,0.12);
}

.corrector-enter-active, .corrector-leave-active {
  transition: opacity 0.2s ease;
}
.corrector-enter-from, .corrector-leave-to {
  opacity: 0;
}
</style>
