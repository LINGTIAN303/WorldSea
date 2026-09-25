<template>
  <div class="st-view">
    <!-- 筛选/视图模式 → 收束条 -->
    <Teleport to="#view-toolbar-filter-body">
      <div class="st-toolbar-group">
        <button class="st-btn" :class="{active: layoutMode === 'bottom-up'}" @click="switchLayout('bottom-up')">传统树</button>
        <button class="st-btn" :class="{active: layoutMode === 'radial'}" @click="switchLayout('radial')">径向</button>
      </div>
      <div class="st-toolbar-group">
        <span class="st-toolbar-label">体系</span>
        <CustomDropdown v-model="filterType" :options="filterTypeOpts" />
      </div>
      <div class="st-toolbar-group">
        <span class="st-toolbar-label">等级</span>
        <CustomDropdown v-model="filterLevel" :options="filterLevelOpts" />
      </div>
      <label class="st-toggle"><input type="checkbox" v-model="showCounters" /> 克制</label>
      <label class="st-toggle" v-if="layoutMode === 'bottom-up'"><input type="checkbox" v-model="showClusters" /> 聚类</label>
    </Teleport>
    <!-- 动作 → 动作落点 -->
    <Teleport to="#view-toolbar-actions">
      <button class="st-btn" @click="$emit('back')" title="返回列表">
        <WsIcon name="chevron-right" :size="12" :stroke-width="2" />
        列表
      </button>
      <button class="st-btn" @click="fitView" title="自动适配">⊞ 适配</button>
      <span class="st-count">{{ filteredNodes.length }} 个技能</span>
    </Teleport>

    <div class="st-main">
      <div ref="containerRef" class="st-canvas-container"></div>
    </div>

    <div class="st-detail" v-if="selectedNode">
      <div class="st-detail-header">
        <span class="st-detail-icon">{{ selectedNode.icon }}</span>
        <span class="st-detail-name">{{ selectedNode.name }}</span>
        <button class="st-detail-close" @click="deselectNode">✕</button>
      </div>
      <div class="st-detail-fields">
        <div class="st-detail-row"><span class="st-label">体系</span><span>{{ selectedNode.magicType }}</span></div>
        <div class="st-detail-row"><span class="st-label">等级</span><span>{{ selectedNode.level }}</span></div>
        <div class="st-detail-row" v-if="selectedEntity?.properties.cost"><span class="st-label">消耗</span><span>{{ selectedEntity.properties.cost }}</span></div>
        <div class="st-detail-row" v-if="selectedEntity?.properties.castingTime"><span class="st-label">施法时间</span><span>{{ selectedEntity.properties.castingTime }}</span></div>
        <div class="st-detail-row" v-if="selectedEntity?.properties.range"><span class="st-label">范围</span><span>{{ selectedEntity.properties.range }}</span></div>
        <div class="st-detail-row" v-if="selectedEntity?.properties.duration"><span class="st-label">持续</span><span>{{ selectedEntity.properties.duration }}</span></div>
      </div>
      <div class="st-detail-section" v-if="prerequisites.length > 0">
        <span class="st-section-title">前置技能</span>
        <div v-for="p in prerequisites" :key="p.id" class="st-link" role="button" tabindex="0" :aria-label="`打开 ${p.name}`" @click="selectById(p.id)" @keydown.enter.prevent="selectById(p.id)" @keydown.space.prevent="selectById(p.id)">{{ p.icon }} {{ p.name }}</div>
      </div>
      <div class="st-detail-section" v-if="upgrades.length > 0">
        <span class="st-section-title">进阶技能</span>
        <div v-for="u in upgrades" :key="u.id" class="st-link" role="button" tabindex="0" :aria-label="`打开 ${u.name}`" @click="selectById(u.id)" @keydown.enter.prevent="selectById(u.id)" @keydown.space.prevent="selectById(u.id)">{{ u.icon }} {{ u.name }}</div>
      </div>
      <div class="st-detail-section" v-if="counteredBy.length > 0 || countersList.length > 0">
        <span class="st-section-title">克制关系</span>
        <div v-for="c in countersList" :key="'c-'+c.id" class="st-link st-link-red" role="button" tabindex="0" :aria-label="`打开 ${c.name}`" @click="selectById(c.id)" @keydown.enter.prevent="selectById(c.id)" @keydown.space.prevent="selectById(c.id)">克制 {{ c.icon }} {{ c.name }}</div>
        <div v-for="c in counteredBy" :key="'cb-'+c.id" class="st-link st-link-red" role="button" tabindex="0" :aria-label="`打开 ${c.name}`" @click="selectById(c.id)" @keydown.enter.prevent="selectById(c.id)" @keydown.space.prevent="selectById(c.id)">被 {{ c.icon }} {{ c.name }} 克制</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import { useEntityStore, useRelationStore } from '@worldsea/entity-core'
