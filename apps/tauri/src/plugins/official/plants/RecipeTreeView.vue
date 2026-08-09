<template>
  <div class="rt-view">
    <div class="rt-toolbar">
      <button class="rt-btn" @click="$emit('back')" title="返回列表">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 3L5 8l5 5"/></svg>
        列表
      </button>
      <div class="rt-toolbar-sep"></div>
      <div class="rt-toolbar-group">
        <button class="rt-btn" :class="{active: layoutMode === 'bottom-up'}" @click="switchLayout('bottom-up')">配方树</button>
        <button class="rt-btn" :class="{active: layoutMode === 'radial'}" @click="switchLayout('radial')">径向</button>
      </div>
      <div class="rt-toolbar-sep"></div>
      <div class="rt-toolbar-group">
        <span class="rt-toolbar-label">节点</span>
        <CustomDropdown v-model="filterNodeType" :options="filterNodeTypeOpts" />
      </div>
      <div class="rt-toolbar-sep"></div>
      <label class="rt-toggle"><input type="checkbox" v-model="showMagic" /> 施法材料</label>
      <div class="rt-toolbar-spacer"></div>
      <button class="rt-btn" @click="fitView" title="自动适配">⊞ 适配</button>
      <span class="rt-count">{{ filteredNodes.length }} 个节点</span>
    </div>

    <div class="rt-main">
      <div ref="containerRef" class="rt-canvas-container"></div>
    </div>

    <div class="rt-detail" v-if="selectedNode">
      <div class="rt-detail-header">
        <span class="rt-detail-icon">{{ selectedNode.icon }}</span>
        <span class="rt-detail-name">{{ selectedNode.name }}</span>
        <button class="rt-detail-close" @click="canvas.setSelectedId(null)">✕</button>
      </div>
      <div class="rt-detail-fields">
        <div class="rt-detail-row"><span class="rt-label">类型</span><span>{{ selectedNode.nodeType === 'plant' ? '植物' : selectedNode.nodeType === 'item' ? '物品' : '魔法' }}</span></div>
        <div class="rt-detail-row"><span class="rt-label">子类</span><span>{{ selectedNode.subType }}</span></div>
        <div class="rt-detail-row" v-if="selectedNode.rarity"><span class="rt-label">稀有度</span><span :style="{color: selectedNode.color}">{{ selectedNode.rarity }}</span></div>
      </div>
      <div class="rt-detail-section" v-if="selectedEntity?.properties.toxicity">
        <span class="rt-section-title">毒性/副作用</span>
        <div class="rt-text">{{ selectedEntity.properties.toxicity }}</div>
      </div>
      <div class="rt-detail-section" v-if="selectedEntity?.properties.usage">
        <span class="rt-section-title">用途</span>
        <div class="rt-text">{{ selectedEntity.properties.usage }}</div>
      </div>
      <div class="rt-detail-section" v-if="selectedEntity?.properties.appearance">
        <span class="rt-section-title">外观</span>
        <div class="rt-text">{{ selectedEntity.properties.appearance }}</div>
      </div>
      <div class="rt-detail-section" v-if="producedItems.length > 0">
        <span class="rt-section-title">制成品</span>
        <div v-for="i in producedItems" :key="i.id" class="rt-link" role="button" tabindex="0" :aria-label="`打开 ${i.name}`" @click="selectById(i.id)" @keydown.enter.prevent="selectById(i.id)" @keydown.space.prevent="selectById(i.id)"><WsIcon name="item" size="xs" /> {{ i.name }}</div>
      </div>
      <div class="rt-detail-section" v-if="sourcePlants.length > 0">
        <span class="rt-section-title">来源植物</span>
        <div v-for="p in sourcePlants" :key="p.id" class="rt-link rt-link-green" role="button" tabindex="0" :aria-label="`打开 ${p.name}`" @click="selectById(p.id)" @keydown.enter.prevent="selectById(p.id)" @keydown.space.prevent="selectById(p.id)"><WsIcon name="plant" size="xs" /> {{ p.name }}</div>
      </div>
      <div class="rt-detail-section" v-if="magicSpells.length > 0">
        <span class="rt-section-title">施法用途</span>
        <div v-for="m in magicSpells" :key="m.id" class="rt-link rt-link-purple" role="button" tabindex="0" :aria-label="`打开 ${m.name}`" @click="navigateTo(m.id, 'magic')" @keydown.enter.prevent="navigateTo(m.id, 'magic')" @keydown.space.prevent="navigateTo(m.id, 'magic')"><WsIcon name="magic" size="xs" /> {{ m.name }}</div>
      </div>
      <div class="rt-detail-section" v-if="nativeRegions.length > 0">
        <span class="rt-section-title">原生地</span>
        <div v-for="r in nativeRegions" :key="r.id" class="rt-link" role="button" tabindex="0" :aria-label="`打开 ${r.name}`" @click="navigateTo(r.id, 'region')" @keydown.enter.prevent="navigateTo(r.id, 'region')" @keydown.space.prevent="navigateTo(r.id, 'region')"><WsIcon name="location" size="xs" /> {{ r.name }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import { useEntityStore, useRelationStore } from '@worldsmith/entity-core'
import { CustomDropdown } from '@worldsmith/plugin-sdk'
import { useRecipeTreeData, type RecipeNode } from './composables/useRecipeTreeData'
import { useRecipeTreeLayout, type RecipeLayoutMode } from './composables/useRecipeTreeLayout'
import { useRecipeTreeCanvas } from './composables/useRecipeTreeCanvas'

defineEmits<{ (e: 'back'): void }>()

const es = useEntityStore()
const rs = useRelationStore()
const containerRef = ref<HTMLElement | null>(null)
const layoutMode = ref<RecipeLayoutMode>('bottom-up')
const filterNodeType = ref('')
const showMagic = ref(true)

const { nodes, edges } = useRecipeTreeData()
const { applyLayout } = useRecipeTreeLayout()

const canvas = useRecipeTreeCanvas(containerRef)

const filterNodeTypeOpts = [
  { value: '', label: '全部' },
  { value: 'plant', label: '植物' },
  { value: 'item', label: '物品' },
  { value: 'magic', label: '魔法' },
]

const filteredNodes = computed(() => {
  if (!filterNodeType.value) return nodes.value
  return nodes.value.filter(n => n.nodeType === filterNodeType.value)
})

const filteredEdges = computed(() => {
  const nodeIds = new Set(filteredNodes.value.map(n => n.id))
  return edges.value.filter(e => nodeIds.has(e.sourceId) && nodeIds.has(e.targetId))
})

const selectedNode = computed<RecipeNode | null>(() => {
  if (!canvas.selectedId.value) return null
  return nodes.value.find(n => n.id === canvas.selectedId.value) || null
})

const selectedEntity = computed(() => {
  if (!canvas.selectedId.value) return null
  return es.entities?.find(e => e.id === canvas.selectedId.value) || null
})

const producedItems = computed(() => {
  if (!canvas.selectedId.value) return []
  return edges.value
    .filter(e => e.sourceId === canvas.selectedId.value && e.edgeType === 'materials_from')
    .map(e => { const n = nodes.value.find(n => n.id === e.targetId); return n ? { id: n.id, name: n.name } : null })
    .filter((n): n is { id: string; name: string } => !!n)
})

const sourcePlants = computed(() => {
  if (!canvas.selectedId.value) return []
  return edges.value
    .filter(e => e.targetId === canvas.selectedId.value && e.edgeType === 'materials_from')
    .map(e => { const n = nodes.value.find(n => n.id === e.sourceId); return n ? { id: n.id, name: n.name } : null })
    .filter((n): n is { id: string; name: string } => !!n)
})

const magicSpells = computed(() => {
  if (!canvas.selectedId.value) return []
  return rs.relations
    .filter(r => r.type === 'magic_material' && r.sourceId === canvas.selectedId.value)
    .map(r => es.entities?.find(e => e.id === r.targetId && e.type === 'magic'))
    .filter(e => !!e)
    .map(e => ({ id: e!.id, name: e!.name }))
})

const nativeRegions = computed(() => {
  if (!canvas.selectedId.value) return []
  return rs.relations
    .filter(r => r.type === 'native_to' && r.sourceId === canvas.selectedId.value)
    .map(r => es.entities?.find(e => e.id === r.targetId && e.type === 'region'))
    .filter(e => !!e)
    .map(e => ({ id: e!.id, name: e!.name }))
})

function switchLayout(mode: RecipeLayoutMode) {
  layoutMode.value = mode
  applyLayout(filteredNodes.value, filteredEdges.value, mode)
  canvas.markDirty()
  setTimeout(() => canvas.fitView(), 50)
}

function fitView() { canvas.fitView() }

function selectById(id: string) { canvas.setSelectedId(id) }

function navigateTo(entityId: string, entityType: string) {
  window.dispatchEvent(new CustomEvent('ws-navigate', { detail: { type: 'entity', entityId, entityType } }))
}

function recalcLayout() {
  applyLayout(filteredNodes.value, filteredEdges.value, layoutMode.value)
  canvas.markDirty()
}

function updateCanvasData() {
  canvas.setData(filteredNodes.value, filteredEdges.value, showMagic.value)
}

watch(filterNodeType, () => {
  canvas.setSelectedId(null)
  recalcLayout()
  updateCanvasData()
  setTimeout(() => canvas.fitView(), 50)
})

watch(showMagic, () => {
  updateCanvasData()
})

watch([filteredNodes, filteredEdges], () => {
  updateCanvasData()
})

onMounted(async () => {
  await es.loadAll()
  await rs.loadAll()
  recalcLayout()
  updateCanvasData()
  canvas.setCallbacks({
    onNodeClick: (node) => {
      canvas.setSelectedId(canvas.selectedId.value === node.id ? null : node.id)
    },
    onNodeDoubleClick: (node) => {
      const et = node.nodeType === 'plant' ? 'plant' : node.nodeType === 'magic' ? 'magic' : 'item'
      window.dispatchEvent(new CustomEvent('ws-navigate', { detail: { type: 'entity', entityId: node.id, entityType: et } }))
    },
    onBackgroundClick: () => {
      canvas.setSelectedId(null)
    },
    onHoverChange: () => {},
  })
  setTimeout(() => canvas.fitView(), 100)
})
</script>

<style scoped>
.rt-view { display: flex; flex-direction: column; height: 100%; background: var(--color-bg-base); color: var(--color-text-primary); font-size: var(--font-size-sm); position: relative; }
.rt-toolbar { display: flex; gap: 8px; align-items: center; padding: 8px 16px; background: var(--color-bg-surface); border-bottom: 1px solid var(--color-border); flex-shrink: 0; flex-wrap: wrap; }
.rt-toolbar-group { display: flex; align-items: center; gap: 4px; }
.rt-toolbar-label { font-size: var(--font-size-xs); color: var(--color-text-secondary); white-space: nowrap; }
.rt-toolbar-sep { width: 1px; height: 20px; background: var(--color-border); margin: 0 4px; }
.rt-toolbar-spacer { flex: 1; }
.rt-btn { display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border: 1px solid var(--color-border); border-radius: var(--radius-xs); background: var(--color-bg-elevated); color: var(--color-text-primary); font-size: var(--font-size-sm); cursor: pointer; transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s; white-space: nowrap; }
.rt-btn:hover { background: var(--color-bg-hover); border-color: var(--color-text-secondary); color: var(--color-text-primary); }
.rt-btn.active { background: var(--color-bg-hover); border-color: var(--color-primary); color: var(--color-primary); }
.rt-toggle { display: flex; align-items: center; gap: 4px; font-size: var(--font-size-sm); color: var(--color-text-secondary); cursor: pointer; }
.rt-toggle input { accent-color: var(--color-primary); }
.rt-count { font-size: var(--font-size-xs); color: var(--color-text-secondary); }
.rt-main { flex: 1; min-height: 0; }
.rt-canvas-container { width: 100%; height: 100%; }
.rt-detail { position: absolute; right: 16px; top: 56px; width: 240px; background: var(--color-bg-surface); border: 1px solid var(--color-border); border-radius: var(--radius-mid); padding: 12px; box-shadow: var(--shadow-modal); z-index: 10; max-height: calc(100% - 72px); overflow-y: auto; }
.rt-detail-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.rt-detail-icon { font-size: var(--font-size-xl); }
.rt-detail-name { font-size: var(--font-size-base); font-weight: var(--font-weight-semibold); color: var(--color-text-primary); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rt-detail-close { background: none; border: none; color: var(--color-text-secondary); cursor: pointer; font-size: var(--font-size-base); padding: 2px; }
.rt-detail-close:hover { color: var(--color-danger); }
.rt-detail-fields { margin-bottom: 8px; }
.rt-detail-row { display: flex; gap: 8px; font-size: var(--font-size-sm); margin-bottom: 3px; }
.rt-label { color: var(--color-text-secondary); min-width: 48px; }
.rt-detail-section { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--color-border); }
.rt-section-title { font-size: var(--font-size-xs); color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 4px; }
.rt-text { font-size: var(--font-size-sm); color: var(--color-text-primary); line-height: 1.4; }
.rt-link { font-size: var(--font-size-sm); padding: 2px 6px; border-radius: var(--radius-2xs); cursor: pointer; color: var(--color-primary); margin-bottom: 2px; }
.rt-link:hover { background: var(--color-primary-subtle); }
.rt-link-green { color: var(--color-success); }
.rt-link-green:hover { background: rgba(63,185,80,0.1); }
.rt-link-purple { color: var(--color-primary-hover); }
.rt-link-purple:hover { background: rgba(210,168,255,0.1); }
</style>

