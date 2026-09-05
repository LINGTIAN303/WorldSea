<template>
  <CardDeck :count="1" :flat="!!searchQuery" @change="(i) => emit('card-change', i)" ref="deckRef">
    <template #card="{ idx, cls }">
      <div class="set-card deck-card" :class="cls" :data-index="idx" v-show="match('语音 识别 输入 麦克风 voice')">
        <div class="sc-head">语音输入</div>
        <div class="set-row">
          <span>识别语言</span>
          <select v-model="store.voiceLang" class="set-select" aria-label="语音识别语言">
            <option value="zh-CN">中文（普通话）</option>
            <option value="en-US">English</option>
            <option value="auto">自动检测</option>
          </select>
        </div>
        <div class="set-row">
          <span>连续识别</span>
          <label class="set-toggle">
            <input type="checkbox" v-model="store.voiceContinuous" />
            <span class="set-toggle-slider"></span>
          </label>
        </div>
        <p class="set-hint">开启后可持续说话，手动点击麦克风停止；关闭时单次话语后自动停止。</p>
        <p class="set-hint">语音识别需浏览器支持（Chrome / Edge / 桌面端 WebView2），仅作用于输入框麦克风转文字。</p>
      </div>
    </template>
  </CardDeck>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { CardDeck } from '@worldsmith/ui-kit'
import { useSettingsStore } from '@worldsmith/entity-core'

const props = withDefaults(defineProps<{ searchQuery?: string }>(), { searchQuery: '' })
const emit = defineEmits<{ 'card-change': [index: number] }>()

const store = useSettingsStore()
const deckRef = ref<InstanceType<typeof CardDeck> | null>(null)
defineExpose({ goToCard: (i: number) => deckRef.value?.goToCard(i) })

function match(keywords: string): boolean {
  if (!props.searchQuery) return true
  const q = props.searchQuery.toLowerCase()
  return keywords.toLowerCase().split(/\s+/).some((k) => q.includes(k))
}
</script>

<style scoped>
/* 基座样式（.set-card/.sc-head/.set-row/.set-toggle/.set-hint）已收敛至 ui-kit settings-panels.css，此处仅保留面板私有样式 */
.set-select {
  background: var(--content-bg, var(--color-bg-surface));
  border: 1px solid var(--border, var(--color-border));
  border-radius: var(--radius-sm, 8px);
  color: var(--text-color, var(--color-text));
  padding: 4px 8px;
  font-size: var(--font-size-sm);
}
</style>
