<template>
  <!-- 字体分层（卡 4）：界面字号档位 + 各层字体/变体（未设置则跟随上层默认值） -->
  <div class="sc-head">字体分层</div>
  <div class="set-hint" style="margin-bottom:8px">每层字体可独立设置，未设置则跟随上层默认值</div>
  <div class="sf-scale-row">
    <span class="sf-scale-label">界面字号</span>
    <div class="sf-scale-btns" role="group" aria-label="界面字号档位">
      <button class="sf-scale-btn" :class="{ on: Math.abs(fontStore.uiScale - 0.92) < 0.001 }" @click="fontStore.setUiScale(0.92)">紧凑</button>
      <button class="sf-scale-btn" :class="{ on: Math.abs(fontStore.uiScale - 1) < 0.001 }" @click="fontStore.setUiScale(1)">标准</button>
      <button class="sf-scale-btn" :class="{ on: Math.abs(fontStore.uiScale - 1.08) < 0.001 }" @click="fontStore.setUiScale(1.08)">宽松</button>
    </div>
    <input type="range" class="set-range" min="0.85" max="1.15" step="0.01" :value="fontStore.uiScale" :aria-label="'界面字号微调'" @input="fontStore.setUiScale(Number(($event.target as HTMLInputElement).value))" />
    <span class="set-range-val">{{ Math.round(fontStore.uiScale * 100) }}%</span>
  </div>
  <div v-for="fl in FONT_LAYERS" :key="fl.key" class="sf-layer-row">
    <div class="sf-layer-main">
      <span class="sf-layer-label">{{ fl.label }}<span class="set-hint-inline">{{ fl.hint }}</span></span>
      <div class="sf-layer-controls">
        <select class="set-select" :value="fontStore.prefs[fl.key].family" @change="onFontLayerChange(fl.key, ($event.target as HTMLSelectElement).value)">
          <option value="">默认</option>
          <option v-for="e in fontLibraryEntries" :key="e.id" :value="e.family">{{ e.displayName }}</option>
        </select>
        <button class="sf-reset-btn" v-if="fontStore.prefs[fl.key].family" @click="fontStore.resetLayer(fl.key)" title="重置为默认">↺</button>
      </div>
    </div>
    <div v-if="fontStore.prefs[fl.key].family && getVariantsForFamily(fontStore.prefs[fl.key].family).length > 1" class="sf-layer-variants">
      <select class="set-select set-select--sm" :value="variantKey(fontStore.prefs[fl.key])" @change="onVariantChange(fl.key, ($event.target as HTMLSelectElement).value)">
        <option v-for="v in getVariantsForFamily(fontStore.prefs[fl.key].family)" :key="`${v.weight}-${v.style}`" :value="`${v.weight}-${v.style}`">{{ weightLabel(v.weight) }} {{ v.style === 'italic' ? '斜体' : '' }}</option>
      </select>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useFontStore, type FontLayer } from '@worldsea/entity-core'
import { useFontLibraryStore, type FontVariantEntry } from '@worldsea/font-kit'
import { FONT_LAYERS, weightLabel } from '../../utils'

const fontStore = useFontStore()
const libraryStore = useFontLibraryStore()
const fontLibraryEntries = computed(() => libraryStore.getAllEntries())

function onFontLayerChange(layer: FontLayer, family: string) {
  fontStore.setLayerFont(layer, family)
}

function getVariantsForFamily(family: string): FontVariantEntry[] {
  const entry = fontLibraryEntries.value.find(e => e.family === family)
  return entry?.variants ?? []
}

function variantKey(pref: { weight: number; style: string }): string {
  return `${pref.weight}-${pref.style}`
}

function onVariantChange(layer: FontLayer, key: string) {
  const [w, s] = key.split('-')
  fontStore.setLayerVariant(layer, Number(w), s)
}
</script>
