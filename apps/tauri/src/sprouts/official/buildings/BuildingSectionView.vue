<template>
  <div class="bs-view">
    <!-- 工具栏按控件类型分发到 R3 统一工具条各落点（筛选→收束条，动作→动作区） -->
    <Teleport to="#view-toolbar-filter-body">
      <div class="bs-toolbar-group">
        <span class="bs-toolbar-label">类型</span>
        <CustomDropdown v-model="filterType" :options="filterTypeOpts" />
      </div>
      <label class="bs-toggle"><input type="checkbox" v-model="showConnections" /> 通道</label>
    </Teleport>
    <Teleport to="#view-toolbar-actions">
      <button class="bs-btn" @click="$emit('back')" title="返回列表">
        <WsIcon name="chevron-right" :size="12" :stroke-width="2" />
        列表
      </button>
      <button class="bs-btn" @click="fitView" title="自动适配">⊞ 适配</button>
      <span class="bs-count">{{ filteredNodes.length }} 栋建筑</span>
    </Teleport>

    <div class="bs-main">
      <div ref="containerRef" class="bs-canvas-container"></div>
    </div>

    <div class="bs-detail" v-if="selectedNode">
      <div class="bs-detail-header">
        <span class="bs-detail-icon">{{ selectedNode.icon }}</span>
        <span class="bs-detail-name">{{ selectedNode.name }}</span>
        <button class="bs-detail-close" @click="collapseAll">✕</button>
      </div>
      <div class="bs-detail-fields">
        <div class="bs-detail-row"><span class="bs-label">类型</span><span>{{ selectedNode.buildingType }}</span></div>
        <div class="bs-detail-row"><span class="bs-label">层数</span><span>{{ selectedNode.floors }}</span></div>
        <div class="bs-detail-row" v-if="selectedNode.style"><span class="bs-label">风格</span><span>{{ selectedNode.style }}</span></div>
        <div class="bs-detail-row" v-if="selectedNode.material"><span class="bs-label">材料</span><span>{{ selectedNode.material }}</span></div>
        <div class="bs-detail-row" v-if="selectedNode.status"><span class="bs-label">状态</span><span>{{ selectedNode.status }}</span></div>
      </div>
      <div class="bs-detail-section" v-if="selectedFloors.length > 0">
        <span class="bs-section-title">楼层详情</span>
        <div v-for="f in selectedFloors" :key="f.index" class="bs-floor-row">
          <span class="bs-floor-label" :style="{color: selectedNode.color}">{{ f.label }}</span>
          <span class="bs-floor-content">{{ f.content || '—' }}</span>
        </div>
      </div>
      <div class="bs-detail-section" v-if="residents.length > 0">
        <span class="bs-section-title">居民</span>
        <div v-for="r in residents" :key="r.id" class="bs-link" role="button" tabindex="0" :aria-label="`打开 ${r.name}`" @click="navigateTo(r.id, 'character')" @keydown.enter.prevent="navigateTo(r.id, 'character')" @keydown.space.prevent="navigateTo(r.id, 'character')">{{ r.name }}</div>
      </div>
      <div class="bs-detail-section" v-if="storedItems.length > 0">
        <span class="bs-section-title">存放物品</span>
        <div v-for="it in storedItems" :key="it.id" class="bs-link" role="button" tabindex="0" :aria-label="`打开 ${it.name}`" @click="navigateTo(it.id, 'item')" @keydown.enter.prevent="navigateTo(it.id, 'item')" @keydown.space.prevent="navigateTo(it.id, 'item')">{{ it.name }}</div>
      </div>
      <div class="bs-detail-section" v-if="buildingConnections.length > 0">
        <span class="bs-section-title">通道连接</span>
        <div v-for="c in buildingConnections" :key="c.targetId" class="bs-link bs-link-dim">
          <span class="bs-route-tag" :style="{color: routeColor(c.routeType)}">{{ c.routeType }}</span>
          {{ connectedName(c.targetId) }}
        </div>
      </div>
      <div class="bs-detail-section" v-if="selectedNode.significance">
        <span class="bs-section-title">文化意义</span>
        <div class="bs-text">{{ selectedNode.significance }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import { useEntityStore, useRelationStore } from '@worldsea/entity-core'
import { CustomDropdown } from '@worldsea/plugin-sdk'
import { useBuildingSectionData, parseFloors, type BuildingNode, type FloorInfo } from './composables/useBuildingSectionData'
import { useBuildingSectionCanvas } from './composables/useBuildingSectionCanvas'

defineEmits<{ (e: 'back'): void }>()

const es = useEntityStore()
const rs = useRelationStore()
const containerRef = ref<HTMLElement | null>(null)
const filterType = ref('')
const showConnections = ref(true)

const { nodes, connections, buildingTypes, getResidents, getStoredItems } = useBuildingSectionData()

const canvas = useBuildingSectionCanvas(containerRef)

const filterTypeOpts = computed(() => [
  { value: '', label: '全部类型' },
  ...buildingTypes.value.map(t => ({ value: t, label: t })),
])

const filteredNodes = computed(() => {
  const list = filterType.value
    ? nodes.value.filter(n => n.buildingType === filterType.value)
    : nodes.value
  return list
})

const filteredConnections = computed(() => {
  const nodeIds = new Set(filteredNodes.value.map(n => n.id))
  return connections.value.filter(c => nodeIds.has(c.sourceId) && nodeIds.has(c.targetId))
})

const selectedNode = computed<BuildingNode | null>(() => {
  if (!canvas.selectedId.value) return null
  return filteredNodes.value.find(n => n.id === canvas.selectedId.value) || null
})

const selectedFloors = computed<FloorInfo[]>(() => {
  if (!selectedNode.value) return []
  return parseFloors(selectedNode.value.interior, selectedNode.value.floors)
})

const residents = computed(() => {
  if (!canvas.selectedId.value) return []
  return getResidents(canvas.selectedId.value)
})

const storedItems = computed(() => {
  if (!canvas.selectedId.value) return []
  return getStoredItems(canvas.selectedId.value)
})

const buildingConnections = computed(() => {
  if (!canvas.selectedId.value) return []
  return connections.value.filter(
    c => c.sourceId === canvas.selectedId.value || c.targetId === canvas.selectedId.value,
  )
})

function connectedName(id: string): string {
  const e = es.entities?.find(e => e.id === id)
  return e ? e.name : id.slice(0, 8)
}

function routeColor(routeType: string): string {
  const map: Record<string, string> = {
    '门': '#3fb950', '走廊': '#58a6ff', '地道': '#8b949e',
    '桥': '#d29922', '传送门': '#d2a8ff', '密道': '#f0883e',
  }
  return map[routeType] || '#8b949e'
}

function collapseAll() {
  canvas.setSelectedId(null)
}

function fitView() { canvas.fitView() }

function navigateTo(entityId: string, entityType: string) {
  window.dispatchEvent(new CustomEvent('ws-navigate', {
    detail: { type: 'entity', entityId, entityType },
  }))
}

function applyGridLayout(nodeList: BuildingNode[]) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(nodeList.length * 1.5)))
  const gapX = 140
  const gapY = 110
  const offsetX = -(cols - 1) * gapX / 2
  const offsetY = -(Math.ceil(nodeList.length / cols) - 1) * gapY / 2

  for (let i = 0; i < nodeList.length; i++) {
    const col = i % cols
    const row = Math.floor(i / cols)
    nodeList[i].x = offsetX + col * gapX
    nodeList[i].y = offsetY + row * gapY
  }
}

