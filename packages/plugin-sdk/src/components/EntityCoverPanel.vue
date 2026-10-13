<template>
  <div class="ecp">
    <ImageField
      :value="entity.coverImage"
      :editing="true"
      :entity-id="entity.id"
      :cover-position="entity.coverPosition || '50% 50%'"
      :cover-zoom="entity.coverZoom || 1"
      @update:value="onCover"
      @update:cover-position="onPosition"
      @update:cover-zoom="onZoom"
    />
    <p class="ecp-hint">封面用于卡片与详情头图；修改即时保存</p>
  </div>
</template>

<script setup lang="ts">
/**
 * 实体封面面板（详情「封面」Tab 内容件，2026-10-05）：ImageField 直接编辑顶层
 * coverImage/coverPosition/coverZoom，每次变更即时 entityStore.update（undo 链自动记录）。
 * 不走抽屉编辑态草稿——封面是轻量视觉设置，即时反馈比草稿/保存两段式更自然。
 */
import ImageField from './ImageField.vue'
import { useEntityStore, type Entity } from '@worldsea/entity-core'

const props = defineProps<{ entity: Entity }>()
const entityStore = useEntityStore()

/** ImageField 移除时 emit null —— 归一为空串清空顶层封面 */
function onCover(val: unknown) {
  entityStore.update(props.entity.id, { coverImage: (val as string | null) ?? '' })
}
function onPosition(val: string) {
  entityStore.update(props.entity.id, { coverPosition: val })
}
function onZoom(val: number) {
  entityStore.update(props.entity.id, { coverZoom: val })
}
</script>

<style scoped>
.ecp { display: flex; flex-direction: column; gap: 10px; }
.ecp-hint { margin: 0; font-size: var(--font-size-xs, 12px); color: var(--text-tertiary, #9ca3af); }
</style>
