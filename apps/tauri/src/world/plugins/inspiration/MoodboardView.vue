<template>
  <div class="mv-view">
    <!-- 筛选 → 收束条 -->
    <Teleport to="#view-toolbar-filter-body">
      <div class="mv-toolbar-group">
        <span class="mv-toolbar-label">筛选</span>
        <CustomDropdown v-model="filterType" :options="filterOptions" />
      </div>
    </Teleport>
    <!-- 动作 → 动作落点 -->
    <Teleport to="#view-toolbar-actions">
      <button class="mv-btn" @click="$emit('back')" title="返回列表">
        <WsIcon name="chevron-right" :size="12" :stroke-width="2" />
        列表
      </button>
      <button class="mv-btn" @click="autoLayout" title="自动排列">≡ 排列</button>
      <span class="mv-count">{{ filteredCards.length }} 项素材</span>
    </Teleport>

    <div class="mv-main">
      <MoodboardCanvas
        :cards="filteredCards"
        :selectedCardId="selectedCardId"
        @cardClick="onCardClick"
        @cardDoubleClick="onCardDoubleClick"
        @cardRightClick="onCardRightClick"
        @cardDragEnd="onCardDragEnd"
        @backgroundClick="selectedCardId = null"
      />
    </div>

    <div class="mv-detail" v-if="selectedEntity">
      <div class="mv-detail-header">
        <span class="mv-detail-name">{{ selectedEntity.name }}</span>
        <button class="mv-detail-close" @click="selectedCardId = null">✕</button>
      </div>
      <div class="mv-detail-type">{{ (selectedEntity.properties.materialType as string) || '其他' }}</div>
      <div class="mv-detail-row" v-if="selectedEntity.properties.source">
        <span class="mv-label">来源</span>
        <span>{{ selectedEntity.properties.source }}</span>
      </div>
      <div class="mv-detail-row" v-if="selectedEntity.properties.url">
        <span class="mv-label">链接</span>
        <a :href="String(selectedEntity.properties.url)" target="_blank" class="mv-link">{{ selectedEntity.properties.url }}</a>
      </div>
      <div class="mv-detail-row" v-if="selectedEntity.properties.notes">
        <span class="mv-label">笔记</span>
        <span class="mv-detail-notes">{{ selectedEntity.properties.notes }}</span>
      </div>
      <div class="mv-detail-colors" v-if="selectedColors.length > 0">
        <span class="mv-label">主色调</span>
        <div class="mv-color-row">
          <span v-for="c in selectedColors" :key="c.hex" class="mv-color-swatch"
            :style="{ background: c.hex }" :title="c.hex"></span>
        </div>
      </div>
    </div>

    <div class="mv-context-menu" v-if="ctxMenu.visible" :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }">
      <button class="mv-ctx-btn" @click="onCtxEdit">✎ 编辑</button>
      <button class="mv-ctx-btn mv-ctx-danger" @click="onCtxDelete">✖ 删除</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import { CustomDropdown } from '@worldsea/plugin-sdk'
import MoodboardCanvas from './components/MoodboardCanvas.vue'
import { getWorldService } from '../../service-registry'
import type { WorldEntitiesService } from '../../services'
import type { CardData } from './composables/moodboardDraw'
import { extractColorsFromUrl } from './composables/useColorExtractor'
import type { Entity } from '@worldsea/entity-core'

/** 取数经树服务（唯一取数通道，换数据源只改 services.ts）；取不到属时序被破坏，报错不降级。 */
function entitiesSvc(): WorldEntitiesService {
  const svc = getWorldService<WorldEntitiesService>('world.entities')
  if (!svc) throw new Error('[inspiration] world.entities 服务未就绪（视图渲染早于起树）')
  return svc
}

defineEmits<{ (e: 'back'): void }>()

const filterType = ref('')
const selectedCardId = ref<string | null>(null)
const cardPositions = ref<Map<string, { x: number; y: number }>>(new Map())
const entityColors = ref<Map<string, string[]>>(new Map())

const filterOptions = [
  { value: '', label: '全部' },
  { value: '图片', label: '图片' },
  { value: '视频', label: '视频' },
  { value: '文章', label: '文章' },
  { value: '音乐', label: '音乐' },
  { value: '概念', label: '概念' },
  { value: '角色', label: '角色' },
  { value: '场景', label: '场景' },
  { value: '对话', label: '对话' },
  { value: '其他', label: '其他' },
]

const ctxMenu = ref<{ visible: boolean; x: number; y: number; cardId: string }>({
  visible: false, x: 0, y: 0, cardId: '',
})

const inspirationEntities = computed(() => {
  return (entitiesSvc().list() ?? []).filter(e => e.type === 'inspiration')
})

const filteredCards = computed<CardData[]>(() => {
  let entities = inspirationEntities.value
  if (filterType.value) {
    entities = entities.filter(e => e.properties.materialType === filterType.value)
  }
  return entities.map(e => entityToCard(e))
})

const selectedEntity = computed<Entity | null>(() => {
  if (!selectedCardId.value) return null
  return inspirationEntities.value.find(e => e.id === selectedCardId.value) || null
})

const selectedColors = computed(() => {
  if (!selectedCardId.value) return []
  const colors = entityColors.value.get(selectedCardId.value) || []
  return colors.map(hex => ({ hex, r: 0, g: 0, b: 0, ratio: 0 }))
})

