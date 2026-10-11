<template>
  <CardDeck :count="1" :flat="!!searchQuery" @change="(i) => emit('card-change', i)" ref="deckRef">
    <template #card="{ idx, cls }">
      <div class="set-card deck-card" :class="cls" :data-index="idx" v-show="match('关系 relation 自动 创建 实体')">
        <div class="sc-head">关系</div>
        <div class="set-row"><span>自动创建实体提示</span><label class="set-toggle"><input type="checkbox" v-model="store.autoCreateEntityEnabled" /><span class="set-toggle-slider"></span></label></div>
        <template v-if="store.autoCreateEntityEnabled">
          <div class="set-row set-row-sub"><span>关系选择器中触发</span><label class="set-toggle"><input type="checkbox" v-model="store.autoCreateSelectorEnabled" /><span class="set-toggle-slider"></span></label></div>
          <div class="set-row set-row-sub"><span>实体引用字段中触发</span><label class="set-toggle"><input type="checkbox" v-model="store.autoCreateEntityRefEnabled" /><span class="set-toggle-slider"></span></label></div>
        </template>
      </div>
    </template>
  </CardDeck>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { CardDeck } from '@worldsea/ui-kit'
import { useSettingsStore } from '@worldsea/entity-core'
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
/* 基座样式（.set-card/.sc-head/.set-row/.set-toggle/.set-hint）已收敛至 ui-kit settings-panels.css，此处仅保留面板私有样式 */
.set-row-sub { padding-left: 16px; }

</style>
