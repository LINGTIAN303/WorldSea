<template>
  <div class="rs-view">
    <div class="rs-toolbar">
      <button class="rs-btn" @click="$emit('back')" title="返回列表">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 3L5 8l5 5"/></svg>
        列表
      </button>
      <div class="rs-toolbar-sep"></div>
      <div class="rs-toolbar-group">
        <span class="rs-toolbar-label">体系</span>
        <CustomDropdown v-model="filterSystem" :options="filterSystemOpts" />
      </div>
      <div class="rs-toolbar-spacer"></div>
      <span class="rs-count">{{ filteredSteps.length }} 个境界</span>
    </div>

    <div class="rs-main">
      <div ref="containerRef" class="rs-canvas-container"></div>
    </div>

    <div class="rs-detail" v-if="selectedStep">
      <div class="rs-detail-header">
        <span class="rs-detail-icon">{{ selectedStep.icon }}</span>
        <span class="rs-detail-name">{{ selectedStep.name }}</span>
        <button class="rs-detail-close" @click="canvas.setSelectedId(null)">✕</button>
      </div>
      <div class="rs-detail-fields">
        <div class="rs-detail-row"><span class="rs-label">体系</span><span>{{ selectedStep.system }}</span></div>
        <div class="rs-detail-row"><span class="rs-label">境界</span><span>{{ selectedStep.realm || '—' }}</span></div>
        <div class="rs-detail-row"><span class="rs-label">层级</span><span>T{{ selectedStep.tier }}</span></div>
        <div class="rs-detail-row" v-if="selectedStep.culture"><span class="rs-label">文化</span><span>{{ selectedStep.culture }}</span></div>
      </div>
      <div class="rs-detail-section" v-if="selectedStep.power">
        <span class="rs-section-title">战力表现</span>
        <div class="rs-text">{{ selectedStep.power }}</div>
      </div>
      <div class="rs-detail-section" v-if="selectedStep.promotion">
        <span class="rs-section-title">晋升条件</span>
        <div class="rs-text">{{ selectedStep.promotion }}</div>
      </div>
      <div class="rs-detail-section" v-if="selectedStep.bottleneck">
        <span class="rs-section-title">瓶颈/限制</span>
        <div class="rs-text">{{ selectedStep.bottleneck }}</div>
      </div>
      <div class="rs-detail-section" v-if="relatedChars.length > 0">
        <span class="rs-section-title">当前境界角色</span>
        <div v-for="c in relatedChars" :key="c.id" class="rs-link" @click="navigateTo(c.id, 'character')">{{ c.name }}</div>
      </div>
      <div class="rs-detail-section" v-if="relatedSkills.length > 0">
        <span class="rs-section-title">所需技能</span>
        <div v-for="s in relatedSkills" :key="s.id" class="rs-link" @click="navigateTo(s.id, 'magic')">{{ s.name }}</div>
      </div>
      <div class="rs-detail-section" v-if="relatedItems.length > 0">
        <span class="rs-section-title">突破丹药/法器</span>
        <div v-for="i in relatedItems" :key="i.id" class="rs-link" @click="navigateTo(i.id, 'item')">{{ i.name }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useEntityStore, useRelationStore } from '@worldsmith/entity-core'
import { CustomDropdown } from '@worldsmith/plugin-sdk'
import { useRealmStaircaseData, type RealmStep } from './composables/useRealmStaircaseData'
import { useRealmStaircaseCanvas } from './composables/useRealmStaircaseCanvas'

defineEmits<{ (e: 'back'): void }>()

const es = useEntityStore()
const rs = useRelationStore()
const containerRef = ref<HTMLElement | null>(null)
const filterSystem = ref('')

const { steps, systems } = useRealmStaircaseData()
const canvas = useRealmStaircaseCanvas(containerRef)

const filterSystemOpts = computed(() => [
  { value: '', label: '全部体系' },
  ...systems.value.map(s => ({ value: s, label: s })),
])

const filteredSteps = computed(() => {
  if (!filterSystem.value) return steps.value
  return steps.value.filter(s => s.system === filterSystem.value)
})

const selectedStep = computed<RealmStep | null>(() => {
  if (!canvas.selectedId.value) return null
  return steps.value.find(s => s.id === canvas.selectedId.value) || null
})

