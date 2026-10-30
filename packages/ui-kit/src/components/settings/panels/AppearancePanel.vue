<template>
  <CardDeck :count="5" :flat="!!searchQuery" @change="(i) => emit('card-change', i)" ref="deckRef">
    <template #card="{ idx, cls }">
      <div class="set-card deck-card" :class="cls" :data-index="idx"
        v-show="idx === 0 ? match('主题 theme 外观 底色 深色 浅色 跟随系统 强调色 颜色 编辑器 图谱 星图 眼睛 虹膜 iris 风格 材质 实体 形变 触感 拟态 玻璃 glass neu mist') : idx === 1 ? match('高亮 highlight 脉冲 动画 淡化 扩散 透明度') : true">
        <!-- 主题（2026-09-13 收束：主题 = 底色 × 强调色 两轴，不再陈列六个预设主题卡） -->
        <template v-if="idx === 0">
          <div class="sc-head">主题</div>
          <div class="set-theme-sub">底色</div>
          <div class="set-theme-row" role="group" aria-label="底色">
            <button v-for="m in modeOptions" :key="m.id" class="set-theme-btn" :class="{ on: modePreference === m.id }" @click="onModeChange(m.id)"><WsIcon :name="m.icon" size="md" class="st-icon" /><span class="st-label">{{ m.label }}</span></button>
          </div>
          <div class="set-theme-sub">强调色</div>
          <div class="set-accent-row" role="group" aria-label="强调色">
            <button v-for="a in ACCENT_PRESETS" :key="a.id" class="set-accent-dot" :class="{ on: currentThemeId === a.id }" :title="a.label" :aria-label="`强调色：${a.label}`" @click="onAccentChange(a.id)">
              <span class="set-accent-core" :style="{ background: a.light }"></span>
            </button>
            <button class="set-accent-dot set-accent-dot--custom" :class="{ on: isCustomAccent }" title="自定义强调色" aria-label="自定义强调色" @click="customPickerOpen = true">
              <span class="set-accent-core" :style="isCustomAccent && customAccentColor ? { background: customAccentColor } : undefined"></span>
            </button>
          </div>
          <div class="set-accent-hint">
            当前强调色：{{ currentAccentLabel }}（深色下自动提亮）
            <button v-if="isCustomAccent && customAccentColor" class="set-accent-save" :title="isAlreadySaved ? '已在收藏中' : '保存到我的强调色'" @click="onSaveCurrent">{{ isAlreadySaved ? '已保存' : '保存此色' }}</button>
          </div>
          <div v-if="savedAccents.length" class="set-accent-row set-accent-row--saved" role="group" aria-label="我的强调色">
            <div v-for="hex in savedAccents" :key="hex" class="set-saved-wrap">
              <button class="set-accent-dot" :class="{ on: isCustomAccent && customAccentColor === hex }" :title="`我的强调色 ${hex}`" :aria-label="`应用我的强调色 ${hex}`" @click="onSavedApply(hex)">
                <span class="set-accent-core" :style="{ background: hex }"></span>
              </button>
              <button class="set-saved-del" :aria-label="`删除我的强调色 ${hex}`" title="删除" @click.stop="onSavedRemove(hex)">✕</button>
            </div>
          </div>
          <ColorPickerDialog :show="customPickerOpen" :initial-color="customAccentColor ?? '#4f46e5'" :transform="quantizeAnchor" @confirm="onCustomAccentConfirm" @close="customPickerOpen = false" />
          <div class="set-theme-sub">风格</div>
          <div class="set-style-row" role="group" aria-label="界面风格">
            <button
              v-for="pack in stylePacks"
              :key="pack.id"
              class="set-style-card"
              :class="{ on: styleId === pack.id, 'is-planned': pack.status === 'planned' }"
              :disabled="pack.status === 'planned'"
              :title="pack.description"
              :aria-label="`界面风格：${pack.label}${pack.status === 'planned' ? '（研究中）' : ''}`"
              @click="onStyleChange(pack.id)"
            >
              <span class="set-style-preview" :data-style-preview="pack.id"></span>
              <span class="set-style-name">{{ pack.label }}</span>
              <span v-if="pack.status === 'planned'" class="set-style-badge">研究中</span>
            </button>
          </div>
          <div v-if="styleId === 'soft-glass'" class="set-style-variant" role="group" aria-label="玻璃变体">
            <span class="set-style-variant-label">玻璃变体</span>
            <button class="set-style-variant-btn" :class="{ on: glassVariant === 'regular' }" @click="onGlassVariant('regular')">常规</button>
            <button class="set-style-variant-btn" :class="{ on: glassVariant === 'clear' }" @click="onGlassVariant('clear')">清透</button>
          </div>
          <div class="set-accent-hint">当前风格：{{ currentStyleLabel }}</div>
          <button class="set-theme-editor-btn" @click="openThemeEditor">
            <WsIcon name="theme-editor" size="xs" /> 微调材质 / 实体 / 形变 / 触感
          </button>
          <div class="set-row" style="margin-top:8px">
            <span>性能模式（关闭背景模糊）</span>
            <label class="set-toggle">
              <input type="checkbox" :checked="perfMode" @change="onPerfModeChange(($event.target as HTMLInputElement).checked)" />
              <span class="set-toggle-slider"></span>
            </label>
          </div>
          <div class="set-theme-sub">眼睛虹膜色</div>
          <div class="set-accent-row" role="group" aria-label="眼睛虹膜色">
            <button class="set-accent-dot" :class="{ on: !eyeIrisColor }" title="跟随强调色" aria-label="眼睛虹膜色：跟随强调色" @click="onEyeIrisFollow">
              <span class="set-accent-core" :style="{ background: currentAccentSwatch }"></span>
            </button>
            <button class="set-accent-dot set-accent-dot--custom" :class="{ on: !!eyeIrisColor }" title="自定义眼睛虹膜色" aria-label="自定义眼睛虹膜色" @click="eyePickerOpen = true">
              <span class="set-accent-core" :style="eyeIrisColor ? { background: eyeIrisColor } : undefined"></span>
            </button>
          </div>
          <div class="set-accent-hint">{{ eyeIrisColor ? `固定虹膜色：${eyeIrisColor}（启动页与切换遮罩同步）` : '跟随强调色（随上方色板联动，深色下自动提亮）' }}</div>
          <ColorPickerDialog :show="eyePickerOpen" :initial-color="eyeIrisColor ?? '#8b87f8'" @confirm="onEyeIrisConfirm" @close="eyePickerOpen = false" />
          <div class="set-theme-sub">图谱底色</div>
          <div class="set-row"><span>全局图谱</span><select v-model="store.graphBackgroundMode" class="set-select" aria-label="图谱底色"><option value="dark">深色星图</option><option value="theme">跟随主题</option></select></div>
          <button class="set-theme-editor-btn" @click="openThemeEditor">
            <WsIcon name="theme-editor" size="xs" /> 主题编辑器
          </button>
        </template>
        <!-- 高亮 -->
        <template v-else-if="idx === 1">
          <div class="sc-head">高亮</div>
          <div class="set-row"><span>脉冲动画</span><label class="set-toggle"><input type="checkbox" v-model="store.highlight_pulseEnabled" /><span class="set-toggle-slider"></span></label></div>
          <div class="set-row"><span>启用淡化</span><label class="set-toggle"><input type="checkbox" v-model="store.highlight_dimmingEnabled" /><span class="set-toggle-slider"></span></label></div>
          <template v-if="store.highlight_dimmingEnabled">
            <div class="set-row"><span>淡化模式</span><select v-model="store.highlight_dimmingMode" class="set-select"><option value="simple">简单淡化</option><option value="spread">关系扩散</option></select></div>
            <div class="set-row"><span>淡化透明度</span><div class="set-range-wrap"><input type="range" min="0.1" max="0.5" step="0.05" v-model.number="store.highlight_dimOpacity" class="set-range" /><span class="set-range-val">{{ store.highlight_dimOpacity }}</span></div></div>
            <div v-if="store.highlight_dimmingMode === 'spread'" class="set-row"><span>扩散跳数</span><select v-model.number="store.highlight_spreadHops" class="set-select"><option :value="1">1 跳</option><option :value="2">2 跳</option><option :value="3">3 跳</option></select></div>
          </template>
        </template>
        <!-- 字体库 -->
        <template v-else-if="idx === 2">
          <div class="sc-head">字体库</div>
          <div class="sf-library-header">
            <label class="sf-import-btn" :class="{ 'is-busy': importingFont }">
              <WsInlineLoading v-if="importingFont" size="sm" label="正在安装字体" />
              <span>{{ importingFont ? '安装中' : '导入字体' }}</span>
              <input type="file" accept=".wsfont,.ttf,.otf,.woff,.woff2,.zip" :disabled="importingFont" @change="onFontImport" style="display:none" />
            </label>
            <span class="sf-storage-hint">{{ fontStorageHint }}</span>
          </div>
          <div v-if="fontLibraryEntries.length === 0" class="set-hint" style="padding:12px 0">尚未安装字体，点击"导入字体"添加</div>
          <div v-else class="sf-library-list">
            <!-- 无分组的独立字体 -->
            <div v-for="entry in standaloneEntries" :key="entry.id" class="sf-lib-card">
              <div class="sf-lib-info">
                <span class="sf-lib-name">{{ entry.displayName }}</span>
                <span class="sf-lib-source" :data-source="entry.source">{{ sourceLabel(entry.source) }}</span>
              </div>
              <div class="sf-lib-preview" :style="{ fontFamily: `'${entry.family}', sans-serif` }">预览文本 Preview</div>
              <div class="sf-lib-meta">{{ entry.variants.length }} 变体 · {{ formatSize(entry.totalSize) }}</div>
              <button class="sf-lib-delete" @click="onFontDelete(entry.id)" title="删除字体">✕</button>
            </div>
            <!-- 按 ZIP 分组 -->
            <div v-for="group in fontGroups" :key="group.groupId" class="sf-lib-group">
              <div class="sf-lib-group-header">
                <WsIcon name="package" size="xs" />
                <span class="sf-lib-group-name">{{ group.groupName }}</span>
                <span class="sf-lib-group-count">{{ group.entries.length }} 字体</span>
                <button class="sf-lib-group-delete" @click="onFontGroupDelete(group.groupId)" title="删除整组">✕</button>
              </div>
              <div v-for="entry in group.entries" :key="entry.id" class="sf-lib-card sf-lib-card--grouped">
                <div class="sf-lib-info">
                  <span class="sf-lib-name">{{ entry.displayName }}</span>
                  <span class="sf-lib-source" :data-source="entry.source">{{ sourceLabel(entry.source) }}</span>
                </div>
                <div class="sf-lib-preview" :style="{ fontFamily: `'${entry.family}', sans-serif` }">预览文本 Preview</div>
                <div class="sf-lib-meta">{{ entry.variants.length }} 变体 · {{ formatSize(entry.totalSize) }}</div>
              </div>
            </div>
          </div>
        </template>
        <!-- 字体分层 -->
        <template v-else-if="idx === 3">
          <div class="sc-head">字体分层</div>
          <div class="set-hint" style="margin-bottom:8px">每层字体可独立设置，未设置则跟随上层默认值</div>
          <div v-for="fl in FONT_LAYERS" :key="fl.key" class="sf-layer-row">
            <div class="sf-layer-main">
              <span class="sf-layer-label">{{ fl.label }}<span class="set-hint-inline">{{ fl.hint }}</span></span>
              <div class="sf-layer-controls">
                <select class="set-select" :value="fontStore.prefs[fl.key].family" @change="onFontLayerChange(fl.key, ($event.target as HTMLSelectElement).value)">
                  <option value="">默认</option>
                  <option v-for="e in fontLibraryEntries" :key="e.id" :value="e.family">{{ e.displayName }}</option>
                </select>
                <button class="sf-reset-btn" v-if="fontStore.prefs[fl.key].family" @click="fontStore.resetLayer(fl.key)" title="重置为默认">↺</button>
              </div>
            </div>
            <div v-if="fontStore.prefs[fl.key].family && getVariantsForFamily(fontStore.prefs[fl.key].family).length > 1" class="sf-layer-variants">
              <select class="set-select set-select--sm" :value="variantKey(fontStore.prefs[fl.key])" @change="onVariantChange(fl.key, ($event.target as HTMLSelectElement).value)">
                <option v-for="v in getVariantsForFamily(fontStore.prefs[fl.key].family)" :key="`${v.weight}-${v.style}`" :value="`${v.weight}-${v.style}`">{{ weightLabel(v.weight) }} {{ v.style === 'italic' ? '斜体' : '' }}</option>
              </select>
            </div>
          </div>
        </template>
        <!-- 卡片与预览（2026-10-25 形象图批 B/C）：悬停形象预览 + 视频封面播放策略。
             注意：本卡只允许一个 sc-head（设置外壳左列目录按 sc-head 抓标题，多条会越位错卡）——
             视频封面/形象图追踪用 set-theme-sub 组内小标题 -->
        <template v-else>
          <div class="sc-head">卡片与预览</div>
          <div class="set-row"><span>悬停卡片显示形象图</span><label class="set-toggle"><input type="checkbox" v-model="store.entityCardHoverPreview" /><span class="set-toggle-slider"></span></label></div>
          <div class="set-row" v-if="store.entityCardHoverPreview"><span>预览框无框模式</span><label class="set-toggle"><input type="checkbox" v-model="store.hoverPreviewFrameless" /><span class="set-toggle-slider"></span></label></div>
          <div class="set-theme-sub" style="margin-top:10px">视频封面</div>
          <div class="set-row"><span>卡片内自动播放</span><select v-model="store.videoCoverAutoplay" class="set-select"><option value="off">不自动播放（默认）</option><option value="all">全部实体</option><option value="selected">仅指定实体</option></select></div>
          <div class="set-row" v-if="store.videoCoverAutoplay === 'selected'" style="flex-direction:column;align-items:stretch"><span style="margin-bottom:4px">自动播放的实体（{{ store.videoCoverAutoplayEntities.length }}）</span><EntityMultiSelect v-model="store.videoCoverAutoplayEntities" /></div>
          <div class="set-row"><span>悬停卡片时播放</span><label class="set-toggle"><input type="checkbox" v-model="store.videoCoverHoverPlay" /><span class="set-toggle-slider"></span></label></div>
          <div class="set-row"><span>滚动时暂停播放</span><label class="set-toggle"><input type="checkbox" v-model="store.videoCoverPauseOnScroll" /><span class="set-toggle-slider"></span></label></div>
          <div class="set-theme-sub" style="margin-top:10px">形象图追踪</div>
          <div class="set-row"><span>点击实体后浮层跟随鼠标</span><label class="set-toggle"><input type="checkbox" v-model="store.portraitFollowMouse" /><span class="set-toggle-slider"></span></label></div>
        </template>
      </div>
    </template>
  </CardDeck>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useSettingsStore, useTheme, useFontStore, ACCENT_PRESETS, CUSTOM_ACCENT_ID, quantizeAnchor, type FontLayer } from '@worldsea/entity-core'
