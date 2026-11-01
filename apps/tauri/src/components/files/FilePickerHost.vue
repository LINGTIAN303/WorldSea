<template>
  <!-- 自绘文件选择器（单例宿主）：Shell 挂载一次，消费 filePickerApi 队列的队头。
       外观复刻 settings-dialog 的 sf-* 配方以自动跟随三套风格与深浅色；
       Esc/Tab/焦点还原统一由 useFocusTrap 承担（自动接 modalStack）。
       浏览状态机在 useFilePickerBrowse，本文件只做渲染与事件绑定。 -->
  <Teleport to="body">
    <Transition name="ws-scale-fade">
      <div v-if="req" class="fp-overlay" @click.self="cancel">
        <div
          ref="panelRef"
          class="fp-shell"
          :style="{ width: `${width}px` }"
          role="dialog"
          aria-modal="true"
          aria-labelledby="fp-title"
        >
          <div class="fp-head">
            <span id="fp-title" class="fp-title">{{ req.req.title || (isDirMode ? '选择文件夹' : '选择文件') }}</span>
            <span class="fp-head-spacer"></span>
            <button class="fp-icon-btn" title="关闭（Esc）" @click="cancel">
              <WsIcon name="close" size="sm" />
            </button>
          </div>

          <!-- 导航行：后退 / 前进 / 上级 / 可编辑路径 / 刷新 -->
          <div class="fp-nav">
            <button class="fp-icon-btn" title="后退" :disabled="historyIndex <= 0" @click="goBack">
              <WsIcon name="arrow-left" size="sm" />
            </button>
            <button class="fp-icon-btn" title="前进" :disabled="historyIndex >= history.length - 1" @click="goForward">
              <WsIcon name="arrow-right" size="sm" />
            </button>
            <button class="fp-icon-btn" title="上一级" :disabled="!canGoUp" @click="goUp">
              <WsIcon name="chevron-up" size="sm" />
            </button>
            <input
              v-model="pathDraft"
              class="fp-path"
              spellcheck="false"
              aria-label="当前路径（可直接编辑后回车跳转）"
              @keydown.enter.prevent="commitPathDraft"
              @keydown.esc.prevent="resetPathDraft"
            />
            <button class="fp-icon-btn" title="刷新" @click="reload">
              <WsIcon name="refresh" size="sm" />
            </button>
          </div>

          <!-- 搜索行：当前目录内按名称过滤（不递归；切换目录自动清空）+ 视图切换 -->
          <div class="fp-search-row">
            <div class="fp-search-wrap">
              <WsIcon name="search" size="xs" class="fp-search-icon" />
              <input
                v-model="query"
                class="fp-search"
                type="search"
                spellcheck="false"
                placeholder="在当前文件夹中搜索名称"
                aria-label="在当前文件夹中搜索"
              />
              <button v-if="query" class="fp-search-clear" title="清除搜索" @click="query = ''">
                <WsIcon name="close" size="xs" />
              </button>
            </div>
            <!-- 视图切换：详细信息列表 / 缩略图网格（aria-pressed 标注当前态） -->
            <div class="fp-view-toggle" role="group" aria-label="视图模式">
              <button
                class="fp-view-btn"
                :class="{ on: viewMode === 'list' }"
                :aria-pressed="viewMode === 'list'"
                title="详细信息视图"
                @click="setViewMode('list')"
              ><WsIcon name="list" size="xs" /></button>
              <button
                class="fp-view-btn"
                :class="{ on: viewMode === 'grid' }"
                :aria-pressed="viewMode === 'grid'"
                title="缩略图网格视图"
                @click="setViewMode('grid')"
              ><WsIcon name="grid" size="xs" /></button>
            </div>
          </div>

          <div class="fp-body">
            <!-- 左轨：最近访问 / 快捷位置 / 盘符（渲染在 FilePickerRail） -->
            <FilePickerRail
              :recent-dirs="recentDirs"
              :quick-locations="quickLocations"
              :drives="drives"
              :active-path="currentPath"
              @navigate="navigate"
            />

            <!-- 主区：面包屑 + 列表/网格 -->
            <div ref="mainRef" class="fp-main">
              <!-- 面包屑：点 chip 跳本级，点箭头展开同级子目录（渲染在 FilePickerCrumbs） -->
              <FilePickerCrumbs ref="crumbsRef" :crumbs="crumbs" @navigate="navigate" />

              <!-- 目录切换过渡：key=路径强制重建内容层，方向感由 navDirection 选 enter 变体；
                   data-reduce-motion 根属性会把过渡压到近瞬移（theme.css 全局开关） -->
              <Transition :name="`fp-dir-${navDirection}`" mode="out-in">
                <div v-if="loadingList" key="loading" class="fp-loading">
                  <!-- R2 骨架口径：列表 = 文本条，网格 = 图块格 -->
                  <template v-if="viewMode === 'grid'">
                    <div class="fp-skel-grid">
                      <WsSkeleton v-for="n in 8" :key="n" variant="card" :aspect="'104 / 122'" label="正在读取目录" />
                    </div>
                  </template>
                  <div v-else class="fp-skel-list">
                    <WsSkeleton
                      v-for="n in 8"
                      :key="n"
                      variant="text"
                      :lines="1"
                      label="正在读取目录"
                      :style="{ width: `${62 + (n % 4) * 9}%` }"
                      :aria-hidden="n > 1 || undefined"
                    />
                  </div>
                </div>
                <div v-else-if="listError" key="error" class="fp-status fp-status--error">
                  <span>{{ listError }}</span>
                  <button class="fp-link" @click="reload">重试</button>
                </div>
                <div v-else-if="visibleEntries.length === 0" key="empty" class="fp-status fp-status--empty">
                  <span>{{ entries.length === 0 ? '此文件夹为空' : '当前过滤器下没有可显示的文件' }}</span>
                  <button v-if="canGoUp" class="fp-link" @click="goUp">返回上一级</button>
                </div>
                <div v-else key="content" class="fp-content">
                  <!-- 巨目录截断提示：条数够多时只说结论，不用错误色（这不是故障） -->
                  <div v-if="listTruncated" class="fp-truncated">
                    条目较多，仅显示前 {{ entries.length }} 项；可输入路径直达或在上方搜索
                  </div>

                  <!-- 固定行高/格高 + 虚拟窗口：巨目录只渲染可视区。
                       键盘导航绑在本容器上（tabindex=0）：↑↓ 移动（网格下跨整行、←→ 邻格）、
                       Enter 进入/确认、Space 切换、Shift 区间多选、Ctrl+A 全选、Backspace 上级。 -->
                  <div
                    ref="listRef"
                    class="fp-list"
                    role="listbox"
                    tabindex="0"
                    :aria-multiselectable="multiple"
                    :aria-activedescendant="focusIndex >= 0 ? `fp-item-${focusIndex}` : undefined"
                    @scroll="onListScroll"
                    @keydown="onListKeydown"
                  >
                    <!-- 列表视图：绝对定位行， spacer 撑出总高 -->
                    <div v-if="viewMode === 'list'" class="fp-list-spacer" :style="{ height: `${visibleEntries.length * rowHeight}px` }">
                      <div
                        v-for="row in rows"
                        :key="row.entry.path"
                        :id="`fp-item-${row.index}`"
                        class="fp-row"
                        :class="{ dir: row.entry.isDir, on: selected.has(row.entry.path), dim: !!row.limit, focus: focusIndex === row.index }"
                        :style="{ top: `${row.index * rowHeight}px` }"
                        role="option"
                        :aria-selected="selected.has(row.entry.path)"
                        :aria-disabled="row.limit ? 'true' : undefined"
                        :title="row.limit ? row.limit : row.entry.path"
                        @click="onRowClick(row, { shift: $event.shiftKey })"
                        @dblclick="onRowDblClick(row)"
                        @mouseenter="onRowHover(row, $event)"
                        @mouseleave="onRowLeave"
                      >
                        <span class="fp-row-icon">
                          <WsIcon v-if="row.entry.isDir" name="folder" size="xs" />
                          <img
                            v-else-if="canThumbnail(row.entry)"
                            class="fp-thumb"
                            :src="thumbUrl(row.entry.path)"
                            :alt="''"
                            loading="lazy"
                            decoding="async"
                          />
                          <FileIcon v-else :name="row.entry.name" />
                        </span>
                        <span class="fp-row-name">{{ row.entry.name }}</span>
                        <span class="fp-row-time">{{ formatModified(row.entry.modified) }}</span>
                        <span class="fp-row-type">{{ typeLabelOf(row.entry) }}</span>
                        <span class="fp-row-size">{{ row.entry.isDir ? '' : formatBytes(row.entry.size) }}</span>
                      </div>
                    </div>

                    <!-- 网格视图：按「格子行」虚拟化，每行 cols 个格子（渲染在 FilePickerGrid） -->
                    <FilePickerGrid
                      v-else
                      :rows="gridCells"
                      :virtual-start="virtualWindow.start"
                      :row-height="rowHeight"
                      :total-rows="gridRowsTotal"
                      :selected="selected"
                      :focus-index="focusIndex"
                      @row-click="(cell, e) => onRowClick(cell, { shift: e.shiftKey })"
                      @row-dblclick="onRowDblClick"
                    />
                  </div>
                </div>
              </Transition>
            </div>
          </div>

          <!-- 悬停大图预览：悬浮在面板右侧，不挤占列表布局；延迟出现避免刷过每行都弹 -->
          <Transition name="ws-scale-fade">
            <div
              v-if="preview"
              class="fp-preview"
              :style="{ top: `${preview.top}px`, left: `${preview.left}px` }"
              aria-hidden="true"
            >
              <img :src="preview.src" :alt="preview.name" />
              <div class="fp-preview-name">{{ preview.name }}</div>
            </div>
          </Transition>

          <div class="fp-foot">
            <span class="fp-foot-info">
              <template v-if="summary.count">
                已选 {{ summary.count }} 项<template v-if="summary.totalBytes"> · {{ formatBytes(summary.totalBytes) }}</template>
              </template>
              <template v-else-if="overLimitCount">
                {{ overLimitCount }} 项超过{{ formatBytes(req.req.maxBytes ?? 0) }}上限
              </template>
              <template v-else>未选择</template>
            </span>
            <button class="fp-native" title="网络位置 / 云端占位文件等边界场景可改用系统对话框" @click="useNativeDialog">
              <WsIcon name="folder-open" size="xs" />
              <span>用系统对话框</span>
            </button>
            <TuiButton variant="ghost" size="sm" @click="cancel">取消</TuiButton>
            <TuiButton variant="primary" size="sm" :disabled="!canConfirm" @click="confirm">
              {{ isDirMode ? '选择此文件夹' : '选择' }}
            </TuiButton>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { convertFileSrc } from '@tauri-apps/api/core'
