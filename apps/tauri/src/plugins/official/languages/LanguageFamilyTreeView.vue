<template>
  <div class="lft-view">
    <div class="lft-toolbar">
      <button class="lft-btn" @click="$emit('back')" title="返回列表">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 3L5 8l5 5"/></svg>
        列表
      </button>
      <div class="lft-toolbar-sep"></div>
      <div class="lft-toolbar-group">
        <button class="lft-btn" :class="{active: layoutMode === 'top-down'}" @click="switchLayout('top-down')">语系树</button>
        <button class="lft-btn" :class="{active: layoutMode === 'radial'}" @click="switchLayout('radial')">径向</button>
      </div>
      <div class="lft-toolbar-sep"></div>
      <div class="lft-toolbar-group">
        <span class="lft-toolbar-label">语系</span>
        <CustomDropdown v-model="filterFamily" :options="filterFamilyOpts" />
      </div>
      <div class="lft-toolbar-group">
        <span class="lft-toolbar-label">类型</span>
        <CustomDropdown v-model="filterType" :options="filterTypeOpts" />
      </div>
      <div class="lft-toolbar-sep"></div>
      <label class="lft-toggle"><input type="checkbox" v-model="showRelated" /> 关联</label>
      <label class="lft-toggle" v-if="layoutMode === 'top-down'"><input type="checkbox" v-model="showClusters" /> 聚类</label>
      <div class="lft-toolbar-spacer"></div>
      <button class="lft-btn" @click="fitView" title="自动适配">⊞ 适配</button>
      <span class="lft-count">{{ filteredNodes.length }} 种语言</span>
    </div>

    <div class="lft-main">
      <div ref="containerRef" class="lft-canvas-container"></div>
    </div>

    <div class="lft-detail" v-if="selectedNode">
      <div class="lft-detail-header">
        <span class="lft-detail-icon">{{ selectedNode.icon }}</span>
        <span class="lft-detail-name">{{ selectedNode.name }}</span>
        <button class="lft-detail-close" @click="canvas.setSelectedId(null)">✕</button>
      </div>
      <div class="lft-detail-fields">
        <div class="lft-detail-row"><span class="lft-label">类型</span><span>{{ selectedNode.langType }}</span></div>
        <div class="lft-detail-row"><span class="lft-label">文字</span><span>{{ selectedNode.scriptType || '—' }}</span></div>
        <div class="lft-detail-row"><span class="lft-label">语系</span><span>{{ selectedNode.languageFamily || '—' }}</span></div>
        <div class="lft-detail-row" v-if="selectedEntity?.properties.scope"><span class="lft-label">范围</span><span>{{ selectedEntity.properties.scope }}</span></div>
        <div class="lft-detail-row" v-if="selectedEntity?.properties.maturity"><span class="lft-label">成熟度</span><span>{{ selectedEntity.properties.maturity }}</span></div>
      </div>
      <div class="lft-detail-section" v-if="selectedEntity?.properties.phonology">
        <span class="lft-section-title">音系特点</span>
        <div class="lft-text">{{ selectedEntity.properties.phonology }}</div>
      </div>
      <div class="lft-detail-section" v-if="selectedEntity?.properties.grammar">
        <span class="lft-section-title">语法特点</span>
        <div class="lft-text">{{ selectedEntity.properties.grammar }}</div>
      </div>
      <div class="lft-detail-section" v-if="selectedEntity?.properties.vocabulary">
        <span class="lft-section-title">词汇示例</span>
        <div class="lft-text">{{ selectedEntity.properties.vocabulary }}</div>
      </div>
      <div class="lft-detail-section" v-if="branchParents.length > 0">
        <span class="lft-section-title">分支来源</span>
        <div v-for="p in branchParents" :key="p.id" class="lft-link" @click="selectById(p.id)">{{ p.icon }} {{ p.name }}</div>
      </div>
      <div class="lft-detail-section" v-if="branchChildren.length > 0">
        <span class="lft-section-title">分支语言</span>
        <div v-for="c in branchChildren" :key="c.id" class="lft-link" @click="selectById(c.id)">{{ c.icon }} {{ c.name }}</div>
      </div>
      <div class="lft-detail-section" v-if="relatedLangs.length > 0">
        <span class="lft-section-title">关联语言</span>
        <div v-for="r in relatedLangs" :key="r.id" class="lft-link" :class="relatedLinkClass(r.relation)" @click="selectById(r.id)">{{ r.icon }} {{ r.name }} <span class="lft-relation-tag">{{ r.relation }}</span></div>
      </div>
      <div class="lft-detail-section" v-if="spokenBySpecies.length > 0">
        <span class="lft-section-title">使用者</span>
        <div v-for="s in spokenBySpecies" :key="s.id" class="lft-link" @click="navigateTo(s.id, 'species')">{{ s.name }}</div>
      </div>
      <div class="lft-detail-section" v-if="spokenInRegions.length > 0">
        <span class="lft-section-title">通行区域</span>
        <div v-for="r in spokenInRegions" :key="r.id" class="lft-link" @click="navigateTo(r.id, 'region')">{{ r.name }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useEntityStore, useRelationStore } from '@worldsmith/entity-core'
