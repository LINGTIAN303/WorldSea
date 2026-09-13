<template>
  <CardDeck :count="1" :flat="!!searchQuery" @change="(i) => emit('card-change', i)" ref="deckRef">
    <template #card="{ idx, cls }">
      <div class="set-card deck-card" :class="cls" :data-index="idx" v-show="match('芽 sprout 启用 禁用')">
        <div class="sc-head">
          <span>芽管理</span>
          <div class="set-plugin-cats" role="tablist" aria-label="芽分类筛选">
            <button
              v-for="c in SPROUT_CATEGORIES"
              :key="c.id"
              type="button"
              class="sp-cat"
              :class="{ active: activeCategory === c.id }"
              role="tab"
              :aria-selected="activeCategory === c.id"
              @click="onCategoryClick(c.id)"
            >{{ c.label }}</button>
          </div>
        </div>
        <div class="set-plugin-search"><input type="text" v-model="sproutSearch" placeholder="搜索芽..." class="set-input" /></div>
        <!-- 批量操作行：全选作用于当前过滤集（分类/搜索筛选后的可见芽）；「全部激活」= 分类「全部」+ 无搜索时点全选 -->
        <div class="sp-bulk-bar">
          <button type="button" class="sp-bulk-btn" :disabled="filteredSprouts.length === 0" @click="onSelectAll(true)">全选</button>
          <button type="button" class="sp-bulk-btn" :disabled="filteredSprouts.length === 0" @click="onSelectAll(false)">全不选</button>
          <span class="sp-bulk-spacer"></span>
          <template v-if="savingGroup">
            <input ref="groupNameRef" v-model="groupName" type="text" class="set-input sp-group-input" placeholder="分组名称..." maxlength="20" @keyup.enter="confirmSaveGroup" @keyup.esc="cancelSaveGroup" />
            <button type="button" class="sp-bulk-btn sp-bulk-btn--primary" :disabled="!groupName.trim()" @click="confirmSaveGroup">保存</button>
            <button type="button" class="sp-bulk-btn" @click="cancelSaveGroup">取消</button>
          </template>
          <button v-else type="button" class="sp-bulk-btn" :disabled="filteredSprouts.length === 0" @click="startSaveGroup">保存为分组</button>
        </div>
        <!-- 自定义分组 chips：点击应用（仅激活组内芽，组外停用）；当前激活集与分组一致时高亮 -->
        <div v-if="store.sproutGroups.length > 0" class="sp-group-row" role="group" aria-label="自定义分组">
          <button
            v-for="g in store.sproutGroups"
            :key="g.id"
            type="button"
            class="sp-group-chip"
            :class="{ on: isActiveSetEqual(g.sproutIds) }"
            :title="`应用分组「${g.name}」：仅激活组内 ${g.sproutIds.length} 个芽，组外停用`"
            @click="onApplyGroup(g)"
          >
            <span class="sp-group-name">{{ g.name }}</span>
            <span class="sp-group-count">{{ g.sproutIds.length }}</span>
            <span class="sp-group-del" role="button" :aria-label="`删除分组 ${g.name}`" title="删除分组" @click.stop="onRemoveGroup(g)">✕</span>
          </button>
        </div>
        <draggable v-if="showDraggable" :list="sproutList" item-key="id" ghost-class="sp-ghost" drag-class="sp-drag" handle=".sp-grip" @end="onSproutDragEnd" class="set-plugin-list">
          <template #item="{ element: p }">
            <div class="set-plugin-item">
              <span class="sp-grip" title="拖拽排序"><WsIcon name="grip" size="xs" /></span>
              <span v-if="p.source" class="sp-source">{{ p.source === 'builtin' ? '内置' : p.source === 'local' ? '本地' : '远程' }}</span>
              <label class="sp-toggle"><input type="checkbox" :checked="p.active" @change="onSproutToggle(p.id)" /><span class="sp-icon"><WsIcon v-if="hasIcon(p.icon)" :name="p.icon" size="sm" /><span v-else>{{ p.icon }}</span></span><span class="sp-label">{{ p.label }}</span></label>
            </div>
          </template>
        </draggable>
        <div v-else class="set-plugin-list">
          <div v-for="p in filteredSprouts" :key="p.id" class="set-plugin-item">
            <span v-if="p.source" class="sp-source">{{ p.source === 'builtin' ? '内置' : p.source === 'local' ? '本地' : '远程' }}</span>
            <label class="sp-toggle"><input type="checkbox" :checked="p.active" @change="onSproutToggle(p.id)" /><span class="sp-icon"><WsIcon v-if="hasIcon(p.icon)" :name="p.icon" size="sm" /><span v-else>{{ p.icon }}</span></span><span class="sp-label">{{ p.label }}</span></label>
          </div>
        </div>
      </div>
    </template>
  </CardDeck>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useSettingsStore, useUIStore, usePluginStore, SPROUT_CATEGORIES, type SproutCategory, type SproutGroup } from '@worldsea/entity-core'
