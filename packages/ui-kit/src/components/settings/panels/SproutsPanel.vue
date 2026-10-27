<template>
  <!-- 芽管理面板（薄壳，2026-10-13 拆层）：CardDeck 包装 + SproutsCardContent 内容。
       拆层动机：「插件」分区需要多卡叠放（外部插件卡 + 芽管理卡），CardDeck 归分区容器持有；
       本组件保持对外 API 不变（props / card-change / expose），SettingsDialog 兼容层无感。 -->
  <CardDeck :count="1" :flat="!!searchQuery" @change="(i) => emit('card-change', i)" ref="deckRef">
    <template #card="{ idx, cls }">
      <SproutsCardContent v-if="idx === 0" :class="cls" :search-query="searchQuery" @dirty="emit('dirty')" ref="contentRef" />
    </template>
  </CardDeck>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { CardDeck } from '@worldsea/ui-kit'
import SproutsCardContent from './SproutsCardContent.vue'

defineProps<{ searchQuery?: string }>()
const emit = defineEmits<{ dirty: []; 'card-change': [index: number] }>()

const deckRef = ref<InstanceType<typeof CardDeck> | null>(null)
const contentRef = ref<InstanceType<typeof SproutsCardContent> | null>(null)

defineExpose({
  resetSproutSearch: () => contentRef.value?.resetSproutSearch(),
  goToCard: (i: number) => deckRef.value?.goToCard(i),
})
</script>
