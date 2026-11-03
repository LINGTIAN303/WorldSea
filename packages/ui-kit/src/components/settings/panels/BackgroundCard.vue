<template>
  <div class="bg-card">
    <div class="sc-head">背景</div>

    <!-- 范围 + 项目范围（渲染在 background/BackgroundScopePicker） -->
    <BackgroundScopePicker
      :scope="scope"
      :has-project="hasProject"
      :is-project-custom="isProjectCustom"
      :has-any-path="hasAnyPath"
      :picking="picking"
      @update:scope="scope = $event"
      @scope-project="onScopeProject"
      @make-custom="onMakeCustom"
      @follow-global="onFollowGlobal"
    />

    <!-- 映射即预览：工作台四区 / 首页整图，下方大背景卡片 -->
    <BackgroundTargetMap
      :scope="scope"
      :map="map"
      :selected="target"
      :disabled="picking !== null"
      :toolbar-mode="currentToolbarMode"
      :preview-theme="previewTheme"
      @select="onSelectTarget"
      @switch-map="onSwitchMap"
      @switch-theme="previewTheme = $event"
    />

    <!-- 上下文编辑区：作用于当前选中目标（渲染在 background/BackgroundEditor） -->
    <div ref="editorRef">
      <BackgroundEditor
        :target="target"
        :selected="selected"
        :caps="caps"
        :read-only="readOnly"
        :has-any-path="hasAnyPath"
        :picking="picking"
        :preview-scope="previewScope"
        :preview-theme="previewTheme"
        :canvas-preview-has-source="canvasPreviewHasSource"
        :current-toolbar-mode="currentToolbarMode"
        :toolbar-mode-text="toolbarModeText"
        :error="error"
        :thumb-src="thumbSrc"
        :thumb-style="thumbStyle"
        :missing-for="missingFor"
        @pick="onPick"
        @remove="onRemove"
        @toggle="onToggle"
        @fit="onFit"
        @focus="onFocus"
        @dim="onDim"
        @blur="onBlur"
        @persist="persistNow"
      />
    </div>

    <p class="set-hint">
      大背景在所有区域之下；分区背景只作用于对应区域。首页底图与项目封面相互独立。暗化过低会降低文字可读性。六个目标按需启用，避免同时解码过多图片。
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  BACKGROUND_THEMES, BACKGROUND_TARGET_CAPS, useBackground,
  type BackgroundFit, type BackgroundTarget, type BackgroundTheme, type FocusStep,
} from '@worldsea/style-kit'
import {
  getFileStorageBackend,
  removeProjectBackgroundFile,
} from '@worldsea/entity-core/core'
import { useFileSystemProject } from '@worldsea/entity-core/composables'
import { usePluginStore, useUIStore } from '@worldsea/entity-core'
import BackgroundTargetMap, { type ToolbarMode } from './BackgroundTargetMap.vue'
import BackgroundEditor from './background/BackgroundEditor.vue'
import BackgroundScopePicker from './background/BackgroundScopePicker.vue'
import { useBackgroundProjectPersist } from './background/useBackgroundProjectPersist'
import { useBackgroundSelection } from './background/useBackgroundSelection'
import { useBackgroundImageOps } from './background/useBackgroundImageOps'

const {
  globalConfig, projectConfig, globalSrcs, projectSrcs, globalMissing, projectMissing,
  setProjectConfig, setTargetSrcs, setTargetImage, clearTargetImage, updateTarget,
  setTargetCustom, markMissing, flushGlobal,
} = useBackground()

const scope = ref<'global' | 'project'>('global')
const picking = ref<BackgroundTheme | null>(null)
const error = ref('')
const editorRef = ref<HTMLElement | null>(null)
const uiStore = useUIStore()
const pluginStore = usePluginStore()
/** 设置卡内的亮/暗预览主题：初值取当前根主题，之后只由卡片内切换改（不写全局主题） */
const previewTheme = ref<BackgroundTheme>(
  document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
)

/** 当前工作台视图的工具条形态；无视图/首页时 unavailable */
const currentToolbarMode = computed<ToolbarMode>(() => {
  if (uiStore.surface !== 'workspace' || !uiStore.currentView) return 'unavailable'
  return pluginStore.getView(uiStore.currentView)?.toolbar ?? 'bar'
})
const toolbarModeText = computed(() => {
  switch (currentToolbarMode.value) {
    case 'bar': return '当前视图：随流工具条，背景生效。'
    case 'overlay': return '当前视图：悬浮工具条，背景不生效。'
    case 'none': return '当前视图：隐藏工具条，背景不生效。'
    default: return '当前无工作台视图，打开视图后按形态生效。'
  }
})

