<template>
  <div class="set-overlay" v-if="show" @click.self="close">
    <div ref="dialogRef" class="set-shell" role="dialog" aria-modal="true" aria-labelledby="set-dialog-title" tabindex="-1">
      <aside v-show="railVisible" class="set-rail" aria-label="配置目录" :style="railStyle">
        <button v-for="(it, i) in railItems" :key="i" class="set-rail-item"
          :class="railItemClass(i)" @click="goRail(i)">{{ it.text }}</button>
      </aside>
      <div class="set-topbar">
        <div class="set-topbar-left">
          <WsIcon name="settings" size="sm" />
          <span id="set-dialog-title" class="set-topbar-title">设置</span>
        </div>
        <div class="set-search-wrap">
          <WsIcon name="search" size="xs" class="set-search-icon" />
          <input type="text" class="set-search-input" v-model="searchQuery" placeholder="搜索设置..." aria-label="搜索设置" />
          <button v-if="searchQuery" class="set-search-clear" @click="searchQuery = ''" aria-label="清除搜索">✕</button>
        </div>
        <div class="set-topbar-spacer"></div>
        <button class="set-close" @click="close" aria-label="关闭设置">✕</button>
      </div>

      <div class="set-tabs-wrap" :class="{ 'has-scroll': canScrollTabs }">
        <button v-show="canScrollLeft" class="set-tabs-arrow set-tabs-arrow--left"
          @click="scrollTabs(-1)" aria-label="向左滚动"><WsIcon name="chevron-left" size="xs" /></button>
        <nav ref="tabsRef" class="set-tabs" @scroll="onTabsScroll" @wheel="onTabsWheel">
          <button v-for="cat in categories" :key="cat.id"
            class="set-tab" :class="{ active: activeSection === cat.id }"
            @click="onTabClick(cat.id)">
            <WsIcon :name="cat.icon" size="xs" class="stb-icon" />
            <span class="stb-label">{{ cat.label }}</span>
          </button>
        </nav>
        <button v-show="canScrollRight" class="set-tabs-arrow set-tabs-arrow--right"
          @click="scrollTabs(1)" aria-label="向右滚动"><WsIcon name="chevron-right" size="xs" /></button>
      </div>

      <div class="set-cards" ref="cardsRef" v-if="activeSection || searchQuery">
        <!-- 搜索模式：渲染所有匹配类别的面板 -->
        <template v-if="searchQuery">
          <template v-for="cat in matchedCategories" :key="cat.id">
            <AppearancePanel v-if="cat.id === 'appearance'" :search-query="searchQuery" @dirty="onDirty" />
            <PluginsPanel v-if="cat.id === 'plugins'" :search-query="searchQuery" @dirty="onDirty" />
            <EditorPanel v-if="cat.id === 'editor'" :search-query="searchQuery" @dirty="onDirty" />
            <LayoutPanel v-if="cat.id === 'layout'" :search-query="searchQuery" @dirty="onDirty" />
            <DetailSettingsPanel v-if="cat.id === 'detail'" :search-query="searchQuery" />
            <RelationsPanel v-if="cat.id === 'relations'" :search-query="searchQuery" @dirty="onDirty" />
            <ShortcutsPanel v-if="cat.id === 'shortcuts'" :search-query="searchQuery" @dirty="onDirty" />
            <AccessibilityPanel v-if="cat.id === 'accessibility'" :search-query="searchQuery" />
            <StorageManagementTab v-if="cat.id === 'storage'" :search-query="searchQuery" @card-change="onPanelCardChange" />
            <AboutPanel v-if="cat.id === 'about'" :search-query="searchQuery" @card-change="onPanelCardChange" />
          </template>
          <div v-if="matchedCategories.length === 0" class="set-empty">未找到匹配的设置项</div>
        </template>

        <!-- 正常模式：只渲染当前激活的分类（均接入 CardDeck 叠放翻卡，左列标题点击翻卡） -->
        <template v-else>
          <AppearancePanel v-if="activeSection === 'appearance'" ref="appearanceRef" @dirty="onDirty" @card-change="onPanelCardChange" />
          <PluginsPanel v-else-if="activeSection === 'plugins'" ref="pluginsRef" :search-query="searchQuery" @dirty="onDirty" @card-change="onPanelCardChange" />
          <EditorPanel v-else-if="activeSection === 'editor'" ref="editorRef" @dirty="onDirty" @card-change="onPanelCardChange" />
          <LayoutPanel v-else-if="activeSection === 'layout'" ref="layoutRef" @dirty="onDirty" @card-change="onPanelCardChange" />
          <DetailSettingsPanel v-else-if="activeSection === 'detail'" ref="detailRef" @card-change="onPanelCardChange" />
          <RelationsPanel v-else-if="activeSection === 'relations'" ref="relationsRef" @dirty="onDirty" @card-change="onPanelCardChange" />
          <ShortcutsPanel v-else-if="activeSection === 'shortcuts'" ref="shortcutsRef" @dirty="onDirty" @card-change="onPanelCardChange" />
          <AccessibilityPanel v-else-if="activeSection === 'accessibility'" ref="accessibilityRef" @card-change="onPanelCardChange" />
          <AboutPanel v-else-if="activeSection === 'about'" ref="aboutRef" @card-change="onPanelCardChange" />
          <template v-else-if="activeSection === 'storage'">
            <StorageManagementTab ref="storageRef" :search-query="searchQuery" @card-change="onPanelCardChange" />
          </template>
        </template>
      </div>

      <div class="resize-handle-right" v-if="false" @mousedown="modalResizable.onResizeStart"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useUIStore, usePluginStore, isViewVisible } from '@worldsea/entity-core'
