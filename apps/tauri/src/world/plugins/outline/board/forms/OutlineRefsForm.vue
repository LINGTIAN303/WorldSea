<template>
  <!--
    关联实体徽章（OutlineRefsForm）—— 派生型表现形式
    重建旧树视图的「关联实体徽章组」（`useOutlineEntityLinks.ts`，09-17 随旧视图删除）：
    **按实体类型聚合**、**点击跳转实体**。
    · 纯派生只读：数据源是**关系表**（`outline_mentions` / `outline_located_in` / `outline_covers`），
      本组件不写任何数据；建立关联的入口在 Agent（`link_entity` 工具）
    · 哪几条关系类型纳入由**注册表**决定（`pickRefRelationTypes`）——新增一条自动出现
  -->
  <div class="orf">
    <div v-if="!groups.length" class="orf-empty">
      {{ emptyText }}
    </div>

    <div v-for="g in groups" :key="g.entityType" class="orf-group">
      <div class="orf-head">
        <WsIcon :name="iconOf(g.entityType)" size="xs" class="orf-icon" />
        <span class="orf-type">{{ labelOf(g.entityType) }}</span>
        <span class="orf-count">{{ g.members.length }}</span>
      </div>
      <div class="orf-members">
        <button
          v-for="m in visibleMembers(g)"
          :key="m.id"
          class="orf-chip"
          type="button"
          :title="`${m.name}（${m.relationTypes.map(relationLabel).join(' / ')}）—— 点击跳转`"
          @click.stop="openEntity(m.id, g.entityType)"
        >{{ m.name }}</button>
        <span v-if="g.members.length > maxPerGroup" class="orf-more" :title="restNames(g)">
          +{{ g.members.length - maxPerGroup }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 徽章组件：纯派生只读（`kind: 'derived'`）。
 *
 * 数据链路：`relationStore.relations`（关系表）+ `entityStore.entities`（名称与类型）
 * → `groupOutlineRefs`（纯函数分组）→ 渲染。
 *
 * 与「线索式」的区别：线索式读**节点字段**（`properties.storylines`），
 * 徽章读**关系表** —— 所以建立关联必须走关系写入（Agent 的 `link_entity`），
 * 属性面板里没有、也不该有对应输入框（关系不是字段）。
 */
import { computed } from 'vue'
import { useEntityStore, useRelationStore, entitySchemaRegistry, relationshipRegistry } from '@worldsea/entity-core'
// 芽视图里的 UI 组件必须显式导入（不是全局组件）
import { WsIcon } from '@worldsea/ui-kit'
import { resolveFormConfig } from './registry'
import {
  groupOutlineRefs,
  pickRefRelationTypes,
  type OutlineRefGroup,
  type OutlineRefMember,
  type RefEntityLike,
} from './outlineRefs'

const props = defineProps<{
  nodeId: string
  config?: Record<string, unknown>
}>()

const es = useEntityStore()
const rs = useRelationStore()
const cfg = computed(() => resolveFormConfig('refs', props.config))

const maxPerGroup = computed(() => {
  const n = Number(cfg.value.maxPerGroup)
  return Number.isFinite(n) && n > 0 ? Math.min(20, Math.floor(n)) : 4
})

/**
 * 纳入徽章的关系类型：由**关系注册表**决定（按 sourceType 索引，新增「节点 → 芽实体」
 * 的关系类型会自动出现，无需改这里）。见 `pickRefRelationTypes` 注释。
 */
const refRelationTypes = computed(() =>
  pickRefRelationTypes(relationshipRegistry.getBySourceType('outline_node')),
)

const entityById = computed(() => {
  const m = new Map<string, RefEntityLike>()
  for (const e of es.entities ?? []) m.set(e.id, { id: e.id, type: e.type, name: e.name })
  return m
})

const groups = computed(() =>
  groupOutlineRefs(rs.relations ?? [], props.nodeId, entityById.value, refRelationTypes.value),
)

const emptyText = computed(() =>
  String(cfg.value.emptyText ?? '暂无关联实体（可由 Agent 建立关联）'),
)

const iconOf = (type: string): string => entitySchemaRegistry.getIconName(type) || 'link'
const labelOf = (type: string): string => entitySchemaRegistry.getLabel(type) || type
/** 关系类型的中文标签（用于 chip 的 title 提示，如「提及」/「发生于」） */
const relationLabel = (type: string): string => relationshipRegistry.get(type)?.label || type

function visibleMembers(g: OutlineRefGroup): OutlineRefMember[] {
  return g.members.slice(0, maxPerGroup.value)
}
function restNames(g: OutlineRefGroup): string {
  return g.members.slice(maxPerGroup.value).map(m => m.name).join('、')
}

/** 跳转实体（复用既有 ws-navigate 链路，与「打开正文」同一实现） */
function openEntity(entityId: string, entityType: string): void {
  window.dispatchEvent(new CustomEvent('ws-navigate', {
    detail: { entityType, entityId },
  }))
}
</script>

<style scoped>
.orf {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.orf-empty {
  font-size: var(--font-size-2xs);
  color: var(--text-tertiary);
}
.orf-group { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.orf-head { display: flex; align-items: center; gap: 4px; }
.orf-icon {
  flex-shrink: 0;
  /* 显式设色：暗色主题下不设会继承成不可见（项目通用坑） */
  color: var(--text-secondary);
}
.orf-type { font-size: var(--font-size-2xs); color: var(--text-secondary); }
.orf-count {
  padding: 0 4px;
  border-radius: var(--radius-xs);
  background: var(--bg-tertiary);
  color: var(--text-tertiary);
  font-size: var(--font-size-2xs);
}
.orf-members { display: flex; flex-wrap: wrap; gap: 3px; }
.orf-chip {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 1px 6px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-xs);
  background: transparent;
  /* 显式设色（同 .orf-icon） */
  color: var(--text-color);
  font-size: var(--font-size-2xs);
  font-family: inherit;
  cursor: pointer;
}
.orf-chip:hover { border-color: var(--primary); color: var(--primary); }
.orf-more { font-size: var(--font-size-2xs); color: var(--text-tertiary); align-self: center; }
</style>
