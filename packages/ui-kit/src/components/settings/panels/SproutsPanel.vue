<template>
  <CardDeck :count="1" :flat="!!searchQuery" @change="(i) => emit('card-change', i)" ref="deckRef">
    <template #card="{ idx, cls }">
      <div class="set-card deck-card" :class="cls" :data-index="idx" v-show="match('芽 sprout 启用 禁用 分组 全选')">
        <div class="sc-head">
          <div class="sc-head-left">
            <span>芽管理</span>
            <!-- 分组下拉：应用 / 保存当前为分组 / 删除，三合一（点击外部或 Esc 关闭） -->
            <div ref="groupDdRef" class="sp-group-dd">
              <button
                type="button"
                class="sp-group-dd-btn"
                :aria-expanded="groupMenuOpen"
                aria-haspopup="menu"
                @click="openMenu"
              >
                <span>分组</span>
                <WsIcon name="chevron-down" size="xs" />
              </button>
              <div v-if="groupMenuOpen" class="sp-group-menu" role="menu">
                <!-- 命名行常驻（不再做「点击切换出输入框」的 v-if 流程，规避焦点/时序类失效）：
                     输入名字 → 保存（保存对象 = 当前激活集，见 confirmSaveGroup） -->
                <div class="sp-group-save-row">
                  <input
                    ref="groupNameRef"
                    v-model="groupName"
                    type="text"
                    class="set-input sp-group-input"
                    :placeholder="`分组名（保存当前激活 ${activeSproutIds.length} 个）`"
                    maxlength="20"
                    @keyup.enter="confirmSaveGroup"
                    @keyup.esc="closeMenu"
                  />
                </div>
                <div class="sp-group-save-actions">
                  <button
                    type="button"
                    class="sp-bulk-btn sp-bulk-btn--primary"
                    title="保存当前激活的芽为该名称的分组（同名覆盖更新）"
                    @click="confirmSaveGroup"
                  >保存</button>
                </div>
                <div class="sp-group-menu-sep"></div>
                <div class="sp-group-menu-caption">已存分组（点击应用）</div>
                <div v-if="store.sproutGroups.length === 0" class="sp-group-menu-empty">暂无分组</div>
                <div
                  v-for="g in store.sproutGroups"
                  :key="g.id"
                  class="sp-group-menu-item"
                  :class="{ on: isActiveSetEqual(g.sproutIds) }"
                  role="menuitem"
                  :title="`应用分组「${g.name}」：仅激活组内 ${g.sproutIds.length} 个芽，组外停用`"
                  @click="onApplyGroup(g)"
                >
                  <span class="sp-group-name">{{ g.name }}</span>
                  <span class="sp-group-count">{{ g.sproutIds.length }}</span>
                  <span class="sp-group-del" role="button" :aria-label="`删除分组 ${g.name}`" title="删除分组" @click.stop="onRemoveGroup(g)">✕</span>
                </div>
              </div>
            </div>
          </div>
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
        <!-- 搜索行：左端为全选/全不选单键（按当前过滤集是否已全激活切换文案与动作） -->
        <div class="set-plugin-search">
          <button
            type="button"
            class="sp-selectall-btn"
            :disabled="filteredSprouts.length === 0"
            :title="filteredAllActive ? '取消当前可见芽的激活（至少保留人物志兜底）' : '激活当前可见芽'"
            @click="onToggleSelectAll"
          >{{ filteredAllActive ? '全不选' : '全选' }}</button>
          <input type="text" v-model="sproutSearch" placeholder="搜索芽..." class="set-input" />
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
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useSettingsStore, useUIStore, usePluginStore, SPROUT_CATEGORIES, type SproutCategory, type SproutGroup } from '@worldsea/entity-core'
import { hasIcon, toastSuccess, toastWarn } from '@worldsea/ui-kit'
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

// ── 批量操作与自定义分组（2026-09-13；布局调整：全选并入搜索行单键、分组改标题旁下拉）──
// 范围语义（2026-09-13 二次修正）：
// - 全选/全不选作用于「当前过滤集」（分类 + 搜索后的可见芽）——批量勾选手段
// - **保存分组保存的是「当前激活集」**（用户勾选出来的自定义激活范围快照），与过滤集无关
// （groupName/groupNameRef 声明在下方「分组下拉」段）

/** 当前激活芽列表（保存分组的对象） */
const activeSproutIds = computed(() => store.sprouts.filter(p => p.active).map(p => p.id))

