<template>
  <div class="wl-view">
    <!-- 筛选/视图模式 → 收束条 -->
    <Teleport to="#view-toolbar-filter-body">
      <div class="wl-toolbar-group">
        <button class="wl-btn" :class="{active: layoutMode === 'grid'}" @click="switchLayout('grid')">武器架</button>
        <button class="wl-btn" :class="{active: layoutMode === 'radial'}" @click="switchLayout('radial')">径向</button>
      </div>
      <div class="wl-toolbar-group">
        <span class="wl-toolbar-label">类型</span>
        <CustomDropdown v-model="filterType" :options="filterTypeOpts" />
      </div>
      <label class="wl-toggle"><input type="checkbox" v-model="showHolders" /> 持有者</label>
      <label class="wl-toggle"><input type="checkbox" v-model="showRelations" /> 克制/配套</label>
    </Teleport>
    <!-- 动作 → 动作落点 -->
    <Teleport to="#view-toolbar-actions">
      <button class="wl-btn" @click="$emit('back')" title="返回列表">
        <WsIcon name="chevron-right" :size="12" :stroke-width="2" />
        列表
      </button>
      <button class="wl-btn" @click="fitView" title="自动适配">⊞ 适配</button>
      <span class="wl-count">{{ filteredNodes.length }} 件武器</span>
    </Teleport>

    <div class="wl-main">
      <div ref="containerRef" class="wl-canvas-container"></div>
    </div>

    <div class="wl-detail" v-if="selectedNode">
      <div class="wl-detail-header">
        <span class="wl-detail-icon">{{ selectedNode.icon }}</span>
        <span class="wl-detail-name">{{ selectedNode.name }}</span>
        <button class="wl-detail-close" @click="canvas.setSelectedId(null)">✕</button>
      </div>
      <div class="wl-detail-fields">
        <div class="wl-detail-row"><span class="wl-label">类型</span><span>{{ selectedNode.weaponType }}</span></div>
        <div class="wl-detail-row"><span class="wl-label">品阶</span><span :style="{color: selectedNode.color}">{{ selectedNode.rank }}</span></div>
        <div class="wl-detail-row" v-if="selectedNode.status"><span class="wl-label">状态</span><span>{{ selectedNode.status }}</span></div>
        <div class="wl-detail-row" v-if="selectedNode.material"><span class="wl-label">材质</span><span>{{ selectedNode.material }}</span></div>
        <div class="wl-detail-row" v-if="selectedNode.smith"><span class="wl-label">铸造者</span><span>{{ selectedNode.smith }}</span></div>
      </div>
      <div class="wl-detail-section" v-if="selectedNode.specialAbilities">
        <span class="wl-section-title">特殊能力</span>
        <div class="wl-text">{{ selectedNode.specialAbilities }}</div>
      </div>
      <div class="wl-detail-section" v-if="currentHolder">
        <span class="wl-section-title">当前持有者</span>
        <div class="wl-link" role="button" tabindex="0" :aria-label="`打开 ${currentHolder.characterName}`" @click="navigateTo(currentHolder.characterId, 'character')" @keydown.enter.prevent="navigateTo(currentHolder.characterId, 'character')" @keydown.space.prevent="navigateTo(currentHolder.characterId, 'character')">{{ currentHolder.characterName }}</div>
      </div>
      <div class="wl-detail-section" v-if="pastHolders.length > 0">
        <span class="wl-section-title">历代持有者</span>
        <div v-for="h in pastHolders" :key="h.characterId" class="wl-link wl-link-dim" role="button" tabindex="0" :aria-label="`打开 ${h.characterName}`" @click="navigateTo(h.characterId, 'character')" @keydown.enter.prevent="navigateTo(h.characterId, 'character')" @keydown.space.prevent="navigateTo(h.characterId, 'character')">{{ h.characterName }}</div>
      </div>
      <div class="wl-detail-section" v-if="relatedWeapons.length > 0">
        <span class="wl-section-title">关联武器</span>
        <div v-for="r in relatedWeapons" :key="r.id" class="wl-link" :class="relationClass(r.relation)" role="button" tabindex="0" :aria-label="`打开 ${r.name}`" @click="selectById(r.id)" @keydown.enter.prevent="selectById(r.id)" @keydown.space.prevent="selectById(r.id)">{{ r.icon }} {{ r.name }} <span class="wl-relation-tag">{{ r.relation }}</span></div>
      </div>
      <div class="wl-detail-section" v-if="keyBattles.length > 0">
        <span class="wl-section-title">关键战役</span>
        <div v-for="b in keyBattles" :key="b.id" class="wl-link" role="button" tabindex="0" :aria-label="`打开 ${b.name}`" @click="navigateTo(b.id, 'event')" @keydown.enter.prevent="navigateTo(b.id, 'event')" @keydown.space.prevent="navigateTo(b.id, 'event')">{{ b.name }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import { useEntityStore, useRelationStore } from '@worldsea/entity-core'
import { CustomDropdown } from '@worldsea/plugin-sdk'
import { useWeaponLineageData, type WeaponNode } from './composables/useWeaponLineageData'
import { useWeaponLineageLayout, type WeaponLayoutMode } from './composables/useWeaponLineageLayout'
import { useWeaponLineageCanvas } from './composables/useWeaponLineageCanvas'

defineEmits<{ (e: 'back'): void }>()

const es = useEntityStore()
const rs = useRelationStore()
const containerRef = ref<HTMLElement | null>(null)
const layoutMode = ref<WeaponLayoutMode>('grid')
const filterType = ref('')
const showHolders = ref(true)
const showRelations = ref(true)

const { nodes, holderLinks, weaponEdges, weaponTypes } = useWeaponLineageData()
const { applyLayout } = useWeaponLineageLayout()

const canvas = useWeaponLineageCanvas(containerRef)

const filterTypeOpts = computed(() => [
  { value: '', label: '全部类型' },
  ...weaponTypes.value.map(t => ({ value: t, label: t })),
])

const filteredNodes = computed(() => {
  if (!filterType.value) return nodes.value
  return nodes.value.filter(n => n.weaponType === filterType.value)
})

const filteredEdges = computed(() => {
  const nodeIds = new Set(filteredNodes.value.map(n => n.id))
  return weaponEdges.value.filter(e => nodeIds.has(e.sourceId) && nodeIds.has(e.targetId))
})

const selectedNode = computed<WeaponNode | null>(() => {
  if (!canvas.selectedId.value) return null
  return filteredNodes.value.find(n => n.id === canvas.selectedId.value) || null
})

const currentHolder = computed(() => {
  if (!canvas.selectedId.value) return null
  return holderLinks.value.find(h => h.weaponId === canvas.selectedId.value && h.isCurrent) || null
})

const pastHolders = computed(() => {
  if (!canvas.selectedId.value) return []
  return holderLinks.value.filter(h => h.weaponId === canvas.selectedId.value && !h.isCurrent)
})

const relatedWeapons = computed(() => {
  if (!canvas.selectedId.value) return []
  return weaponEdges.value
    .filter(e => e.sourceId === canvas.selectedId.value || e.targetId === canvas.selectedId.value)
    .map(e => {
      const targetId = e.sourceId === canvas.selectedId.value ? e.targetId : e.sourceId
      const n = nodes.value.find(n => n.id === targetId)
      return n ? { ...n, relation: e.relation } : null
    })
    .filter((n): n is WeaponNode & { relation: string } => !!n)
})

const keyBattles = computed(() => {
  if (!canvas.selectedId.value) return []
  return rs.relations
    .filter(r => r.type === 'key_battles' && r.sourceId === canvas.selectedId.value)
    .map(r => es.entities?.find(e => e.id === r.targetId && e.type === 'event'))
    .filter(e => !!e)
    .map(e => ({ id: e!.id, name: e!.name }))
})

function relationClass(relation: string): string {
  const map: Record<string, string> = { '克制': 'wl-link-red', '配套': 'wl-link-green', '同源': 'wl-link-purple', '对立': 'wl-link-orange' }
  return map[relation] || ''
}

function switchLayout(mode: WeaponLayoutMode) {
  layoutMode.value = mode
  applyLayout(filteredNodes.value, mode)
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
  applyLayout(filteredNodes.value, layoutMode.value)
  canvas.markDirty()
}

function updateCanvasData() {
  canvas.setData(filteredNodes.value, filteredEdges.value, holderLinks.value, showHolders.value, showRelations.value)
}

watch(filterType, () => {
  canvas.setSelectedId(null)
  recalcLayout()
  updateCanvasData()
  setTimeout(() => canvas.fitView(), 50)
})

watch([showHolders, showRelations], () => {
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
      window.dispatchEvent(new CustomEvent('ws-navigate', {
        detail: { type: 'entity', entityId: node.id, entityType: 'item' },
      }))
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
.wl-view { display: flex; flex-direction: column; height: 100%; background: var(--color-bg-base); color: var(--color-text-primary); font-size: var(--font-size-sm); position: relative; }
.wl-toolbar { display: flex; gap: 8px; align-items: center; padding: 8px 16px; background: var(--color-bg-surface); border-bottom: 1px solid var(--color-border); flex-shrink: 0; flex-wrap: wrap; }
.wl-toolbar-group { display: flex; align-items: center; gap: 4px; }
.wl-toolbar-label { font-size: var(--font-size-xs); color: var(--color-text-secondary); white-space: nowrap; }
.wl-toolbar-sep { width: 1px; height: 20px; background: var(--color-border); margin: 0 4px; }
.wl-toolbar-spacer { flex: 1; }
.wl-btn { display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border: 1px solid var(--color-border); border-radius: var(--radius-xs); background: var(--color-bg-elevated); color: var(--color-text-primary); font-size: var(--font-size-sm); cursor: pointer; transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s; white-space: nowrap; }
.wl-btn:hover { background: var(--color-bg-hover); border-color: var(--color-text-secondary); color: var(--color-text-primary); }
.wl-btn.active { background: var(--color-bg-hover); border-color: var(--color-primary); color: var(--color-primary); }
.wl-toggle { display: flex; align-items: center; gap: 4px; font-size: var(--font-size-sm); color: var(--color-text-secondary); cursor: pointer; }
.wl-toggle input { accent-color: var(--color-primary); }
.wl-count { font-size: var(--font-size-xs); color: var(--color-text-secondary); }
.wl-main { flex: 1; min-height: 0; }
.wl-canvas-container { width: 100%; height: 100%; }
.wl-detail { position: absolute; right: 16px; top: 56px; width: 240px; background: var(--color-bg-surface); border: 1px solid var(--color-border); border-radius: var(--radius-mid); padding: 12px; box-shadow: var(--shadow-modal); z-index: 10; max-height: calc(100% - 72px); overflow-y: auto; }
.wl-detail-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.wl-detail-icon { font-size: var(--font-size-xl); }
.wl-detail-name { font-size: var(--font-size-base); font-weight: var(--font-weight-semibold); color: var(--color-text-primary); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wl-detail-close { background: none; border: none; color: var(--color-text-secondary); cursor: pointer; font-size: var(--font-size-base); padding: 2px; }
.wl-detail-close:hover { color: var(--color-danger); }
.wl-detail-fields { margin-bottom: 8px; }
.wl-detail-row { display: flex; gap: 8px; font-size: var(--font-size-sm); margin-bottom: 3px; }
.wl-label { color: var(--color-text-secondary); min-width: 48px; }
.wl-detail-section { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--color-border); }
.wl-section-title { font-size: var(--font-size-xs); color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 4px; }
.wl-text { font-size: var(--font-size-sm); color: var(--color-text-primary); line-height: 1.4; }
.wl-link { font-size: var(--font-size-sm); padding: 2px 6px; border-radius: var(--radius-2xs); cursor: pointer; color: var(--color-primary); margin-bottom: 2px; display: flex; align-items: center; gap: 4px; }
.wl-link:hover { background: var(--color-primary-subtle); }
.wl-link-dim { color: var(--color-text-secondary); }
.wl-link-dim:hover { background: rgba(139,148,158,0.1); }
.wl-link-red { color: var(--color-danger); }
.wl-link-red:hover { background: rgba(248,81,73,0.1); }
.wl-link-green { color: var(--color-success); }
.wl-link-green:hover { background: rgba(63,185,80,0.1); }
.wl-link-purple { color: var(--color-primary-hover); }
.wl-link-purple:hover { background: rgba(210,168,255,0.1); }
.wl-link-orange { color: #f0883e; }
.wl-link-orange:hover { background: rgba(240,136,62,0.1); }
.wl-relation-tag { font-size: var(--text-micro-font-size); color: var(--color-text-secondary); background: var(--color-bg-elevated); padding: 1px 4px; border-radius: 2px; }
</style>
