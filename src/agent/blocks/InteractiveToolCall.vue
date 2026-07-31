<template>
  <!-- 交互式工具调用分发器：按 interactiveType 路由到对应子组件 -->
  <InteractiveChoice
    v-if="interactiveType === 'choice'"
    :tc="tc"
    @block-action="emit('block-action', $event)"
  />
  <InteractiveDisplay
    v-else-if="interactiveType === 'display'"
    :tc="tc"
    @block-action="emit('block-action', $event)"
  />
  <InteractiveWaiting
    v-else-if="interactiveType === 'waiting'"
    :tc="tc"
  />
  <InteractiveConfirm
    v-else-if="interactiveType === 'confirm'"
    :tc="tc"
    @tool-confirm="emit('tool-confirm', $event)"
  />
  <InteractiveNormal v-else :tc="tc" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import InteractiveChoice from './interactive-tool/InteractiveChoice.vue'
import InteractiveDisplay from './interactive-tool/InteractiveDisplay.vue'
import InteractiveWaiting from './interactive-tool/InteractiveWaiting.vue'
import InteractiveConfirm from './interactive-tool/InteractiveConfirm.vue'
import InteractiveNormal from './interactive-tool/InteractiveNormal.vue'
import type { ToolCallView } from '../composables/useAgent'
import type { BlockActionEvent } from './index'

const props = defineProps<{
  tc: ToolCallView
}>()

const emit = defineEmits<{
  'block-action': [event: BlockActionEvent]
  'tool-confirm': [event: { toolId: string; approved: boolean }]
}>()

/** 交互类型：默认 none 走普通型分支 */
const interactiveType = computed(() => props.tc.interactiveType || 'none')
</script>
