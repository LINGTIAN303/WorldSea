<template>
  <div class="bg-card">
    <div class="sc-head">背景</div>

    <!-- 范围 -->
    <div class="bg-scope bg-seg-row" role="group" aria-label="背景范围">
      <button class="bg-seg" :class="{ on: scope === 'global' }" @click="scope = 'global'">全局</button>
      <button
        class="bg-seg"
        :class="{ on: scope === 'project' }"
        :disabled="!hasProject"
        :title="hasProject ? '仅当前项目' : '未打开项目'"
        @click="onScopeProject"
      >本项目</button>
    </div>
    <p v-if="!hasProject" class="set-hint">未打开项目，仅可设置全局背景。</p>

    <!-- 目标 -->
    <div class="bg-targets bg-seg-row" role="group" aria-label="背景目标">
      <button
        v-for="t in BACKGROUND_TARGETS"
        :key="t"
        class="bg-seg"
        :class="{ on: target === t }"
        @click="target = t"
      >{{ TARGET_LABELS[t] }}</button>
    </div>

    <!-- 项目范围：跟随全局 / 本项目自定义 -->
    <template v-if="scope === 'project'">
      <div class="bg-project">
        <span class="bg-project__state">{{ isProjectCustom ? '本项目自定义中' : '当前跟随全局' }}</span>
        <button class="set-btn bg-project__btn" @click="isProjectCustom ? onFollowGlobal() : onMakeCustom()">
          {{ isProjectCustom ? '恢复跟随全局' : '本项目自定义' }}
        </button>
      </div>
      <p v-if="!isProjectCustom" class="set-hint">当前跟随全局；改为本项目自定义后可单独选图。</p>
      <p v-else-if="!hasAnyPath" class="set-hint">本项目自定义已继承全局参数，请为本项目重新选择图片。</p>
    </template>

    <!-- 预览 -->
    <div class="bg-preview" :class="`bg-preview--${target}`">
      <BackgroundLayer :target="target" :scope="previewScope" preview />
      <span v-if="!previewHasSource" class="bg-preview__empty">{{ readOnly ? '跟随全局，暂无图片' : '未选择图片' }}</span>
    </div>

    <!-- 亮/暗图片槽 -->
    <div v-for="theme in BACKGROUND_THEMES" :key="theme" class="bg-slot" :class="`bg-slot--${theme}`">
      <span class="bg-slot__label">{{ theme === 'light' ? '亮色图' : '暗色图' }}</span>
      <div class="bg-slot__thumb" :style="thumbStyle(theme)">
        <span v-if="!thumbSrc(theme)" class="bg-slot__placeholder">无</span>
      </div>
      <div class="bg-slot__actions">
        <button class="set-btn bg-slot__pick" :disabled="readOnly || picking !== null" @click="onPick(theme)">
          {{ picking === theme ? '正在导入…' : selected.paths[theme] ? '替换图片' : '选择图片' }}
        </button>
        <button
          v-if="selected.paths[theme]"
          class="set-btn bg-slot__remove"
          :disabled="readOnly || picking !== null"
          @click="onRemove(theme)"
        >移除</button>
      </div>
      <p v-if="missingFor(theme)" class="set-hint bg-error">背景文件不可用，请重新选择。</p>
    </div>
    <p v-if="error" class="set-hint bg-error">{{ error }}</p>

    <!-- 启用 -->
    <div class="set-row">
      <span>启用背景</span>
      <label class="set-toggle">
        <input
          type="checkbox"
          aria-label="启用背景"
          :checked="selected.enabled"
          :disabled="readOnly || !hasAnyPath"
          @change="onToggle(($event.target as HTMLInputElement).checked)"
        />
        <span class="set-toggle-slider"></span>
      </label>
    </div>

    <!-- 参数：分区目标固定 cover/居中，不展示填充与焦点 -->
    <div v-if="caps.fit" class="set-row">
      <span>填充</span>
      <select class="set-select bg-fit" aria-label="填充方式" :value="selected.fit" :disabled="readOnly || !hasAnyPath" @change="onFit">
        <option value="cover">铺满</option>
        <option value="contain">完整</option>
        <option value="tile">平铺</option>
      </select>
    </div>
    <div v-if="caps.focus" class="set-row">
      <span>焦点</span>
      <div class="bg-focus" role="group" aria-label="背景焦点">
        <button
          v-for="cell in FOCUS_CELLS"
          :key="cell.key"
          class="bg-focus__cell"
          :class="{ on: selected.focusX === cell.x && selected.focusY === cell.y }"
          :disabled="readOnly || !hasAnyPath || selected.fit === 'tile'"
          :aria-label="cell.label"
          @click="onFocus(cell.x, cell.y)"
        ></button>
      </div>
    </div>
    <div class="set-row">
      <span>暗化</span>
      <div class="set-range-wrap">
        <input type="range" aria-label="暗化" min="0" max="80" step="1" class="set-range bg-dim" :value="selected.dim" :disabled="readOnly || !hasAnyPath" @input="onDim" @change="persistNow" />
        <span class="set-range-val">{{ selected.dim }}%</span>
      </div>
    </div>
    <div class="set-row">
      <span>模糊</span>
      <div class="set-range-wrap">
        <input type="range" aria-label="模糊" min="0" max="30" step="1" class="set-range bg-blur" :value="selected.blur" :disabled="readOnly || !hasAnyPath" @input="onBlur" @change="persistNow" />
        <span class="set-range-val">{{ selected.blur }}px</span>
      </div>
    </div>

    <p class="set-hint">
      画布背景在所有区域之下；分区背景只作用于对应区域。首页底图与项目封面相互独立。暗化过低会降低文字可读性。五个目标按需启用，避免同时解码过多图片。
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  BACKGROUND_TARGETS, BACKGROUND_THEMES, BACKGROUND_TARGET_CAPS, normalizeProjectConfig, useBackground,
  type BackgroundFit, type BackgroundTarget, type BackgroundTheme, type FocusStep,
} from '@worldsea/style-kit'
import {
  deleteProjectBackground, getFileStorageBackend, pickAndSaveBackground, readProjectBackground,
  removeBackgroundFile, removeProjectBackgroundFile, resolveProjectBackgroundAssets, writeProjectBackground,
} from '@worldsea/entity-core/core'
import { useFileSystemProject } from '@worldsea/entity-core/composables'
import BackgroundLayer from '../../layout/BackgroundLayer.vue'