import { CustomDropdown } from '@worldsea/plugin-sdk'
import { useSkillTreeData, type SkillNode } from './composables/useSkillTreeData'
import { useSkillTreeLayout, type LayoutMode } from './composables/useSkillTreeLayout'
import { useSkillTreeCanvas } from './composables/useSkillTreeCanvas'

defineEmits<{ (e: 'back'): void }>()

const es = useEntityStore()
const rs = useRelationStore()
const containerRef = ref<HTMLElement | null>(null)
const layoutMode = ref<LayoutMode>('bottom-up')
const filterType = ref('')
const filterLevel = ref('')
const showCounters = ref(true)
const showClusters = ref(true)

const { magicEntities, nodes, edges } = useSkillTreeData()
const { applyLayout } = useSkillTreeLayout()

const canvas = useSkillTreeCanvas(containerRef)

const filterTypeOpts = [
  { value: '', label: '全部体系' },
  { value: '元素魔法', label: '元素魔法' }, { value: '心灵魔法', label: '心灵魔法' },
  { value: '神术/圣光', label: '神术/圣光' }, { value: '黑魔法/诅咒', label: '黑魔法/诅咒' },
  { value: '自然魔法', label: '自然魔法' }, { value: '符文/附魔', label: '符文/附魔' },
  { value: '炼金术', label: '炼金术' }, { value: '武术/战技', label: '武术/战技' },
  { value: '科技/异能', label: '科技/异能' }, { value: '通用', label: '通用' },
]

const filterLevelOpts = [
  { value: '', label: '全等级' },
  { value: '入门', label: '入门' }, { value: '初级', label: '初级' },
  { value: '中级', label: '中级' }, { value: '高级', label: '高级' },
  { value: '大师', label: '大师' }, { value: '传说', label: '传说' },
  { value: '神级', label: '神级' },
]

const filteredNodes = computed(() => {
  let result = nodes.value
  if (filterType.value) result = result.filter(n => n.magicType === filterType.value)
  if (filterLevel.value) result = result.filter(n => n.level === filterLevel.value)
  return result
})

const filteredEdges = computed(() => {
  const nodeIds = new Set(filteredNodes.value.map(n => n.id))
  return edges.value.filter(e => nodeIds.has(e.sourceId) && nodeIds.has(e.targetId))
})

const selectedNode = computed<SkillNode | null>(() => {
  if (!canvas.selectedId.value) return null
  return filteredNodes.value.find(n => n.id === canvas.selectedId.value) || null
})

const selectedEntity = computed(() => {
  if (!canvas.selectedId.value) return null
  return magicEntities.value.find(e => e.id === canvas.selectedId.value) || null
})

const prerequisites = computed(() => {
  if (!canvas.selectedId.value) return []
  return edges.value
    .filter(e => e.type === 'upgrades_to' && e.targetId === canvas.selectedId.value)
    .map(e => nodes.value.find(n => n.id === e.sourceId))
    .filter((n): n is SkillNode => !!n)
})

const upgrades = computed(() => {
  if (!canvas.selectedId.value) return []
  return edges.value
    .filter(e => e.type === 'upgrades_to' && e.sourceId === canvas.selectedId.value)
    .map(e => nodes.value.find(n => n.id === e.targetId))
    .filter((n): n is SkillNode => !!n)
})

const countersList = computed(() => {
  if (!canvas.selectedId.value) return []
  return edges.value
    .filter(e => e.type === 'counters' && e.sourceId === canvas.selectedId.value)
    .map(e => nodes.value.find(n => n.id === e.targetId))
    .filter((n): n is SkillNode => !!n)
})