import { hasIcon, toastSuccess } from '@worldsea/ui-kit'
import { CardDeck } from '@worldsea/ui-kit'
import WsIcon from '../../WsIcon.vue'
import draggable from 'vuedraggable'
import { matchKeywords } from '../utils'

const props = defineProps<{ searchQuery?: string }>()
const emit = defineEmits<{ dirty: []; 'card-change': [index: number] }>()

const deckRef = ref<InstanceType<typeof CardDeck> | null>(null)

const store = useSettingsStore()
const uiStore = useUIStore()
const pluginStore = usePluginStore()

// 芽面板内部的搜索框（独立于全局 searchQuery）
const sproutSearch = ref('')
// 当前选中的分类筛选（'all' 表示全部）
const activeCategory = ref<SproutCategory | 'all'>('all')

function match(keywords: string): boolean {
  return matchKeywords(props.searchQuery ?? '', keywords)
}

function onCategoryClick(id: SproutCategory) {
  // 再次点击当前分类则取消筛选，回到全部
  activeCategory.value = activeCategory.value === id ? 'all' : id
}

const sproutList = ref(store.sprouts.map(p => ({ ...p })))

function syncSproutList() {
  const order = uiStore.sidebarOrder
  const sorted = [...store.sprouts].sort((a, b) => {
    const va = pluginStore.views.find(v => v.pluginId === a.id)
    const vb = pluginStore.views.find(v => v.pluginId === b.id)
    const ia = va ? order.indexOf(va.id) : 999
    const ib = vb ? order.indexOf(vb.id) : 999
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
  })
  sproutList.value = sorted.map(p => ({ ...p }))
}

watch(() => [uiStore.sidebarOrder, store.sprouts] as const, () => {
  syncSproutList()
}, { deep: true, immediate: true })

// 仅在「未搜索 且 未筛选分类」时启用拖拽排序，避免对子集排序造成歧义
const showDraggable = computed(() => !sproutSearch.value && activeCategory.value === 'all')

const filteredSprouts = computed(() => {
  let list = sproutList.value
  if (activeCategory.value !== 'all') {
    list = list.filter(p => p.category === activeCategory.value)
  }
  if (sproutSearch.value) {
    const q = sproutSearch.value.toLowerCase()
    list = list.filter(p =>
      p.label.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)
    )
  }
  return list
})

function onSproutDragEnd() {
  const newOrder = sproutList.value
    .map(p => pluginStore.views.find(v => v.pluginId === p.id)?.id)
    .filter((id): id is string => !!id)
  const existing = new Set(newOrder)
  for (const id of uiStore.sidebarOrder) {
    if (!existing.has(id)) newOrder.push(id)
  }
  uiStore.sidebarOrder = newOrder
  emit('dirty')
}

function onSproutToggle(id: string) {
  store.toggleSprout(id)
  emit('dirty')
}

