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

          <!-- 搜索行：当前目录内按名称过滤（不递归；切换目录自动清空） -->
          <div class="fp-search-row">
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

          <div class="fp-body">
            <!-- 左轨：快捷位置 + 盘符 -->
            <div class="fp-rail">
              <div v-if="recentDirs.length" class="fp-rail-group">
                <div class="fp-rail-title">最近访问</div>
                <button
                  v-for="dir in recentDirs"
                  :key="dir"
                  class="fp-rail-item"
                  :class="{ on: samePath(dir, currentPath) }"
                  :title="dir"
                  @click="navigate(dir)"
                >
                  <WsIcon name="clock" size="xs" />
                  <span>{{ railLabel(dir) }}</span>
                </button>
              </div>
              <div class="fp-rail-group">
                <div class="fp-rail-title">快捷位置</div>
                <button
                  v-for="loc in quickLocations"
                  :key="loc.id"
                  class="fp-rail-item"
                  :class="{ on: samePath(loc.path, currentPath) }"
                  :title="loc.path"
                  @click="navigate(loc.path)"
                >
                  <WsIcon :name="loc.icon" size="xs" />
                  <span>{{ loc.label }}</span>
                </button>
              </div>
              <div class="fp-rail-group">
                <div class="fp-rail-title">此电脑</div>
                <button
                  v-for="drive in drives"
                  :key="drive.path"
                  class="fp-rail-item"
                  :class="{ on: driveRootOf(currentPath) === normalizePath(drive.path) }"
                  :title="driveTitle(drive)"
                  @click="navigate(drive.path)"
                >
                  <WsIcon name="cat-storage" size="xs" />
                  <span>{{ drive.name }}</span>
                </button>
                <div v-if="drives.length === 0" class="fp-rail-empty">未取到盘符</div>
              </div>
            </div>

            <!-- 主区：面包屑 + 列表 -->
            <div class="fp-main">
              <div class="fp-crumbs">
                <template v-for="(crumb, i) in crumbs" :key="crumb.path">
                  <span v-if="i > 0" class="fp-crumb-sep">/</span>
                  <button class="fp-crumb" :class="{ on: i === crumbs.length - 1 }" @click="navigate(crumb.path)">
                    {{ crumb.label }}
                  </button>
                </template>
              </div>

              <div v-if="loadingList" class="fp-status"><WsInlineLoading size="sm" label="正在读取目录" /></div>
              <div v-else-if="listError" class="fp-status fp-status--error">
                <span>{{ listError }}</span>
                <button class="fp-link" @click="reload">重试</button>
              </div>
              <div v-else-if="visibleEntries.length === 0" class="fp-status">
                {{ entries.length === 0 ? '此文件夹为空' : '当前过滤器下没有可显示的文件' }}
              </div>

              <!-- 固定行高 + 虚拟窗口：巨目录（System32 等）只渲染可视区。
                   键盘导航绑在本容器上（tabindex=0）：↑↓ 移动、Enter 进入/确认、
                   Space 切换、Shift+↑↓ 或 Shift+点击 区间多选、Ctrl+A 全选、Backspace 上级。 -->
              <div
                v-else
                ref="listRef"
                class="fp-list"
                role="listbox"
                tabindex="0"
                :aria-multiselectable="multiple"
                :aria-activedescendant="focusIndex >= 0 ? `fp-row-${focusIndex}` : undefined"
                @scroll="onListScroll"
                @keydown="onListKeydown"
              >
                <div class="fp-list-spacer" :style="{ height: `${visibleEntries.length * ROW_HEIGHT}px` }">
                  <!-- 列宽与 .fp-row 的固定宽度保持一致（名称弹性，其余定宽） -->
                  <div
                    v-for="row in rows"
                    :key="row.entry.path"
                    :id="`fp-row-${row.index}`"
                    class="fp-row"
                    :class="{
                      dir: row.entry.isDir,
                      on: selected.has(row.entry.path),
                      dim: !!row.limit,
                      focus: focusIndex === row.index,
                    }"
                    :style="{ top: `${row.index * ROW_HEIGHT}px` }"
                    role="option"
                    :aria-selected="selected.has(row.entry.path)"
                    :aria-disabled="row.limit ? 'true' : undefined"
                    :title="row.limit ? row.limit : row.entry.path"
                    @click="onRowClick(row, { shift: $event.shiftKey })"
                    @dblclick="onRowDblClick(row)"
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
              </div>
            </div>
          </div>

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
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { convertFileSrc } from '@tauri-apps/api/core'
import { FileIcon, TuiButton, WsIcon, WsInlineLoading } from '@worldsea/ui-kit'
import { useResizable } from '@worldsea/ui-kit/composables/useResizable'
import { useFocusTrap } from '@/composables/useFocusTrap'
import { activePick, settlePick } from '@/composables/filePickerApi'
import { useFilePickerBrowse, ROW_HEIGHT } from '@/composables/useFilePickerBrowse'
import { canThumbnail, formatModified, normalizePath, typeLabelOf } from './filePickerModel'

