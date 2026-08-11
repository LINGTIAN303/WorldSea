<template>
  <div class="set-overlay" v-if="show" @click.self="close">
    <div ref="dialogRef" class="set-shell" role="dialog" aria-modal="true" aria-labelledby="set-dialog-title" tabindex="-1">
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

      <nav class="set-tabs">
        <button v-for="cat in categories" :key="cat.id"
          class="set-tab" :class="{ active: activeSection === cat.id }"
          @click="onTabClick(cat.id)">
          <WsIcon :name="cat.icon" size="xs" class="stb-icon" />
          <span class="stb-label">{{ cat.label }}</span>
        </button>
      </nav>

      <div class="set-cards" v-if="activeSection || searchQuery">
        <!-- 搜索模式：渲染所有匹配类别的面板 -->
        <template v-if="searchQuery">
          <template v-for="cat in matchedCategories" :key="cat.id">
            <AppearancePanel v-if="cat.id === 'appearance'" :search-query="searchQuery" @dirty="onDirty" />
            <PluginsPanel v-if="cat.id === 'plugins'" :search-query="searchQuery" @dirty="onDirty" />
            <EditorPanel v-if="cat.id === 'editor'" :search-query="searchQuery" @dirty="onDirty" />
            <LayoutPanel v-if="cat.id === 'layout'" :search-query="searchQuery" @dirty="onDirty" />
            <RelationsPanel v-if="cat.id === 'relations'" :search-query="searchQuery" @dirty="onDirty" />
            <CompanionPanel v-if="cat.id === 'video'" :search-query="searchQuery" @dirty="onDirty" />
            <ShortcutsPanel v-if="cat.id === 'shortcuts'" :search-query="searchQuery" @dirty="onDirty" />
            <VoicePanel v-if="cat.id === 'voice'" :search-query="searchQuery" @dirty="onDirty" />
            <div v-if="cat.id === 'agent'" class="agent-set-embed"><SpaceAgentSettingsPanel @close="close" /></div>
          </template>
          <div v-if="matchedCategories.length === 0" class="set-empty">未找到匹配的设置项</div>
        </template>

        <!-- 正常模式：只渲染当前激活的分类 -->
        <template v-else>
          <AppearancePanel v-if="activeSection === 'appearance'" @dirty="onDirty" />
          <PluginsPanel v-else-if="activeSection === 'plugins'" @dirty="onDirty" />
          <EditorPanel v-else-if="activeSection === 'editor'" @dirty="onDirty" />
          <LayoutPanel v-else-if="activeSection === 'layout'" @dirty="onDirty" />
          <RelationsPanel v-else-if="activeSection === 'relations'" @dirty="onDirty" />
          <CompanionPanel v-else-if="activeSection === 'video'" @dirty="onDirty" />
          <ShortcutsPanel v-else-if="activeSection === 'shortcuts'" @dirty="onDirty" />
          <VoicePanel v-else-if="activeSection === 'voice'" @dirty="onDirty" />
          <template v-else-if="activeSection === 'storage'">
            <StorageManagementTab />
          </template>
          <div v-else-if="activeSection === 'agent'" class="agent-set-embed"><SpaceAgentSettingsPanel @close="close" /></div>
        </template>
      </div>

      <div class="resize-handle-right" v-if="false" @mousedown="modalResizable.onResizeStart"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useSettingsStore, useUIStore, usePluginStore } from '@worldsmith/entity-core'
import { useResizable, WsIcon } from '@worldsmith/ui-kit'
import { useFocusTrap } from '@/composables/useFocusTrap'
import StorageManagementTab from '../data/StorageManagementTab.vue'
// 设置子面板（已迁移到 ui-kit，通过 re-export 兼容层导入）
import AppearancePanel from './panels/AppearancePanel.vue'
import PluginsPanel from './panels/PluginsPanel.vue'
import EditorPanel from './panels/EditorPanel.vue'
import LayoutPanel from './panels/LayoutPanel.vue'
import RelationsPanel from './panels/RelationsPanel.vue'
import CompanionPanel from './panels/CompanionPanel.vue'
import ShortcutsPanel from './panels/ShortcutsPanel.vue'
import VoicePanel from './panels/VoicePanel.vue'
// Agent 设置面板（embedded 封装，2026-08-09 迁入主设置）
import SpaceAgentSettingsPanel from '@/space/panels/SpaceAgentSettingsPanel.vue'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ close: [] }>()

const dialogRef = ref<HTMLElement | null>(null)

const { activate, deactivate } = useFocusTrap(dialogRef, {
  escapeDeactivates: true,
  onEscape: () => close(),
})

// 模态框可调整大小（保留接口，当前未启用）
const modalResizable = useResizable({ panelId: 'modal-settings', defaultWidth: 560, minWidth: 400, side: 'right' })

