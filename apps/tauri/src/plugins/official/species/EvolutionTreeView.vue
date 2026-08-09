<template>
  <div class="evo-view">
    <div class="evo-toolbar">
      <button class="evo-btn" @click="$emit('back')" title="返回列表">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 3L5 8l5 5"/></svg>
        列表
      </button>
      <div class="evo-toolbar-sep"></div>
      <div class="evo-toolbar-group">
        <button class="evo-btn" :class="{active: layoutMode === 'top-down'}" @click="switchLayout('top-down')">进化树</button>
        <button class="evo-btn" :class="{active: layoutMode === 'radial'}" @click="switchLayout('radial')">径向</button>
      </div>
      <div class="evo-toolbar-sep"></div>
      <div class="evo-toolbar-group">
        <span class="evo-toolbar-label">类型</span>
        <CustomDropdown v-model="filterType" :options="filterTypeOpts" />
      </div>
      <div class="evo-toolbar-sep"></div>
      <label class="evo-toggle"><input type="checkbox" v-model="showSymbiosis" /> 共生</label>
      <label class="evo-toggle"><input type="checkbox" v-model="showRivals" /> 天敌</label>
      <label class="evo-toggle" v-if="layoutMode === 'top-down'"><input type="checkbox" v-model="showClusters" /> 聚类</label>
      <div class="evo-toolbar-spacer"></div>
      <button class="evo-btn" @click="fitView" title="自动适配">⊞ 适配</button>
      <span class="evo-count">{{ filteredNodes.length }} 个物种</span>
    </div>

    <div class="evo-main">
      <div ref="containerRef" class="evo-canvas-container"></div>
    </div>

    <div class="evo-detail" v-if="selectedNode">
      <div class="evo-detail-header">
        <span class="evo-detail-icon">{{ selectedNode.icon }}</span>
        <span class="evo-detail-name">{{ selectedNode.name }}</span>
        <button class="evo-detail-close" @click="deselectNode">✕</button>
      </div>
      <div class="evo-detail-fields">
        <div class="evo-detail-row"><span class="evo-label">类型</span><span>{{ selectedNode.speciesType }}</span></div>
        <div class="evo-detail-row" v-if="selectedEntity?.properties.origin"><span class="evo-label">起源地</span><span>{{ selectedEntity.properties.origin }}</span></div>
        <div class="evo-detail-row" v-if="selectedEntity?.properties.population"><span class="evo-label">人口</span><span>{{ selectedEntity.properties.population }}</span></div>
        <div class="evo-detail-row" v-if="selectedEntity?.properties.avgLifespan"><span class="evo-label">寿命</span><span>{{ selectedEntity.properties.avgLifespan }}</span></div>
        <div class="evo-detail-row" v-if="selectedEntity?.properties.avgHeight"><span class="evo-label">身高</span><span>{{ selectedEntity.properties.avgHeight }}</span></div>
        <div class="evo-detail-row" v-if="selectedEntity?.properties.language"><span class="evo-label">语言</span><span>{{ selectedEntity.properties.language }}</span></div>
      </div>
      <div class="evo-detail-section" v-if="selectedEntity?.properties.abilities">
        <span class="evo-section-title">天赋能力</span>
        <div class="evo-text">{{ selectedEntity.properties.abilities }}</div>
      </div>
      <div class="evo-detail-section" v-if="selectedEntity?.properties.weakness">
        <span class="evo-section-title">弱点/缺陷</span>
        <div class="evo-text">{{ selectedEntity.properties.weakness }}</div>
      </div>
      <div class="evo-detail-section" v-if="ancestors.length > 0">
        <span class="evo-section-title">祖先</span>
        <div v-for="a in ancestors" :key="a.id" class="evo-link" role="button" tabindex="0" :aria-label="`打开 ${a.name}`" @click="selectById(a.id)" @keydown.enter.prevent="selectById(a.id)" @keydown.space.prevent="selectById(a.id)">{{ a.icon }} {{ a.name }}</div>
      </div>
      <div class="evo-detail-section" v-if="descendants.length > 0">
        <span class="evo-section-title">进化后代</span>
        <div v-for="d in descendants" :key="d.id" class="evo-link" role="button" tabindex="0" :aria-label="`打开 ${d.name}`" @click="selectById(d.id)" @keydown.enter.prevent="selectById(d.id)" @keydown.space.prevent="selectById(d.id)">{{ d.icon }} {{ d.name }}</div>
      </div>
      <div class="evo-detail-section" v-if="hybrids.length > 0">
        <span class="evo-section-title">杂交亲缘</span>
        <div v-for="h in hybrids" :key="h.id" class="evo-link evo-link-purple" role="button" tabindex="0" :aria-label="`打开 ${h.name}`" @click="selectById(h.id)" @keydown.enter.prevent="selectById(h.id)" @keydown.space.prevent="selectById(h.id)">{{ h.icon }} {{ h.name }}</div>
      </div>
      <div class="evo-detail-section" v-if="symbiotes.length > 0">
        <span class="evo-section-title">共生</span>
        <div v-for="s in symbiotes" :key="s.id" class="evo-link evo-link-green" role="button" tabindex="0" :aria-label="`打开 ${s.name}`" @click="selectById(s.id)" @keydown.enter.prevent="selectById(s.id)" @keydown.space.prevent="selectById(s.id)">{{ s.icon }} {{ s.name }}</div>
      </div>
      <div class="evo-detail-section" v-if="rivals.length > 0">
        <span class="evo-section-title">天敌</span>
        <div v-for="r in rivals" :key="r.id" class="evo-link evo-link-red" role="button" tabindex="0" :aria-label="`打开 ${r.name}`" @click="selectById(r.id)" @keydown.enter.prevent="selectById(r.id)" @keydown.space.prevent="selectById(r.id)">{{ r.icon }} {{ r.name }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useEntityStore, useRelationStore } from '@worldsmith/entity-core'