import { useResizable, WsIcon } from '@worldsea/ui-kit'
// 设置面板基座样式（.set-card/.sc-head/.set-row/.set-toggle/.set-hint 唯一权威定义）
import '@worldsea/ui-kit/components/settings/settings-panels.css'
import { useFocusTrap } from '@/composables/useFocusTrap'
import StorageManagementTab from './data/StorageManagementTab.vue'
// 设置子面板（已迁移到 ui-kit，通过 re-export 兼容层导入）
import AppearancePanel from './panels/AppearancePanel.vue'
import PluginsPanel from './panels/PluginsPanel.vue'
import EditorPanel from './panels/EditorPanel.vue'
import LayoutPanel from './panels/LayoutPanel.vue'
import DetailSettingsPanel from './panels/DetailSettingsPanel.vue'
import RelationsPanel from './panels/RelationsPanel.vue'
import ShortcutsPanel from './panels/ShortcutsPanel.vue'
import AccessibilityPanel from './panels/AccessibilityPanel.vue'
// Agent 设置面板（embedded 封装，2026-08-09 迁入主设置）
// 关于面板（2026-09-05 自左栏底部更多菜单迁入为独立 Tab）
import AboutPanel from './panels/AboutPanel.vue'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ close: [] }>()

const dialogRef = ref<HTMLElement | null>(null)

const { activate, deactivate } = useFocusTrap(dialogRef, {
  escapeDeactivates: true,
  onEscape: () => close(),
})

// 模态框可调整大小（保留接口，当前未启用）
const modalResizable = useResizable({ panelId: 'modal-settings', defaultWidth: 560, minWidth: 400, side: 'right' })

const uiStore = useUIStore()
const pluginStore = usePluginStore()

const dirty = ref(false)

function onDirty() {
  dirty.value = true
}

watch(() => props.show, (val) => {
  if (val) {
    dirty.value = false
    activeSection.value = null
    nextTick(() => activate())
  } else {
    deactivate()
  }
})

const categories = [
  { id: 'appearance', icon: 'cat-appearance', label: '外观' },
  { id: 'plugins', icon: 'cat-plugins', label: '插件' },
  { id: 'editor', icon: 'cat-editor', label: '编辑' },
  { id: 'layout', icon: 'cat-layout', label: '布局' },
  { id: 'detail', icon: 'data-entity', label: '实体详情' },
  { id: 'relations', icon: 'cat-relations', label: '关系' },
  { id: 'shortcuts', icon: 'cat-shortcuts', label: '快捷键' },
  { id: 'storage', icon: 'cat-storage', label: '存储' },
  { id: 'accessibility', icon: 'motion', label: '无障碍' },
  { id: 'about', icon: 'info', label: '关于' },
]

