<template>
  <Transition name="ws-slide-right">
    <div v-if="visible" class="g-legend">
      <div class="g-legend-head">
        <span class="g-legend-title">类型图例</span>
        <span class="g-legend-sub">{{ types.length }} 类</span>
        <button class="g-legend-close" aria-label="关闭图例" @click="$emit('close')">
          <WsIcon name="close" size="xs" />
        </button>
      </div>
      <div class="g-legend-body">
        <div
          v-for="type in types"
          :key="type.type"
          class="g-legend-item"
          :class="{ off: hiddenTypes.has(type.type) }"
          @click="$emit('toggle-type', type.type)"
        >
          <span class="g-legend-dot" :style="{ background: colorOf(type.type) }"></span>
          <WsIcon :name="type.icon" size="xs" class="g-legend-icon" />
          <span class="g-legend-label">{{ type.label }}</span>
          <span class="g-legend-count">{{ type.total }}</span>
          <span v-if="type.isolated > 0" class="g-legend-isolated" :title="`${type.isolated} 个未连接`">{{ type.isolated }} 孤</span>
          <button
            v-if="type.isolated > 0"
            class="g-legend-locate"
            title="定位类型星座"
            aria-label="定位类型星座"
            @click.stop="$emit('focus-type', type.type)"
          ><WsIcon name="target" size="xs" /></button>
        </div>

        <div class="g-legend-divider"></div>
        <div class="g-legend-title g-legend-title--small">关系语义</div>
        <button
          v-for="family in families"
          :key="family.key"
          class="g-legend-rel"
          :class="{ off: hiddenFamilies.has(family.key) }"
          :title="`点击${hiddenFamilies.has(family.key) ? '显示' : '隐藏'}该语义族`"
          @click="$emit('toggle-family', family.key)"
        >
          <span class="g-legend-line" :style="{ background: family.color }"></span>
          <span class="g-legend-label">{{ family.label }}</span>
        </button>

        <div class="g-legend-divider"></div>
        <button
          class="g-legend-rel"
          :class="{ off: !showCommunities }"
          :title="showCommunities ? '隐藏社区轮廓' : '显示社区轮廓'"
          @click="$emit('toggle-community')"
        >
          <span class="g-legend-hull"></span>
          <span class="g-legend-label">社区轮廓</span>
          <span class="g-legend-count">{{ communityCount }}</span>
        </button>
        <div v-if="showCommunities" class="g-legend-communities">
          <div v-for="(community, index) in visibleCommunities" :key="community.id" class="g-legend-community">
            <span class="g-legend-hull" :style="{ borderColor: colorOfCommunity(index) }"></span>
            <span class="g-legend-label">{{ community.label }}</span>
            <span class="g-legend-count">{{ community.size }}</span>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import type { EdgeFamily, TypeSummary } from '../model/types'
import type { Community } from '../model/community'
import { communityColors } from '../policy/communityStyle'
import { DARK_EDGE_FAMILY, LIGHT_EDGE_FAMILY, familyPalette } from '../policy/palette'

const props = defineProps<{
  visible: boolean
  types: TypeSummary[]
  hiddenTypes: Set<string>
  hiddenFamilies: Set<EdgeFamily>
  communities: Community[]
  communityCount: number
  showCommunities: boolean
  themeMode: 'dark' | 'theme'
}>()

defineEmits<{
  close: []
  'toggle-type': [type: string]
  'toggle-family': [family: EdgeFamily]
  'toggle-community': []
  'focus-type': [type: string]
}>()

const families = computed<{ key: EdgeFamily; label: string; color: string }[]>(() => {
  const table = props.themeMode === 'theme' ? LIGHT_EDGE_FAMILY : DARK_EDGE_FAMILY
  return [
    { key: 'structural', label: '结构', color: table.structural },
    { key: 'social', label: '社会', color: table.social },
    { key: 'spatial', label: '空间', color: table.spatial },
    { key: 'causal', label: '因果', color: table.causal },
    { key: 'narrative', label: '叙事', color: table.narrative },
    { key: 'other', label: '其他', color: table.other },
  ]
})