import { CustomDropdown } from '@worldsmith/plugin-sdk'
import { useEvolutionTreeData, type EvoNode } from './composables/useEvolutionTreeData'
import { useEvolutionTreeLayout, type EvoLayoutMode } from './composables/useEvolutionTreeLayout'
import { useEvolutionTreeCanvas } from './composables/useEvolutionTreeCanvas'

defineEmits<{ (e: 'back'): void }>()

const es = useEntityStore()
const rs = useRelationStore()
const containerRef = ref<HTMLElement | null>(null)
const layoutMode = ref<EvoLayoutMode>('top-down')
const filterType = ref('')
const showSymbiosis = ref(true)
const showRivals = ref(true)
const showClusters = ref(true)

const { speciesEntities, nodes, edges } = useEvolutionTreeData()
const { applyLayout } = useEvolutionTreeLayout()

const canvas = useEvolutionTreeCanvas(containerRef)

const filterTypeOpts = [
  { value: '', label: '全部类型' },
  { value: '类人', label: '类人' }, { value: '兽族', label: '兽族' },
  { value: '精灵', label: '精灵' }, { value: '矮人', label: '矮人' },
  { value: '龙族', label: '龙族' }, { value: '机械', label: '机械' },
  { value: '元素', label: '元素' }, { value: '亡灵', label: '亡灵' },
  { value: '神话生物', label: '神话生物' }, { value: '异界生物', label: '异界生物' },
  { value: '植物智能', label: '植物智能' }, { value: '其他', label: '其他' },
]

const filteredNodes = computed(() => {
  let result = nodes.value
  if (filterType.value) result = result.filter(n => n.speciesType === filterType.value)
  return result
})

const filteredEdges = computed(() => {
  const nodeIds = new Set(filteredNodes.value.map(n => n.id))
  return edges.value.filter(e => nodeIds.has(e.sourceId) && nodeIds.has(e.targetId))
})

const selectedNode = computed<EvoNode | null>(() => {
  if (!canvas.selectedId.value) return null
  return filteredNodes.value.find(n => n.id === canvas.selectedId.value) || null
})

const selectedEntity = computed(() => {
  if (!canvas.selectedId.value) return null
  return speciesEntities.value.find(e => e.id === canvas.selectedId.value) || null
})

function getRelatedNodes(relation: string, direction: 'outgoing' | 'incoming' | 'both'): EvoNode[] {
  if (!canvas.selectedId.value) return []
  return edges.value
    .filter(e => {
      if (e.relation !== relation) return false
      if (direction === 'outgoing') return e.sourceId === canvas.selectedId.value
      if (direction === 'incoming') return e.targetId === canvas.selectedId.value
      return e.sourceId === canvas.selectedId.value || e.targetId === canvas.selectedId.value
    })
    .map(e => {
      const targetId = e.sourceId === canvas.selectedId.value ? e.targetId : e.sourceId
      return nodes.value.find(n => n.id === targetId)
    })
    .filter((n): n is EvoNode => !!n)
}

const ancestors = computed(() => getRelatedNodes('祖先', 'incoming'))
const descendants = computed(() => getRelatedNodes('进化', 'outgoing'))
const hybrids = computed(() => getRelatedNodes('杂交', 'both'))
const symbiotes = computed(() => getRelatedNodes('共生', 'both'))
const rivals = computed(() => getRelatedNodes('天敌', 'both'))

function deselectNode() {
  canvas.setSelectedId(null)
}

function switchLayout(mode: EvoLayoutMode) {
  layoutMode.value = mode
  applyLayout(filteredNodes.value, filteredEdges.value, mode)
  canvas.setLayoutMode(mode)
  canvas.markDirty()
  setTimeout(() => canvas.fitView(), 50)
}

function fitView() {
  canvas.fitView()
}