const activeSection = ref<string | null>(null)
const searchQuery = ref('')

// ── Tab 栏单行横向滚动 + 左右三角控件 ──
const tabsRef = ref<HTMLElement | null>(null)
const canScrollLeft = ref(false)
const canScrollRight = ref(false)
const canScrollTabs = computed(() => canScrollLeft.value || canScrollRight.value)

function onTabsScroll(): void {
  const el = tabsRef.value
  if (!el) return
  canScrollLeft.value = el.scrollLeft > 0
  canScrollRight.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
}

function recomputeTabsOverflow(): void {
  const el = tabsRef.value
  if (!el) return
  // 有横向溢出才显示三角；滚到尽头自动隐藏对应侧
  canScrollLeft.value = el.scrollLeft > 0
  canScrollRight.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
}

function scrollTabs(dir: number): void {
  const el = tabsRef.value
  if (!el) return
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  el.scrollBy({ left: dir * 240, behavior: reduced ? 'auto' : 'smooth' })
}

/** 滚轮横向滚动 Tab 栏（默认滚轮是纵向，这里转成横向） */
function onTabsWheel(e: WheelEvent): void {
  const el = tabsRef.value
  if (!el) return
  el.scrollLeft += e.deltaY
  e.preventDefault()
}

// 监听 Tab 溢出变化：打开时/渲染后/窗口尺寸变化时复算（ResizeObserver 对 scrollWidth 溢出不触发，故需显式复算）
let tabsResizeObs: ResizeObserver | null = null
watch(() => props.show, (val) => {
  if (val) {
    nextTick(() => {
      recomputeTabsOverflow()
      // 字体/布局可能晚稳定，延迟再复算一次
      window.setTimeout(() => recomputeTabsOverflow(), 80)
      if (!tabsResizeObs && tabsRef.value) {
        tabsResizeObs = new ResizeObserver(() => recomputeTabsOverflow())
        tabsResizeObs.observe(tabsRef.value)
      }
    })
  }
})
function onWindowResize(): void {
  recomputeTabsOverflow()
  updateRailLayout()
}
onMounted(() => {
  nextTick(() => {
    recomputeTabsOverflow()
    window.setTimeout(() => recomputeTabsOverflow(), 80)
  })
  window.addEventListener('resize', onWindowResize)
})
onUnmounted(() => {
  tabsResizeObs?.disconnect()
  window.removeEventListener('resize', onWindowResize)
})

// ── 配置面板左侧「UI 框列」：从当前面板 .sc-head 派生 + scroll-spy 高亮 ──
interface RailItem { text: string; el: HTMLElement }
const cardsRef = ref<HTMLElement | null>(null)
const railItems = ref<RailItem[]>([])
const activeRail = ref(-1)
const railVisible = computed(() => !searchQuery.value && activeSection.value !== null && railItems.value.length > 0)
/** 各分类面板实例（均暴露 goToCard，供左列标题点击翻卡；@card-change 上报左列高亮） */
const appearanceRef = ref<InstanceType<typeof AppearancePanel> | null>(null)
const pluginsRef = ref<InstanceType<typeof PluginsPanel> | null>(null)
const editorRef = ref<InstanceType<typeof EditorPanel> | null>(null)
const layoutRef = ref<InstanceType<typeof LayoutPanel> | null>(null)
const detailRef = ref<InstanceType<typeof DetailSettingsPanel> | null>(null)
const relationsRef = ref<InstanceType<typeof RelationsPanel> | null>(null)
const shortcutsRef = ref<InstanceType<typeof ShortcutsPanel> | null>(null)
const storageRef = ref<InstanceType<typeof StorageManagementTab> | null>(null)
const accessibilityRef = ref<InstanceType<typeof AccessibilityPanel> | null>(null)
const aboutRef = ref<InstanceType<typeof AboutPanel> | null>(null)
const panelRefs: Record<string, { value: any }> = {
  appearance: appearanceRef,
  plugins: pluginsRef,
  editor: editorRef,
  layout: layoutRef,
  detail: detailRef,
  relations: relationsRef,
  shortcuts: shortcutsRef,
  storage: storageRef,
  accessibility: accessibilityRef,
  about: aboutRef,
}
/** 叠放翻卡上报：左列高亮跟随当前卡片 */
function onPanelCardChange(i: number): void {
  activeRail.value = i
}
/** 左列定位样式：top/height 与配置面板区对齐（全高背景）；标题项在 rail 内垂直居中，中心自然对齐主卡中心 */
const railStyle = ref<Record<string, string>>({})