function entityToCard(e: Entity): CardData {
  const pos = cardPositions.value.get(e.id)
  const type = (e.properties.materialType as string) || '其他'
  const url = e.properties.url as string | undefined
  const isImage = type === '图片' && url
  const colors = entityColors.value.get(e.id) || []

  return {
    id: e.id,
    entityId: e.id,
    name: e.name,
    type,
    x: pos?.x ?? 0,
    y: pos?.y ?? 0,
    w: isImage ? 200 : 180,
    h: isImage ? 240 : 160,
    imageUrl: isImage ? url : null,
    color: null,
    text: !isImage && e.description ? e.description : (e.properties.notes as string || null),
    colors,
  }
}

function autoLayout() {
  const cols = 4
  const gapX = 220
  const gapY = 180
  const startX = -((Math.min(cols, filteredCards.value.length) - 1) * gapX) / 2
  const startY = -((Math.ceil(filteredCards.value.length / cols) - 1) * gapY) / 2

  const newPositions = new Map<string, { x: number; y: number }>()
  for (let i = 0; i < filteredCards.value.length; i++) {
    const col = i % cols
    const row = Math.floor(i / cols)
    newPositions.set(filteredCards.value[i].id, {
      x: startX + col * gapX,
      y: startY + row * gapY,
    })
  }
  cardPositions.value = newPositions
}

async function extractColorsForEntities() {
  for (const e of inspirationEntities.value) {
    const url = e.properties.url as string | undefined
    const type = e.properties.materialType as string
    if (type === '图片' && url && !entityColors.value.has(e.id)) {
      try {
        const colors = await extractColorsFromUrl(url, 5)
        if (colors.length > 0) {
          entityColors.value.set(e.id, colors.map(c => c.hex))
          entityColors.value = new Map(entityColors.value)
        }
      } catch {}
    }
  }
}

function onCardClick(card: CardData) {
  selectedCardId.value = card.id
}

function onCardDoubleClick(card: CardData) {
  const entity = inspirationEntities.value.find(e => e.id === card.id)
  if (entity) {
    window.dispatchEvent(new CustomEvent('ws-navigate', {
      detail: { entityType: 'inspiration', entityId: entity.id },
    }))
  }
}

function onCardRightClick(card: CardData) {
  selectedCardId.value = card.id
}

function onCardDragEnd(card: CardData, x: number, y: number) {
  cardPositions.value.set(card.id, { x, y })
  cardPositions.value = new Map(cardPositions.value)
}

function onCtxEdit() {
  ctxMenu.value.visible = false
}

function onCtxDelete() {
  if (ctxMenu.value.cardId) {
    entitiesSvc().remove(ctxMenu.value.cardId)
  }
  ctxMenu.value.visible = false
}

watch(filterType, () => { selectedCardId.value = null })

watch(inspirationEntities, () => {
  extractColorsForEntities()
}, { deep: true })

onMounted(async () => {
  entitiesSvc().reload()
  autoLayout()
  setTimeout(() => extractColorsForEntities(), 500)
})
</script>

<style scoped>
.mv-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-bg-base);
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  position: relative;
}

.mv-toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 8px 16px;
  background: var(--color-bg-surface);
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.mv-toolbar-group { display: flex; align-items: center; gap: 4px; }
.mv-toolbar-label { font-size: var(--font-size-xs); color: var(--color-text-secondary); white-space: nowrap; }
.mv-toolbar-sep { width: 1px; height: 20px; background: var(--color-border); margin: 0 4px; }
.mv-toolbar-spacer { flex: 1; }

.mv-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s;
  white-space: nowrap;
}

.mv-btn:hover { background: var(--color-bg-hover); border-color: var(--color-text-secondary); color: var(--color-text-primary); }

.mv-count { font-size: var(--font-size-xs); color: var(--color-text-secondary); }

.mv-main { flex: 1; min-height: 0; }

.mv-detail {
  position: absolute;
  right: 16px;
  top: 56px;
  width: 240px;
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 12px;
  box-shadow: var(--shadow-card);
  z-index: 10;
}

.mv-detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.mv-detail-name {
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.mv-detail-close {
  background: none;
  border: none;
  color: var(--color-text-secondary);
  cursor: pointer;
  font-size: var(--font-size-base);
  padding: 2px;
}

.mv-detail-close:hover { color: var(--color-danger); }

.mv-detail-type {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
}

.mv-detail-row {
  display: flex;
  gap: 8px;
  font-size: var(--font-size-sm);
  margin-bottom: 4px;
}

.mv-label { color: var(--color-text-secondary); min-width: 32px; }

.mv-link {
  color: var(--color-primary);
  text-decoration: none;
  word-break: break-all;
}

.mv-link:hover { text-decoration: underline; }

.mv-detail-notes {
  color: var(--color-text-primary);
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 80px;
  overflow-y: auto;
}

.mv-detail-colors {
  margin-top: 8px;
}

.mv-color-row {
  display: flex;
  gap: 4px;
  margin-top: 4px;
}

.mv-color-swatch {
  width: 20px;
  height: 20px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
}

.mv-context-menu {
  position: fixed;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: 4px;
  z-index: 100;
  box-shadow: var(--shadow-dropdown);
}

.mv-ctx-btn {
  display: block;
  width: 100%;
  padding: 4px 12px;
  border: none;
  background: none;
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  cursor: pointer;
  text-align: left;
  border-radius: var(--radius-xs);
}

.mv-ctx-btn:hover { background: var(--color-bg-hover); }
.mv-ctx-danger { color: var(--color-danger); }
.mv-ctx-danger:hover { background: color-mix(in srgb, var(--color-danger) 10%, transparent); }
</style>