import { useFontPresets, useFontLibraryStore, type FontLibraryEntry, type FontVariantEntry } from '@worldsea/font-kit'
import { installFromWsfont, installFromRawFont, installFromZip } from '@worldsea/font-kit'
import WsIcon from '../../WsIcon.vue'
import WsInlineLoading from '../../feedback/loading/WsInlineLoading.vue'
import ColorPickerDialog from '../../editor/ColorPickerDialog.vue'
import EntityMultiSelect from './EntityMultiSelect.vue'
import { toastSuccess, toastWarn, CardDeck } from '@worldsea/ui-kit'
import { useStyle, STYLE_LIST, type StyleId, type GlassVariant } from '@worldsea/style-kit'
import { matchKeywords, FONT_LAYERS, weightLabel, sourceLabel, formatSize } from '../utils'

const props = defineProps<{ searchQuery?: string }>()
const emit = defineEmits<{ dirty: []; 'card-change': [index: number] }>()

const importingFont = ref(false)

// ── 叠放翻卡：复用通用 CardDeck（翻卡逻辑/样式已下沉 ui-kit useCardDeck + CardDeck.vue） ──
const deckRef = ref<InstanceType<typeof CardDeck> | null>(null)
defineExpose({ goToCard: (i: number) => deckRef.value?.goToCard(i) })