/** 更新左列标题区位置：rail 高度保持配置面板区全高（保留全高背景），顶部与配置面板区对齐；
    标题项垂直居中（.set-rail justify-content:center），标题项中心落在 rail 中心 = 主卡中心线。 */
function updateRailLayout(): void {
  const cardsEl = cardsRef.value
  if (!cardsEl) {
    railStyle.value = {}
    return
  }
  railStyle.value = {
    top: `${cardsEl.offsetTop}px`,
    height: `${cardsEl.offsetHeight}px`,
  }
}

/** 各面板分节标题选择器与其所属卡片的选择器（2026-09-06 归一完成：全部面板统一 .sc-head/.set-card） */
const HEADING_SELECTOR = '.sc-head'
const SECTION_SELECTOR = '.set-card'

/** 提取分节标题主文本：部分 .sc-head 内含多个元素（如芽面板含筛选标签），只取首个文字子节点 */
function headText(h: HTMLElement): string {
  const span = h.querySelector('span')
  if (span) return span.textContent?.trim() || ''
  return h.textContent?.trim() || ''
}

/** 重建左列：读取当前面板内所有分节标题文本。全部分类均为叠放翻卡，高亮由 card-change 事件驱动（默认第一张） */
function rebuildRail(): void {
  const cardsEl = cardsRef.value
  if (!cardsEl) {
    railItems.value = []
    activeRail.value = -1
    return
  }
  const heads = Array.from(cardsEl.querySelectorAll(HEADING_SELECTOR)) as HTMLElement[]
  railItems.value = heads.map(h => ({
    text: headText(h),
    el: h.closest(SECTION_SELECTOR) as HTMLElement,
  })).filter(r => r.text && r.el)
  activeRail.value = 0
  nextTick(updateRailLayout)
}

function goRail(i: number): void {
  const item = railItems.value[i]
  // 全部分类均接入 CardDeck 叠放翻卡：左列标题 → 翻到对应卡（单卡分类 goToCard 为 no-op）
  const panel = panelRefs[activeSection.value ?? '']?.value
  if (panel?.goToCard && item) {
    panel.goToCard(i)
    activeRail.value = i
    return
  }
  if (!item?.el) return
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  item.el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
}

/** 左列标题块的复合类：位置（首/中/尾/单）+ 激活态 + 放射透视变量 */
function railItemClass(i: number): Record<string, boolean | string> {
  const n = railItems.value.length
  const posClass = n === 1 ? 'set-rail-item--single'
    : i === 0 ? 'set-rail-item--top'
    : i === n - 1 ? 'set-rail-item--bottom'
    : 'set-rail-item--mid'
  return {
    on: activeRail.value === i,
    [posClass]: true,
    // 绕枢轴偏移量（-1~1，0=中间格），驱动「》」放射旋转/收窄
    '--v-offset': n <= 1 ? '0' : ((i - (n - 1) / 2) / ((n - 1) / 2)).toFixed(3),
    '--v-abs': n <= 1 ? '0' : Math.abs((i - (n - 1) / 2) / ((n - 1) / 2)).toFixed(3),
  }
}