const req = activePick

/** 面板宽度（可拖拽，跨次记忆：与其它模态共用 useResizable 的持久化口径） */
const { width } = useResizable({ panelId: 'modal-file-picker', defaultWidth: 880, minWidth: 640, maxWidth: 1400 })

const panelRef = ref<HTMLElement | null>(null)
const listRef = ref<HTMLElement | null>(null)

const browse = useFilePickerBrowse({
  request: () => req.value?.req ?? null,
  settle: settlePick,
})

const {
  drives, quickLocations, recentDirs, currentPath, pathDraft, query, entries, loadingList, listError,
  selected, focusIndex, history, historyIndex, isDirMode, multiple, canGoUp,
  visibleEntries, rows, crumbs, summary, overLimitCount, canConfirm,
  navigate, goBack, goForward, goUp, reload, commitPathDraft, resetPathDraft,
  onScroll, onRowClick, onRowDblClick, confirm, reset, useNativeDialog,
  samePath, driveRootOf, driveTitle, formatBytes,
  moveFocus, focusSelect, focusEnter, selectAll, clearSelection,
} = browse

/** 左轨标签：末两级路径，够区分又不会撑爆 168px 栏宽 */
function railLabel(path: string): string {
  const segs = normalizePath(path).split('/').filter(Boolean)
  return segs.slice(-2).join('/') || path
}

/**
 * 缩略图 URL（asset 协议）。只在渲染可见行时调用，虚拟滚动已把范围收窄到可视区；
 * 浏览器侧再叠加 loading="lazy" 与 decoding="async" 兜住快速滚动。
 */
function thumbUrl(path: string): string {
  return convertFileSrc(normalizePath(path))
}

useFocusTrap(panelRef, {
  active: computed(() => !!req.value),
  // 有选择时第一次 Esc 只清空选择，再按一次才关闭（与文件管理器习惯一致）
  onEscape: () => (selected.value.size > 0 ? clearSelection() : cancel()),
})

function cancel(): void {
  settlePick(null)
}

/** 滚动事件委托（浏览器状态机只管数值，DOM 引用留在视图层） */
function onListScroll(e: Event): void {
  onScroll(e.target as HTMLElement)
}

/** 焦点行滚入视口（键盘移动后调用；虚拟窗口下只保证目标行可见） */
function revealFocus(): void {
  const el = listRef.value
  if (!el) return
  const top = focusIndex.value * ROW_HEIGHT
  const bottom = top + ROW_HEIGHT
  if (top < el.scrollTop) el.scrollTop = top
  else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight
}

/**
 * 列表键盘导航。
 * 只接管方向键/Enter/Space/Backspace/Ctrl+A，其余键（含文字输入）放行给搜索框与路径框。
 */
function onListKeydown(e: KeyboardEvent): void {
  const before = focusIndex.value
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault()
      moveFocus(1)
      if (e.shiftKey) focusSelect({ shift: true })
      break
    case 'ArrowUp':
      e.preventDefault()
      moveFocus(-1)
      if (e.shiftKey) focusSelect({ shift: true })
      break
    case 'Home':
      e.preventDefault()
      moveFocus(-visibleEntries.value.length)
      break
    case 'End':
      e.preventDefault()
      moveFocus(visibleEntries.value.length)
      break
    case ' ':
      // Space 只用于切换选中，不触发页面滚动
      e.preventDefault()
      focusSelect({ shift: e.shiftKey })
      break
    case 'Enter':
      e.preventDefault()
      focusEnter()
      break
    case 'Backspace':
      e.preventDefault()
      goUp()
      break
    case 'a':
    case 'A':
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      selectAll()
      break
    default:
      return
  }
  if (focusIndex.value !== before) void nextTick().then(revealFocus)
}

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
  // 组件被卸载时释放未兑现请求，避免调用方 Promise 悬挂
  if (req.value) settlePick(null)
})
</script>

<style scoped src="./file-picker-host.css"></style>
