<template>
  <div class="theme-pro">
    <div class="theme-pro__toolbar">
      <span class="theme-pro__hint">编辑设计令牌覆盖（实时生效）；强调色在「外观」、圆角在「快速」Tab 管理</span>
      <button class="theme-pro__reset" @click="resetOverrides">重置</button>
    </div>

    <button class="theme-pro__jump" @click="jumpToAppearance">
      <span class="theme-pro__jump-title">强调色 → 外观面板</span>
      <span class="theme-pro__jump-desc">预设 / 自定义 / 我的收藏已统一管理（手动覆盖强调色四键已退役，避免与强调色轴互相清除）</span>
    </button>

    <div class="theme-pro__named">
      <div class="theme-pro__named-head">
        <span class="theme-pro__named-title">我的主题</span>
        <span class="theme-pro__named-hint">整组保存当前令牌覆盖（强调色由外观面板管理，不随主题保存）；应用 = 整组替换</span>
      </div>
      <div class="theme-pro__named-save">
        <input v-model="namedDraft" class="theme-pro__named-input" placeholder="主题名…" @keydown.enter="onSaveNamed" />
        <button class="theme-pro__named-save-btn" @click="onSaveNamed">保存当前为主题</button>
      </div>
      <div v-if="namedThemes.length" class="theme-pro__named-list">
        <div v-for="t in namedThemes" :key="t.id" class="theme-pro__named-item">
          <span class="theme-pro__named-name">{{ t.name }}</span>
          <span class="theme-pro__named-count">{{ Object.keys(t.tokens).length }} 项</span>
          <button class="theme-pro__named-btn" @click="onApplyNamed(t.id)">应用</button>
          <button class="theme-pro__named-btn theme-pro__named-btn--del" @click="onDeleteNamed(t.id)">删除</button>
        </div>
      </div>
      <div v-else class="theme-pro__named-empty">暂无保存的主题——在专业/快速 Tab 调好令牌后，命名保存即可随时应用</div>
    </div>

    <div class="theme-pro__groups">
      <div v-for="group in tokenGroups" :key="group.id" class="theme-pro__group">
        <button class="theme-pro__group-header" @click="toggleGroup(group.id)">
          <span class="theme-pro__group-arrow" :class="{ open: expandedGroups[group.id] }">▸</span>
          <span class="theme-pro__group-name">{{ group.label }}</span>
          <span class="theme-pro__group-count">{{ group.tokens.length }}</span>
        </button>
        <div v-if="expandedGroups[group.id]" class="theme-pro__group-body">
          <div v-for="token in group.tokens" :key="token.key" class="theme-pro__token">
            <label class="theme-pro__token-label">{{ token.label }}</label>
            <div class="theme-pro__token-control">
              <input
                v-if="token.type === 'color'"
                type="color"
                :value="getTokenValue(token.key)"
                @input="onTokenChange(token.key, ($event.target as HTMLInputElement).value)"
                class="theme-pro__color-input"
              />
              <input
                v-else-if="token.type === 'range'"
                type="range"
                :min="token.min ?? 0"
                :max="token.max ?? 100"
                :step="token.step ?? 1"
                :value="getTokenNumericValue(token.key, token.fallback)"
                @input="onTokenChange(token.key, `${($event.target as HTMLInputElement).value}${token.unit ?? 'px'}`)"
                class="theme-pro__range-input"
              />
              <input
                v-else
                type="text"
                :value="getTokenValue(token.key)"
                @input="onTokenChange(token.key, ($event.target as HTMLInputElement).value)"
                class="theme-pro__text-input"
              />
              <span class="theme-pro__token-value">{{ getTokenValue(token.key) }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="contrastInfo" class="theme-pro__contrast">
      <div class="theme-pro__contrast-title">WCAG 对比度</div>
      <div class="theme-pro__contrast-row">
        <span>主文字 / 背景</span>
        <span :class="['theme-pro__contrast-ratio', { pass: contrastInfo.ratio >= 4.5 }]">{{ contrastInfo.ratio.toFixed(1) }}:1</span>
        <span :class="['theme-pro__contrast-badge', contrastInfo.level]">{{ contrastInfo.level }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useUIStore } from '@worldsea/entity-core'
import { toastSuccess, toastWarn } from '@worldsea/ui-kit'
import { useTheme } from '@/composables/useTheme'

interface TokenDef {
  key: string
  label: string
  type: 'color' | 'range' | 'text'
  min?: number
  max?: number
  step?: number
  unit?: string
  fallback?: string
}

interface TokenGroup {
  id: string
  label: string
  tokens: TokenDef[]
}

const emit = defineEmits<{ 'jump-to-appearance': [] }>()
const props = defineProps<{ activeTab?: string; previewNonce?: number }>()

/** 前往外观面板（强调色唯一入口）：带 section 目标打开设置并关本编辑器 */
function jumpToAppearance() {
  const ui = useUIStore()
  ui.settingsTarget = { section: 'appearance' }
  window.dispatchEvent(new CustomEvent('ws-open-settings'))
  emit('jump-to-appearance')
}

// 我的主题：把当前令牌覆盖整组存为命名主题，随时应用/删除（引擎 customThemes，强调色键剔除在 useTheme 内完成）
const { userOverrides, setUserOverrides, customThemes, saveCurrentOverridesAsTheme, applyNamedTheme, removeCustomTheme } = useTheme()
const namedThemes = computed(() => customThemes.value)
const namedDraft = ref('')

function onSaveNamed() {
  const saved = saveCurrentOverridesAsTheme(namedDraft.value)
  if (!saved) {
    toastWarn('当前没有可保存的令牌覆盖（或主题名为空）')
    return
  }
  toastSuccess(`已保存主题「${saved.name}」`)
  namedDraft.value = ''
}

function onApplyNamed(id: string) {
  if (applyNamedTheme(id)) toastSuccess('主题已应用')
}

function onDeleteNamed(id: string) {
  removeCustomTheme(id)
}

const expandedGroups = reactive<Record<string, boolean>>({})

function toggleGroup(id: string) {
  expandedGroups[id] = !expandedGroups[id]
}

const tokenGroups: TokenGroup[] = [
  {
    id: 'colors-semantic',
    label: '语义色',
    tokens: [
      { key: '--color-success', label: '成功', type: 'color' },
      { key: '--color-warning', label: '警告', type: 'color' },
      { key: '--color-danger', label: '危险', type: 'color' },
      { key: '--color-info', label: '信息', type: 'color' },
    ],
  },
  {
    id: 'colors-text',
    label: '文字色',
    tokens: [
      { key: '--color-text-primary', label: '主要文字', type: 'color' },
      { key: '--color-text-secondary', label: '次要文字', type: 'color' },
      { key: '--color-text-tertiary', label: '辅助文字', type: 'color' },
      { key: '--color-text-inverse', label: '反色文字', type: 'color' },
    ],
  },
  {
    id: 'colors-bg',
    label: '背景色',
    tokens: [
      { key: '--color-bg-base', label: '基础背景', type: 'color' },
      { key: '--color-bg-surface', label: '表面背景', type: 'color' },
      { key: '--color-bg-elevated', label: '浮起背景', type: 'color' },
      { key: '--color-bg-hover', label: '悬停背景', type: 'color' },
      { key: '--color-bg-active', label: '激活背景', type: 'color' },
    ],
  },
  {
    id: 'colors-border',
    label: '边框色',
    tokens: [
      { key: '--color-border', label: '默认边框', type: 'color' },
      { key: '--color-border-subtle', label: '弱边框', type: 'color' },
    ],
  },
  {
    id: 'font',
    label: '字体',
    tokens: [
      { key: '--font-family-base', label: '基础字体', type: 'text' },
      { key: '--font-size-sm', label: '小字号', type: 'text' },
      { key: '--font-size-md', label: '中字号', type: 'text' },
      { key: '--font-size-lg', label: '大字号', type: 'text' },
    ],
  },
]

onMounted(() => {
  tokenGroups.forEach(g => { expandedGroups[g.id] = g.id === 'colors-brand' })
})

function getTokenValue(key: string): string {
  if (userOverrides.value[key]) return userOverrides.value[key]
  const style = getComputedStyle(document.documentElement)
  return style.getPropertyValue(key).trim()
}

function getTokenNumericValue(key: string, fallback?: string): number {
  const val = getTokenValue(key)
  const num = parseFloat(val)
  return isNaN(num) ? parseFloat(fallback ?? '0') : num
}

function onTokenChange(key: string, value: string) {
  const newOverrides = { ...userOverrides.value, [key]: value }
  setUserOverrides(newOverrides)
}

function resetOverrides() {
  setUserOverrides({})
}

const contrastInfo = computed(() => {
  props.previewNonce // 深浅预览切换后重算（getComputedStyle 非响应式，靠 nonce 触发重渲染）
  const primary = getTokenValue('--color-text-primary')
  const bg = getTokenValue('--color-bg-base')
  if (!primary || !bg) return null
  const l1 = getLuminance(primary)
  const l2 = getLuminance(bg)
  const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
  let level = 'fail'
  if (ratio >= 7) level = 'AAA'
  else if (ratio >= 4.5) level = 'AA'
  else if (ratio >= 3) level = 'AA-lg'
  return { ratio, level }
})

function getLuminance(hex: string): number {
  const cleaned = hex.replace('#', '')
  if (cleaned.length !== 6) return 0.5
  const r = parseInt(cleaned.substring(0, 2), 16) / 255
  const g = parseInt(cleaned.substring(2, 4), 16) / 255
  const b = parseInt(cleaned.substring(4, 6), 16) / 255
  const toLinear = (c: number) => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)
}
</script>