// 切换分类或搜索时重置卡片区滚动：长面板（如 Agent）滚动后切短面板，scrollTop 残留会把
// 短面板内容卷出视口——表现为「面板丢失」（2026-09-06 修复）
watch([activeSection, searchQuery], () => {
  if (cardsRef.value) cardsRef.value.scrollTop = 0
})

// 切换分类或退出搜索后重建左列（此时面板已渲染）
watch(activeSection, () => { if (!searchQuery.value) nextTick(rebuildRail) })
watch(searchQuery, (q) => { if (!q) nextTick(rebuildRail) })
onMounted(() => nextTick(() => { if (!props.show) return; rebuildRail() }))

// 各分类的搜索关键词（用于搜索模式下过滤匹配的分类）
const CATEGORY_KEYWORDS: Record<string, string> = {
  appearance: '主题 外观 深色 浅色 宇宙 极光 锻造 水墨 棱镜 编辑器 高亮 脉冲 动画 淡化 扩散 透明度 theme highlight 字体 字体库 字体分层 导入 变体',
  plugins: '插件 外部插件 内置插件 功能插件 常驻 非芽 芽 扩展 模块 启用 禁用 内置 本地 远程 外部 sprout 分组 全选 源码 重载 装载 plugin external puzzle utility',
  editor: '编辑 撤销 重做 历史 大纲 内嵌 光标 平滑 undo redo outline caret smooth',
  layout: '布局 面板 思维导图 中心节点 字段 预设 宽度 panel mindmap field 时间线 timeline 拖拽 泳道 甘特图 紧凑 分组 手机预览 phone preview',
  relations: '关系 自动 创建 实体 引用 图谱 选择器 relation auto create',
  shortcuts: '快捷键 键盘 快捷 绑定 shortcut keyboard',
  storage: '存储 清理 孤立 文件 诊断 缓存 空间 配额 storage cleanup orphan diagnostic',
  accessibility: '动画效果 减弱动态 动画 动效 消息 脉冲 状态 面板 侧边栏 弹窗 控件 启动 眩晕 降低 可访问 reduce motion accessibility',
  about: '关于 版本 产品 WorldSea about version',
}

const matchedCategories = computed(() => {
  if (!searchQuery.value) return []
  const q = searchQuery.value.toLowerCase()
  return categories.filter(cat => CATEGORY_KEYWORDS[cat.id]?.toLowerCase().includes(q))
})

function onTabClick(id: string) {
  activeSection.value = activeSection.value === id ? null : id
  searchQuery.value = ''
}

function close() {
  if (dirty.value) {
    const currentView = uiStore.currentView
    if (currentView) {
      const view = pluginStore.getView(currentView)
      if (view?.pluginId && !isViewVisible(view.pluginId)) {
        const firstActive = pluginStore.views.find(v => isViewVisible(v.pluginId))
        if (firstActive) {
          uiStore.setView(firstActive.id)
          uiStore.viewComponent = firstActive.component
        }
      }
    }
    uiStore.viewRefreshKey++
  }
  dirty.value = false
  searchQuery.value = ''
  emit('close')
}
</script>

<style scoped>
.set-overlay { position: fixed; inset: 0; z-index: var(--z-overlay); background: var(--overlay, rgba(0,0,0,0.35)); display: flex; align-items: flex-start; justify-content: center; padding-top: 3vh; }
.set-shell { height: min(88vh, 680px); display: flex; flex-direction: column; position: relative; min-width: 420px; max-width: 680px; width: auto; }
/* 2026-09-13：上限 640 → 680——芽管理卡（26 芽 + 头部）在 640 下会触发卡片区内滚动，
   680 下芽卡一屏完整可见；其余标签页仅获得更多可视空间 */

