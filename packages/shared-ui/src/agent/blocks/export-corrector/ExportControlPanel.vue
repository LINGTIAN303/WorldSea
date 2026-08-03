<template>
  <div class="corrector__right">
    <div class="ctrl-section">
      <h4 class="ctrl-title">尺寸</h4>
      <div class="ctrl-mode-toggle">
        <button :class="['ctrl-btn-sm', { active: !isFixedMode }]" @click="config.dimensionMode = 'auto'">Auto</button>
        <button :class="['ctrl-btn-sm', { active: isFixedMode }]" @click="config.dimensionMode = 'fixed'">Fixed</button>
      </div>
      <div v-if="isFixedMode" class="ctrl-ratios">
        <button
          v-for="r in aspectRatios"
          :key="r.label"
          :class="['ctrl-btn-ratio', { active: config.aspectRatio === r.value }]"
          @click="emit('select-ratio', r.value)"
        >{{ r.label }}</button>
      </div>
      <div v-if="isFixedMode" class="ctrl-dim-inputs">
        <label class="ctrl-dim">宽 <input type="number" :value="config.width ?? ''" @input="emit('width-input', $event)" min="100" max="2000" /></label>
        <label class="ctrl-dim">高 <input type="number" :value="config.height ?? ''" @input="emit('height-input', $event)" min="100" max="2000" /></label>
      </div>
      <label v-if="isFixedMode" class="ctrl-row">圆角
        <input type="range" min="0" max="60" :value="config.borderRadius" @input="config.borderRadius = Number(($event.target as HTMLInputElement).value)" />
        <span class="ctrl-val">{{ config.borderRadius }}px</span>
      </label>
    </div>

    <div class="ctrl-section">
      <h4 class="ctrl-title">布局</h4>
      <label class="ctrl-row">内边距
        <input type="range" min="0" max="80" :value="config.padding" @input="config.padding = Number(($event.target as HTMLInputElement).value)" />
        <span class="ctrl-val">{{ config.padding }}px</span>
      </label>
      <label v-if="writingMode === 'horizontal'" class="ctrl-row">最大宽度
        <input type="range" min="200" max="1200" :value="config.maxWidth" @input="config.maxWidth = Number(($event.target as HTMLInputElement).value)" />
        <span class="ctrl-val">{{ config.maxWidth }}px</span>
      </label>
      <label v-else class="ctrl-row">列高
        <input type="range" min="200" max="2000" :value="config.maxWidth" @input="config.maxWidth = Number(($event.target as HTMLInputElement).value)" />
        <span class="ctrl-val">{{ config.maxWidth }}px</span>
      </label>
    </div>

    <div class="ctrl-section">
      <h4 class="ctrl-title">背景</h4>
      <label class="ctrl-row">适配
        <select :value="config.backgroundFit" @change="config.backgroundFit = ($event.target as HTMLSelectElement).value as ExportCorrectorConfig['backgroundFit']">
          <option value="cover">Cover</option>
          <option value="contain">Contain</option>
          <option value="stretch">Stretch</option>
        </select>
      </label>
      <label class="ctrl-row">颜色覆盖
        <input type="color" :value="config.bgColorOverride || '#000000'" @input="config.bgColorOverride = ($event.target as HTMLInputElement).value" />
        <button class="ctrl-btn-xs" @click="config.bgColorOverride = null">继承</button>
      </label>
    </div>

    <div class="ctrl-section">
      <h4 class="ctrl-title">文字</h4>
      <label class="ctrl-row">字号
        <input type="range" min="10" max="72" :value="config.fontSizeOverride ?? baseFontSize" @input="config.fontSizeOverride = Number(($event.target as HTMLInputElement).value)" />
        <span class="ctrl-val">{{ config.fontSizeOverride ?? baseFontSize }}px</span>
        <button v-if="config.fontSizeOverride" class="ctrl-btn-xs" @click="config.fontSizeOverride = null">继承</button>
      </label>
      <label class="ctrl-row">行高
        <input type="range" min="1" max="4" step="0.1" :value="config.lineHeightOverride ?? 2" @input="config.lineHeightOverride = Number(($event.target as HTMLInputElement).value)" />
        <span class="ctrl-val">{{ config.lineHeightOverride ?? '继承' }}</span>
        <button v-if="config.lineHeightOverride" class="ctrl-btn-xs" @click="config.lineHeightOverride = null">继承</button>
      </label>
      <div class="ctrl-row">
        <span>阴影</span>
        <label class="ctrl-toggle">
          <input type="checkbox" :checked="!!config.textShadow" @change="emit('toggle-shadow', $event)" />
          {{ config.textShadow ? '已启用' : '继承' }}
        </label>
      </div>
      <div class="ctrl-row">
        <span>对齐</span>
        <div class="ctrl-align-toggle">
          <button :class="['ctrl-btn-xs', { active: config.textAlign === 'left' }]" @click="config.textAlign = 'left'">左</button>
          <button :class="['ctrl-btn-xs', { active: config.textAlign === 'center' }]" @click="config.textAlign = 'center'">中</button>
          <button :class="['ctrl-btn-xs', { active: config.textAlign === 'right' }]" @click="config.textAlign = 'right'">右</button>
        </div>
      </div>
      <label class="ctrl-row">字间距
        <input type="range" min="0" max="0.5" step="0.01" :value="config.letterSpacingOverride ?? 0" @input="config.letterSpacingOverride = Number(($event.target as HTMLInputElement).value)" />
        <span class="ctrl-val">{{ config.letterSpacingOverride != null ? config.letterSpacingOverride.toFixed(2) + 'em' : '继承' }}</span>
        <button v-if="config.letterSpacingOverride != null" class="ctrl-btn-xs" @click="config.letterSpacingOverride = null">继承</button>
      </label>
    </div>

    <div class="ctrl-section">
      <h4 class="ctrl-title">水印</h4>
      <input class="ctrl-input" type="text" placeholder="右下角叠加文字" :value="config.watermark" @input="config.watermark = ($event.target as HTMLInputElement).value" />
    </div>

    <div class="ctrl-section">
      <h4 class="ctrl-title">导出</h4>
      <div class="ctrl-row">
        <span>格式</span>
        <select :value="config.outputFormat" @change="config.outputFormat = ($event.target as HTMLSelectElement).value as ExportCorrectorConfig['outputFormat']">
          <option value="png">PNG</option>
          <option value="jpeg">JPEG</option>
          <option value="webp">WebP</option>
        </select>
      </div>
      <label v-if="config.outputFormat !== 'png'" class="ctrl-row">质量
        <input type="range" min="0.1" max="1" step="0.02" :value="config.outputQuality" @input="config.outputQuality = Number(($event.target as HTMLInputElement).value)" />
        <span class="ctrl-val">{{ Math.round(config.outputQuality * 100) }}%</span>
      </label>
      <div class="ctrl-row">
        <span>倍率</span>
        <div class="ctrl-align-toggle">
          <button :class="['ctrl-btn-xs', { active: config.outputScale === 1 }]" @click="config.outputScale = 1">1×</button>
          <button :class="['ctrl-btn-xs', { active: config.outputScale === 2 }]" @click="config.outputScale = 2">2×</button>
          <button :class="['ctrl-btn-xs', { active: config.outputScale === 3 }]" @click="config.outputScale = 3">3×</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ExportCorrectorConfig } from '@worldsmith/agent-runtime'