/** 当前过滤集是否已全部激活（全选单键的文案/动作切换依据） */
const filteredAllActive = computed(() =>
  filteredSprouts.value.length > 0 && filteredSprouts.value.every(p => p.active),
)

function onToggleSelectAll() {
  onSelectAll(!filteredAllActive.value)
}

function onSelectAll(active: boolean) {
  store.setSproutsActive(filteredSprouts.value.map(p => p.id), active)
  emit('dirty')
}

// ── 分组下拉 ──
// 交互契约：命名输入常驻菜单顶部（不做 v-if 切换，规避「点击切换→焦点丢失/时序竞争」
// 整类失效）；保存按钮不加 disabled——空名/空激活集点击时 toast 明确反馈，杜绝「没反应」。
const groupMenuOpen = ref(false)
const groupDdRef = ref<HTMLElement | null>(null)
const groupName = ref('')
const groupNameRef = ref<HTMLInputElement | null>(null)

function openMenu() {
  groupMenuOpen.value = !groupMenuOpen.value
  if (groupMenuOpen.value) {
    nextTick(() => groupNameRef.value?.focus())
  } else {
    groupName.value = ''
  }
}

function closeMenu() {
  groupMenuOpen.value = false
  groupName.value = ''
}

function onDocClick(e: MouseEvent) {
  if (!groupMenuOpen.value) return
  if (groupDdRef.value && !groupDdRef.value.contains(e.target as Node)) {
    closeMenu()
  }
}
onMounted(() => document.addEventListener('click', onDocClick))
onUnmounted(() => document.removeEventListener('click', onDocClick))

