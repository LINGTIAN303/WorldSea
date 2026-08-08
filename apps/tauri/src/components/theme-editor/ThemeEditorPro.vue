<template>
  <div class="theme-pro">
    <div class="theme-pro__toolbar">
      <span class="theme-pro__hint">编辑语义令牌，实时预览效果</span>
      <button class="theme-pro__reset" @click="resetOverrides">重置</button>
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
import { reactive, computed, onMounted } from 'vue'
import { useTheme } from '@/composables/useTheme'

const { userOverrides, setUserOverrides } = useTheme()

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

const expandedGroups = reactive<Record<string, boolean>>({})

function toggleGroup(id: string) {
  expandedGroups[id] = !expandedGroups[id]
}

const tokenGroups: TokenGroup[] = [
  {
    id: 'colors-brand',
    label: '品牌色',
    tokens: [
      { key: '--color-primary', label: '主色', type: 'color' },
      { key: '--color-primary-hover', label: '主色悬停', type: 'color' },
      { key: '--color-primary-active', label: '主色激活', type: 'color' },
      { key: '--color-primary-subtle', label: '主色淡', type: 'color' },
    ],
  },
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
    id: 'radius',
    label: '圆角',
    tokens: [
      { key: '--radius-sm', label: '小圆角', type: 'range', min: 0, max: 12, step: 1, unit: 'px', fallback: '4' },
      { key: '--radius-md', label: '中圆角', type: 'range', min: 0, max: 16, step: 1, unit: 'px', fallback: '8' },
      { key: '--radius-lg', label: '大圆角', type: 'range', min: 0, max: 24, step: 1, unit: 'px', fallback: '12' },
      { key: '--radius-btn', label: '按钮圆角', type: 'range', min: 0, max: 16, step: 1, unit: 'px', fallback: '6' },
      { key: '--radius-card', label: '卡片圆角', type: 'range', min: 0, max: 24, step: 1, unit: 'px', fallback: '12' },
      { key: '--radius-modal', label: '弹窗圆角', type: 'range', min: 0, max: 32, step: 1, unit: 'px', fallback: '16' },
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
.theme-pro__hint { font-size: var(--font-size-xs); color: var(--color-text-tertiary); }
.theme-pro__reset {
  padding: var(--space-1) var(--space-2); border: 1px solid var(--color-border); border-radius: var(--radius-sm);
  background: transparent; color: var(--color-text-secondary); font-size: var(--font-size-xs); cursor: pointer;
  transition: background var(--duration-fast) var(--ease-default), border-color var(--duration-fast) var(--ease-default), color var(--duration-fast) var(--ease-default), box-shadow var(--duration-fast) var(--ease-default), transform var(--duration-fast) var(--ease-default), opacity var(--duration-fast) var(--ease-default), filter var(--duration-fast) var(--ease-default);
}
.theme-pro__reset:hover { border-color: var(--color-danger); color: var(--color-danger); }

.theme-pro__groups { display: flex; flex-direction: column; gap: var(--space-1); max-height: 420px; overflow-y: auto; }
.theme-pro__group { border: 1px solid var(--color-border-subtle); border-radius: var(--radius-md); overflow: hidden; }
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

.theme-pro__token { display: flex; align-items: center; gap: var(--space-3); }
.theme-pro__token-label { font-size: var(--font-size-xs); color: var(--color-text-secondary); min-width: 80px; flex-shrink: 0; }
.theme-pro__token-control { display: flex; align-items: center; gap: var(--space-2); flex: 1; }
.theme-pro__color-input { width: 32px; height: 24px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); cursor: pointer; padding: 0; background: none; }
.theme-pro__color-input::-webkit-color-swatch-wrapper { padding: 2px; }
.theme-pro__color-input::-webkit-color-swatch { border: none; border-radius: 2px; }
.theme-pro__range-input { flex: 1; accent-color: var(--color-primary); }
.theme-pro__text-input {
  flex: 1; padding: var(--space-1) var(--space-2); border: 1px solid var(--color-border); border-radius: var(--radius-sm);
  font-size: var(--font-size-xs); background: var(--color-bg-elevated); color: var(--color-text-primary); font-family: monospace;
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
