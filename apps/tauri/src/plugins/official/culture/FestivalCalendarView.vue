<template>
  <div class="cal-view">
    <!-- 工具栏 Teleport 到 R3 视图工具条的控件区（#view-toolbar-controls），实现单条统一工具栏 -->
    <Teleport to="#view-toolbar-controls">
      <div class="cal-toolbar">
        <button class="cal-btn" @click="$emit('back')" title="返回列表">
          <WsIcon name="chevron-right" :size="12" :stroke-width="2" />
          列表
        </button>
        <div class="cal-toolbar-sep"></div>
        <div class="cal-toolbar-group">
          <span class="cal-toolbar-label">类型</span>
          <CustomDropdown v-model="filterType" :options="filterTypeOpts" />
        </div>
        <div class="cal-toolbar-sep"></div>
        <label class="cal-toggle"><input type="checkbox" v-model="showUntimed" /> 显示无固定时间</label>
        <div class="cal-toolbar-spacer"></div>
        <button class="cal-btn" @click="fitView" title="重置视图">⊞ 适配</button>
        <span class="cal-count">{{ timedNodes.length }} 个有期 / {{ untimeNodes.length }} 个无期</span>
      </div>
    </Teleport>

    <div class="cal-main">
      <div ref="containerRef" class="cal-canvas-container"></div>
    </div>

    <div class="cal-detail" v-if="selectedNode">
      <div class="cal-detail-header">
        <span class="cal-detail-icon">{{ selectedNode.icon }}</span>
        <span class="cal-detail-name">{{ selectedNode.name }}</span>
        <button class="cal-detail-close" @click="canvas.setSelectedId(null)">✕</button>
      </div>
      <div class="cal-detail-fields">
        <div class="cal-detail-row"><span class="cal-label">类型</span><span>{{ selectedNode.cultureType }}</span></div>
        <div class="cal-detail-row"><span class="cal-label">周期</span><span>{{ selectedNode.cycle || '—' }}</span></div>
        <div class="cal-detail-row"><span class="cal-label">季节</span><span>{{ selectedNode.season || '—' }}</span></div>
        <div class="cal-detail-row" v-if="selectedEntity?.properties.origin"><span class="cal-label">起源</span><span>{{ selectedEntity.properties.origin }}</span></div>
        <div class="cal-detail-row" v-if="selectedEntity?.properties.participants"><span class="cal-label">参与者</span><span>{{ selectedEntity.properties.participants }}</span></div>
      </div>
      <div class="cal-detail-section" v-if="selectedNode.significance">
        <span class="cal-section-title">意义/象征</span>
        <div class="cal-text">{{ selectedNode.significance }}</div>
      </div>
      <div class="cal-detail-section" v-if="selectedNode.practices">
        <span class="cal-section-title">仪式/做法</span>
        <div class="cal-text">{{ selectedNode.practices }}</div>
      </div>
      <div class="cal-detail-section" v-if="relatedRegions.length > 0">
        <span class="cal-section-title">流行地区</span>
        <div v-for="r in relatedRegions" :key="r.id" class="cal-link" role="button" tabindex="0" :aria-label="`打开 ${r.name}`" @click="navigateTo(r.id, 'region')" @keydown.enter.prevent="navigateTo(r.id, 'region')" @keydown.space.prevent="navigateTo(r.id, 'region')">{{ r.name }}</div>
      </div>
      <div class="cal-detail-section" v-if="relatedSpecies.length > 0">
        <span class="cal-section-title">所属物种</span>
        <div v-for="s in relatedSpecies" :key="s.id" class="cal-link" role="button" tabindex="0" :aria-label="`打开 ${s.name}`" @click="navigateTo(s.id, 'species')" @keydown.enter.prevent="navigateTo(s.id, 'species')" @keydown.space.prevent="navigateTo(s.id, 'species')">{{ s.name }}</div>
      </div>
      <div class="cal-detail-section" v-if="relatedOrgs.length > 0">
        <span class="cal-section-title">推行势力</span>
        <div v-for="o in relatedOrgs" :key="o.id" class="cal-link" role="button" tabindex="0" :aria-label="`打开 ${o.name}`" @click="navigateTo(o.id, 'organization')" @keydown.enter.prevent="navigateTo(o.id, 'organization')" @keydown.space.prevent="navigateTo(o.id, 'organization')">{{ o.name }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import { useEntityStore, useRelationStore } from '@worldsmith/entity-core'
import { CustomDropdown } from '@worldsmith/plugin-sdk'
import { useFestivalCalendarData, type FestivalNode } from './composables/useFestivalCalendarData'
import { useFestivalCalendarCanvas } from './composables/useFestivalCalendarCanvas'

defineEmits<{ (e: 'back'): void }>()

const es = useEntityStore()
const rs = useRelationStore()
const containerRef = ref<HTMLElement | null>(null)
const filterType = ref('')
const showUntimed = ref(true)

const { cultureEntities, nodes, timedNodes, untimeNodes } = useFestivalCalendarData()
const canvas = useFestivalCalendarCanvas(containerRef)

const filterTypeOpts = [
  { value: '', label: '全部类型' },
  { value: '节日庆典', label: '节日庆典' }, { value: '宗教仪式', label: '宗教仪式' },
  { value: '风俗习惯', label: '风俗习惯' }, { value: '艺术流派', label: '艺术流派' },
  { value: '饮食文化', label: '饮食文化' }, { value: '服饰传统', label: '服饰传统' },
  { value: '社交礼仪', label: '社交礼仪' }, { value: '丧葬习俗', label: '丧葬习俗' },
  { value: '其他', label: '其他' },
]

const selectedNode = computed<FestivalNode | null>(() => {
  if (!canvas.selectedId.value) return null
  return nodes.value.find(n => n.id === canvas.selectedId.value) || null
})

const selectedEntity = computed(() => {
  if (!canvas.selectedId.value) return null
  return cultureEntities.value.find(e => e.id === canvas.selectedId.value) || null
})

function getRelated(targetType: string, relType: string) {
  if (!canvas.selectedId.value) return []
  const rels = rs.relations.filter(r =>
    r.type === relType && r.sourceId === canvas.selectedId.value
  )
  return rels.map(r => es.entities?.find(e => e.id === r.targetId && e.type === targetType))
    .filter(e => !!e)
    .map(e => ({ id: e!.id, name: e!.name }))
}

const relatedRegions = computed(() => getRelated('region', 'practiced_in'))
const relatedSpecies = computed(() => getRelated('species', 'practiced_by'))
const relatedOrgs = computed(() => getRelated('organization', 'promoted_by'))

function navigateTo(entityId: string, entityType: string) {
  window.dispatchEvent(new CustomEvent('ws-navigate', {
    detail: { type: 'entity', entityId, entityType },
  }))
}

function fitView() {
  canvas.fitCalendarView()
}

watch([filterType, showUntimed], () => {
  canvas.setData(timedNodes.value, untimeNodes.value, filterType.value, showUntimed.value)
  setTimeout(() => canvas.fitCalendarView(), 50)
})

onMounted(async () => {
  await es.loadAll()
  await rs.loadAll()
  canvas.setData(timedNodes.value, untimeNodes.value, filterType.value, showUntimed.value)
  canvas.setCallbacks({
    onNodeClick: (node) => { canvas.setSelectedId(node.id) },
    onNodeDoubleClick: (node) => {
      window.dispatchEvent(new CustomEvent('ws-navigate', {
        detail: { type: 'entity', entityId: node.id, entityType: 'culture' },
      }))
    },
    onBackgroundClick: () => { canvas.setSelectedId(null) },
    onHoverChange: () => {},
  })
  setTimeout(() => canvas.fitCalendarView(), 100)
})
</script>

<style scoped>
.cal-view { display: flex; flex-direction: column; height: 100%; background: var(--color-bg-base); color: var(--color-text-primary); font-size: var(--font-size-sm); position: relative; }
/* 工具栏 Teleport 到 R3 后：行内横排，去除自身背景/边框/内边距 */
.cal-toolbar { display: flex; gap: 8px; align-items: center; padding: 0; background: transparent; border-bottom: none; flex-shrink: 0; flex-wrap: nowrap; min-width: 0; }
.cal-toolbar-group { display: flex; align-items: center; gap: 4px; }
.cal-toolbar-label { font-size: var(--font-size-xs); color: var(--color-text-secondary); white-space: nowrap; }
.cal-toolbar-sep { width: 1px; height: 20px; background: var(--color-border); margin: 0 4px; }
.cal-toolbar-spacer { flex: 1; }
.cal-btn { display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-bg-elevated); color: var(--color-text-primary); font-size: var(--font-size-sm); cursor: pointer; transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s; white-space: nowrap; }
.cal-btn:hover { background: var(--color-bg-hover); border-color: var(--color-text-secondary); color: var(--color-text-primary); }
.cal-toggle { display: flex; align-items: center; gap: 4px; font-size: var(--font-size-sm); color: var(--color-text-secondary); cursor: pointer; }
.cal-toggle input { accent-color: var(--color-primary); }
.cal-count { font-size: var(--font-size-xs); color: var(--color-text-secondary); }
.cal-main { flex: 1; min-height: 0; }
.cal-canvas-container { width: 100%; height: 100%; }
.cal-detail { position: absolute; right: 16px; top: 16px; width: 240px; background: var(--color-bg-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 12px; box-shadow: var(--shadow-card); z-index: 10; max-height: calc(100% - 32px); overflow-y: auto; }
.cal-detail-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.cal-detail-icon { font-size: var(--font-size-xl); }
.cal-detail-name { font-size: var(--font-size-base); font-weight: var(--font-weight-semibold); color: var(--color-text-primary); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cal-detail-close { background: none; border: none; color: var(--color-text-secondary); cursor: pointer; font-size: var(--font-size-base); padding: 2px; }
.cal-detail-close:hover { color: var(--color-danger); }
.cal-detail-fields { margin-bottom: 8px; }
.cal-detail-row { display: flex; gap: 8px; font-size: var(--font-size-sm); margin-bottom: 3px; }
.cal-label { color: var(--color-text-secondary); min-width: 48px; }
.cal-detail-section { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--color-border); }
.cal-section-title { font-size: var(--font-size-xs); color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 4px; }
.cal-text { font-size: var(--font-size-sm); color: var(--color-text-primary); line-height: 1.4; }
.cal-link { font-size: var(--font-size-sm); padding: 2px 6px; border-radius: var(--radius-xs); cursor: pointer; color: var(--color-primary); margin-bottom: 2px; }
.cal-link:hover { background: var(--color-primary-subtle); }
</style>
