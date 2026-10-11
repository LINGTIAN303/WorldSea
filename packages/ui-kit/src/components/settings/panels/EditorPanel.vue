<template>
  <CardDeck :count="3" :flat="!!searchQuery" @change="(i) => emit('card-change', i)" ref="deckRef">
    <template #card="{ idx, cls }">
      <div class="set-card deck-card" :class="cls" :data-index="idx"
        v-show="idx === 0 ? match('撤销 重做 undo redo 历史') : idx === 1 ? match('大纲 outline 内嵌 编辑') : match('光标 caret 平滑 smooth')">
        <!-- 撤销 / 重做 -->
        <template v-if="idx === 0">
          <div class="sc-head">撤销 / 重做</div>
          <div class="set-row"><span>撤销历史条数</span><input type="number" class="set-input set-input-sm" :value="store.undoHistoryLimit" min="5" max="100" @input="onUndoLimitChange" /></div>
          <div class="set-row"><span>多步重做</span><label class="set-toggle"><input type="checkbox" :checked="store.multiStepRedo" @change="store.multiStepRedo = ($event.target as HTMLInputElement).checked" /><span class="set-toggle-slider"></span></label></div>
          <div class="set-hint">关闭后 {{ formatKeyForDisplay('ctrl') }}+Y 仅重做一步</div>
        </template>
        <!-- 大纲 -->
        <template v-else-if="idx === 1">
          <div class="sc-head">大纲</div>
          <div class="set-row"><span>内嵌编辑</span><label class="set-toggle"><input type="checkbox" v-model="store.outlineInlineEdit" /><span class="set-toggle-slider"></span></label></div>
          <div class="set-hint">启用后，大纲节点详情面板底部显示文本编辑区</div>
        </template>
        <!-- 光标 -->
        <template v-else>
          <div class="sc-head">光标</div>
          <div class="set-row"><span>平滑光标</span><label class="set-toggle"><input type="checkbox" v-model="store.smoothCaretEnabled" /><span class="set-toggle-slider"></span></label></div>
          <template v-if="store.smoothCaretEnabled">
            <div class="set-row"><span>动画时长 (ms)</span><input type="number" class="set-input set-input-sm" v-model.number="store.smoothCaretDuration" min="50" max="500" step="10" /></div>
            <div class="set-row"><span>光标样式</span><select v-model="store.smoothCaretVariant" class="set-select"><option value="line">竖线</option><option value="block">方块</option><option value="underline">下划线</option></select></div>
          </template>
        </template>
      </div>
    </template>
  </CardDeck>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useSettingsStore } from '@worldsea/entity-core'
import { formatKeyForDisplay, CardDeck } from '@worldsea/ui-kit'
import { matchKeywords } from '../utils'

const props = defineProps<{ searchQuery?: string }>()
const emit = defineEmits<{ dirty: []; 'card-change': [index: number] }>()

// ── 叠放翻卡：复用通用 CardDeck（翻卡逻辑/样式已下沉 ui-kit useCardDeck + CardDeck.vue） ──
const deckRef = ref<InstanceType<typeof CardDeck> | null>(null)
defineExpose({ goToCard: (i: number) => deckRef.value?.goToCard(i) })

const store = useSettingsStore()

function match(keywords: string): boolean {
  return matchKeywords(props.searchQuery ?? '', keywords)
}

function onUndoLimitChange(e: Event) {
  const val = Number((e.target as HTMLInputElement).value)
  if (val >= 5 && val <= 100) {
    store.undoHistoryLimit = val
    emit('dirty')
  }
}
</script>

<style scoped>
/* 基座样式（.set-card/.sc-head/.set-row/.set-toggle/.set-hint）已收敛至 ui-kit settings-panels.css，此处仅保留面板私有样式 */

.set-input { padding: 4px 8px; font-size: var(--font-size-sm); border: 1px solid var(--border, var(--color-border)); border-radius: var(--radius-sm); background: var(--bg, var(--color-bg-surface)); color: var(--text-color); }
.set-input:focus { outline: none; border-color: var(--primary, var(--color-primary)); }
.set-input-sm { width: 72px; text-align: center; }
.set-select { padding: 4px 8px; font-size: var(--font-size-sm); border: 1px solid var(--border, var(--color-border)); border-radius: var(--radius-sm); background: var(--bg, var(--color-bg-surface)); color: var(--text-color); cursor: pointer; }
.set-select:focus { outline: none; border-color: var(--primary, var(--color-primary)); }
</style>