const TARGET_LABELS: Record<BackgroundTarget, string> = {
  canvas: '画布',
  home: '首页',
  titlebar: '窗口栏',
  sidebar: '侧栏',
  content: '内容区',
}
const FOCUS_CELLS: Array<{ key: string; x: FocusStep; y: FocusStep; label: string }> = [
  { key: 'tl', x: 0, y: 0, label: '左上' },
  { key: 'tc', x: 50, y: 0, label: '上中' },
  { key: 'tr', x: 100, y: 0, label: '右上' },
  { key: 'ml', x: 0, y: 50, label: '左中' },
  { key: 'mc', x: 50, y: 50, label: '居中' },
  { key: 'mr', x: 100, y: 50, label: '右中' },
  { key: 'bl', x: 0, y: 100, label: '左下' },
  { key: 'bc', x: 50, y: 100, label: '下中' },
  { key: 'br', x: 100, y: 100, label: '右下' },
]

const {
  globalConfig, projectConfig, globalSrcs, projectSrcs, globalMissing, projectMissing,
  setProjectConfig, setTargetSrcs, setTargetImage, clearTargetImage, updateTarget,
  setTargetCustom, markMissing, flushGlobal,
} = useBackground()

const scope = ref<'global' | 'project'>('global')
const target = ref<BackgroundTarget>('canvas')
const picking = ref<BackgroundTheme | null>(null)
const error = ref('')