const { boundDir } = useFileSystemProject()
// 读写基准是实体存储根 <workspace>/worlddata；boundDir 只是项目切换触发器
const projectDir = computed(() => {
  void boundDir.value
  return getFileStorageBackend()?.projectDir ?? ''
})
const hasProject = computed(() => !!projectDir.value)
// 先建当前目标（isProjectCustom 与缩略图取值都依赖它），再装配选择层
const target = ref<BackgroundTarget>('titlebar')
const isProjectCustom = computed(() => !!projectConfig.value?.targets[target.value])
// 目标选择 / 地图切换 / 缩略图取值在 background/useBackgroundSelection
const {
  map, previewScope, onSelectTarget, onSwitchMap, thumbSrc, thumbStyle, missingFor,
} = useBackgroundSelection({
  target, picking, error, editorRef, isProjectCustom, projectSrcs, globalSrcs, projectMissing, globalMissing,
})
const readOnly = computed(() => scope.value === 'project' && !isProjectCustom.value)
const selected = computed(() => scope.value === 'project' && isProjectCustom.value
  ? projectConfig.value!.targets[target.value]!
  : globalConfig.value.targets[target.value])
const hasAnyPath = computed(() => !!(selected.value.paths.light || selected.value.paths.dark))
const caps = computed(() => BACKGROUND_TARGET_CAPS[target.value])
const canvasPreviewHasSource = computed(() => {
  const srcs = previewScope.value === 'project' ? projectSrcs.value.canvas : globalSrcs.value.canvas
  const miss = previewScope.value === 'project' ? projectMissing.value.canvas : globalMissing.value.canvas
  return !!(srcs.light || srcs.dark) && !(miss.light && miss.dark)
})

// ── 项目配置读写（加载竞态 / 防抖保存 / 挂起快照 flush）在 background/useBackgroundProjectPersist ──
const {
  invalidateProjectLoad, reloadProject, persistProjectNow,
  flushPendingProjectSave, persistNow, schedulePersist,
} = useBackgroundProjectPersist({
  projectDir, scope, projectConfig, setProjectConfig, setTargetSrcs, markMissing, flushGlobal,
})
function onScopeProject() {
  if (!hasProject.value) return
  scope.value = 'project'
}

/** 项目自定义：继承全局参数，图片留空（复制完整目标配置再清图） */
function onMakeCustom() {
  if (!hasProject.value || picking.value) return
  error.value = ''
  invalidateProjectLoad()
  setTargetCustom(target.value, true)
  persistProjectNow()
}

/** 恢复跟随全局：先删除项目目标引用的图片，再删目标本身并落盘 */
function onFollowGlobal() {
  if (picking.value) return
  error.value = ''
  invalidateProjectLoad()
  const dir = projectDir.value
  const cfg = projectConfig.value?.targets[target.value]
  if (cfg && dir) {
    for (const theme of BACKGROUND_THEMES) {
      const rel = cfg.paths[theme]
      if (rel) void removeProjectBackgroundFile(dir, rel)
    }
  }
  setTargetCustom(target.value, false)
  persistProjectNow()
}

// 取图 / 移除（捕获发起时的范围与目录，防等待期间切换项目写错位置）
const { onPick, onRemove } = useBackgroundImageOps({
  scope, target, projectDir, selected, readOnly, picking, error,
  invalidateProjectLoad, setTargetImage, clearTargetImage, persistProjectNow, flushGlobal,
})

function onToggle(on: boolean) {
  invalidateProjectLoad()
  updateTarget(target.value, { enabled: on }, scope.value)
  persistNow()
}
function onFit(event: Event) {
  invalidateProjectLoad()
  updateTarget(target.value, { fit: (event.target as HTMLSelectElement).value as BackgroundFit }, scope.value)
  persistNow()
}
function onFocus(x: FocusStep, y: FocusStep) {
  invalidateProjectLoad()
  updateTarget(target.value, { focusX: x, focusY: y }, scope.value)
  persistNow()
}
function onDim(event: Event) {
  invalidateProjectLoad()
  updateTarget(target.value, { dim: Number((event.target as HTMLInputElement).value) }, scope.value)
  schedulePersist()
}
function onBlur(event: Event) {
  invalidateProjectLoad()
  updateTarget(target.value, { blur: Number((event.target as HTMLInputElement).value) }, scope.value)
  schedulePersist()
}