function recalcLayout() {
  applyGridLayout(filteredNodes.value)
  canvas.markDirty()
}

function updateCanvasData() {
  const conns = showConnections.value ? filteredConnections.value : []
  canvas.setData(filteredNodes.value, conns)
}

watch(filterType, () => {
  canvas.setSelectedId(null)
  recalcLayout()
  updateCanvasData()
  setTimeout(() => canvas.fitView(), 50)
})

watch(showConnections, () => {
  updateCanvasData()
})

watch([filteredNodes, filteredConnections], () => {
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
        detail: { type: 'entity', entityId: node.id, entityType: 'building' },
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
.bs-view { display: flex; flex-direction: column; height: 100%; background: var(--color-bg-base); color: var(--color-text-primary); font-size: var(--font-size-sm); position: relative; }
.bs-toolbar { display: flex; gap: 8px; align-items: center; padding: 0; background: transparent; border-bottom: none; flex-shrink: 0; flex-wrap: nowrap; min-width: 0; }
.bs-toolbar-group { display: flex; align-items: center; gap: 4px; }
.bs-toolbar-label { font-size: var(--font-size-xs); color: var(--color-text-secondary); white-space: nowrap; }
.bs-toolbar-sep { width: 1px; height: 20px; background: var(--color-border); margin: 0 4px; }
.bs-toolbar-spacer { flex: 1; }
.bs-btn { display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border: 1px solid var(--color-border); border-radius: var(--radius-xs); background: var(--color-bg-elevated); color: var(--color-text-primary); font-size: var(--font-size-sm); cursor: pointer; transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s; white-space: nowrap; }
.bs-btn:hover { background: var(--color-bg-hover); border-color: var(--color-text-secondary); color: var(--color-text-primary); }
.bs-toggle { display: flex; align-items: center; gap: 4px; font-size: var(--font-size-sm); color: var(--color-text-secondary); cursor: pointer; }
.bs-toggle input { accent-color: var(--color-primary); }
.bs-count { font-size: var(--font-size-xs); color: var(--color-text-secondary); }
.bs-main { flex: 1; min-height: 0; }
.bs-canvas-container { width: 100%; height: 100%; }
.bs-detail { position: absolute; right: 16px; top: 16px; width: 240px; background: var(--color-bg-surface); border: 1px solid var(--color-border); border-radius: var(--radius-mid); padding: 12px; box-shadow: var(--shadow-modal); z-index: 10; max-height: calc(100% - 32px); overflow-y: auto; }
.bs-detail-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.bs-detail-icon { font-size: var(--font-size-xl); }
.bs-detail-name { font-size: var(--font-size-base); font-weight: var(--font-weight-semibold); color: var(--color-text-primary); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bs-detail-close { background: none; border: none; color: var(--color-text-secondary); cursor: pointer; font-size: var(--font-size-base); padding: 2px; }
.bs-detail-close:hover { color: var(--color-danger); }
.bs-detail-fields { margin-bottom: 8px; }
.bs-detail-row { display: flex; gap: 8px; font-size: var(--font-size-sm); margin-bottom: 3px; }
.bs-label { color: var(--color-text-secondary); min-width: 48px; }
.bs-detail-section { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--color-border); }
.bs-section-title { font-size: var(--font-size-xs); color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 4px; }
.bs-text { font-size: var(--font-size-sm); color: var(--color-text-primary); line-height: 1.4; }
.bs-floor-row { display: flex; gap: 6px; font-size: var(--font-size-sm); margin-bottom: 2px; align-items: baseline; }
.bs-floor-label { font-weight: var(--font-weight-semibold); min-width: 28px; }
.bs-floor-content { color: var(--color-text-primary); }
.bs-link { font-size: var(--font-size-sm); padding: 2px 6px; border-radius: var(--radius-2xs); cursor: pointer; color: var(--color-primary); margin-bottom: 2px; display: flex; align-items: center; gap: 4px; }
.bs-link:hover { background: var(--color-primary-subtle); }
.bs-link-dim { color: var(--color-text-secondary); }
.bs-link-dim:hover { background: color-mix(in srgb, var(--color-text-secondary) 10%, transparent); }
.bs-route-tag { font-size: var(--text-micro-font-size); background: var(--color-bg-elevated); padding: 1px 4px; border-radius: 2px; }
</style>