import { CustomDropdown } from '@worldsmith/plugin-sdk'
import { useLangFamilyTreeData, type LangNode, type LangRelation } from './composables/useLangFamilyTreeData'
import { useLangFamilyTreeLayout, type LangLayoutMode } from './composables/useLangFamilyTreeLayout'
import { useLangFamilyTreeCanvas } from './composables/useLangFamilyTreeCanvas'

defineEmits<{ (e: 'back'): void }>()

const es = useEntityStore()
const rs = useRelationStore()
const containerRef = ref<HTMLElement | null>(null)
const layoutMode = ref<LangLayoutMode>('top-down')
const filterFamily = ref('')
const filterType = ref('')
const showRelated = ref(true)
const showClusters = ref(true)

const { langEntities, nodes, edges, families } = useLangFamilyTreeData()
const { applyLayout } = useLangFamilyTreeLayout()

const canvas = useLangFamilyTreeCanvas(containerRef)

const filterFamilyOpts = computed(() => [
  { value: '', label: '全部语系' },
  ...families.value.map(f => ({ value: f, label: f })),
])

const filterTypeOpts = [
  { value: '', label: '全部类型' },
  { value: '自然语言', label: '自然语言' }, { value: '魔法语言', label: '魔法语言' },
  { value: '古代语', label: '古代语' }, { value: '方言', label: '方言' },
  { value: '手语', label: '手语' }, { value: '密码', label: '密码/密文' },
]

const filteredNodes = computed(() => {
  let result = nodes.value
  if (filterFamily.value) result = result.filter(n => n.languageFamily === filterFamily.value)
  if (filterType.value) result = result.filter(n => n.langType === filterType.value)
  return result
})

const filteredEdges = computed(() => {
  const nodeIds = new Set(filteredNodes.value.map(n => n.id))
  return edges.value.filter(e => nodeIds.has(e.sourceId) && nodeIds.has(e.targetId))
})

const selectedNode = computed<LangNode | null>(() => {
  if (!canvas.selectedId.value) return null
  return filteredNodes.value.find(n => n.id === canvas.selectedId.value) || null
})

const selectedEntity = computed(() => {
  if (!canvas.selectedId.value) return null
  return langEntities.value.find(e => e.id === canvas.selectedId.value) || null
})

const branchParents = computed(() => {
  if (!canvas.selectedId.value) return []
  return edges.value
    .filter(e => e.type === 'branch' && e.targetId === canvas.selectedId.value)
    .map(e => nodes.value.find(n => n.id === e.sourceId))
    .filter((n): n is LangNode => !!n)
})

const branchChildren = computed(() => {
  if (!canvas.selectedId.value) return []
  return edges.value
    .filter(e => e.type === 'branch' && e.sourceId === canvas.selectedId.value)
    .map(e => nodes.value.find(n => n.id === e.targetId))
    .filter((n): n is LangNode => !!n)
})

const relatedLangs = computed(() => {
  if (!canvas.selectedId.value) return []
  return edges.value
    .filter(e => e.type === 'related' && (e.sourceId === canvas.selectedId.value || e.targetId === canvas.selectedId.value))
    .map(e => {
      const targetId = e.sourceId === canvas.selectedId.value ? e.targetId : e.sourceId
      const n = nodes.value.find(n => n.id === targetId)
      return n ? { ...n, relation: e.relation || '同源' as LangRelation } : null
    })
    .filter((n): n is LangNode & { relation: LangRelation } => !!n)
})

function relatedLinkClass(relation: LangRelation): string {
  const map: Record<LangRelation, string> = {
    '同源': 'lft-link-green', '借词': 'lft-link-yellow', '混合': 'lft-link-purple',
    '变体': 'lft-link-blue', '祖先语言': 'lft-link-gray',
  }
  return map[relation] || ''
}

function getRelatedEntities(targetType: string, relType: string) {
  if (!canvas.selectedId.value) return []
  return rs.relations
    .filter(r => r.type === relType && r.sourceId === canvas.selectedId.value)
    .map(r => es.entities?.find(e => e.id === r.targetId && e.type === targetType))
    .filter(e => !!e)
    .map(e => ({ id: e!.id, name: e!.name }))
}

const spokenBySpecies = computed(() => getRelatedEntities('species', 'spoken_by'))
const spokenInRegions = computed(() => getRelatedEntities('region', 'spoken_in'))

function switchLayout(mode: LangLayoutMode) {
  layoutMode.value = mode
  applyLayout(filteredNodes.value, filteredEdges.value, mode)
  canvas.setLayoutMode(mode)
  canvas.markDirty()
  setTimeout(() => canvas.fitView(), 50)
}

function fitView() { canvas.fitView() }

function selectById(id: string) {
  canvas.setSelectedId(id)
}