watch(boundDir, () => {
  // 切项目：先把旧项目的挂起快照落盘，再重读新项目，定时器不得写进新项目
  flushPendingProjectSave()
  if (!hasProject.value && scope.value === 'project') scope.value = 'global'
  void reloadProject()
})
onMounted(() => { void reloadProject() })
onBeforeUnmount(() => {
  // 卸载时只落盘挂起快照（可能属于旧项目）；当场再读当前配置可能已指向别的项目
  invalidateProjectLoad()
  flushPendingProjectSave()
  flushGlobal()
})
</script>

<style scoped>
/* 范围/目标分段按钮：控件矩阵与项目跟随态由 store 决定，这里只表达选中与禁用 */
.bg-seg-row {
  display: flex;
  border: 1px solid var(--sf-control-edge);
  border-radius: calc(var(--radius-sm) * var(--sf-radius-scale));
  overflow: hidden;
}
.bg-seg {
  flex: 1;
  padding: 5px 8px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--fs-sm);
  cursor: pointer;
}
.bg-seg + .bg-seg { border-left: 1px solid var(--sf-control-edge); }
.bg-seg.on { background: var(--accent-soft); color: var(--accent); }
.bg-seg:disabled { opacity: 0.5; cursor: not-allowed; }
.bg-scope { margin-bottom: 8px; }

.bg-project {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
}
.bg-project__state { font-size: var(--fs-sm); color: var(--text-secondary); }
.bg-project__btn:disabled { opacity: 0.5; cursor: not-allowed; }

/* 上下文编辑区：与映射之间用细分隔线区分「选哪里」与「调什么」 */
.bg-editor {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--sf-panel-edge);
}
.bg-editor__head {
  margin-bottom: 6px;
  font-size: var(--fs-sm);
  font-weight: 500;
  color: var(--text-color);
}
.bg-editor__mode { margin-top: 2px; }
.bg-editor__preview {
  position: relative;
  overflow: hidden;
  z-index: 0;
  aspect-ratio: 16 / 9;
  margin-bottom: 8px;
  border: 1px solid var(--sf-panel-edge);
  border-radius: calc(var(--radius-md) * var(--sf-radius-scale));
  background: var(--bg-app);
}
.bg-editor__preview :deep(.ws-bg-layer) { z-index: 0; }
.bg-editor__preview-empty {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--fs-xs);
  color: var(--text-muted);
}

.bg-slot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}
.bg-slot__label { width: 44px; font-size: var(--fs-sm); color: var(--text-secondary); }
.bg-slot__thumb {
  width: 72px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: calc(var(--radius-sm) * var(--sf-radius-scale));
  border: 1px solid var(--sf-control-edge);
  background-color: var(--bg-muted);
  background-size: cover;
  background-position: center;
}
.bg-slot__placeholder { font-size: var(--fs-xs); color: var(--text-muted); }
.bg-slot__actions { display: flex; gap: 6px; }
.bg-slot .bg-error { flex-basis: 100%; margin: 0; }
.bg-error { color: var(--danger); }
.bg-slot__pick:disabled,
.bg-slot__remove:disabled { opacity: 0.5; cursor: not-allowed; }

.bg-focus {
  display: grid;
  grid-template-columns: repeat(3, 18px);
  grid-template-rows: repeat(3, 18px);
  gap: 3px;
}
.bg-focus__cell {
  padding: 0;
  cursor: pointer;
  border: 1px solid var(--sf-control-edge);
  border-radius: 2px;
  background: var(--sf-control-bg);
}
.bg-focus__cell.on { border-color: var(--accent); background: var(--accent-soft); }
.bg-focus__cell:disabled { opacity: 0.4; cursor: not-allowed; }

/* .set-select / .set-range* 仅在 AppearancePanel scoped 内定义，子组件不继承，故就地补一份 */
.set-select { padding: 4px 8px; font-size: var(--font-size-sm); border: 1px solid var(--border, var(--color-border)); border-radius: var(--radius-sm); background: var(--bg, var(--color-bg-surface)); color: var(--text-color); cursor: pointer; }
.set-select:focus { outline: none; border-color: var(--primary, var(--color-primary)); }
.set-range-wrap { display: flex; align-items: center; gap: 8px; }
.set-range { width: 100px; accent-color: var(--primary, var(--color-primary)); }
.set-range-val { font-size: var(--font-size-sm); color: var(--text-secondary); min-width: 28px; text-align: right; font-family: monospace; }
</style>