import { FileIcon, TuiButton, WsIcon, WsSkeleton } from '@worldsea/ui-kit'
import { useResizable } from '@worldsea/ui-kit/composables/useResizable'
import { useFocusTrap } from '@/composables/useFocusTrap'
import { activePick, settlePick } from '@/composables/filePickerApi'
import { useFilePickerBrowse } from '@/composables/useFilePickerBrowse'
import { useFilePickerPreview } from '@/composables/useFilePickerPreview'
import { useFilePickerKeys } from '@/composables/useFilePickerKeys'
import FilePickerGrid from './FilePickerGrid.vue'
import type { GridCell } from './FilePickerGrid.vue'
import FilePickerRail from './FilePickerRail.vue'
import FilePickerCrumbs from './FilePickerCrumbs.vue'
import {
  canThumbnail, formatModified, normalizePath, overLimitReason, typeLabelOf,
  type FsEntry,
} from './filePickerModel'

const req = activePick

/** 面板宽度（可拖拽，跨次记忆：与其它模态共用 useResizable 的持久化口径） */
const { width } = useResizable({ panelId: 'modal-file-picker', defaultWidth: 880, minWidth: 640, maxWidth: 1400 })

const panelRef = ref<HTMLElement | null>(null)
const mainRef = ref<HTMLElement | null>(null)
const listRef = ref<HTMLElement | null>(null)

