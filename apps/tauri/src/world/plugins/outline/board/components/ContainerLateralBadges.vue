<template>
  <!--
    卡片头部的横向关系徽章（G1.1，2026-10-19）
    Q3-A 的三条横向关系（并列 / 递进 / 对比）此前只在节点详情可见；
    这里把它们聚合成卡片上的小标记，不点开详情也能看出「有哪些横向关系」。
    点徽章 → 打开该节点详情（与五视图钻取同一落点）。
  -->
  <span v-if="badges.length" class="bc-lateral">
    <button
      v-for="b in badges"
      :key="b.key"
      class="bc-badge"
      type="button"
      :title="`${LATERAL_META[b.key].label} × ${b.count}（点击查看详情）`"
      @click.stop="openDetail"
    >{{ LATERAL_META[b.key].mark }}{{ b.count }}</button>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRelationStore, type Entity } from '@worldsea/entity-core'
import { lateralBadges, LATERAL_META } from '../lateralBadges'
import { focusNodeField } from '../composables/useNodeFieldFocus'

const props = defineProps<{ node?: Entity }>()

const rs = useRelationStore()
const badges = computed(() => (props.node ? lateralBadges(rs.relations ?? [], props.node.id) : []))

function openDetail(): void {
  if (props.node) focusNodeField(props.node.id, '')
}
</script>

<style scoped>
.bc-lateral { display: inline-flex; gap: 2px; flex-shrink: 0; }
.bc-badge {
  padding: 0 3px;
  height: 14px;
  border: none;
  border-radius: var(--radius-xs);
  background: var(--bg-tertiary);
  color: var(--text-tertiary);
  font-size: 9px;
  line-height: 14px;
  font-family: inherit;
  cursor: pointer;
}
.bc-badge:hover { color: var(--primary); background: var(--bg-secondary); }
</style>