const visibleCommunities = computed(() => props.communities.filter(community => community.size >= 3))

function colorOfCommunity(index: number): string {
  return communityColors(index, props.themeMode).stroke
}

function colorOf(type: string): string {
  const palette = familyPalette(type, props.themeMode)
  return palette.fill
}
</script>

<style scoped>
.g-legend {
  position: absolute; top: 56px; right: 12px; width: 248px;
  max-height: calc(100% - 200px); display: flex; flex-direction: column;
  border: 1px solid var(--g-panel-border, rgba(255,255,255,0.1)); border-radius: var(--radius-mid);
  background: var(--g-panel-bg, rgba(8,12,20,0.94)); backdrop-filter: blur(12px);
  z-index: 8; overflow: hidden;
}
.g-legend-head { display: flex; align-items: center; gap: 6px; padding: 10px 12px 8px; border-bottom: 1px solid var(--g-panel-border, rgba(255,255,255,0.08)); }
.g-legend-title { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--g-text-strong, #e2e8f0); }
.g-legend-title--small { padding: 0 2px 4px; font-size: var(--font-size-xs); color: var(--g-text-dim, #94a3b8); font-weight: 500; }
.g-legend-sub { font-size: var(--font-size-xs); color: var(--g-text-dim, #94a3b8); margin-right: auto; }
.g-legend-close { display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; border: none; border-radius: var(--radius-xs); background: transparent; color: var(--g-text-dim, #94a3b8); cursor: pointer; }
.g-legend-close:hover { color: var(--g-text-strong, #e2e8f0); background: var(--g-hover, rgba(255,255,255,0.08)); }
.g-legend-body { padding: 6px 8px 10px; overflow-y: auto; }
.g-legend-item { display: flex; align-items: center; gap: 6px; padding: 4px 5px; border-radius: var(--radius-xs); cursor: pointer; transition: background 0.15s, opacity 0.15s; }
.g-legend-item:hover { background: var(--g-hover, rgba(255,255,255,0.06)); }
.g-legend-item.off { opacity: 0.38; }
.g-legend-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.g-legend-icon { color: var(--g-text-dim, #94a3b8); flex-shrink: 0; }
.g-legend-label { flex: 1; min-width: 0; font-size: var(--font-size-xs); color: var(--g-text, #cbd5e1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.g-legend-count { font-size: var(--font-size-xs); color: var(--g-text-dim, #94a3b8); font-variant-numeric: tabular-nums; }
.g-legend-isolated { font-size: var(--font-size-xs); color: #d9a05b; white-space: nowrap; }
.g-legend-locate { display: flex; align-items: center; justify-content: center; width: 18px; height: 18px; border: none; border-radius: var(--radius-xs); background: transparent; color: var(--g-text-dim, #94a3b8); cursor: pointer; opacity: 0; }
.g-legend-item:hover .g-legend-locate { opacity: 1; }
.g-legend-locate:hover { color: var(--g-accent, #6ea8fe); background: var(--g-hover, rgba(255,255,255,0.08)); }
.g-legend-divider { height: 1px; background: var(--g-panel-border, rgba(255,255,255,0.08)); margin: 8px 2px; }
.g-legend-rel { display: flex; align-items: center; gap: 8px; width: 100%; padding: 3px 5px; border: none; border-radius: var(--radius-xs); background: transparent; text-align: left; cursor: pointer; transition: background 0.15s, opacity 0.15s; }
.g-legend-rel:hover { background: var(--g-hover, rgba(255,255,255,0.06)); }
.g-legend-rel.off { opacity: 0.38; }
.g-legend-line { width: 18px; height: 2px; border-radius: 1px; flex-shrink: 0; }
.g-legend-hull { width: 18px; height: 10px; border: 1px dashed var(--g-text-dim, #94a3b8); border-radius: 6px; flex-shrink: 0; }
.g-legend-communities { display: flex; flex-direction: column; gap: 2px; padding: 2px 2px 2px 23px; }
.g-legend-community { display: flex; align-items: center; gap: 8px; min-width: 0; }
.g-legend-community .g-legend-hull { width: 14px; height: 8px; }
</style>