const browse = useFilePickerBrowse({
  request: () => req.value?.req ?? null,
  settle: settlePick,
})

const {
  drives, quickLocations, recentDirs, currentPath, pathDraft, query, entries, loadingList, listError,
  listTruncated,
  selected, focusIndex, history, historyIndex, isDirMode, multiple, canGoUp,
  visibleEntries, rows, crumbs, summary, overLimitCount, canConfirm,
  viewMode, setViewMode, navDirection, rowHeight, cols, gridRowsTotal, virtualWindow, setViewportWidth,
  navigate, goBack, goForward, goUp, reload, commitPathDraft, resetPathDraft,
  onScroll, onRowClick, onRowDblClick, confirm, reset, useNativeDialog,
  formatBytes,
  moveFocus, focusSelect, focusEnter, selectAll, clearSelection,
} = browse

/** 网格可视行的格子（按行分组；与列表行同构，超限随条目计算） */
const gridCells = computed<GridCell[][]>(() => {
  const all = visibleEntries.value
  const maxBytes = req.value?.req.maxBytes
  const out: GridCell[][] = []
  for (let r = virtualWindow.value.start; r < virtualWindow.value.end; r++) {
    const begin = r * cols.value
    const row: GridCell[] = []
    for (let i = begin; i < Math.min(begin + cols.value, all.length); i++) {
      const entry = all[i]
      row.push({ entry, index: i, limit: overLimitReason(entry, maxBytes) })
    }
    out.push(row)
  }
  return out
})

