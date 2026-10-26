<template>
  <Transition name="ws-slide-right">
    <aside v-if="visible && node" class="g-inspector" aria-label="实体检查器">
      <div class="g-inspector-head">
        <WsIcon :name="node.typeIcon" size="sm" class="g-inspector-icon" />
        <span class="g-inspector-name">{{ node.name }}</span>
        <button class="g-inspector-close" aria-label="关闭检查器" @click="$emit('close')">
          <WsIcon name="close" size="xs" />
        </button>
      </div>

      <div class="g-inspector-meta">
        <span class="g-inspector-badge">{{ node.typeLabel }}</span>
        <span class="g-inspector-badge">{{ node.degree }} 关系</span>
        <span v-if="node.isolated" class="g-inspector-badge g-inspector-badge--warn">未连接</span>
      </div>

      <div v-if="node.tags.length" class="g-inspector-tags">
        <span v-for="tag in node.tags" :key="tag" class="g-inspector-tag">{{ tag }}</span>
      </div>

      <p v-if="node.description" class="g-inspector-desc">{{ node.description }}</p>

      <div class="g-inspector-actions">
        <button class="g-inspector-action" @click="$emit('focus', node)">以他为中心</button>
        <button class="g-inspector-action g-inspector-action--primary" @click="$emit('navigate', node)">打开详情</button>
      </div>

      <div class="g-inspector-section">
        <div class="g-inspector-section-head">
          <span>关系</span>
          <span class="g-inspector-section-count">{{ relations.length }}</span>
        </div>
        <div v-if="relations.length === 0" class="g-inspector-empty">
          尚未建立关系。可在实体详情页的「关联」中添加。
        </div>
        <button
          v-for="row in relations"
          :key="row.edgeId"
          class="g-inspector-rel"
          @click="$emit('select-relation', row)"
        >
          <span class="g-inspector-rel-dot" :style="{ background: colorOf(row.family) }"></span>
          <span class="g-inspector-rel-dir">{{ row.direction === 'out' ? '→' : row.direction === 'in' ? '←' : '↔' }}</span>
          <span class="g-inspector-rel-label">{{ row.relLabel }}</span>
          <span class="g-inspector-rel-other">{{ row.otherName }}</span>
          <WsIcon :name="row.otherIcon" size="xs" class="g-inspector-rel-icon" />
        </button>
      </div>
    </aside>
  </Transition>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import type { OverviewNode } from '../model/types'
import type { InspectorRelation } from '../model/inspector'
import { DARK_EDGE_FAMILY, LIGHT_EDGE_FAMILY } from '../policy/palette'

const props = defineProps<{
  visible: boolean
  node: OverviewNode | null
  relations: InspectorRelation[]
  themeMode: 'dark' | 'theme'
}>()

defineEmits<{
  close: []
  navigate: [node: OverviewNode]
  focus: [node: OverviewNode]
  'select-relation': [row: InspectorRelation]
}>()

const edgeColors = computed(() => props.themeMode === 'theme' ? LIGHT_EDGE_FAMILY : DARK_EDGE_FAMILY)

function colorOf(family: string): string {
  return edgeColors.value[family] ?? edgeColors.value.other
}
</script>

<style scoped>
.g-inspector {
  position: absolute; right: 0; top: 0; bottom: 0; width: 300px; z-index: 14;
  display: flex; flex-direction: column; gap: 10px; padding: 14px;
  border-left: 1px solid var(--g-panel-border, rgba(255,255,255,0.1));
  background: var(--g-panel-bg, rgba(8,12,20,0.96)); backdrop-filter: blur(14px);
  overflow-y: auto;
}
.g-inspector-head { display: flex; align-items: center; gap: 8px; }
.g-inspector-icon { color: var(--g-accent, #6ea8fe); flex-shrink: 0; }
.g-inspector-name { flex: 1; min-width: 0; font-size: var(--font-size-base); font-weight: var(--font-weight-semibold); color: var(--g-text-strong, #e2e8f0); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.g-inspector-close { display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; border: none; border-radius: var(--radius-xs); background: transparent; color: var(--g-text-dim, #94a3b8); cursor: pointer; }
.g-inspector-close:hover { color: var(--g-text-strong, #e2e8f0); background: var(--g-hover, rgba(255,255,255,0.08)); }
.g-inspector-meta { display: flex; flex-wrap: wrap; gap: 6px; }
.g-inspector-badge { padding: 2px 7px; border: 1px solid var(--g-panel-border, rgba(255,255,255,0.12)); border-radius: var(--radius-2xl); font-size: var(--font-size-xs); color: var(--g-text-dim, #94a3b8); }
.g-inspector-badge--warn { color: #d9a05b; border-color: rgba(217,160,91,0.35); }
.g-inspector-tags { display: flex; flex-wrap: wrap; gap: 4px; }
.g-inspector-tag { padding: 1px 6px; border-radius: var(--radius-xs); background: var(--g-hover, rgba(255,255,255,0.06)); font-size: var(--font-size-xs); color: var(--g-text, #cbd5e1); }
.g-inspector-desc { margin: 0; font-size: var(--font-size-xs); line-height: 1.6; color: var(--g-text-dim, #94a3b8); display: -webkit-box; -webkit-line-clamp: 5; -webkit-box-orient: vertical; overflow: hidden; }
.g-inspector-actions { display: flex; gap: 8px; }
.g-inspector-action { flex: 1; padding: 6px 8px; border: 1px solid var(--g-panel-border, rgba(255,255,255,0.14)); border-radius: var(--radius-sm); background: transparent; color: var(--g-text, #cbd5e1); font-size: var(--font-size-xs); cursor: pointer; transition: background 0.15s, border-color 0.15s; }
.g-inspector-action:hover { background: var(--g-hover, rgba(255,255,255,0.08)); }
.g-inspector-action--primary { color: var(--g-accent, #6ea8fe); border-color: color-mix(in srgb, var(--g-accent, #6ea8fe) 50%, transparent); }
.g-inspector-section { border-top: 1px solid var(--g-panel-border, rgba(255,255,255,0.08)); padding-top: 10px; }
.g-inspector-section-head { display: flex; align-items: center; gap: 6px; font-size: var(--font-size-xs); color: var(--g-text-dim, #94a3b8); margin-bottom: 6px; }
.g-inspector-section-count { color: var(--g-text-strong, #e2e8f0); }
.g-inspector-empty { padding: 10px; border: 1px dashed var(--g-panel-border, rgba(255,255,255,0.12)); border-radius: var(--radius-sm); font-size: var(--font-size-xs); line-height: 1.6; color: var(--g-text-dim, #94a3b8); }
.g-inspector-rel { display: flex; align-items: center; gap: 6px; width: 100%; padding: 5px 6px; border: none; border-radius: var(--radius-xs); background: transparent; color: var(--g-text, #cbd5e1); font-size: var(--font-size-xs); text-align: left; cursor: pointer; }
.g-inspector-rel:hover { background: var(--g-hover, rgba(255,255,255,0.06)); }
.g-inspector-rel-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.g-inspector-rel-dir { color: var(--g-text-dim, #94a3b8); flex-shrink: 0; }
.g-inspector-rel-label { flex-shrink: 0; color: var(--g-text-dim, #94a3b8); }
.g-inspector-rel-other { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--g-text-strong, #e2e8f0); }
.g-inspector-rel-icon { color: var(--g-text-dim, #94a3b8); flex-shrink: 0; }
</style>
