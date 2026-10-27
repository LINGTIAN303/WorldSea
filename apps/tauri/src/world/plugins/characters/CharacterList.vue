<template>
  <div class="character-view">
    <GenericEntityView
      ref="gevRef"
      entityType="character"
      :filter-defs="filterDefs"
      :sort-options="sortOptions"
      :custom-tabs="customTabs"
      :detail-layout="DETAIL_LAYOUT" detail-carrier="column"
      entity-label="角色"
      id-prefix="chr"
      :icon-fn="() => 'character'"
      card-subtitle="role"
      @select-entity="onSelectEntity"
    >
      <template #toolbar-extra>
        <TuiButton variant="secondary" size="sm" icon="compare" :active="compareMode" @click="toggleCompareMode">对比</TuiButton>
        <CustomDropdown v-model="selectedTemplate" :options="templateOptions" placeholder="模板创建" @update:model-value="onTemplateSelect" />
      </template>

      <template #detail-header="{ entity }">
        <span class="dp-avatar"><template v-if="entity?.avatar">{{ entity?.avatar }}</template><WsIcon v-else :name="entitySchemaRegistry.getIconName('character')" :size="22" /></span>
        <div class="dp-title-area">
          <h3>{{ entity?.name || '' }}</h3>
          <span class="dp-type-label">角色</span>
        </div>
      </template>

      <template #tab-family="{ entity }">
        <FamilyTree :character-id="entity.id" @navigate="onFamilyNavigate" @switch-to-profile="switchToInfoTab" />
      </template>

      <template #tab-relation-graph="{ entity }">
        <RelationGraph :character-id="entity.id" @navigate="onFamilyNavigate" />
      </template>

      <template #tab-experience="{ entity }">
        <CharacterExperience :character-id="entity.id" @switch-to-profile="switchToInfoTab" />
      </template>

      <template #tab-names="{ entity }">
        <div class="dp-help">角色在不同阶段或不同人面前有不同的称呼</div>
        <div v-for="(n, idx) in alternateNames" :key="idx" class="dp-name-row">
          <input v-model="n.name" class="dp-name-input" placeholder="称呼" />
          <input v-model="n.context" class="dp-name-ctx" placeholder="使用场景" />
          <button class="dp-name-rm" @click="removeName(idx)"><WsIcon name="close" size="xs" /></button>
        </div>
        <button class="btn-sm-add" @click="addName">＋ 添加称呼</button>
        <TuiButton variant="secondary" size="sm" style="margin-top:8px" @click="saveNames(entity)">保存称呼</TuiButton>
      </template>

      <template #tab-appearance="{ entity }">
        <div class="dp-help">记录角色不同时期的外貌变化</div>
        <div v-for="(a, idx) in appearanceStages" :key="idx" class="dp-app-row">
          <input v-model="a.stage" class="dp-app-stage" placeholder="时期（少年、成年）" />
          <textarea v-model="a.description" class="dp-app-desc" placeholder="外貌描述" rows="2"></textarea>
          <button class="dp-name-rm" @click="removeAppearance(idx)"><WsIcon name="close" size="xs" /></button>
        </div>
        <button class="btn-sm-add" @click="addAppearance">＋ 添加外貌阶段</button>
        <TuiButton variant="secondary" size="sm" style="margin-top:8px" @click="saveAppearances(entity)">保存外貌记录</TuiButton>
      </template>

      <template #tab-equipment="{ entity }">
        <div class="dp-body-grid">
          <div v-for="slot in bodySlots" :key="slot.id" class="dp-body-slot" :class="{ 'dp-slot-empty': !slotItems(entity.id, slot.id).length }">
            <div class="dp-slot-label"><WsIcon :name="slot.icon" size="xs" /> {{ slot.label }}</div>
            <div v-for="item in slotItems(entity.id, slot.id)" :key="item.id" class="dp-equip-card">
              <div class="dp-equip-header">
                <span class="dp-equip-icon"><WsIcon :name="apparelIcon(item)" size="xs" /></span>
                <span class="dp-equip-armor" :class="'armor-' + armorKey(item)">{{ armorLabel(item) }}</span>
              </div>
              <div class="dp-equip-body">
                <h4>{{ item.name }}</h4>
                <div class="dp-equip-tags">
                  <span class="dp-equip-type">{{ (item.properties.apparelType as string) || '服饰' }}</span>
                  <span v-if="item.properties.defense" class="dp-equip-def"><WsIcon name="shield" size="xs" /> {{ item.properties.defense }}</span>
                  <button class="dp-equip-unequip" @click="unequipApparel(entity.id, item.id)" title="卸下"><WsIcon name="close" size="xs" /></button>
                </div>
              </div>
            </div>
            <div v-if="!slotItems(entity.id, slot.id).length" class="dp-slot-placeholder">空</div>
          </div>
        </div>
        <p v-if="getWornApparel(entity.id).length === 0" class="dp-help">该角色当前未穿戴任何服饰</p>
        <EntityRelationSelector :entity-id="entity.id" entity-type="character" relation-type="worn_by" :reverse-direction="true" />
      </template>
    </GenericEntityView>

    <Transition name="ws-detail-backdrop">
      <div v-if="compareMode && compareChars.length === 2" class="compare-overlay">
        <div class="compare-panel">
          <div class="compare-header">
            <h3>角色对比</h3>
            <button class="detail-close" @click="compareMode = false; compareIds = []" aria-label="关闭"><WsIcon name="close" size="xs" /></button>
          </div>
          <div class="compare-table">
            <div class="compare-row compare-row-header">
              <span class="compare-label">属性</span>
              <span v-for="c in compareChars" :key="c.id" class="compare-val">{{ c.name }}</span>
            </div>
            <div v-for="key in compareFields" :key="key" class="compare-row">
              <span class="compare-label">{{ fieldLabel(key) }}</span>
              <span v-for="c in compareChars" :key="c.id" class="compare-val"
                :class="{ 'compare-diff': isDiff(key, c, compareChars) }">
                {{ c.properties?.[key] || '—' }}
              </span>
            </div>
            <div class="compare-row">
              <span class="compare-label">标签</span>
              <span v-for="c in compareChars" :key="c.id" class="compare-val">
                {{ c.tags?.join(', ') || '—' }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { TuiButton, WsIcon  } from '@worldsea/ui-kit'
import { useEntityStore, useRelationStore, entitySchemaRegistry, useUIStore } from '@worldsea/entity-core'
import type { Entity } from '@worldsea/entity-core'
import FamilyTree from './components/FamilyTree.vue'
import RelationGraph from './components/RelationGraph.vue'
import CharacterExperience from './components/CharacterExperience.vue'

import { GenericEntityView, EntityRelationSelector, CustomDropdown, useShortcuts, useUndoRedo } from '@worldsea/plugin-sdk'
import { toastSuccess } from '@worldsea/ui-kit'
import { characterTemplates } from './characterTemplates'
import { DETAIL_TAB_DECLARATIONS } from '../../detailTabDeclarations'
import type { FilterDef, CustomTabDef, LayoutSource } from '@worldsea/plugin-sdk'

const entityStore = useEntityStore()
const relationStore = useRelationStore()
const charSchema = computed(() => entitySchemaRegistry.get('character'))
const { register, unregister } = useShortcuts()
const { undo, redo } = useUndoRedo()

// ── GenericEntityView ref ──
const gevRef = ref<InstanceType<typeof GenericEntityView> | null>(null)

/** 角色详情以正文为主，默认段落式；用户在抽屉里选过之后以覆写为准 */
const DETAIL_LAYOUT: LayoutSource = { contentForm: 'narrative' }
// ── Filter definitions (dynamic) ──
const filterDefs: FilterDef[] = [
  { key: 'gender', label: '性别', dynamic: true },
  { key: 'race', label: '种族', dynamic: true },
  { key: 'occupation', label: '职业', dynamic: true },
  { key: 'faction', label: '势力', dynamic: true },
  { key: 'age', label: '年龄', dynamic: true },
]

// ── Sort options ──
const sortOptions = [
  { key: 'name', label: '名称' },
  { key: 'gender', label: '性别' },
  { key: 'race', label: '种族' },
  { key: 'age', label: '年龄' },
  { key: 'occupation', label: '职业' },
]

// ── Custom tabs（声明单点在 world/detailTabDeclarations.ts——设置面「Tab 管理」卡与图标守卫共用）──
const customTabs: CustomTabDef[] = DETAIL_TAB_DECLARATIONS.character?.custom ?? []

// ── Compare mode ──
const compareMode = ref(false)
const compareIds = ref<string[]>([])

function toggleCompareMode() {
  compareMode.value = !compareMode.value
  compareIds.value = []
}

function toggleCompareChar(id: string) {
  const idx = compareIds.value.indexOf(id)
  if (idx >= 0) {
    compareIds.value.splice(idx, 1)
  } else if (compareIds.value.length < 2) {
    compareIds.value.push(id)
  }
}

const compareChars = computed(() =>
  compareIds.value.map(id => entityStore.entityMap.get(id)).filter(Boolean) as Entity[]
)

const compareFields = computed(() => {
  const allKeys = new Set<string>()
  for (const c of compareChars.value) {
    if (c.properties) for (const k of Object.keys(c.properties)) {
      if (!k.startsWith('_')) allKeys.add(k)
    }
  }
  return Array.from(allKeys)
})

function isDiff(key: string, _char: Entity, all: Entity[]) {
  if (all.length < 2) return false
  const vals = all.map(c => String(c.properties?.[key] ?? ''))
  return new Set(vals).size > 1
}

function fieldLabel(key: string): string {
  const field = charSchema.value?.fields.find((f: any) => f.key === key)
  return field?.label || key
}

// ── Template creation ──
const selectedTemplate = ref('')

const templateOptions = [
  { value: '', label: '模板创建' },
  ...characterTemplates.map(t => ({ value: t.id, label: t.name })),
]

function onTemplateSelect(id: string) {
  if (!id) return
  const tpl = characterTemplates.find(t => t.id === id)
  if (!tpl) return
  selectedTemplate.value = ''
  gevRef.value?.openFormWithDefaults(tpl.defaults)
}

// ── Select entity handler (for compare mode interception) ──
function onSelectEntity(entity: Entity) {
  if (compareMode.value) {
    toggleCompareChar(entity.id)
    return
  }
  // Track selected entity for names/appearances loading
  loadEntityTabData(entity)
  // Dispatch ws-select-entity for cross-plugin navigation
  window.dispatchEvent(new CustomEvent('ws-select-entity', { detail: { entityId: entity.id } }))
}

// ── ws-select-entity listener (cross-plugin navigation) ──
function selectCharacterById(id?: string | null) {
  const entity = entityStore.entityMap.get(id ?? '')
  if (!entity || entity.type !== 'character') return
  gevRef.value?.selectEntityById(entity.id)
  loadEntityTabData(entity)
}
function onWsSelectEntity(e: Event) {
  selectCharacterById((e as CustomEvent).detail?.entityId)
}

// ── Undo/Redo shortcuts ──
onMounted(() => {
  window.addEventListener('ws-select-entity', onWsSelectEntity)
  void entityStore.loadAll().then(() => selectCharacterById(useUIStore().selectedEntityId)) // 跨视图跳转挂起位兜底（见 Shell.onWsNavigate）

  const undoKeys = ['ctrl', 'z']
  const redoKeys = ['ctrl', 'y']
  register({ id: 'character.undo', keys: undoKeys, scope: 'view', description: '角色：撤销', handler: () => undo(entityStore, relationStore) })
  register({ id: 'character.redo', keys: redoKeys, scope: 'view', description: '角色：重做', handler: () => redo(entityStore, relationStore) })
})

onBeforeUnmount(() => {
  window.removeEventListener('ws-select-entity', onWsSelectEntity)
  unregister('character.undo')
  unregister('character.redo')
})

// ── Alternate names management ──
const alternateNames = ref<{ name: string; context: string }[]>([])

function loadNames(entity: Entity): { name: string; context: string }[] {
  try {
    const raw = entity?.properties?._altNames as string
    return raw ? JSON.parse(raw) : [{ name: '', context: '' }]
  } catch { return [{ name: '', context: '' }] }
}

async function saveNames(entity: Entity) {
  const names = alternateNames.value.filter(n => n.name.trim())
  await entityStore.update(entity.id, {
    properties: { ...entity.properties, _altNames: JSON.stringify(names) },
  })
  await entityStore.loadByType('character')
  toastSuccess('称呼已保存')
}

function addName() { alternateNames.value.push({ name: '', context: '' }) }
function removeName(idx: number) { alternateNames.value.splice(idx, 1) }

// ── Appearance stages management ──
const appearanceStages = ref<{ stage: string; description: string }[]>([])

function loadAppearances(entity: Entity): { stage: string; description: string }[] {
  try {
    const raw = entity?.properties?._appearances as string
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

async function saveAppearances(entity: Entity) {
  const apps = appearanceStages.value.filter(a => a.stage.trim())
  await entityStore.update(entity.id, {
    properties: { ...entity.properties, _appearances: JSON.stringify(apps) },
  })
  await entityStore.loadByType('character')
  toastSuccess('外貌记录已保存')
}

function addAppearance() { appearanceStages.value.push({ stage: '', description: '' }) }
function removeAppearance(idx: number) { appearanceStages.value.splice(idx, 1) }

// ── Track selected entity for names/appearances loading ──

function loadEntityTabData(entity: Entity) {
  alternateNames.value = loadNames(entity)
  appearanceStages.value = loadAppearances(entity)
  relationStore.loadAll()
}

// ── Equipment / worn apparel ──
function getWornApparel(characterId: string): Entity[] {
  const rels = relationStore.relations.filter(r =>
    r.type === 'worn_by' && r.targetId === characterId
  )
  return rels.map(r => entityStore.entities.find(e => e.id === r.sourceId)).filter(Boolean) as Entity[]
}

function apparelIcon(item: Entity): string {
  const t = (item.properties.apparelType as string) || ''
  const map: Record<string, string> = {
    '上衣': 'clothing', '外套/披风': 'clothing', '法袍': 'clothing',
    '下装': 'pants', '连衣裙': 'dress',
    '头饰': 'crown', '鞋履': 'boots', '手套': 'gloves',
    '饰品/首饰': 'ring', '轻甲': 'shield', '中甲': 'shield',
    '重甲': 'shield', '盾牌': 'shield', '套装': 'item',
  }
  return map[t] || 'clothing'
}

function armorLabel(item: Entity): string {
  return (item.properties.armorClass as string) || '无防护'
}

function armorKey(item: Entity): string {
  const v = armorLabel(item)
  const map: Record<string, string> = {
    '无防护': 'none', '布甲': 'cloth', '皮甲': 'leather',
    '锁甲': 'chain', '板甲': 'plate', '法袍': 'robe', '饰品': 'accessory',
  }
  return map[v] || 'none'
}

const bodySlots = [
  { id: 'head', label: '头部', icon: 'crown', types: ['头饰'] },
  { id: 'body', label: '身体', icon: 'clothing', types: ['上衣', '外套/披风', '法袍', '连衣裙', '轻甲', '中甲', '重甲'] },
  { id: 'hands', label: '手部', icon: 'gloves', types: ['手套'] },
  { id: 'legs', label: '下身', icon: 'pants', types: ['下装'] },
  { id: 'feet', label: '足部', icon: 'boots', types: ['鞋履'] },
  { id: 'accessory', label: '饰品', icon: 'ring', types: ['饰品/首饰'] },
  { id: 'shield', label: '盾牌', icon: 'shield', types: ['盾牌'] },
  { id: 'set', label: '套装', icon: 'item', types: ['套装'] },
]

function slotItems(characterId: string, slotId: string): Entity[] {
  const slot = bodySlots.find(s => s.id === slotId)
  if (!slot) return []
  return getWornApparel(characterId).filter((item: Entity) =>
    slot.types.includes((item.properties.apparelType as string) || '')
  )
}

async function unequipApparel(characterId: string, apparelId: string) {
  const rel = relationStore.relations.find(r =>
    r.type === 'worn_by' && r.sourceId === apparelId && r.targetId === characterId
  )
  if (rel) {
    await relationStore.remove(rel.id)
    await relationStore.loadAll()
    toastSuccess('已卸下装备')
  }
}

// ── Navigation helpers ──
function onFamilyNavigate(id: string) {
  gevRef.value?.selectEntityById(id)
  const entity = entityStore.entityMap.get(id)
  if (entity) {
    loadEntityTabData(entity)
  }
}

function switchToInfoTab() {
  gevRef.value?.switchTab('info')
}
</script>

<style scoped>
.character-view {
  height: 100%;
  display: flex;
  flex-direction: column;
}

/* Detail header */
.dp-avatar { font-size: var(--icon-xl); }
.dp-title-area { display: flex; flex-direction: column; }
.dp-title-area h3 { margin: 0; font-size: var(--font-size-xl); }
.dp-type-label { font-size: var(--font-size-sm); color: var(--text-secondary); }

/* Compare */
.compare-overlay { position: fixed; inset: var(--titlebar-height, 32px) 0 0 0; z-index: var(--z-overlay); background: var(--overlay); display: flex; align-items: center; justify-content: center; }
.compare-panel { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: var(--radius-2xl); padding: 20px; min-width: 480px; max-width: 640px; max-height: 80vh; overflow-y: auto; box-shadow: 0 8px 32px rgba(0,0,0,0.3); }
.compare-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.compare-header h3 { margin: 0; font-size: var(--font-size-lg); color: var(--accent); }
.compare-table { display: flex; flex-direction: column; gap: 0; }
.compare-row { display: grid; grid-template-columns: 120px 1fr 1fr; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--border-light); font-size: var(--font-size-sm); }
.compare-row-header { font-weight: var(--font-weight-semibold); color: var(--text-color); border-bottom: 2px solid var(--border-color); }
.compare-label { color: var(--text-secondary); font-weight: var(--font-weight-medium); }
.compare-val { color: var(--text-color); }
.compare-diff { color: var(--primary); font-weight: var(--font-weight-semibold); }

/* Names tab */
.dp-help { font-size: var(--font-size-sm); color: var(--text-tertiary); margin-bottom: 8px; }
.dp-name-row { display: flex; gap: 6px; margin-bottom: 6px; align-items: center; }
.dp-name-input { flex: 1; padding: 5px 8px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); font-size: var(--font-size-sm); font-family: inherit; }
.dp-name-ctx { flex: 1; padding: 5px 8px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); font-size: var(--font-size-sm); font-family: inherit; }
.dp-name-rm { width: 22px; height: 22px; border: none; background: transparent; cursor: pointer; color: var(--danger); font-size: var(--font-size-sm); border-radius: var(--radius-xs); flex-shrink: 0; }
.dp-name-rm:hover { background: var(--danger-light); }