// ── 批量操作与自定义分组（2026-09-13）──
// 范围语义统一：全选/全不选/保存为分组都作用于「当前过滤集」（分类 + 搜索后的可见芽）。
// 工作流示例：切到「世界观」分类 → 全选 → 保存为分组 → 得到世界观方案；「全部」分类下
// 全选 = 一键全部激活。
const savingGroup = ref(false)
const groupName = ref('')
const groupNameRef = ref<HTMLInputElement | null>(null)

function onSelectAll(active: boolean) {
  store.setSproutsActive(filteredSprouts.value.map(p => p.id), active)
  emit('dirty')
}

function startSaveGroup() {
  groupName.value = ''
  savingGroup.value = true
  nextTick(() => groupNameRef.value?.focus())
}

function cancelSaveGroup() {
  savingGroup.value = false
  groupName.value = ''
}

function confirmSaveGroup() {
  const name = groupName.value.trim()
  if (!name || filteredSprouts.value.length === 0) return
  const g = store.saveSproutGroup(name, filteredSprouts.value.map(p => p.id))
  savingGroup.value = false
  groupName.value = ''
  emit('dirty')
  toastSuccess(`已保存分组「${g.name}」（${g.sproutIds.length} 个芽）`)
}

/** 当前激活 id 集（用于分组应用态高亮） */
const activeIdSet = computed(() => new Set(store.sprouts.filter(p => p.active).map(p => p.id)))

function isActiveSetEqual(ids: string[]): boolean {
  if (ids.length !== activeIdSet.value.size) return false
  return ids.every(id => activeIdSet.value.has(id))
}

function onApplyGroup(g: SproutGroup) {
  store.applySproutGroup(g.id)
  emit('dirty')
  toastSuccess(`已应用分组「${g.name}」（激活 ${g.sproutIds.length} 个芽）`)
}

function onRemoveGroup(g: SproutGroup) {
  store.removeSproutGroup(g.id)
  emit('dirty')
}

defineExpose({ resetSproutSearch: () => { sproutSearch.value = '' }, goToCard: (i: number) => deckRef.value?.goToCard(i) })
</script>

<style scoped>
/* 基座样式（.set-card/.sc-head/.set-row/.set-toggle/.set-hint）已收敛至 ui-kit settings-panels.css，此处仅保留面板私有样式 */
.sc-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--text-tertiary, var(--color-text-tertiary)); margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
.sc-head > span { flex-shrink: 0; }

.set-input { padding: 4px 8px; font-size: var(--font-size-sm); border: 1px solid var(--border, var(--color-border)); border-radius: var(--radius-sm); background: var(--bg, var(--color-bg-surface)); color: var(--text-color); }
.set-input:focus { outline: none; border-color: var(--primary, var(--color-primary)); }

