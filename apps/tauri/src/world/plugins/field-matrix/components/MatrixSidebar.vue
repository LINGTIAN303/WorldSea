<template>
  <aside class="fm-rail" :class="{ collapsed }" aria-label="芽导航">
    <div v-if="fixedGroup && fixedGroup.items.length > 0" class="fm-rail-fixed">
      <nav>
        <div class="fm-rail-group">
          <div class="fm-rail-group-title">{{ fixedGroup.title }}</div>
          <a
            v-for="item in fixedGroup.items"
            :key="item.id"
            :href="`#${item.id}`"
            class="fm-rail-item"
            :class="{ active: item.id === active }"
            :aria-current="item.id === active ? 'location' : undefined"
            @click.prevent="emit('select', item.id)"
          >
            <span class="fm-rail-label">{{ item.label }}</span>
            <code v-if="item.meta" class="fm-rail-meta">{{ item.meta }}</code>
            <b v-if="item.count !== undefined" class="fm-rail-count">{{ item.count }}</b>
          </a>
        </div>
      </nav>
    </div>

    <div class="fm-rail-scroll">
      <nav>
        <div v-for="group in scrollGroups" :key="group.title" class="fm-rail-group">
          <div class="fm-rail-group-title">{{ group.title }}</div>
          <a
            v-for="item in group.items"
            :key="item.id"
            :href="`#${item.id}`"
            class="fm-rail-item"
            :class="{ active: item.id === active }"
            :aria-current="item.id === active ? 'location' : undefined"
            @click.prevent="emit('select', item.id)"
          >
            <span class="fm-rail-label">{{ item.label }}</span>
            <code v-if="item.meta" class="fm-rail-meta">{{ item.meta }}</code>
            <b v-if="item.count !== undefined" class="fm-rail-count">{{ item.count }}</b>
          </a>
        </div>
      </nav>
      <div v-if="!hasItems" class="fm-rail-empty">没有匹配的条目</div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { MatrixNavGroup } from '../model/nav'

const props = withDefaults(defineProps<{
  groups: MatrixNavGroup[]
  active: string
  collapsed?: boolean
}>(), {
  collapsed: false,
})

const fixedGroup = computed(() => props.groups.find(group => group.fixed))
const scrollGroups = computed(() => props.groups.filter(group => !group.fixed && group.items.length > 0))
const hasItems = computed(() =>
  (fixedGroup.value?.items.length ?? 0) > 0 || scrollGroups.value.length > 0,
)

const emit = defineEmits<{ select: [id: string] }>()
</script>

<style scoped>
/* 视图顶层整列（对齐笔记本芽侧栏层级）：贴画布右缘、整高、可收起 */
.fm-rail {
  display: flex;
  flex-direction: column;
  width: 260px;
  flex-shrink: 0;
  height: 100%;
  overflow: hidden;
  background: var(--bg-surface);
  border-left: 1px solid var(--border-color);
  transition: width 0.2s ease, border-color 0.2s ease;
}
.fm-rail.collapsed {
  width: 0;
  border-left-color: transparent;
}
/* 总览固定块：不参与滚动 */
.fm-rail-fixed {
  flex-shrink: 0;
  width: 260px;
  padding: 12px 8px 8px;
  border-bottom: 1px solid var(--color-border-subtle);
  box-sizing: border-box;
}
/* 其余分组独立滚动，组标题吸顶 */
.fm-rail-scroll {
  flex: 1;
  min-height: 0;
  width: 260px;
  overflow: auto;
  padding: 0 8px 16px;
  box-sizing: border-box;
}
.fm-rail-empty {
  padding: 18px 10px;
  color: var(--text-tertiary);
  font-size: var(--font-size-sm);
  text-align: center;
}
.fm-rail-group-title {
  margin: 0;
  padding: 8px 8px 5px;
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-tertiary);
}
.fm-rail-scroll .fm-rail-group-title {
  position: sticky;
  top: 0;
  z-index: 2;
  padding-top: 10px;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--color-border-subtle);
}
.fm-rail-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
  line-height: 1.35;
  text-decoration: none;
  transition: background 0.15s, color 0.15s;
}
.fm-rail-item:hover {
  background: var(--hover-bg);
  color: var(--text-color);
  text-decoration: none;
}
.fm-rail-item.active {
  background: var(--active-bg);
  color: var(--color-primary);
  font-weight: var(--font-weight-semibold);
}
.fm-rail-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fm-rail-meta {
  flex-shrink: 0;
  font-family: var(--font-family-mono);
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}
.fm-rail-count {
  flex-shrink: 0;
  min-width: 18px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--hover-bg);
  color: var(--text-tertiary);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  line-height: 17px;
  text-align: center;
}
.fm-rail-item.active .fm-rail-meta,
.fm-rail-item.active .fm-rail-count {
  color: var(--color-primary);
}
@media (max-width: 1280px) {
  .fm-rail {
    display: none;
  }
}
</style>