<style scoped>
.theme-pro { display: flex; flex-direction: column; gap: var(--space-3); }
.theme-pro__toolbar { display: flex; justify-content: space-between; align-items: center; }
.theme-pro__jump {
  display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-3) var(--space-4);
  border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg-elevated);
  cursor: pointer; text-align: left; transition: border-color var(--duration-fast) var(--ease-default), background var(--duration-fast) var(--ease-default);
}
.theme-pro__jump:hover { border-color: var(--color-primary); background: var(--color-bg-hover); }
.theme-pro__jump-title { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--color-primary); }
.theme-pro__jump-desc { font-size: var(--font-size-xs); color: var(--color-text-tertiary); }

/* 我的主题（命名主题管理） */
.theme-pro__named { border: 1px solid var(--color-border-subtle); border-radius: var(--radius-md); padding: var(--space-3); display: flex; flex-direction: column; gap: var(--space-2); }
.theme-pro__named-head { display: flex; align-items: baseline; gap: var(--space-2); flex-wrap: wrap; }
.theme-pro__named-title { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--color-text-primary); }
.theme-pro__named-hint { font-size: var(--font-size-xs); color: var(--color-text-tertiary); }
.theme-pro__named-save { display: flex; gap: var(--space-2); }
.theme-pro__named-input { flex: 1; padding: var(--space-1) var(--space-2); border: 1px solid var(--color-border); border-radius: var(--radius-sm); font-size: var(--font-size-xs); background: var(--color-bg-elevated); color: var(--color-text-primary); outline: none; }
.theme-pro__named-input:focus { border-color: var(--color-primary); }
.theme-pro__named-save-btn { padding: var(--space-1) var(--space-2); border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-bg-elevated); color: var(--color-text-secondary); font-size: var(--font-size-xs); cursor: pointer; white-space: nowrap; }
.theme-pro__named-save-btn:hover { border-color: var(--color-primary); color: var(--color-primary); }
.theme-pro__named-list { display: flex; flex-direction: column; gap: var(--space-1); }
.theme-pro__named-item { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-1) var(--space-2); border-radius: var(--radius-sm); background: var(--color-bg-elevated); }
.theme-pro__named-name { font-size: var(--font-size-xs); color: var(--color-text-primary); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.theme-pro__named-count { font-size: var(--font-size-xs); color: var(--color-text-tertiary); }
.theme-pro__named-btn { padding: 2px var(--space-2); border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: transparent; color: var(--color-text-secondary); font-size: var(--font-size-xs); cursor: pointer; }
.theme-pro__named-btn:hover { border-color: var(--color-primary); color: var(--color-primary); }
.theme-pro__named-btn--del:hover { border-color: var(--color-danger); color: var(--color-danger); }
.theme-pro__named-empty { font-size: var(--font-size-xs); color: var(--color-text-tertiary); }
.theme-pro__hint { font-size: var(--font-size-xs); color: var(--color-text-tertiary); }
.theme-pro__reset {
  padding: var(--space-1) var(--space-2); border: 1px solid var(--color-border); border-radius: var(--radius-sm);
  background: transparent; color: var(--color-text-secondary); font-size: var(--font-size-xs); cursor: pointer;
  transition: background var(--duration-fast) var(--ease-default), border-color var(--duration-fast) var(--ease-default), color var(--duration-fast) var(--ease-default), box-shadow var(--duration-fast) var(--ease-default), transform var(--duration-fast) var(--ease-default), opacity var(--duration-fast) var(--ease-default), filter var(--duration-fast) var(--ease-default);
}
.theme-pro__reset:hover { border-color: var(--color-danger); color: var(--color-danger); }

.theme-pro__groups { display: flex; flex-direction: column; gap: var(--space-1); }
/* 免疫压缩：组卡片永不收缩（历史教训——容器高度受限时 flex-shrink 会把展开组均匀压扁并被 overflow:hidden 裁切） */
.theme-pro__group { border: 1px solid var(--color-border-subtle); border-radius: var(--radius-md); overflow: hidden; flex-shrink: 0; }
.theme-pro__group-header {
  display: flex; align-items: center; gap: var(--space-2); width: 100%; padding: var(--space-2) var(--space-3);
  border: none; background: var(--color-bg-elevated); cursor: pointer; font-size: var(--font-size-sm);
  color: var(--color-text-primary); font-weight: var(--font-weight-medium); text-align: left;
}
.theme-pro__group-header:hover { background: var(--color-bg-hover); }
.theme-pro__group-arrow { transition: transform var(--duration-fast) var(--ease-default); font-size: var(--font-size-xs); }
.theme-pro__group-arrow.open { transform: rotate(90deg); }
.theme-pro__group-count { font-size: var(--font-size-xs); color: var(--color-text-tertiary); margin-left: auto; }
.theme-pro__group-body { padding: var(--space-2) var(--space-3); display: flex; flex-direction: column; gap: var(--space-2); }

.theme-pro__token { display: flex; align-items: center; gap: var(--space-3); min-width: 0; }
.theme-pro__token-label { font-size: var(--font-size-xs); color: var(--color-text-secondary); min-width: 80px; flex-shrink: 0; }
.theme-pro__token-control { display: flex; align-items: center; gap: var(--space-2); flex: 1; min-width: 0; }
.theme-pro__color-input { width: 32px; height: 24px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); cursor: pointer; padding: 0; background: none; flex-shrink: 0; }
.theme-pro__color-input::-webkit-color-swatch-wrapper { padding: 2px; }
.theme-pro__color-input::-webkit-color-swatch { border: none; border-radius: 2px; }
.theme-pro__range-input { flex: 1; min-width: 0; accent-color: var(--color-primary); }
.theme-pro__text-input {
  flex: 1; min-width: 0; padding: var(--space-1) var(--space-2); border: 1px solid var(--color-border); border-radius: var(--radius-sm);
  font-size: var(--font-size-xs); background: var(--color-bg-elevated); color: var(--color-text-primary); font-family: monospace; outline: none;
}
.theme-pro__text-input:focus { outline: none; border-color: var(--color-primary); }
.theme-pro__token-value { font-size: var(--font-size-xs); color: var(--color-text-tertiary); font-family: monospace; min-width: 60px; text-align: right; }