function confirmSaveGroup() {
  const name = groupName.value.trim()
  if (!name) {
    toastWarn('请先输入分组名')
    return
  }
  if (activeSproutIds.value.length === 0) {
    toastWarn('当前没有激活的芽：先勾选要激活的芽，再保存分组')
    return
  }
  const g = store.saveSproutGroup(name, activeSproutIds.value)
  groupName.value = ''
  groupMenuOpen.value = false
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
  closeMenu()
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

.set-plugin-search { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.set-plugin-search .set-input { flex: 1; min-width: 0; }
/* 全选/全不选单键：文案按当前过滤集是否已全激活切换 */
.sp-selectall-btn {
  flex-shrink: 0; padding: 4px 12px; font-size: var(--font-size-xs, 12px); line-height: 1.6;
  color: var(--text-secondary, var(--color-text-secondary)); background: transparent;
  border: 1px solid var(--border, var(--color-border)); border-radius: 999px; cursor: pointer;
  transition: background 0.1s, border-color 0.1s, color 0.1s, opacity 0.1s;
}
.sp-selectall-btn:hover:not(:disabled) { border-color: var(--primary, var(--color-primary)); color: var(--primary, var(--color-primary)); }
.sp-selectall-btn:disabled { opacity: var(--disabled-opacity, 0.5); cursor: not-allowed; }
.set-plugin-cats { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
.sp-cat { padding: 2px 10px; font-size: var(--font-size-xs, 12px); line-height: 1.6; color: var(--text-secondary, var(--color-text-secondary)); background: transparent; border: 1px solid var(--border, var(--color-border)); border-radius: 999px; cursor: pointer; transition: background 0.1s, border-color 0.1s, color 0.1s; }
.sp-cat:hover { background: var(--hover-bg, var(--color-bg-hover)); }
.sp-cat:focus-visible { outline: none; border-color: var(--primary, var(--color-primary)); box-shadow: 0 0 0 3px var(--primary-soft, color-mix(in srgb, var(--color-primary) 15%, transparent)); }
.sp-cat.active { background: var(--primary, var(--color-primary)); border-color: var(--primary, var(--color-primary)); color: var(--on-accent, #fff); }
/* 列表不设内滚上限：26 个芽按 3 列自然铺满一屏可见，纵向滚动交给外层 .set-cards 兜底 */
.set-plugin-list { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 2px; }

/* ── 分组下拉（标题旁）/ 菜单内保存按钮（2026-09-13）── */
.sc-head-left { display: flex; align-items: center; gap: 8px; min-width: 0; }
.sp-group-dd { position: relative; }
.sp-group-dd-btn {
  display: inline-flex; align-items: center; gap: 4px; padding: 2px 10px;
  font-size: var(--font-size-xs, 12px); line-height: 1.6; text-transform: none; letter-spacing: normal;
  color: var(--text-secondary, var(--color-text-secondary)); background: transparent;
  border: 1px solid var(--border, var(--color-border)); border-radius: 999px; cursor: pointer;
  transition: background 0.1s, border-color 0.1s, color 0.1s;
}
.sp-group-dd-btn:hover { border-color: var(--primary, var(--color-primary)); color: var(--primary, var(--color-primary)); }
.sp-group-menu {
  position: absolute; top: calc(100% + 4px); left: 0; z-index: var(--z-dropdown, 100);
  min-width: 200px; max-height: 260px; overflow-y: auto;
  padding: 4px; border-radius: var(--radius-mid, 8px);
  background: var(--content-bg, var(--color-bg-surface));
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.14), 0 0 0 1px var(--border, var(--color-border));
}
.sp-group-menu-item {
  display: flex; align-items: center; gap: 6px; width: 100%; padding: 5px 8px;
  font-size: var(--font-size-xs, 12px); color: var(--text-secondary, var(--color-text-secondary));
  background: transparent; border: none; border-radius: var(--radius-sm, 6px); cursor: pointer; text-align: left;
  transition: background 0.1s, color 0.1s;
}
.sp-group-menu-item:hover:not(:disabled) { background: var(--hover-bg, var(--color-bg-hover)); color: var(--text-color, var(--color-text-primary)); }
.sp-group-menu-item.on { color: var(--primary, var(--color-primary)); font-weight: var(--font-weight-medium, 500); }
.sp-group-menu-item:disabled { opacity: var(--disabled-opacity, 0.5); cursor: not-allowed; }
.sp-group-menu-action { color: var(--primary, var(--color-primary)); }
.sp-group-menu-empty { padding: 6px 8px; font-size: var(--font-size-xs, 12px); color: var(--text-tertiary, var(--color-text-tertiary)); }
.sp-group-menu-sep { height: 1px; margin: 4px 2px; background: var(--border, var(--color-border)); }
.sp-group-menu-caption { padding: 4px 8px 2px; font-size: var(--text-micro-font-size, 10px); color: var(--text-tertiary, var(--color-text-tertiary)); }
.sp-group-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sp-group-count { font-size: var(--text-micro-font-size, 10px); opacity: 0.7; }
.sp-group-del { color: inherit; opacity: 0.55; cursor: pointer; padding: 0 2px; border-radius: 3px; }
.sp-group-del:hover { opacity: 1; color: var(--danger, var(--color-danger)); }
.sp-group-save-row { padding: 2px; }
.sp-group-save-row .sp-group-input { width: 100%; }
.sp-group-save-actions { display: flex; justify-content: flex-end; gap: 6px; padding: 6px 2px 2px; }
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
.sp-group-input { padding: 3px 8px; font-size: var(--font-size-xs, 12px); }
.set-plugin-item { padding: 3px 0; display: flex; align-items: center; gap: 4px; }
.sp-grip { cursor: grab; color: var(--text-tertiary, #bbb); font-size: var(--font-size-base); line-height: 1; padding: 2px 2px; user-select: none; flex-shrink: 0; transition: color 0.1s; }
.sp-grip:hover { color: var(--text-secondary, #888); }
.sp-grip:active { cursor: grabbing; }
.sp-ghost { opacity: 0.4; background: var(--primary-light, color-mix(in srgb, var(--color-primary) 10%, transparent)); border-radius: 4px; }
.sp-drag { background: var(--content-bg, var(--color-bg-surface)); box-shadow: 0 4px 12px rgba(0,0,0,0.15); border-radius: 4px; }
.sp-source { font-size: var(--text-micro-font-size); color: var(--text-tertiary, var(--color-text-tertiary)); background: var(--bg-secondary, var(--color-bg-elevated)); padding: 1px 4px; border-radius: 3px; margin-right: 4px; }
.sp-toggle { display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: var(--font-size-sm); padding: 2px 6px; border-radius: var(--radius-sm); transition: background 0.1s; }
.sp-toggle:hover { background: var(--hover-bg, var(--color-bg-hover)); }
.sp-toggle input { margin: 0; accent-color: var(--primary, var(--color-primary)); }
.sp-icon { font-size: var(--font-size-lg); }
.sp-label { font-size: var(--font-size-sm); }
</style>