function selectById(id: string) {
  canvas.setSelectedId(id)
}

function recalcLayout() {
  applyLayout(filteredNodes.value, filteredEdges.value, layoutMode.value)
  canvas.markDirty()
}

function updateCanvasData() {
  canvas.setData(filteredNodes.value, filteredEdges.value, showSymbiosis.value, showRivals.value)
}

watch(filterType, () => {
  recalcLayout()
  updateCanvasData()
  setTimeout(() => canvas.fitView(), 50)
})

watch(showSymbiosis, () => { updateCanvasData() })
watch(showRivals, () => { updateCanvasData() })
watch(showClusters, () => { canvas.setShowClusters(showClusters.value) })

onMounted(async () => {
  await es.loadAll()
  await rs.loadAll()
  recalcLayout()
  updateCanvasData()
  canvas.setCallbacks({
    onNodeClick: (node) => { canvas.setSelectedId(node.id) },
    onNodeDoubleClick: (node) => {
      window.dispatchEvent(new CustomEvent('ws-navigate', {
        detail: { type: 'entity', entityId: node.id, entityType: 'species' },
      }))
    },
    onBackgroundClick: () => { canvas.setSelectedId(null) },
    onHoverChange: () => {},
  })
  setTimeout(() => canvas.fitView(), 100)
})
</script>

<style scoped>
.evo-view { display: flex; flex-direction: column; height: 100%; background: var(--color-bg-base); color: var(--color-text-primary); font-size: var(--font-size-sm); position: relative; }
.evo-toolbar { display: flex; gap: 8px; align-items: center; padding: 8px 16px; background: var(--color-bg-surface); border-bottom: 1px solid var(--color-border); flex-shrink: 0; flex-wrap: wrap; }
.evo-toolbar-group { display: flex; align-items: center; gap: 4px; }
.evo-toolbar-label { font-size: var(--font-size-xs); color: var(--color-text-secondary); white-space: nowrap; }
.evo-toolbar-sep { width: 1px; height: 20px; background: var(--color-border); margin: 0 4px; }
.evo-toolbar-spacer { flex: 1; }
.evo-btn { display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border: 1px solid var(--color-border); border-radius: var(--radius-xs); background: var(--color-bg-elevated); color: var(--color-text-primary); font-size: var(--font-size-sm); cursor: pointer; transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s; white-space: nowrap; }
.evo-btn:hover { background: var(--color-bg-hover); border-color: var(--color-text-secondary); color: var(--color-text-primary); }
.evo-btn.active { background: var(--color-bg-hover); border-color: var(--color-primary); color: var(--color-primary); }
.evo-toggle { display: flex; align-items: center; gap: 4px; font-size: var(--font-size-sm); color: var(--color-text-secondary); cursor: pointer; }
.evo-toggle input { accent-color: var(--color-primary); }
.evo-count { font-size: var(--font-size-xs); color: var(--color-text-secondary); }
.evo-main { flex: 1; min-height: 0; }
.evo-canvas-container { width: 100%; height: 100%; }
.evo-detail { position: absolute; right: 16px; top: 56px; width: 240px; background: var(--color-bg-surface); border: 1px solid var(--color-border); border-radius: var(--radius-mid); padding: 12px; box-shadow: var(--shadow-modal); z-index: 10; max-height: calc(100% - 72px); overflow-y: auto; }
.evo-detail-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.evo-detail-icon { font-size: var(--font-size-xl); }
.evo-detail-name { font-size: var(--font-size-base); font-weight: var(--font-weight-semibold); color: var(--color-text-primary); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.evo-detail-close { background: none; border: none; color: var(--color-text-secondary); cursor: pointer; font-size: var(--font-size-base); padding: 2px; }
.evo-detail-close:hover { color: var(--color-danger); }
.evo-detail-fields { margin-bottom: 8px; }
.evo-detail-row { display: flex; gap: 8px; font-size: var(--font-size-sm); margin-bottom: 3px; }
.evo-label { color: var(--color-text-secondary); min-width: 48px; }
.evo-detail-section { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--color-border); }
.evo-section-title { font-size: var(--font-size-xs); color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 4px; }
.evo-text { font-size: var(--font-size-sm); color: var(--color-text-primary); line-height: 1.4; }
.evo-link { font-size: var(--font-size-sm); padding: 2px 6px; border-radius: var(--radius-2xs); cursor: pointer; color: var(--color-primary); margin-bottom: 2px; }
.evo-link:hover { background: var(--color-primary-subtle); }
.evo-link-purple { color: var(--color-primary-hover); }
.evo-link-purple:hover { background: rgba(210,168,255,0.1); }
.evo-link-green { color: var(--color-success); }
.evo-link-green:hover { background: rgba(63,185,80,0.1); }
.evo-link-red { color: var(--color-danger); }
.evo-link-red:hover { background: rgba(248,81,73,0.1); }
</style>