.set-topbar { display: flex; align-items: center; gap: 10px; padding: 10px 16px; background: var(--content-bg, var(--color-bg-surface)); border-radius: var(--radius-md); box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
.set-topbar-left { display: flex; align-items: center; gap: 6px; color: var(--text-secondary); flex-shrink: 0; }
.set-topbar-title { font-size: var(--font-size-base); font-weight: var(--font-weight-semibold); color: var(--text-color); }
.set-topbar-spacer { flex: 1; }
.set-search-wrap { position: relative; width: 500px; flex-shrink: 0; }
.set-search-icon { position: absolute; left: 8px; top: 50%; transform: translateY(-50%); color: var(--text-tertiary, var(--color-text-tertiary)); pointer-events: none; }
.set-search-input { width: 100%; height: 28px; padding: 5px 28px; font-size: var(--font-size-sm); border: 1px solid var(--border, var(--color-border)); border-radius: var(--radius-sm); background: var(--bg, var(--color-bg-surface)); color: var(--text-secondary); }
.set-search-input:focus { outline: none; border-color: var(--primary, var(--color-primary)); }
.set-search-input::placeholder { color: var(--text-tertiary, var(--color-text-tertiary)); }
.set-search-clear { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); background: none; border: none; font-size: var(--font-size-xs); color: var(--text-tertiary, var(--color-text-tertiary)); cursor: pointer; padding: 2px; }
.set-search-clear:hover { color: var(--text-color); }
.set-close { background: none; border: none; font-size: var(--font-size-lg); cursor: pointer; padding: 4px 6px; border-radius: var(--radius-xs); color: var(--text-tertiary, var(--color-text-tertiary)); flex-shrink: 0; }
.set-close:hover { background: var(--hover-bg, var(--color-bg-hover)); color: var(--text-color); }

/* Tab 栏：单行横向滚动（隐藏滚动条），左右端漂浮三角控件 */
.set-tabs-wrap { position: relative; padding-top: 8px; }
.set-tabs { display: flex; gap: 6px; flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; padding: 0 18px 0 18px; }
.set-tabs::-webkit-scrollbar { display: none; }
.set-tabs-arrow {
  position: absolute; top: 50%; transform: translateY(-50%); z-index: 2;
  width: 22px; height: 22px; display: flex; align-items: center; justify-content: center;
  border: none; border-radius: 50%; cursor: pointer;
  background: var(--content-bg, var(--color-bg-surface)); color: var(--text-secondary);
  box-shadow: 0 1px 6px rgba(0,0,0,0.18); font-size: var(--font-size-base);
  transition: background 0.15s, color 0.15s, transform 0.15s;
}
.set-tabs-arrow:hover { background: var(--primary-light, color-mix(in srgb, var(--color-primary) 10%, transparent)); color: var(--primary, var(--color-primary)); }
.set-tabs-arrow--left { left: 0; }
.set-tabs-arrow--right { right: 0; }
.set-tab { display: flex; align-items: center; gap: 5px; padding: 7px 14px; border: none; border-radius: var(--radius-mid); background: var(--content-bg, var(--color-bg-surface)); color: var(--text-secondary); font-size: var(--font-size-sm); cursor: pointer; transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s; white-space: nowrap; box-shadow: 0 1px 4px rgba(0,0,0,0.05), 0 0 0 1px var(--border, var(--color-border)); }
.set-tab:hover { background: var(--content-bg, var(--color-bg-surface)); color: var(--text-color); box-shadow: 0 2px 8px rgba(0,0,0,0.08), 0 0 0 1px var(--border, var(--color-border)); }
.set-tab.active { background: var(--primary-light, color-mix(in srgb, var(--color-primary) 10%, transparent)); color: var(--primary, var(--color-primary)); font-weight: var(--font-weight-medium); box-shadow: 0 2px 8px color-mix(in srgb, var(--color-primary) 12%, transparent), 0 0 0 1px var(--primary, color-mix(in srgb, var(--color-primary) 20%, transparent)); }
.stb-icon { display: inline-flex; }