const store = useSettingsStore()
const stylePacks = STYLE_LIST
const { styleId, setStyle, perfMode, setPerfMode, glassVariant, setGlassVariant } = useStyle()
const currentStyleLabel = computed(() => stylePacks.find(p => p.id === styleId.value)?.label ?? '雾面')

function onStyleChange(id: StyleId) {
  if (stylePacks.find(p => p.id === id)?.status !== 'ready') return
  setStyle(id)
  emit('dirty')
}

function onGlassVariant(variant: GlassVariant) {
  setGlassVariant(variant)
  emit('dirty')
}

function onPerfModeChange(on: boolean) {
  setPerfMode(on)
  emit('dirty')
}
const fontStore = useFontStore()
const { getPresetByFamily, markInstalled } = useFontPresets()
const libraryStore = useFontLibraryStore()
const fontLibraryEntries = computed(() => libraryStore.getAllEntries())

const standaloneEntries = computed(() =>
  fontLibraryEntries.value.filter(e => !e.groupId),
)

interface FontGroup {
  groupId: string
  groupName: string
  entries: FontLibraryEntry[]
}

const fontGroups = computed<FontGroup[]>(() => {
  const map = new Map<string, FontGroup>()
  for (const e of fontLibraryEntries.value) {
    if (!e.groupId || !e.groupName) continue
    let group = map.get(e.groupId)
    if (!group) {
      group = { groupId: e.groupId, groupName: e.groupName, entries: [] }
      map.set(e.groupId, group)
    }
    group.entries.push(e)
  }
  return Array.from(map.values())
})

