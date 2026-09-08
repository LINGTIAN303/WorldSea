<!--
  MessageBlocks：Agent 消息内嵌 Block 组件容器
  渲染除 manuscript 外的所有 Block 类型（table/choice/code/entity-card/alert/stat/list/progress/comparison/timeline/image/video/accordion）。
  BlockManuscript 由父组件单独渲染（因其布局位置与正文不同，需贴顶）。
-->
<template>
  <BlockTable v-for="block in tableBlocks" :key="block.id" :block="block" @action="emit('blockAction', $event)" />
  <BlockChoice v-for="block in choiceBlocks" :key="block.id" :block="block" @action="emit('blockAction', $event)" />
  <BlockCode v-for="block in codeBlocks" :key="block.id" :block="block" @action="emit('blockAction', $event)" />
  <BlockEntityCard v-for="block in entityCardBlocks" :key="block.id" :block="block" @action="emit('blockAction', $event)" />
  <BlockAlert v-for="block in alertBlocks" :key="block.id" :block="block" @action="emit('blockAction', $event)" />
  <BlockStat v-for="block in statBlocks" :key="block.id" :block="block" @action="emit('blockAction', $event)" />
  <BlockList v-for="block in listBlocks" :key="block.id" :block="block" @action="emit('blockAction', $event)" />
  <BlockProgress v-for="block in progressBlocks" :key="block.id" :block="block" @action="emit('blockAction', $event)" />
  <BlockComparison v-for="block in comparisonBlocks" :key="block.id" :block="block" @action="emit('blockAction', $event)" />
  <BlockTimeline v-for="block in timelineBlocks" :key="block.id" :block="block" @action="emit('blockAction', $event)" />
  <BlockImage v-for="block in imageBlocks" :key="block.id" :block="block" @action="emit('blockAction', $event)" />
  <BlockVideo v-for="block in videoBlocks" :key="block.id" :block="block" @action="emit('blockAction', $event)" />
  <BlockAccordion v-for="block in accordionBlocks" :key="block.id" :block="block" @action="emit('blockAction', $event)" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import BlockTable from '../blocks/BlockTable.vue'
import BlockChoice from '../blocks/BlockChoice.vue'
import BlockCode from '../blocks/BlockCode.vue'
import BlockEntityCard from '../blocks/BlockEntityCard.vue'
import BlockAlert from '../blocks/BlockAlert.vue'
import BlockStat from '../blocks/BlockStat.vue'
import BlockList from '../blocks/BlockList.vue'
import BlockProgress from '../blocks/BlockProgress.vue'
import BlockComparison from '../blocks/BlockComparison.vue'
import BlockTimeline from '../blocks/BlockTimeline.vue'
import BlockImage from '../blocks/BlockImage.vue'
import BlockVideo from '../blocks/BlockVideo.vue'
import BlockAccordion from '../blocks/BlockAccordion.vue'
import type { BlockActionEvent } from './types'

const props = defineProps<{
  /** 消息的全部 blocks（内部会按 type 过滤渲染，manuscript 由父组件处理） */
  blocks?: import('@worldsea/agent-runtime').MessageBlock[]
}>()

const emit = defineEmits<{
  (e: 'blockAction', event: BlockActionEvent): void
}>()

const blockList = computed(() => props.blocks || [])
const tableBlocks = computed(() => blockList.value.filter(b => b.type === 'table'))
const choiceBlocks = computed(() => blockList.value.filter(b => b.type === 'choice'))
const codeBlocks = computed(() => blockList.value.filter(b => b.type === 'code'))
const entityCardBlocks = computed(() => blockList.value.filter(b => b.type === 'entity-card'))
const alertBlocks = computed(() => blockList.value.filter(b => b.type === 'alert'))
const statBlocks = computed(() => blockList.value.filter(b => b.type === 'stat'))
const listBlocks = computed(() => blockList.value.filter(b => b.type === 'list'))
const progressBlocks = computed(() => blockList.value.filter(b => b.type === 'progress'))
const comparisonBlocks = computed(() => blockList.value.filter(b => b.type === 'comparison'))
const timelineBlocks = computed(() => blockList.value.filter(b => b.type === 'timeline'))
const imageBlocks = computed(() => blockList.value.filter(b => b.type === 'image'))
const videoBlocks = computed(() => blockList.value.filter(b => b.type === 'video'))
const accordionBlocks = computed(() => blockList.value.filter(b => b.type === 'accordion'))
</script>
