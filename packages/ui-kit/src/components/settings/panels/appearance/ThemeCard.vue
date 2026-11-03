<template>
  <!-- 主题（卡 0）：主题 = 底色 × 强调色 两轴，不再陈列六个预设主题卡 -->
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

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useSettingsStore, useTheme, ACCENT_PRESETS, CUSTOM_ACCENT_ID, quantizeAnchor } from '@worldsea/entity-core'
import WsIcon from '../../../WsIcon.vue'
import ColorPickerDialog from '../../../editor/ColorPickerDialog.vue'
import { toastSuccess, toastWarn } from '@worldsea/ui-kit'
import { useStyle, STYLE_LIST, type StyleId, type GlassVariant } from '@worldsea/style-kit'

const emit = defineEmits<{ dirty: [] }>()

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

// ── 主题两轴 ──
// 轴 1 底色：light/dark/system 三态。持久化与 data-theme 由 App 壳唯一控制
// （apps/tauri/components/ui/useTheme.ts，键 'worldsea:theme'）；本面板只读初值 +
// 监听 ws-theme-mode-changed 同步高亮，切换经 ws-set-theme 交 App 壳落地。
type ModePreference = 'light' | 'dark' | 'system'
const MODE_STORAGE_KEY = 'worldsea:theme'
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
// currentThemeId 收束后即当前强调色 id（'custom' = 自定义轴），驱动色板高亮。
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

// 眼睛虹膜色：缺省跟随强调色，可固定任意色。
// 直改 localStorage + 派发 'ws-set-eye-iris'（App 壳统一落根变量 --ws-eye-iris）——不经强调色管线。
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

function openThemeEditor() {
  window.dispatchEvent(new CustomEvent('ws-open-theme-editor'))
}
</script>
