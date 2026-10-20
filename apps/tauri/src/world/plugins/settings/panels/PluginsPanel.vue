<template>
  <!-- 「插件」分区面板（2026-10-13 对齐 AppearancePanel 叠放翻卡形态；批4 三卡化 / 批5 内置插件常驻化）：
       卡0 外部插件（worlddata 运行时装载，Agent 写入，可启停）+ 卡1 内置插件（非芽 utility，常驻装载无启停）
       + 卡2 芽管理（SproutsCardContent）——「芽是插件，但插件不等于芽」。
       一个分区一个 CardDeck = rail 三项 + 滚轮翻卡。 -->
  <CardDeck :count="4" :flat="!!searchQuery" @change="(i) => emit('card-change', i)" ref="deckRef">
    <template #card="{ idx, cls }">
      <!-- 卡 0 · 外部插件 -->
      <div v-if="idx === 0" class="set-card deck-card" :class="cls"
        v-show="match('外部插件 外置插件 运行时插件 external')">
        <div class="sc-head">
          <div class="exp-head-left">
            <span>外部插件</span>
            <span class="exp-sub">worlddata/.worldsea/plugins/</span>
          </div>
          <button type="button" class="set-btn" :disabled="busy" title="重新扫描插件目录并对比重装" @click="onReload">
            <WsIcon name="refresh" size="xs" /><span>{{ busy ? '重载中…' : '重载' }}</span>
          </button>
        </div>

        <!-- 空态：路径与写入方式指引（弱提示） -->
        <p v-if="states.length === 0" class="set-hint exp-empty">
          此项目还没有外部插件。让 Agent 调用 <code>world_plugin_write</code> 写入插件文件（或把
          <code>&lt;id&gt;.js</code> 放进上方目录），保存后约 1 秒自动热装载。
        </p>

        <!-- 插件行列表 -->
        <div v-else class="exp-list">
          <div v-for="item in states" :key="item.id" class="exp-item" :class="{ rejected: item.status === 'rejected' }">
            <div class="exp-item-main">
              <div class="exp-item-title">
                <span class="exp-name">{{ item.name }}</span>
                <span class="exp-ver">{{ item.version }}</span>
                <span class="exp-status" :class="`is-${item.status}`">{{ statusLabel(item.status) }}</span>
              </div>
              <div class="exp-item-meta">
                <span class="exp-id">{{ item.id }}</span>
                <span v-if="item.reason" class="exp-reason" :title="item.reason">{{ item.reason }}</span>
              </div>
            </div>
            <div class="exp-item-actions">
              <label v-if="item.status !== 'rejected'" class="set-toggle" :title="item.status === 'loaded' ? '停用（视图即刻消失）' : '启用'">
                <input type="checkbox" :checked="item.status === 'loaded'" @change="onToggle(item.id)" /><span class="set-toggle-slider"></span>
              </label>
              <button type="button" class="set-btn" title="查看插件源码" @click="onViewSource(item.id)">源码</button>
              <button
                type="button"
                class="set-btn exp-danger"
                :class="{ confirm: pendingDelete === item.id }"
                :title="pendingDelete === item.id ? '再次点击确认删除' : '删除插件文件'"
                @click="onDelete(item)"
              >{{ pendingDelete === item.id ? '确认删除？' : '删除' }}</button>
            </div>
          </div>
        </div>

        <!-- 源码查看（复用 TuiModal 基座） -->
        <TuiModal :show="sourceView !== null" :title="sourceView ? `${sourceView.id}.js` : ''" size="lg" @close="sourceView = null">
          <pre class="exp-modal-code">{{ sourceView?.code }}</pre>
        </TuiModal>
      </div>

      <!-- 卡 1 · 内置插件（非芽类 utility：常驻装载，无侧栏入口，无启停） -->
      <div v-else-if="idx === 1" class="set-card deck-card" :class="cls"
        v-show="match('内置插件 功能插件 工具 面板 utility overlay 常驻')">
        <div class="sc-head">
          <div class="exp-head-left">
            <span>内置插件</span>
            <span class="exp-sub">常驻装载 · 无侧栏入口的功能面板</span>
          </div>
        </div>
        <div v-if="utilityPlugins.length === 0" class="set-hint exp-empty">当前没有内置插件。</div>
        <div v-else class="exp-list">
          <div v-for="item in utilityPlugins" :key="item.id" class="exp-item">
            <div class="exp-item-main">
              <div class="exp-item-title">
                <span class="exp-name">{{ item.name }}</span>
                <span class="exp-ver">{{ item.version }}</span>
                <span class="exp-status is-loaded">常驻装载</span>
              </div>
              <div class="exp-item-meta">
                <span class="exp-id">{{ item.id }}</span>
                <span class="exp-desc">{{ item.description }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 卡 2 · 芽管理 -->
      <SproutsCardContent v-else-if="idx === 2" :class="cls" :search-query="searchQuery" :domain-of="domainOf" @dirty="emit('dirty')" ref="sproutsContentRef" />

      <!-- 卡 3 · 激活分组（启用范围预设；与域导航正交） -->
      <SproutGroupsCardContent v-else-if="idx === 3" :class="cls" :search-query="searchQuery" @dirty="emit('dirty')" />
    </template>
  </CardDeck>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { getFileStorageBackend, useSettingsStore } from '@worldsea/entity-core'
import { toastSuccess, toastWarn, WsIcon, CardDeck, matchKeywords } from '@worldsea/ui-kit'
import SproutsCardContent from '@worldsea/ui-kit/components/settings/panels/SproutsCardContent.vue'
import SproutGroupsCardContent from '@worldsea/ui-kit/components/settings/panels/SproutGroupsCardContent.vue'
import TuiModal from '@/components/ui/TuiModal.vue'
import { availablePlugins, externalPluginStates, reloadExternalPlugins } from '@/world'
import type { ExternalPluginState } from '@/world'

const props = defineProps<{ searchQuery?: string }>()
const emit = defineEmits<{ dirty: []; 'card-change': [index: number] }>()

const settings = useSettingsStore()
const deckRef = ref<InstanceType<typeof CardDeck> | null>(null)
const sproutsContentRef = ref<InstanceType<typeof SproutsCardContent> | null>(null)

const states = ref<ExternalPluginState[]>([])
/** 世界树插件全集快照（内置 + 外部，含未启用——availablePlugins 非响应式，随 refresh 刷新） */
const treePlugins = ref(availablePlugins())

/** manifest.domain 查询口：ui-kit 芽管理不反向依赖世界树，由本面板注入。 */
const domainMap = computed(() => {
  const map = new Map<string, string>()
  for (const plugin of treePlugins.value) {
    if (plugin.manifest.domain) map.set(plugin.manifest.id, plugin.manifest.domain)
  }
  return map
})
function domainOf(pluginId: string): string {
  return domainMap.value.get(pluginId) ?? 'unclassified'
}

/** 非芽类（utility）内置插件：manifest 自声明 kind，常驻装载（无启停——批5 对齐 dsh 内置语义）。
 *  外部 utility 插件在「外部插件」卡管理，不重复。 */
const utilityPlugins = computed(() => {
  const externalIds = new Set(states.value.map(s => s.id))
  return treePlugins.value
    .filter(p => p.manifest.kind === 'utility' && !externalIds.has(p.manifest.id))
    .map(p => ({
      id: p.manifest.id,
      name: p.manifest.name,
      version: p.manifest.version,
      description: p.manifest.description,
    }))
})
const busy = ref(false)
const pendingDelete = ref<string | null>(null)
const sourceView = ref<{ id: string; code: string } | null>(null)

/** 删除二次确认计时器（3s 未确认自动复位） */
let deleteTimer: ReturnType<typeof setTimeout> | null = null

function match(keywords: string): boolean {
  return matchKeywords(props.searchQuery ?? '', keywords)
}

function statusLabel(status: ExternalPluginState['status']): string {
  return status === 'loaded' ? '已启用' : status === 'skipped' ? '未启用' : '被拒'
}

function refresh() {
  states.value = externalPluginStates()
}

/** 插件文件绝对路径（删除/读源码用）。 */
function pluginFilePath(id: string): string | null {
  const dir = getFileStorageBackend()?.projectDir
  if (!dir) return null
  return `${dir.replace(/[\\/]+$/, '')}/.worldsea/plugins/${id}.js`
}

async function onReload() {
  busy.value = true
  try {
    const report = await reloadExternalPlugins()
    if (report.rejected.length > 0) {
      toastWarn(`重载完成，${report.rejected.length} 个插件被拒（见下方原因）`)
    } else {
      toastSuccess(`重载完成：+${report.added.length} ~${report.updated.length} -${report.removed.length}`)
    }
    settings.syncExternalSprouts(sproutEntries())
    refresh()
    emit('dirty')
  } catch (err) {
    toastWarn(`重载失败：${String(err)}`)
  } finally {
    busy.value = false
  }
}

/** sprouts 对账条目（与 world/index.ts 的 externalSproutEntries 同口径；本面板就近重建） */
function sproutEntries() {
  return states.value
    .filter(item => item.status !== 'rejected')
    .map(item => ({
      id: item.id,
      label: item.name,
      icon: 'puzzle',
      active: settings.sprouts.find(sprout => sprout.id === item.id)?.active ?? true,
    }))
}

function onToggle(id: string) {
  settings.toggleSprout(id)
  refresh()
  emit('dirty')
}

async function onViewSource(id: string) {
  const path = pluginFilePath(id)
  if (!path) {
    toastWarn('项目目录未就绪')
    return
  }
  try {
    const invoke = (await import('@tauri-apps/api/core')).invoke
    const code = await invoke('cmd_fs_read', { path, encoding: 'utf-8' }) as string
    sourceView.value = { id, code }
  } catch (err) {
    toastWarn(`源码读取失败：${String(err)}`)
  }
}

async function onDelete(item: ExternalPluginState) {
  // 二次确认：第一次点只标记，3s 内再点才执行（避免引入确认弹窗的接线成本）
  if (pendingDelete.value !== item.id) {
    pendingDelete.value = item.id
    if (deleteTimer) clearTimeout(deleteTimer)
    deleteTimer = setTimeout(() => { pendingDelete.value = null }, 3000)
    return
  }
  pendingDelete.value = null
  const path = pluginFilePath(item.id)
  if (!path) {
    toastWarn('项目目录未就绪')
    return
  }
  try {
    const invoke = (await import('@tauri-apps/api/core')).invoke
    await invoke('cmd_fs_delete', { path })
    toastSuccess(`已删除 ${item.id}（~1s 内自动卸载）`)
  } catch (err) {
    toastWarn(`删除失败：${String(err)}`)
  }
}

// 芽清单变化（热装载对账 / 开关切换）→ 刷新快照（外部状态 + 世界树插件全集）
watch(() => settings.sprouts.map(s => `${s.id}:${s.active}`).join('|'), () => {
  treePlugins.value = availablePlugins()
  refresh()
})

onMounted(refresh)
onUnmounted(() => { if (deleteTimer) clearTimeout(deleteTimer) })

defineExpose({
  goToCard: (i: number) => deckRef.value?.goToCard(i),
  resetSproutSearch: () => sproutsContentRef.value?.resetSproutSearch(),
})
</script>

<style scoped>
/* 基座（.set-card/.sc-head/.set-btn/.set-toggle/.set-hint）唯一权威在 ui-kit settings-panels.css；此处仅外部插件卡私有布局与弱色文本 */
.exp-head-left { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.exp-sub { font-size: var(--text-micro-font-size, 10px); color: var(--text-tertiary, var(--color-text-tertiary)); text-transform: none; letter-spacing: normal; font-weight: var(--font-weight-normal, 400); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.exp-empty code { padding: 1px 5px; border-radius: 4px; background: var(--bg-secondary, var(--color-bg-elevated)); font-size: 0.92em; }
.exp-list { display: flex; flex-direction: column; }
.exp-item { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 7px 2px; border-bottom: 1px solid var(--border, var(--color-border)); }
.exp-item:last-child { border-bottom: none; }
.exp-item.rejected .exp-name { color: var(--danger, var(--color-danger)); }
.exp-item-main { min-width: 0; }
.exp-item-title { display: flex; align-items: center; gap: 8px; }
.exp-name { font-size: var(--font-size-sm); font-weight: var(--font-weight-medium, 500); }
.exp-ver { font-size: var(--text-micro-font-size, 10px); color: var(--text-tertiary, var(--color-text-tertiary)); }
/* 状态 = 纯文本弱色（无底色徽标）；被拒才用 danger 文本 */
.exp-status { font-size: var(--text-micro-font-size, 10px); color: var(--text-tertiary, var(--color-text-tertiary)); }
.exp-status.is-loaded { color: var(--primary, var(--color-primary)); opacity: 0.85; }
.exp-status.is-rejected { color: var(--danger, var(--color-danger)); }
.exp-item-meta { display: flex; align-items: center; gap: 8px; margin-top: 2px; min-width: 0; }
.exp-id { font-size: var(--text-micro-font-size, 10px); color: var(--text-tertiary, var(--color-text-tertiary)); font-family: var(--font-mono, monospace); }
.exp-desc { font-size: var(--text-micro-font-size, 10px); color: var(--text-tertiary, var(--color-text-tertiary)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.exp-reason { font-size: var(--text-micro-font-size, 10px); color: var(--danger, var(--color-danger)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.exp-item-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
/* 删除/确认 = danger 文本色描边（无填充——弱提示口径） */
.exp-danger:hover:not(:disabled) { border-color: var(--danger, var(--color-danger)); color: var(--danger, var(--color-danger)); }
.exp-danger.confirm { border-color: var(--danger, var(--color-danger)); color: var(--danger, var(--color-danger)); }
.exp-modal-code { margin: 0; padding: 12px 14px; overflow: auto; max-height: 60vh; font-size: var(--font-size-xs, 12px); line-height: 1.6; font-family: var(--font-mono, monospace); white-space: pre-wrap; word-break: break-all; }
</style>