const store = useSettingsStore()
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
  { id: 'relations', icon: 'cat-relations', label: '关系' },
  { id: 'video', icon: 'cat-video', label: '陪伴模式' },
  { id: 'shortcuts', icon: 'cat-shortcuts', label: '快捷键' },
  { id: 'voice', icon: 'volume-on', label: '语音' },
  { id: 'storage', icon: 'cat-storage', label: '存储' },
  { id: 'agent', icon: 'bot', label: 'Agent' },
]

const activeSection = ref<string | null>(null)
const searchQuery = ref('')

// 各分类的搜索关键词（用于搜索模式下过滤匹配的分类）
const CATEGORY_KEYWORDS: Record<string, string> = {
  appearance: '主题 外观 深色 浅色 宇宙 极光 锻造 水墨 棱镜 编辑器 高亮 脉冲 动画 淡化 扩散 透明度 theme highlight 字体 字体库 字体分层 导入 变体',
  plugins: '插件 扩展 模块 启用 禁用 内置 本地 远程 plugin',
  editor: '编辑 撤销 重做 历史 大纲 内嵌 光标 平滑 undo redo outline caret smooth',
  layout: '布局 面板 思维导图 中心节点 字段 预设 宽度 panel mindmap field 时间线 timeline 拖拽 泳道 甘特图 紧凑 分组',
  relations: '关系 自动 创建 实体 引用 图谱 选择器 relation auto create',
  video: '陪伴模式 video 通知 弹窗 人格 角色 附体 persona 概率 运气 场景 停驻 断句 字数 模型 独立 供应商 空间 静默',
  shortcuts: '快捷键 键盘 快捷 绑定 shortcut keyboard',
  voice: '语音 识别 输入 麦克风 连续 语言 voice',
  storage: '存储 清理 孤立 文件 诊断 缓存 空间 配额 storage cleanup orphan diagnostic',
  agent: 'Agent 模型 供应商 用量 Skills MCP 搜索 多模态 终端 安全 人格预设 思考级别 危险操作 确认 agent model provider usage skill mcp search vision terminal safety persona thinking',
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
      if (view?.pluginId && !store.isActive(view.pluginId)) {
        const firstActive = pluginStore.views.find(v => !v.pluginId || store.isActive(v.pluginId))
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
.set-shell { max-height: 78vh; display: flex; flex-direction: column; position: relative; min-width: 420px; max-width: 680px; width: auto; }

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

.set-tabs { display: flex; gap: 6px; padding: 8px 0 0; flex-wrap: wrap; }
.set-tab { display: flex; align-items: center; gap: 5px; padding: 7px 14px; border: none; border-radius: var(--radius-mid); background: var(--content-bg, var(--color-bg-surface)); color: var(--text-secondary); font-size: var(--font-size-sm); cursor: pointer; transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s; white-space: nowrap; box-shadow: 0 1px 4px rgba(0,0,0,0.05), 0 0 0 1px var(--border, var(--color-border)); }
.set-tab:hover { background: var(--content-bg, var(--color-bg-surface)); color: var(--text-color); box-shadow: 0 2px 8px rgba(0,0,0,0.08), 0 0 0 1px var(--border, var(--color-border)); }
.set-tab.active { background: var(--primary-light, color-mix(in srgb, var(--color-primary) 10%, transparent)); color: var(--primary, var(--color-primary)); font-weight: var(--font-weight-medium); box-shadow: 0 2px 8px color-mix(in srgb, var(--color-primary) 12%, transparent), 0 0 0 1px var(--primary, color-mix(in srgb, var(--color-primary) 20%, transparent)); }
.stb-icon { display: inline-flex; }

.set-cards { margin-top: 12px; padding: 12px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }

/* Agent 设置内嵌：撑满卡片区高度，纵向导航 + 内容区自适应 */
.agent-set-embed {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.agent-set-embed :deep(.space-agent-settings) {
  flex: 1;
  min-height: 0;
  /* 去掉外层面板背景/内边距，让卡片直接浮在设置背景上、卡片间缝隙透出背景（与其余标签页一致） */
  background: transparent;
  padding: 0;
}
.agent-set-embed :deep(.space-agent-settings .panel-header) {
  display: none;
}

.set-empty { text-align: center; padding: 32px 0; color: var(--text-tertiary, var(--color-text-tertiary)); font-size: var(--font-size-sm); }

.resize-handle-right { position: absolute; right: 0; top: 0; width: 6px; height: 100%; cursor: col-resize; z-index: 10; background: transparent; transition: background 0.15s; }
.resize-handle-right:hover, .resize-handle-right:active { background: var(--primary); opacity: 0.3; }
</style>