/* Appearance tab */
.dp-app-row { margin-bottom: 8px; padding: 8px; background: var(--card-bg); border: 1px solid var(--border-color); border-radius: var(--radius-md); }
.dp-app-stage { flex: 1; padding: 5px 8px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); font-size: var(--font-size-sm); font-family: inherit; }
.dp-app-desc { width: 100%; padding: 5px 8px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); font-size: var(--font-size-sm); font-family: inherit; resize: vertical; }

.btn-sm-add { padding: 4px 12px; background: none; border: 1px dashed var(--primary); color: var(--primary); border-radius: var(--radius-sm); cursor: pointer; font-size: var(--font-size-sm); transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast), box-shadow var(--transition-fast), transform var(--transition-fast), opacity var(--transition-fast), filter var(--transition-fast); }
.btn-sm-add:hover { background: var(--primary-light); }

/* Equipment tab */
.dp-body-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 4px 0; }
.dp-body-slot { background: var(--card-bg); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 8px; min-height: 60px; }
.dp-body-slot.dp-slot-empty { opacity: 0.5; }
.dp-slot-label { font-size: var(--font-size-xs); font-weight: var(--font-weight-semibold); color: var(--text-secondary); margin-bottom: 6px; display: flex; align-items: center; gap: 4px; }
.dp-slot-placeholder { font-size: var(--font-size-xs); color: var(--text-tertiary); font-style: italic; padding: 4px 0; }
.dp-equip-card { display: flex; gap: 8px; padding: 6px; background: var(--hover-bg); border-radius: var(--radius-sm); margin-bottom: 4px; }
.dp-equip-header { display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 40px; }
.dp-equip-icon { font-size: var(--font-size-xl); }
.dp-equip-armor { padding: 1px 5px; border-radius: var(--radius-sm); font-size: var(--text-micro-font-size); font-weight: var(--font-weight-semibold); white-space: nowrap; }
.armor-none { background: var(--color-bg-elevated); color: var(--color-text-tertiary); }
.armor-cloth { background: #6c5ce7; color: #fff; }
.armor-leather { background: #e67e22; color: #fff; }
.armor-chain { background: #3498db; color: #fff; }
.armor-plate { background: #2c3e50; color: #fff; }
.armor-robe { background: #9b59b6; color: #fff; }
.armor-accessory { background: #f1c40f; color: var(--color-bg-base); }
.dp-equip-body { flex: 1; min-width: 0; }
.dp-equip-body h4 { margin: 0 0 2px; font-size: var(--font-size-sm); }
.dp-equip-tags { display: flex; gap: 4px; align-items: center; }
.dp-equip-type { font-size: var(--text-micro-font-size); padding: 1px 4px; background: var(--hover-bg); border-radius: var(--radius-2xs); color: var(--text-secondary); }
.dp-equip-def { font-size: var(--font-size-xs); color: var(--text-secondary); }
.dp-equip-unequip { margin-left: auto; background: none; border: none; cursor: pointer; color: var(--text-tertiary); padding: 2px; border-radius: var(--radius-xs); display: flex; align-items: center; }
.dp-equip-unequip:hover { color: var(--danger); background: var(--danger-light); }
</style>