function getRelated(targetType: string, relType: string) {
  if (!canvas.selectedId.value) return []
  return rs.relations
    .filter(r => r.type === relType && r.sourceId === canvas.selectedId.value)
    .map(r => es.entities?.find(e => e.id === r.targetId && e.type === targetType))
    .filter(e => !!e)
    .map(e => ({ id: e!.id, name: e!.name }))
}

const relatedChars = computed(() => getRelated('character', 'current_realm'))
const relatedSkills = computed(() => getRelated('magic', 'required_skill'))
const relatedItems = computed(() => getRelated('item', 'breakthrough_item'))

function navigateTo(entityId: string, entityType: string) {
  window.dispatchEvent(new CustomEvent('ws-navigate', {
    detail: { type: 'entity', entityId, entityType },
  }))
}

watch(filterSystem, () => {
  canvas.setData(steps.value, filterSystem.value)
  setTimeout(() => canvas.fitView(), 50)
})

onMounted(async () => {
  await es.loadAll()
  await rs.loadAll()
  canvas.setData(steps.value, filterSystem.value)
  canvas.setCallbacks({
    onNodeClick: (node) => { canvas.setSelectedId(node.id) },
    onNodeDoubleClick: (node) => {
      window.dispatchEvent(new CustomEvent('ws-navigate', {
        detail: { type: 'entity', entityId: node.id, entityType: 'combat_stat' },
      }))
    },
    onBackgroundClick: () => { canvas.setSelectedId(null) },
    onHoverChange: () => {},
  })
  setTimeout(() => canvas.fitView(), 100)
})
</script>

<style scoped>
.rs-view { display: flex; flex-direction: column; height: 100%; background: var(--color-bg-base); color: var(--color-text-primary); font-size: var(--font-size-sm); position: relative; }
.rs-toolbar { display: flex; gap: 8px; align-items: center; padding: 8px 16px; background: var(--color-bg-surface); border-bottom: 1px solid var(--color-border); flex-shrink: 0; flex-wrap: wrap; }
.rs-toolbar-group { display: flex; align-items: center; gap: 4px; }
.rs-toolbar-label { font-size: var(--font-size-xs); color: var(--color-text-secondary); white-space: nowrap; }
.rs-toolbar-sep { width: 1px; height: 20px; background: var(--color-border); margin: 0 4px; }
.rs-toolbar-spacer { flex: 1; }
.rs-btn { display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border: 1px solid var(--color-border); border-radius: var(--radius-xs); background: var(--color-bg-elevated); color: var(--color-text-primary); font-size: var(--font-size-sm); cursor: pointer; transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s; white-space: nowrap; }
.rs-btn:hover { background: var(--color-bg-hover); border-color: var(--color-text-secondary); color: var(--color-text-primary); }
.rs-count { font-size: var(--font-size-xs); color: var(--color-text-secondary); }
.rs-main { flex: 1; min-height: 0; }
.rs-canvas-container { width: 100%; height: 100%; }
.rs-detail { position: absolute; right: 16px; top: 56px; width: 240px; background: var(--color-bg-surface); border: 1px solid var(--color-border); border-radius: var(--radius-mid); padding: 12px; box-shadow: var(--shadow-modal); z-index: 10; max-height: calc(100% - 72px); overflow-y: auto; }
.rs-detail-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.rs-detail-icon { font-size: var(--font-size-xl); }
.rs-detail-name { font-size: var(--font-size-base); font-weight: var(--font-weight-semibold); color: var(--color-text-primary); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rs-detail-close { background: none; border: none; color: var(--color-text-secondary); cursor: pointer; font-size: var(--font-size-base); padding: 2px; }
.rs-detail-close:hover { color: var(--color-danger); }
.rs-detail-fields { margin-bottom: 8px; }
.rs-detail-row { display: flex; gap: 8px; font-size: var(--font-size-sm); margin-bottom: 3px; }
.rs-label { color: var(--color-text-secondary); min-width: 48px; }
.rs-detail-section { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--color-border); }
.rs-section-title { font-size: var(--font-size-xs); color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 4px; }
.rs-text { font-size: var(--font-size-sm); color: var(--color-text-primary); line-height: 1.4; }
.rs-link { font-size: var(--font-size-sm); padding: 2px 6px; border-radius: var(--radius-2xs); cursor: pointer; color: var(--color-primary); margin-bottom: 2px; }
.rs-link:hover { background: var(--color-primary-subtle); }
</style>