const counteredBy = computed(() => {
  if (!canvas.selectedId.value) return []
  return edges.value
    .filter(e => e.type === 'counters' && e.targetId === canvas.selectedId.value)
    .map(e => nodes.value.find(n => n.id === e.sourceId))
    .filter((n): n is SkillNode => !!n)
})

function deselectNode() {
  canvas.setSelectedId(null)
}

function switchLayout(mode: LayoutMode) {
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
  canvas.setData(filteredNodes.value, filteredEdges.value, showCounters.value)
}

watch([filterType, filterLevel], () => {
  recalcLayout()
  updateCanvasData()
  setTimeout(() => canvas.fitView(), 50)
})

watch(showCounters, () => { updateCanvasData() })
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
        detail: { type: 'entity', entityId: node.id, entityType: 'magic' },
      }))
    },
    onBackgroundClick: () => { canvas.setSelectedId(null) },
    onHoverChange: () => {},
  })
  setTimeout(() => canvas.fitView(), 100)
})
</script>

<style scoped>
.st-view { display: flex; flex-direction: column; height: 100%; background: var(--color-bg-base); color: var(--color-text-primary); font-size: var(--font-size-sm); position: relative; }
.st-toolbar { display: flex; gap: 8px; align-items: center; padding: 8px 16px; background: var(--color-bg-surface); border-bottom: 1px solid var(--color-border); flex-shrink: 0; flex-wrap: wrap; }
.st-toolbar-group { display: flex; align-items: center; gap: 4px; }
.st-toolbar-label { font-size: var(--font-size-xs); color: var(--color-text-secondary); white-space: nowrap; }
.st-toolbar-sep { width: 1px; height: 20px; background: var(--color-border); margin: 0 4px; }
.st-toolbar-spacer { flex: 1; }
.st-btn { display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border: 1px solid var(--color-border); border-radius: var(--radius-xs); background: var(--color-bg-elevated); color: var(--color-text-primary); font-size: var(--font-size-sm); cursor: pointer; transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s; white-space: nowrap; }
.st-btn:hover { background: var(--color-bg-hover); border-color: var(--color-text-secondary); color: var(--color-text-primary); }
.st-btn.active { background: var(--color-bg-hover); border-color: var(--color-primary); color: var(--color-primary); }
.st-toggle { display: flex; align-items: center; gap: 4px; font-size: var(--font-size-sm); color: var(--color-text-secondary); cursor: pointer; }
.st-toggle input { accent-color: var(--color-primary); }
.st-count { font-size: var(--font-size-xs); color: var(--color-text-secondary); }
.st-main { flex: 1; min-height: 0; }
.st-canvas-container { width: 100%; height: 100%; }
.st-detail { position: absolute; right: 16px; top: 56px; width: 240px; background: var(--color-bg-surface); border: 1px solid var(--color-border); border-radius: var(--radius-mid); padding: 12px; box-shadow: var(--shadow-modal); z-index: 10; }
.st-detail-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.st-detail-icon { font-size: var(--font-size-xl); }
.st-detail-name { font-size: var(--font-size-base); font-weight: var(--font-weight-semibold); color: var(--color-text-primary); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.st-detail-close { background: none; border: none; color: var(--color-text-secondary); cursor: pointer; font-size: var(--font-size-base); padding: 2px; }
.st-detail-close:hover { color: var(--color-danger); }
.st-detail-fields { margin-bottom: 8px; }
.st-detail-row { display: flex; gap: 8px; font-size: var(--font-size-sm); margin-bottom: 3px; }
.st-label { color: var(--color-text-secondary); min-width: 48px; }
.st-detail-section { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--color-border); }
.st-section-title { font-size: var(--font-size-xs); color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 4px; }
.st-link { font-size: var(--font-size-sm); padding: 2px 6px; border-radius: var(--radius-2xs); cursor: pointer; color: var(--color-primary); margin-bottom: 2px; }
.st-link:hover { background: var(--color-primary-subtle); }
.st-link-red { color: var(--color-danger); }
.st-link-red:hover { background: rgba(248,81,73,0.1); }
</style>