.theme-pro__contrast { padding: var(--space-3); border: 1px solid var(--color-border-subtle); border-radius: var(--radius-md); background: var(--color-bg-elevated); }
.theme-pro__contrast-title { font-size: var(--font-size-xs); font-weight: var(--font-weight-semibold); color: var(--color-text-secondary); margin-bottom: var(--space-2); }
.theme-pro__contrast-row { display: flex; align-items: center; gap: var(--space-2); font-size: var(--font-size-xs); }
.theme-pro__contrast-ratio { font-family: monospace; font-weight: var(--font-weight-semibold); }
.theme-pro__contrast-ratio.pass { color: var(--color-success); }
.theme-pro__contrast-badge { padding: 1px 6px; border-radius: var(--radius-sm); font-size: var(--font-size-xs); font-weight: var(--font-weight-semibold); }
.theme-pro__contrast-badge.AAA { background: color-mix(in srgb, var(--color-success) 12%, transparent); color: var(--color-success); }
.theme-pro__contrast-badge.AA { background: color-mix(in srgb, var(--color-info) 12%, transparent); color: var(--color-info); }
.theme-pro__contrast-badge.AA-lg { background: color-mix(in srgb, var(--color-warning) 12%, transparent); color: var(--color-warning); }
.theme-pro__contrast-badge.fail { background: color-mix(in srgb, var(--color-danger) 12%, transparent); color: var(--color-danger); }
</style>