/**
 * 缩略图 URL（asset 协议）。只在渲染可见行时调用，虚拟滚动已把范围收窄到可视区；
 * 浏览器侧再叠加 loading="lazy" 与 decoding="async" 兜住快速滚动。
 */
function thumbUrl(path: string): string {
  return convertFileSrc(normalizePath(path))
}

/* ── 悬停大图预览（逻辑在 useFilePickerPreview） ── */
const { preview, onRowHover: hoverRow, onRowLeave } = useFilePickerPreview()

/** 行悬停：只把条目交给预览逻辑，DOM 事件留着算位置 */
function onRowHover(row: { entry: FsEntry }, e: MouseEvent): void {
  hoverRow(row.entry, e)
}

/** 面包屑子组件（菜单开关由其自持，Esc 优先关菜单经 closeMenu 兑现） */
const crumbsRef = ref<InstanceType<typeof FilePickerCrumbs> | null>(null)

useFocusTrap(panelRef, {
  active: computed(() => !!req.value),
  // Esc 优先级：面包屑菜单 > 已选清空 > 关闭面板（与文件管理器习惯一致）
  onEscape: () => {
    if (crumbsRef.value?.hasOpenMenu()) return crumbsRef.value.closeMenu()
    if (selected.value.size > 0) return clearSelection()
    cancel()
  },
})

function cancel(): void {
  settlePick(null)
}

/** 滚动事件委托（浏览器状态机只管数值，DOM 引用留在视图层） */
function onListScroll(e: Event): void {
  onScroll(e.target as HTMLElement)
}

/** 键盘导航（逻辑在 useFilePickerKeys；revealFocus 需要 listRef，包装一层） */
const { onListKeydown: handleKeydown } = useFilePickerKeys({
  viewMode: () => viewMode.value,
  cols: () => cols.value,
  rowHeight: () => rowHeight.value,
  visibleCount: () => visibleEntries.value.length,
  focusIndex,
  hasSelection: () => selected.value.size > 0,
  moveFocus,
  focusSelect,
  focusEnter,
  selectAll,
  goUp,
  clearSelection,
})

function onListKeydown(e: KeyboardEvent): void {
  handleKeydown(e, listRef.value)
}

/** 主区内容宽度上报（网格列数依赖；ResizeObserver 覆盖拖宽与窗口 resize） */
let widthObserver: ResizeObserver | null = null
onMounted(() => {
  if (typeof ResizeObserver === 'undefined' || !mainRef.value) return
  widthObserver = new ResizeObserver((entries) => {
    const w = entries[0]?.contentRect.width
    if (w) setViewportWidth(w)
  })
  widthObserver.observe(mainRef.value)
  // 挂载即量一次（observer 首帧也会回调，这里兜底时序）
  setViewportWidth(mainRef.value.clientWidth || 640)
})

/** 每次新请求进来：重置并起步（defaultPath 不可读时回落快捷位置/首个盘符） */
watch(
  req,
  async (current) => {
    if (!current) return
    await reset(current.req.defaultPath)
    // 列表挂载后量一次可视高度（虚拟窗口依赖真实 clientHeight）
    await nextTick()
    if (listRef.value) onScroll(listRef.value)
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  widthObserver?.disconnect()
  // 组件被卸载时释放未兑现请求，避免调用方 Promise 悬挂
  if (req.value) settlePick(null)
})
</script>

<style scoped src="./file-picker-host.css"></style>