function navigateTo(entityId: string, entityType: string) {
  window.dispatchEvent(new CustomEvent('ws-navigate', {
    detail: { type: 'entity', entityId, entityType },
  }))
}

function recalcLayout() {
  applyLayout(filteredNodes.value, filteredEdges.value, layoutMode.value)
  canvas.markDirty()
}

function updateCanvasData() {
  canvas.setData(filteredNodes.value, filteredEdges.value, showRelated.value)
}

watch([filterFamily, filterType], () => {
  recalcLayout()
  updateCanvasData()
  setTimeout(() => canvas.fitView(), 50)
})

watch(showRelated, () => { updateCanvasData() })
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
        detail: { type: 'entity', entityId: node.id, entityType: 'language' },
      }))
    },
    onBackgroundClick: () => { canvas.setSelectedId(null) },
    onHoverChange: () => {},
  })
  setTimeout(() => canvas.fitView(), 100)
})
</script>

<style scoped>
.lft-view { display: flex; flex-direction: column; height: 100%; background: var(--color-bg-base); color: var(--color-text-primary); font-size: var(--font-size-sm); position: relative; }
.lft-toolbar { display: flex; gap: 8px; align-items: center; padding: 8px 16px; background: var(--color-bg-surface); border-bottom: 1px solid var(--color-border); flex-shrink: 0; flex-wrap: wrap; }
.lft-toolbar-group { display: flex; align-items: center; gap: 4px; }
.lft-toolbar-label { font-size: var(--font-size-xs); color: var(--color-text-secondary); white-space: nowrap; }
.lft-toolbar-sep { width: 1px; height: 20px; background: var(--color-border); margin: 0 4px; }
.lft-toolbar-spacer { flex: 1; }
.lft-btn { display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border: 1px solid var(--color-border); border-radius: 4px; background: var(--color-bg-elevated); color: var(--color-text-primary); font-size: var(--font-size-sm); cursor: pointer; transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s; white-space: nowrap; }
.lft-btn:hover { background: var(--color-bg-hover); border-color: var(--color-text-secondary); color: var(--color-text-primary); }
.lft-btn.active { background: var(--color-bg-hover); border-color: var(--color-primary); color: var(--color-primary); }
.lft-toggle { display: flex; align-items: center; gap: 4px; font-size: var(--font-size-sm); color: var(--color-text-secondary); cursor: pointer; }
.lft-toggle input { accent-color: var(--color-primary); }
.lft-count { font-size: var(--font-size-xs); color: var(--color-text-secondary); }
.lft-main { flex: 1; min-height: 0; }
.lft-canvas-container { width: 100%; height: 100%; }
.lft-detail { position: absolute; right: 16px; top: 56px; width: 240px; background: var(--color-bg-surface); border: 1px solid var(--color-border); border-radius: 8px; padding: 12px; box-shadow: var(--shadow-modal); z-index: 10; max-height: calc(100% - 72px); overflow-y: auto; }
.lft-detail-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.lft-detail-icon { font-size: var(--font-size-xl); }
.lft-detail-name { font-size: var(--font-size-base); font-weight: var(--font-weight-semibold); color: var(--color-text-primary); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lft-detail-close { background: none; border: none; color: var(--color-text-secondary); cursor: pointer; font-size: var(--font-size-base); padding: 2px; }
.lft-detail-close:hover { color: var(--color-danger); }
.lft-detail-fields { margin-bottom: 8px; }
.lft-detail-row { display: flex; gap: 8px; font-size: var(--font-size-sm); margin-bottom: 3px; }
.lft-label { color: var(--color-text-secondary); min-width: 48px; }
.lft-detail-section { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--color-border); }
.lft-section-title { font-size: var(--font-size-xs); color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 4px; }
.lft-text { font-size: var(--font-size-sm); color: var(--color-text-primary); line-height: 1.4; }
.lft-link { font-size: var(--font-size-sm); padding: 2px 6px; border-radius: 3px; cursor: pointer; color: var(--color-primary); margin-bottom: 2px; display: flex; align-items: center; gap: 4px; }
.lft-link:hover { background: var(--color-primary-subtle); }
.lft-relation-tag { font-size: var(--text-micro-font-size); color: var(--color-text-secondary); background: var(--color-bg-elevated); padding: 1px 4px; border-radius: 2px; }
.lft-link-green { color: var(--color-success); }
.lft-link-green:hover { background: rgba(63,185,80,0.1); }
.lft-link-yellow { color: #d29922; }
.lft-link-yellow:hover { background: rgba(210,153,34,0.1); }
.lft-link-purple { color: var(--color-primary-hover); }
.lft-link-purple:hover { background: rgba(210,168,255,0.1); }
.lft-link-blue { color: #79c0ff; }
.lft-link-blue:hover { background: rgba(121,192,255,0.1); }
.lft-link-gray { color: var(--color-text-secondary); }
.lft-link-gray:hover { background: rgba(139,148,158,0.1); }
</style>