const fontStorageHint = computed(() => {
  const used = libraryStore.totalSize
  return `${(used / 1024 / 1024).toFixed(1)} MB / 400 MB`
})

// ── 主题两轴（2026-09-13 收束）──
// 轴 1 底色：light/dark/system 三态。持久化与 data-theme 由 App 壳唯一控制
// （apps/tauri/components/ui/useTheme.ts，键 'worldsea:theme'）；本面板只读初值 +
// 监听 ws-theme-mode-changed 同步高亮，切换经 ws-set-theme 交 App 壳落地。
type ModePreference = 'light' | 'dark' | 'system'
const MODE_STORAGE_KEY = 'worldsea:theme' // App 壳三态持久化键
function readModePreference(): ModePreference {
  try {
    const v = localStorage.getItem(MODE_STORAGE_KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}
const modePreference = ref<ModePreference>(readModePreference())
const modeOptions: { id: ModePreference; icon: string; label: string }[] = [
  { id: 'light', icon: 'sun', label: '浅色' },
  { id: 'dark', icon: 'moon', label: '深色' },
  { id: 'system', icon: 'monitor', label: '跟随系统' },
]
function onModeChanged(e: Event) {
  const p = (e as CustomEvent).detail?.preference
  if (p === 'light' || p === 'dark' || p === 'system') modePreference.value = p
}
onMounted(() => window.addEventListener('ws-theme-mode-changed', onModeChanged))
onUnmounted(() => window.removeEventListener('ws-theme-mode-changed', onModeChanged))

function onModeChange(m: ModePreference) {
  window.dispatchEvent(new CustomEvent('ws-set-theme', { detail: { mode: m } }))
  emit('dirty')
}

// 轴 2 强调色：六色预设 + 自定义（entity-core ACCENT_PRESETS / setCustomAccent，深浅双段规则注入）。
// currentThemeId（entity-core）收束后即当前强调色 id（'custom' = 自定义轴），驱动色板高亮。
const { currentThemeId, customAccentColor, savedAccents, saveCurrentAccent, removeSavedAccent } = useTheme()
const currentAccentLabel = computed(() => {
  if (currentThemeId.value === CUSTOM_ACCENT_ID) {
    return customAccentColor.value ? `自定义 · ${customAccentColor.value}` : '自定义'
  }
  return ACCENT_PRESETS.find(a => a.id === currentThemeId.value)?.label ?? '靛蓝'
})

function onAccentChange(id: string) {
  window.dispatchEvent(new CustomEvent('ws-set-theme', { detail: { accent: id } }))
  emit('dirty')
}

// 自定义强调色：取色器任意色 → ws-set-theme { accentHex } → App 壳 setCustomAccent（锚点合规化 + OKLCH 派生）
const customPickerOpen = ref(false)
const isCustomAccent = computed(() => currentThemeId.value === CUSTOM_ACCENT_ID)
function onCustomAccentConfirm(color: string) {
  customPickerOpen.value = false
  window.dispatchEvent(new CustomEvent('ws-set-theme', { detail: { accent: CUSTOM_ACCENT_ID, accentHex: color } }))
  emit('dirty')
}

// 我的强调色：收藏当前自定义色 / 应用 / 删除（存取在 entity-core useTheme，localStorage 持久化）
const isAlreadySaved = computed(() => !!customAccentColor.value && savedAccents.value.includes(customAccentColor.value))
function onSaveCurrent() {
  const hex = customAccentColor.value
  const added = saveCurrentAccent()
  if (added) toastSuccess(`已保存自定义强调色 ${hex}`)
  else toastWarn('该颜色已在收藏中')
}
function onSavedApply(hex: string) {
  window.dispatchEvent(new CustomEvent('ws-set-theme', { detail: { accent: CUSTOM_ACCENT_ID, accentHex: hex } }))
  emit('dirty')
}
function onSavedRemove(hex: string) {
  removeSavedAccent(hex)
}

// 眼睛虹膜色（世界之眼品牌件独立配色，2026-10-26 走查反馈）：缺省跟随强调色，可固定任意色。
// 直改 localStorage + 派发 'ws-set-eye-iris'（App 壳统一落根变量 --ws-eye-iris）——不经强调色管线（独立于色板轴）。
// 键 worldsea-eye-iris 与 splash 独立入口 / dsh_space_veil.js 同源（启动页与切换遮罩同步生效）。
const EYE_IRIS_STORAGE_KEY = 'worldsea-eye-iris'
const eyeIrisColor = ref<string | null>(readEyeIris())
const eyePickerOpen = ref(false)
const currentAccentSwatch = computed(() => customAccentColor.value ?? ACCENT_PRESETS.find(a => a.id === currentThemeId.value)?.light ?? '#4f46e5')

function readEyeIris(): string | null {
  try {
    return localStorage.getItem(EYE_IRIS_STORAGE_KEY)
  } catch {
    return null
  }
}

function onEyeIrisFollow() {
  eyeIrisColor.value = null
  try {
    localStorage.removeItem(EYE_IRIS_STORAGE_KEY)
  } catch { /* 忽略 */ }
  window.dispatchEvent(new CustomEvent('ws-set-eye-iris', { detail: { color: null } }))
  emit('dirty')
}

function onEyeIrisConfirm(color: string) {
  eyePickerOpen.value = false
  eyeIrisColor.value = color
  try {
    localStorage.setItem(EYE_IRIS_STORAGE_KEY, color)
  } catch { /* 忽略 */ }
  window.dispatchEvent(new CustomEvent('ws-set-eye-iris', { detail: { color } }))
  emit('dirty')
}

function match(keywords: string): boolean {
  return matchKeywords(props.searchQuery ?? '', keywords)
}

function openThemeEditor() {
  window.dispatchEvent(new CustomEvent('ws-open-theme-editor'))
}

async function onFontDelete(id: string) {
  const result = await libraryStore.removeEntry(id)
  if (result.ok && result.affectedLayers.length > 0) {
    toastSuccess(`已删除字体，${result.affectedLayers.join('、')}层已重置为默认`)
  } else if (result.ok) {
    toastSuccess('已删除字体')
  }
}

async function onFontGroupDelete(groupId: string) {
  const groupEntries = fontLibraryEntries.value.filter(e => e.groupId === groupId)
  if (groupEntries.length === 0) return
  const allAffectedLayers: string[] = []
  for (const entry of groupEntries) {
    const result = await libraryStore.removeEntry(entry.id)
    if (result.ok && result.affectedLayers.length > 0) {
      allAffectedLayers.push(...result.affectedLayers)
    }
  }
  const layerInfo = allAffectedLayers.length > 0 ? `，${[...new Set(allAffectedLayers)].join('、')}层已重置` : ''
  toastSuccess(`已删除整组字体（${groupEntries.length} 个）${layerInfo}`)
}

function onFontLayerChange(layer: FontLayer, family: string) {
  fontStore.setLayerFont(layer, family)
  if (family) {
    const preset = getPresetByFamily(family)
    if (preset) markInstalled(preset.id)
  }
}

function getVariantsForFamily(family: string): FontVariantEntry[] {
  const entry = fontLibraryEntries.value.find(e => e.family === family)
  return entry?.variants ?? []
}

function variantKey(pref: { weight: number; style: string }): string {
  return `${pref.weight}-${pref.style}`
}

function onVariantChange(layer: FontLayer, key: string) {
  const [w, s] = key.split('-')
  fontStore.setLayerVariant(layer, Number(w), s)
}

function onFontImport(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (importingFont.value) {
    input.value = ''
    return
  }
  if (file.size > 200 * 1024 * 1024) {
    toastWarn(`文件过大 (${(file.size / 1024 / 1024).toFixed(1)} MB)，上限 200 MB`)
    input.value = ''
    return
  }
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  importingFont.value = true

  ;(async () => {
    try {
      const buffer = await file.arrayBuffer()

      if (ext === 'zip') {
        const { entries } = await installFromZip(buffer, file.name)
        let installed = 0
        for (const entry of entries) {
          const result = libraryStore.addEntry(entry)
          if (result.ok) installed++
        }
        toastSuccess(`已从 ZIP 安装 ${installed} 个字体`)
      } else {
        let entry: FontLibraryEntry | undefined

        if (ext === 'wsfont') {
          const result = await installFromWsfont(buffer)
          entry = result.entry
        } else if (['ttf', 'otf', 'woff', 'woff2'].includes(ext)) {
          const result = await installFromRawFont(buffer, file.name)
          entry = result.entry
        }

        if (entry) {
          const result = libraryStore.addEntry(entry)
          if (result.ok) {
            toastSuccess(`已安装字体: ${entry.displayName}`)
          } else {
            toastWarn(result.reason || '安装失败')
          }
        } else {
          toastWarn('不支持的字体格式')
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '字体安装失败，请确认文件格式正确'
      toastWarn(msg)
    } finally {
      importingFont.value = false
    }
  })()
  input.value = ''
}
</script>

<style scoped>
/* 基座样式（.set-card/.sc-head/.set-row/.set-toggle/.set-hint）已收敛至 ui-kit settings-panels.css，此处仅保留面板私有样式 */
.set-hint-inline { font-size: var(--font-size-xs); color: var(--text-tertiary); font-weight: normal; }

.set-theme-row { display: flex; gap: 6px; }
.set-theme-sub { margin: 2px 0 6px; font-size: var(--font-size-xs); color: var(--text-tertiary, var(--color-text-tertiary)); }
/* 强调色色板：圆形色点，选中态用当前强调色勾边 */
.set-accent-row { display: flex; gap: 10px; flex-wrap: wrap; }
.set-accent-dot {
  width: 30px; height: 30px; border-radius: 50%; padding: 3px;
  border: 2px solid var(--border, var(--color-border)); background: transparent; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  transition: background 0.12s, border-color 0.12s, color 0.12s, box-shadow 0.12s, transform 0.12s, opacity 0.12s, filter 0.12s;
}
.set-accent-dot:hover { border-color: var(--primary, var(--color-primary)); }
.set-accent-dot.on {
  border-color: var(--primary, var(--color-primary));
  box-shadow: 0 0 0 2px var(--primary-light, color-mix(in srgb, var(--color-primary) 25%, transparent));
}
.set-accent-core { display: block; width: 100%; height: 100%; border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.08); }
/* 自定义色点：未激活时彩虹轮盘示意「任选」，激活后由内联样式显示量化后的实际色 */
.set-accent-dot--custom .set-accent-core { background: conic-gradient(#ef4444, #f59e0b, #22c55e, #06b6d4, #6366f1, #d946ef, #ef4444); }
/* 我的强调色（收藏行）：悬停显示删除角标 */
.set-accent-row--saved { margin-top: 8px; }
.set-saved-wrap { position: relative; display: inline-flex; }
.set-saved-del { position: absolute; top: -5px; right: -5px; width: 15px; height: 15px; border-radius: 50%; border: none; background: var(--bg-active, var(--color-bg-active)); color: var(--text-secondary, var(--color-text-secondary)); font-size: 9px; line-height: 1; cursor: pointer; opacity: 0; transition: opacity 0.12s; display: flex; align-items: center; justify-content: center; }
.set-saved-wrap:hover .set-saved-del, .set-saved-del:focus-visible { opacity: 1; }
.set-accent-save { margin-left: 8px; padding: 2px 10px; font-size: var(--font-size-xs); border: 1px solid var(--border, var(--color-border)); border-radius: var(--radius-sm, 6px); background: var(--bg, var(--color-bg-surface)); color: var(--text-secondary, var(--color-text-secondary)); cursor: pointer; transition: border-color 0.12s, color 0.12s; }
.set-accent-save:hover { border-color: var(--primary, var(--color-primary)); color: var(--primary, var(--color-primary)); }
.set-accent-save:disabled { opacity: 0.6; cursor: default; }
.set-accent-hint { margin-top: 8px; font-size: var(--font-size-xs); color: var(--text-tertiary, var(--color-text-tertiary)); }
.set-theme-btn { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 8px 4px; border: 1px solid var(--border, var(--color-border)); border-radius: 8px; background: var(--bg, var(--color-bg-surface)); cursor: pointer; transition: background 0.12s, border-color 0.12s, color 0.12s, box-shadow 0.12s, transform 0.12s, opacity 0.12s, filter 0.12s; }
.set-theme-btn:hover { border-color: var(--primary, var(--color-primary)); }
.set-theme-btn.on { border-color: var(--primary, var(--color-primary)); background: var(--primary-light, color-mix(in srgb, var(--color-primary) 10%, transparent)); }
.st-icon { font-size: var(--font-size-xl); }
.st-label { font-size: var(--font-size-xs); color: var(--text-secondary); }
.set-theme-editor-btn {
  margin-top: 8px; width: 100%; padding: 8px 12px; border: 1px dashed var(--border, var(--color-border));
  border-radius: 8px; background: transparent; cursor: pointer; font-size: var(--font-size-sm);
  color: var(--text-secondary); transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s; text-align: center;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
}
.set-theme-editor-btn:hover { border-color: var(--primary, var(--color-primary)); color: var(--primary, var(--color-primary)); background: var(--primary-light, color-mix(in srgb, var(--color-primary) 10%, transparent)); }

.set-select { padding: 4px 8px; font-size: var(--font-size-sm); border: 1px solid var(--border, var(--color-border)); border-radius: var(--radius-sm); background: var(--bg, var(--color-bg-surface)); color: var(--text-color); cursor: pointer; }
.set-select:focus { outline: none; border-color: var(--primary, var(--color-primary)); }
.set-range-wrap { display: flex; align-items: center; gap: 8px; }
.set-range { width: 100px; accent-color: var(--primary, var(--color-primary)); }
.set-range-val { font-size: var(--font-size-sm); color: var(--text-secondary); min-width: 28px; text-align: right; font-family: monospace; }
.set-select--sm { max-width: 160px; font-size: var(--fs-sm); padding: 3px 6px; }

/* ── 字体设置面板 ── */
.sf-layer-label { display: flex; flex-direction: column; gap: 2px; }
.sf-layer-controls { display: flex; align-items: center; gap: 6px; }
.sf-reset-btn {
  width: 24px; height: 24px; border: none; background: transparent;
  cursor: pointer; border-radius: 4px; font-size: var(--font-size-sm);
  color: var(--text-secondary); display: flex; align-items: center; justify-content: center;
}
.sf-reset-btn:hover { background: var(--hover-bg); color: var(--primary); }
.sf-layer-row { display: flex; flex-direction: column; gap: 4px; padding: 6px 0; }
.sf-layer-main { display: flex; align-items: center; justify-content: space-between; }
.sf-layer-variants { padding-left: 120px; }

.sf-import-btn {
  display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border: 1px dashed var(--border-color);
  border-radius: var(--radius-sm); cursor: pointer; font-size: var(--font-size-sm); color: var(--text-secondary);
  transition: border-color 0.15s, color 0.15s;
}
.sf-import-btn:hover { border-color: var(--primary); color: var(--primary); }
.sf-import-btn.is-busy { cursor: progress; color: var(--text-tertiary); }

.sf-library-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.sf-storage-hint { font-size: var(--fs-sm); color: var(--color-text-muted); }
.sf-library-list { display: flex; flex-direction: column; gap: 8px; }
.sf-lib-card {
  position: relative; padding: 10px 12px; border: 1px solid var(--color-border);
  border-radius: var(--radius-sm); background: var(--color-surface);
}
.sf-lib-info { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.sf-lib-name { font-weight: 500; }
.sf-lib-source { font-size: var(--fs-xs); padding: 1px 6px; border-radius: 3px; background: var(--color-surface-hover); }
.sf-lib-source[data-source="wsfont"] { color: #5b8def; }
.sf-lib-source[data-source="raw"] { color: #8a8a8a; }
.sf-lib-source[data-source="windfonts"] { color: #4caf50; }
.sf-lib-source[data-source="preset"] { color: #9c6ade; }
.sf-lib-source[data-source="zip"] { color: #e8a838; }
.sf-lib-preview { font-size: var(--fs-base); margin: 4px 0; color: var(--color-text-secondary); }
.sf-lib-meta { font-size: var(--fs-xs); color: var(--color-text-muted); }
.sf-lib-delete {
  position: absolute; top: 8px; right: 8px; background: none; border: none;
  cursor: pointer; color: var(--color-text-muted); font-size: var(--fs-base); padding: 2px 4px; border-radius: 3px;
}
.sf-lib-delete:hover { color: var(--color-danger); background: var(--color-surface-hover); }
.sf-lib-group { margin-top: 8px; border: 1px solid var(--color-border); border-radius: 8px; overflow: hidden; }
.sf-lib-group-header {
  display: flex; align-items: center; gap: 6px; padding: 8px 12px;
  background: var(--color-surface-hover); border-bottom: 1px solid var(--color-border);
  font-size: var(--fs-md); font-weight: 500;
}
.sf-lib-group-name { flex: 1; }
.sf-lib-group-count { font-size: var(--fs-xs); color: var(--color-text-muted); font-weight: 400; }
.sf-lib-group-delete {
  background: none; border: none; cursor: pointer; color: var(--color-text-muted);
  font-size: var(--fs-base); padding: 2px 4px; border-radius: 3px;
}
.sf-lib-group-delete:hover { color: var(--color-danger); background: var(--color-surface); }
.sf-lib-card--grouped { border: none; border-radius: 0; border-bottom: 1px solid var(--color-border-subtle); }
.sf-lib-card--grouped:last-child { border-bottom: none; }
.set-style-row { display: flex; gap: 8px; }
.set-style-card {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  flex: 1; padding: 8px; cursor: pointer;
  background: var(--sf-control-bg); border: 1px solid var(--sf-control-edge);
  border-radius: calc(var(--radius-md) * var(--sf-radius-scale));
  box-shadow: var(--sf-control-shadow);
  transition: border-color var(--dur-fast) var(--ease), transform var(--dur-fast) var(--ease-spring);
}
.set-style-card:hover { border-color: var(--accent); box-shadow: var(--sf-control-shadow), var(--sf-ambient); }
.set-style-card.on { border-color: var(--accent); }
.set-style-preview {
  width: 100%; height: 34px; border-radius: calc(var(--radius-sm) * var(--sf-radius-scale));
  border: 1px solid var(--sf-panel-edge);
}
.set-style-preview[data-style-preview='mist'] { background: linear-gradient(180deg, #ffffff, #f4f4f5); }
.set-style-preview[data-style-preview='soft-glass'] {
  background: linear-gradient(135deg, rgba(255,255,255,.85), rgba(200,220,255,.55));
  border-color: rgba(255,255,255,.8);
}
.set-style-preview[data-style-preview='neu'] {
  background: #e8eaef;
  box-shadow: 3px 3px 8px rgba(163,177,198,.55), -3px -3px 8px rgba(255,255,255,.85);
  border-color: transparent;
}
.set-style-name { font-size: var(--fs-sm); color: var(--text-secondary); }
.set-style-card.is-planned { opacity: 0.55; cursor: not-allowed; }
.set-style-badge {
  position: absolute; top: 4px; right: 4px;
  padding: 1px 5px; border-radius: var(--radius-pill);
  font-size: var(--fs-3xs); color: var(--text-muted);
  background: var(--bg-muted); border: 1px solid var(--border);
}
.set-style-card { position: relative; }
.set-style-preview[data-style-preview='liquid-glass'] { background: linear-gradient(120deg, rgba(255,255,255,.9), rgba(180,210,255,.6), rgba(255,255,255,.9)); border-color: rgba(255,255,255,.9); } /* style-conformance: ignore */
.set-style-variant { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
.set-style-variant-label { font-size: var(--fs-xs); color: var(--text-muted); margin-right: 2px; }
.set-style-variant-btn {
  padding: 3px 10px; font-size: var(--fs-xs); cursor: pointer;
  border: 1px solid var(--sf-control-edge); border-radius: var(--radius-pill);
  background: var(--sf-control-bg); color: var(--text-secondary);
}
.set-style-variant-btn.on { border-color: var(--accent); color: var(--accent); }
</style>