/* 左列标题导航：绝对定位贴附对话框左侧外侧（脱离文档流，不挤压/偏移对话框），top/height 由 JS 对齐配置面板区 */
.set-rail {
  position: absolute; right: calc(100% + 14px); width: 120px;
  overflow-y: auto; display: flex; flex-direction: column; gap: 3px;
  padding: 4px 0; scrollbar-width: none;
  /* 标题项垂直居中：使标题项中心落在 rail 中心 = 主卡中心线（rail 全高背景） */
  justify-content: center;
  /* 视距：为每个扇骨提供透视上下文（枢轴在左端） */
  perspective: 700px;
}
.set-rail::-webkit-scrollbar { display: none; }
.set-rail-item {
  position: relative;
  display: block; text-align: left; border: none; border-radius: 4px;
  /* 右侧留白避让楔形收窄；左端贴枢轴 */
  padding: 7px 22px 7px 12px; font-size: var(--font-size-xs); color: var(--text-secondary);
  background:
    linear-gradient(100deg, var(--content-bg, var(--color-bg-surface)) 0%, var(--content-bg, var(--color-bg-surface)) 84%, color-mix(in srgb, var(--color-primary) 9%, var(--content-bg, var(--color-bg-surface))) 100%);
  box-shadow: 0 1px 4px rgba(0,0,0,0.07), 0 0 0 1px var(--border, var(--color-border));
  transition: background 0.2s, color 0.2s, box-shadow 0.2s, transform 0.2s;
  cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  /* 扇形放射：「》」展开 —— 以左端为枢轴，rotateY 随 --v-offset 展开；宽度略按位置增（越靠中间越宽=正对） */
  transform-origin: left center;
  transform: rotateY(calc(var(--v-offset) * 22deg)) scale(calc(1 - var(--v-abs) * 0.12));
  width: calc(100% - var(--v-abs) * 6%);
  margin-left: calc(var(--v-abs) * 6%);
}
.set-rail-item:hover,
.set-rail-item.on {
  color: var(--primary, var(--color-primary));
  background:
    linear-gradient(100deg, color-mix(in srgb, var(--color-primary) 12%, var(--content-bg, var(--color-bg-surface))) 0%, color-mix(in srgb, var(--color-primary) 15%, var(--content-bg, var(--color-bg-surface))) 84%, color-mix(in srgb, var(--color-primary) 32%, var(--content-bg, var(--color-bg-surface))) 100%);
  box-shadow: 0 2px 8px color-mix(in srgb, var(--color-primary) 14%, transparent), 0 0 0 1px color-mix(in srgb, var(--color-primary) 22%, transparent);
  /* 激活/悬停：扇骨转正朝用户 */
  transform: rotateY(0deg) scale(1);
  width: 100%;
  margin-left: 0;
}
/* 斜向 3D（分位）：左上收窄成楔形（扇骨向枢轴点收拢），右侧保持竖直；仅切边框，文本保持水平 */
.set-rail-item--top { clip-path: polygon(0 0, 100% 12%, 100% 100%, 0 100%); }
.set-rail-item--mid { clip-path: polygon(0 0, 100% 12%, 100% 88%, 0 100%); }
.set-rail-item--bottom { clip-path: polygon(0 0, 100% 0, 100% 88%, 0 100%); }
.set-rail-item--single { clip-path: polygon(0 0, 100% 12%, 100% 88%, 0 100%); }
/* 激活态左侧强调条（贴正面竖边，不被斜切影响） */
.set-rail-item.on::before {
  content: ''; position: absolute; left: 0; top: 8%; bottom: 8%; width: 3px; border-radius: 2px;
  background: var(--primary, var(--color-primary));
}

.set-cards { margin-top: 12px; padding: 12px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; flex: 1; min-width: 0; min-height: 0; }

.set-empty { text-align: center; padding: 32px 0; color: var(--text-tertiary, var(--color-text-tertiary)); font-size: var(--font-size-sm); }

.resize-handle-right { position: absolute; right: 0; top: 0; width: 6px; height: 100%; cursor: col-resize; z-index: 10; background: transparent; transition: background 0.15s; }
.resize-handle-right:hover, .resize-handle-right:active { background: var(--primary); opacity: 0.3; }

/* 减弱动态效果：关闭平滑动画与过渡 */
:root[data-anim-panels='off'] .set-tabs-arrow { transition: none; }
:root[data-anim-panels='off'] .set-rail-item { transition: none; }
</style>