const { boundDir } = useFileSystemProject()
// 读写基准是实体存储根 <workspace>/worlddata；boundDir 只是项目切换触发器
const projectDir = computed(() => {
  void boundDir.value
  return getFileStorageBackend()?.projectDir ?? ''
})
const hasProject = computed(() => !!projectDir.value)
const isProjectCustom = computed(() => !!projectConfig.value?.targets[target.value])
const readOnly = computed(() => scope.value === 'project' && !isProjectCustom.value)
const selected = computed(() => scope.value === 'project' && isProjectCustom.value
  ? projectConfig.value!.targets[target.value]!
  : globalConfig.value.targets[target.value])
const caps = computed(() => BACKGROUND_TARGET_CAPS[target.value])
const hasAnyPath = computed(() => !!(selected.value.paths.light || selected.value.paths.dark))
const previewScope = computed<'global' | 'project'>(() =>
  scope.value === 'project' && isProjectCustom.value ? 'project' : 'global')
const previewHasSource = computed(() => {
  const src = previewScope.value === 'project' ? projectSrcs.value[target.value] : globalSrcs.value[target.value]
  const miss = previewScope.value === 'project' ? projectMissing.value[target.value] : globalMissing.value[target.value]
  return !!(src.light || src.dark) && !(miss.light && miss.dark)
})

function thumbSrc(theme: BackgroundTheme): string {
  const srcs = previewScope.value === 'project' ? projectSrcs.value : globalSrcs.value
  return srcs[target.value][theme]
}
function thumbStyle(theme: BackgroundTheme) {
  const src = thumbSrc(theme)
  return src ? { backgroundImage: `url("${src}")` } : undefined
}
function missingFor(theme: BackgroundTheme): boolean {
  const miss = previewScope.value === 'project' ? projectMissing.value : globalMissing.value
  return miss[target.value][theme]
}

// ── 项目配置读写（本地 token 防项目切换竞态） ──
let loadToken = 0
async function reloadProject() {
  const token = ++loadToken
  const dir = projectDir.value
  if (!dir) {
    setProjectConfig(null)
    if (scope.value === 'project') scope.value = 'global'
    return
  }
  try {
    const raw = await readProjectBackground(dir)
    if (token !== loadToken) return
    const config = normalizeProjectConfig(raw)
    if (!config) { setProjectConfig(null); return }
    const refs: Array<{ target: BackgroundTarget; theme: BackgroundTheme; path: string }> = []
    for (const t of BACKGROUND_TARGETS) {
      const cfg = config.targets[t]
      if (!cfg) continue
      for (const theme of BACKGROUND_THEMES) {
        if (cfg.paths[theme]) refs.push({ target: t, theme, path: cfg.paths[theme] })
      }
    }
    const { srcs, missing: miss } = await resolveProjectBackgroundAssets(dir, refs)
    if (token !== loadToken) return
    setProjectConfig(config)
    for (const t of BACKGROUND_TARGETS) {
      if (!config.targets[t]) continue
      setTargetSrcs(t, { light: srcs[t]?.light ?? '', dark: srcs[t]?.dark ?? '' }, 'project')
      for (const theme of BACKGROUND_THEMES) if (miss[t]?.[theme]) markMissing(t, theme, 'project')
    }
  } catch (err) {
    console.warn('[background] 设置卡加载项目背景失败:', err)
    if (token === loadToken) setProjectConfig(null)
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
/** 写入项目配置；无自定义目标时删除配置文件（项目回到跟随全局） */
function persistProjectNow() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  const dir = projectDir.value
  if (!dir) return
  const config = projectConfig.value
  if (config && Object.keys(config.targets).length) {
    void writeProjectBackground(dir, config).catch((err) => {
      console.warn('[background] 保存项目背景失败:', err)
    })
  } else {
    void deleteProjectBackground(dir)
  }
}
function scheduleProjectSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(persistProjectNow, 150)
}
function persistNow() {
  if (scope.value === 'project') persistProjectNow()
  else flushGlobal()
}
function schedulePersist() {
  if (scope.value === 'project') scheduleProjectSave()
}

function onScopeProject() {
  if (!hasProject.value) return
  scope.value = 'project'
}