.set-plugin-search { margin-bottom: 8px; }
.set-plugin-search .set-input { width: 100%; }
.set-plugin-cats { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
.sp-cat { padding: 2px 10px; font-size: var(--font-size-xs, 12px); line-height: 1.6; color: var(--text-secondary, var(--color-text-secondary)); background: transparent; border: 1px solid var(--border, var(--color-border)); border-radius: 999px; cursor: pointer; transition: background 0.1s, border-color 0.1s, color 0.1s; }
.sp-cat:hover { background: var(--hover-bg, var(--color-bg-hover)); }
.sp-cat:focus-visible { outline: none; border-color: var(--primary, var(--color-primary)); box-shadow: 0 0 0 3px var(--primary-soft, color-mix(in srgb, var(--color-primary) 15%, transparent)); }
.sp-cat.active { background: var(--primary, var(--color-primary)); border-color: var(--primary, var(--color-primary)); color: var(--on-accent, #fff); }
/* 列表不设内滚上限：27 个芽按 3 列自然铺满一屏可见，纵向滚动交给外层 .set-cards 兜底
   （此前 max-height 320px 会把第 9 行（自定义视图/自定义模块/工作流）裁到屏下） */
.set-plugin-list { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 2px; }

/* ── 批量操作行 / 自定义分组（2026-09-13）── */
.sp-bulk-bar { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.sp-bulk-spacer { flex: 1; }
.sp-bulk-btn {
  padding: 3px 10px; font-size: var(--font-size-xs, 12px); line-height: 1.6;
  color: var(--text-secondary, var(--color-text-secondary)); background: transparent;
  border: 1px solid var(--border, var(--color-border)); border-radius: 999px; cursor: pointer;
  transition: background 0.1s, border-color 0.1s, color 0.1s, opacity 0.1s;
}
.sp-bulk-btn:hover:not(:disabled) { border-color: var(--primary, var(--color-primary)); color: var(--primary, var(--color-primary)); }
.sp-bulk-btn:disabled { opacity: var(--disabled-opacity, 0.5); cursor: not-allowed; }
.sp-bulk-btn--primary { background: var(--primary, var(--color-primary)); border-color: var(--primary, var(--color-primary)); color: var(--on-accent, #fff); }
.sp-bulk-btn--primary:hover:not(:disabled) { color: var(--on-accent, #fff); filter: brightness(1.08); }
.sp-group-input { width: 160px; padding: 3px 8px; font-size: var(--font-size-xs, 12px); }
.sp-group-row { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.sp-group-chip {
  display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px;
  font-size: var(--font-size-xs, 12px); line-height: 1.6;
  border: 1px solid var(--border, var(--color-border)); border-radius: 999px;
  background: transparent; color: var(--text-secondary, var(--color-text-secondary)); cursor: pointer;
  transition: background 0.1s, border-color 0.1s, color 0.1s;
}
.sp-group-chip:hover { border-color: var(--primary, var(--color-primary)); color: var(--primary, var(--color-primary)); }
.sp-group-chip.on {
  background: var(--primary-light, color-mix(in srgb, var(--color-primary) 10%, transparent));
  border-color: var(--primary, var(--color-primary)); color: var(--primary, var(--color-primary));
}
.sp-group-count { font-size: var(--text-micro-font-size, 10px); opacity: 0.7; }
.sp-group-del { color: inherit; opacity: 0.55; cursor: pointer; padding: 0 1px; border-radius: 3px; }
.sp-group-del:hover { opacity: 1; color: var(--danger, var(--color-danger)); }
.set-plugin-item { padding: 3px 0; display: flex; align-items: center; gap: 4px; }
.sp-grip { cursor: grab; color: var(--text-tertiary, #bbb); font-size: var(--font-size-base); line-height: 1; padding: 2px 2px; user-select: none; flex-shrink: 0; transition: color 0.1s; }
.sp-grip:hover { color: var(--text-secondary, #888); }
.sp-grip:active { cursor: grabbing; }
.sp-ghost { opacity: 0.4; background: var(--primary-light, color-mix(in srgb, var(--color-primary) 10%, transparent)); border-radius: 4px; }
.sp-drag { background: var(--content-bg, var(--color-bg-surface)); box-shadow: 0 4px 12px rgba(0,0,0,0.15); border-radius: 4px; }
.sp-source { font-size: var(--text-micro-font-size); color: var(--text-tertiary, var(--color-text-tertiary)); background: var(--bg-secondary, var(--color-bg-elevated)); padding: 1px 4px; border-radius: 3px; margin-right: 4px; }
.sp-toggle { display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: var(--font-size-sm); padding: 4px 6px; border-radius: var(--radius-sm); transition: background 0.1s; }
.sp-toggle:hover { background: var(--hover-bg, var(--color-bg-hover)); }
.sp-toggle input { margin: 0; accent-color: var(--primary, var(--color-primary)); }
.sp-icon { font-size: var(--font-size-lg); }
.sp-label { font-size: var(--font-size-sm); }
</style>