defineProps<{
  config: ExportCorrectorConfig
  isFixedMode: boolean
  aspectRatios: { label: string; value: number | null }[]
  writingMode: 'horizontal' | 'vertical'
  baseFontSize: number
}>()

const emit = defineEmits<{
  'select-ratio': [value: number | null]
  'width-input': [event: Event]
  'height-input': [event: Event]
  'toggle-shadow': [event: Event]
}>()
</script>

<style scoped>
.corrector__right {
  width: 320px;
  flex-shrink: 0;
  overflow-y: auto;
  padding: 16px 20px;
  border-left: 1px solid rgba(255,255,255,0.08);
}
.ctrl-section {
  margin-bottom: 20px;
}
.ctrl-title {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  opacity: 0.5;
  margin: 0 0 10px;
}
.ctrl-mode-toggle {
  display: flex;
  gap: 4px;
  margin-bottom: 8px;
}
.ctrl-btn-sm {
  flex: 1;
  padding: 4px 8px;
  font-size: 11px;
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  color: inherit;
  font-family: inherit;
}
.ctrl-btn-sm.active {
  background: rgba(255,255,255,0.12);
  border-color: rgba(255,255,255,0.3);
}
.ctrl-ratios {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 8px;
}
.ctrl-btn-ratio {
  padding: 3px 8px;
  font-size: 11px;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  color: inherit;
  font-family: inherit;
}
.ctrl-btn-ratio.active {
  background: rgba(255,255,255,0.15);
  border-color: rgba(255,255,255,0.3);
}
.ctrl-dim-inputs {
  display: flex;
  gap: 8px;
}
.ctrl-dim {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
}
.ctrl-dim input {
  width: 70px;
  padding: 3px 6px;
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 4px;
  background: rgba(255,255,255,0.04);
  color: inherit;
  font-size: 12px;
  font-family: inherit;
}
.ctrl-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  margin-bottom: 6px;
}
.ctrl-row input[type="range"] {
  flex: 1;
  max-width: 120px;
  height: 4px;
  accent-color: var(--color-accent, #6c8cff);
}
.ctrl-row select {
  padding: 2px 6px;
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 4px;
  background: rgba(255,255,255,0.04);
  color: inherit;
  font-size: 12px;
  font-family: inherit;
}
.ctrl-row input[type="color"] {
  width: 28px;
  height: 22px;
  padding: 0;
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
}
.ctrl-val {
  font-size: 11px;
  opacity: 0.6;
  min-width: 30px;
}
.ctrl-btn-xs {
  font-size: 10px;
  padding: 1px 6px;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 3px;
  background: transparent;
  cursor: pointer;
  color: inherit;
  font-family: inherit;
}
.ctrl-btn-xs:hover {
  background: rgba(255,255,255,0.08);
}
.ctrl-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
}
.ctrl-align-toggle {
  display: flex;
  gap: 2px;
}
.ctrl-align-toggle .ctrl-btn-xs.active {
  background: rgba(255,255,255,0.15);
  border-color: rgba(255,255,255,0.3);
}
.ctrl-input {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 4px;
  background: rgba(255,255,255,0.04);
  color: inherit;
  font-size: 12px;
  font-family: inherit;
  box-sizing: border-box;
}
</style>
