<template>
  <CardDeck :count="1" :flat="!!searchQuery" @change="(i) => emit('card-change', i)" ref="deckRef">
    <template #card="{ idx, cls }">
      <div class="set-card deck-card" :class="cls" :data-index="idx" v-show="match('编辑面板 悬浮 拖拽 定位 跟随 卡片 白板 大纲 面板 inspector follow fixed free drag board outline')">
        <div class="sc-head">白板编辑面板</div>
        <div class="set-row">
          <span>定位方式</span>
          <select v-model="inspectorMode" class="obp-select">
            <option value="follow">跟随卡片（默认）</option>
            <option value="fixed">固定左上角</option>
            <option value="free">悬浮（可拖拽）</option>
          </select>
        </div>
        <p class="set-hint">
          跟随卡片：选中容器时编辑面板贴在卡片左侧、与卡片顶部平行；左侧空间不足时自动贴到卡片右侧。
        </p>
        <p class="set-hint">
          固定左上角：始终停在画布左上角（右侧有节点侧边栏，放右上会被覆盖）。
        </p>
        <p class="set-hint">
          悬浮：拖动标题栏可把面板放到视口内任意位置；点击画布空白处不会关闭面板。
        </p>
      </div>
    </template>
  </CardDeck>
</template>

<script setup lang="ts">
/**
 * OutlineBoardPanel — 设置「大纲」Tab（2026-10-18）。
 *
 * 现存唯一设置：**白板容器编辑面板的定位方式**（跟随卡片 / 固定右上角）。
 * 选择经 `useOutlineBoardPrefs` 持久化（localStorage），设置面板与白板共享同一份模块级状态，
 * 改完立即生效——因此**不上报 dirty**（没有「待保存」语义）。
 */
import { ref } from 'vue'
import { CardDeck } from '@worldsea/ui-kit'
import { useOutlineBoardPrefs } from '@/world/plugins/outline/board/composables/useOutlineBoardPrefs'

const props = withDefaults(defineProps<{ searchQuery?: string }>(), { searchQuery: '' })
const emit = defineEmits<{ dirty: []; 'card-change': [index: number] }>()

const { inspectorMode } = useOutlineBoardPrefs()
const deckRef = ref<InstanceType<typeof CardDeck> | null>(null)
defineExpose({ goToCard: (i: number) => deckRef.value?.goToCard(i) })

function match(keywords: string): boolean {
  if (!props.searchQuery) return true
  const q = props.searchQuery.trim().toLowerCase()
  return !q || keywords.toLowerCase().includes(q)
}
</script>

<style scoped>
.obp-select {
  height: 26px;
  padding: 0 6px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-xs);
  background: var(--input-bg);
  color: var(--text-color);
  font-size: var(--font-size-xs);
  font-family: inherit;
}
</style>