/** 项目自定义：继承全局参数，图片留空（复制完整目标配置再清图） */
function onMakeCustom() {
  if (!hasProject.value) return
  setTargetCustom(target.value, true)
  persistProjectNow()
}

/** 恢复跟随全局：先删除项目目标引用的图片，再删目标本身并落盘 */
function onFollowGlobal() {
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

async function onPick(theme: BackgroundTheme) {
  if (readOnly.value || picking.value) return
  picking.value = theme
  error.value = ''
  try {
    const oldPath = selected.value.paths[theme]
    const result = await pickAndSaveBackground({
      scope: scope.value,
      projectDir: projectDir.value,
      target: target.value,
      theme,
    })
    if (result === null) return
    if (!result.ok || !result.src) {
      error.value = result.reason ?? '背景导入失败'
      return
    }
    if (scope.value === 'project') {
      if (!result.relativePath) { error.value = '背景导入失败'; return }
      setTargetImage(target.value, theme, { path: result.relativePath, src: result.src }, 'project')
      persistProjectNow()
      if (oldPath && oldPath !== result.relativePath) void removeProjectBackgroundFile(projectDir.value, oldPath)
    } else {
      if (!result.path) { error.value = '背景导入失败'; return }
      setTargetImage(target.value, theme, { path: result.path, src: result.src }, 'global')
      if (oldPath && oldPath !== result.path) void removeBackgroundFile(oldPath)
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    picking.value = null
  }
}

function onRemove(theme: BackgroundTheme) {
  if (readOnly.value) return
  const oldPath = selected.value.paths[theme]
  clearTargetImage(target.value, theme, scope.value)
  if (scope.value === 'project') {
    if (oldPath) void removeProjectBackgroundFile(projectDir.value, oldPath)
    persistProjectNow()
  } else {
    if (oldPath) void removeBackgroundFile(oldPath)
    flushGlobal()
  }
}

function onToggle(on: boolean) {
  updateTarget(target.value, { enabled: on }, scope.value)
  persistNow()
}
function onFit(event: Event) {
  updateTarget(target.value, { fit: (event.target as HTMLSelectElement).value as BackgroundFit }, scope.value)
  persistNow()
}
function onFocus(x: FocusStep, y: FocusStep) {
  updateTarget(target.value, { focusX: x, focusY: y }, scope.value)
  persistNow()
}
function onDim(event: Event) {
  updateTarget(target.value, { dim: Number((event.target as HTMLInputElement).value) }, scope.value)
  schedulePersist()
}
function onBlur(event: Event) {
  updateTarget(target.value, { blur: Number((event.target as HTMLInputElement).value) }, scope.value)
  schedulePersist()
}

watch(boundDir, () => {
  if (!hasProject.value && scope.value === 'project') scope.value = 'global'
  void reloadProject()
})
onMounted(() => { void reloadProject() })
onBeforeUnmount(() => {
  if (saveTimer) persistProjectNow()
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
.bg-targets { margin-bottom: 8px; }

.bg-project {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
}
.bg-project__state { font-size: var(--fs-sm); color: var(--text-secondary); }

/* 预览按目标形状：画布/首页 16:9，窗口栏横条，侧栏竖条，内容区矩形 */
.bg-preview {
  position: relative;
  overflow: hidden;
  margin-top: 8px;
  border-radius: calc(var(--radius-md) * var(--sf-radius-scale));
  border: 1px solid var(--sf-panel-edge);
  background: var(--bg-app);
}
.bg-preview--canvas,
.bg-preview--home,
.bg-preview--content { aspect-ratio: 16 / 9; }
.bg-preview--titlebar { height: 44px; }
.bg-preview--sidebar { width: 110px; height: 150px; }
.bg-preview__empty {
  position: absolute; inset: 0; z-index: 1;
  display: flex; align-items: center; justify-content: center;
  font-size: var(--fs-xs); color: var(--text-muted);
}
/* 层默认负 z-index 会落到卡片底色之下：预览容器内抬到 0 层 */
.bg-preview :deep(.ws-bg-layer) { z-index: 0; }

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
