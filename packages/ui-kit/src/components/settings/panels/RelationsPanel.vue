<template>
  <CardDeck :count="1" :flat="!!searchQuery" @change="(i) => emit('card-change', i)" ref="deckRef">
    <template #card="{ idx, cls }">
      <div class="set-card deck-card" :class="cls" :data-index="idx" v-show="match('关系 relation 自动 创建 实体')">
        <div class="sc-head">关系</div>
        <div class="set-row"><span>自动创建实体提示</span><label class="set-toggle"><input type="checkbox" v-model="store.autoCreateEntityEnabled" /><span class="set-toggle-slider"></span></label></div>
        <template v-if="store.autoCreateEntityEnabled">
          <div class="set-row set-row-sub"><span>关系选择器中触发</span><label class="set-toggle"><input type="checkbox" v-model="store.autoCreateSelectorEnabled" /><span class="set-toggle-slider"></span></label></div>
          <div class="set-row set-row-sub"><span>实体引用字段中触发</span><label class="set-toggle"><input type="checkbox" v-model="store.autoCreateEntityRefEnabled" /><span class="set-toggle-slider"></span></label></div>
          <div class="set-row set-row-sub"><span>图谱视图中触发</span><label class="set-toggle"><input type="checkbox" v-model="store.autoCreateGraphEnabled" /><span class="set-toggle-slider"></span></label></div>
        </template>
      </div>
    </template>
  </CardDeck>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { CardDeck } from '@worldsmith/ui-kit'
import { useSettingsStore } from '@worldsmith/entity-core'
import { matchKeywords } from '../utils'

const props = defineProps<{ searchQuery?: string }>()
const emit = defineEmits<{ 'card-change': [index: number] }>()

const store = useSettingsStore()

function match(keywords: string): boolean {
  return matchKeywords(props.searchQuery ?? '', keywords)
}

const deckRef = ref<InstanceType<typeof CardDeck> | null>(null)
defineExpose({ goToCard: (i: number) => deckRef.value?.goToCard(i) })
</script>

<style scoped>
.set-card { background: var(--content-bg, var(--color-bg-surface)); border-radius: var(--radius-md); padding: 14px 16px; box-shadow: 0 1px 6px rgba(0,0,0,0.06), 0 0 0 1px var(--border, var(--color-border)); }
.sc-head { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--text-tertiary, var(--color-text-tertiary)); margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
.set-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; font-size: var(--font-size-sm); gap: 12px; }
.set-row-sub { padding-left: 16px; }

.set-toggle { position: relative; display: inline-block; width: 36px; height: 20px; cursor: pointer; flex-shrink: 0; }
.set-toggle input { opacity: 0; width: 0; height: 0; position: absolute; }
.set-toggle-slider { position: absolute; inset: 0; background: var(--border, var(--color-border)); border-radius: 20px; transition: background 0.2s; }
.set-toggle-slider::before { content: ''; position: absolute; width: 14px; height: 14px; left: 3px; top: 3px; background: var(--color-bg-surface); border-radius: 50%; transition: transform 0.2s; }
.set-toggle input:checked + .set-toggle-slider { background: var(--primary, var(--color-primary)); }
.set-toggle input:checked + .set-toggle-slider::before { transform: translateX(16px); }
</style>
