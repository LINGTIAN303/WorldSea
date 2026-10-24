<template>
  <div class="theme-quick">
    <!-- 底色 × 强调色统一在外观面板（预设/自定义/我的收藏），此处跳转不重复编辑 -->
    <button class="theme-quick__jump" @click="jumpToAppearance">
      <span class="theme-quick__jump-title">底色 × 强调色</span>
      <span class="theme-quick__jump-desc">浅色/深色 · 预设/自定义/我的收藏 —— 前往「外观」分区调整</span>
    </button>

    <div class="theme-quick__section">
      <h4 class="theme-quick__heading">圆角风格</h4>
      <div class="theme-quick__options">
        <button
          v-for="opt in radiusOptions"
          :key="opt.id"
          :class="['theme-quick__option', { 'theme-quick__option--active': radiusStyle === opt.id }]"
          @click="setRadiusStyle(opt.id)"
        >{{ opt.label }}</button>
      </div>
    </div>

    <div class="theme-quick__section">
      <h4 class="theme-quick__heading">密度</h4>
      <div class="theme-quick__options">
        <button
          v-for="opt in densityOptions"
          :key="opt.id"
          :class="['theme-quick__option', { 'theme-quick__option--active': density === opt.id }]"
          @click="setDensity(opt.id)"
        >{{ opt.label }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useUIStore } from '@worldsea/entity-core'
// entity-core 主题引擎：setUserOverrides 仅写令牌覆盖（圆角/密度），不碰 data-theme 与强调色。
import { useTheme } from '@/composables/useTheme'

const props = defineProps<{ activeTab?: string }>()
const emit = defineEmits<{ 'jump-to-appearance': [] }>()

const { userOverrides, setUserOverrides } = useTheme()
const ui = useUIStore()

/** 切入本 Tab 时重读覆盖状态（其他 Tab/面板可能已改动） */
watch(() => props.activeTab, (v) => {
  if (v === 'quick') {
    radiusStyle.value = detectRadiusStyle()
    density.value = detectDensity()
  }
})

/** 前往外观面板：带 section 目标打开设置（先例 HomeSurface），并关本编辑器避免双模态 */
function jumpToAppearance() {
  ui.settingsTarget = { section: 'appearance' }
  window.dispatchEvent(new CustomEvent('ws-open-settings'))
  emit('jump-to-appearance')
}

// 圆角/密度覆盖键全集：选「标准/舒适」（= 回归主题基准）时据此清除，避免旧覆盖残留。
// 2026-10-25 归一：圆角唯一入口 = 本 Tab 三态（专业 Tab 滑杆已退役），键集扩全 7 键杜绝交叉残留
const RADIUS_KEYS = ['--radius-btn', '--radius-card', '--radius-input', '--radius-modal', '--radius-sm', '--radius-md', '--radius-lg']
const DENSITY_KEYS = ['--spacing-card', '--spacing-btn', '--spacing-gap', '--spacing-btn-x', '--spacing-btn-sm-x', '--spacing-modal-x']

// 回显：从 userOverrides 反推当前风格（未覆盖 = standard/comfortable），
// 修复此前「打开编辑器永远显示默认态」的状态丢失
function detectRadiusStyle(): 'sharp' | 'standard' | 'round' {
  const v = userOverrides.value['--radius-btn']
  if (v === '2px') return 'sharp'
  if (v === '12px') return 'round'
  return 'standard'
}
function detectDensity(): 'compact' | 'comfortable' | 'spacious' {
  const v = userOverrides.value['--spacing-card']
  if (v === 'var(--space-3)') return 'compact'
  if (v === 'var(--space-6)') return 'spacious'
  return 'comfortable'
}

const radiusStyle = ref<'sharp' | 'standard' | 'round'>(detectRadiusStyle())
const density = ref<'compact' | 'comfortable' | 'spacious'>(detectDensity())

const radiusOptions = [
  { id: 'sharp' as const, label: '锐利' },
  { id: 'standard' as const, label: '标准' },
  { id: 'round' as const, label: '圆润' },
]

const densityOptions = [
  { id: 'compact' as const, label: '紧凑' },
  { id: 'comfortable' as const, label: '舒适' },
  { id: 'spacious' as const, label: '宽松' },
]

function setRadiusStyle(style: 'sharp' | 'standard' | 'round') {
  radiusStyle.value = style
  applyQuickSettings()
}

function setDensity(d: 'compact' | 'comfortable' | 'spacious') {
  density.value = d
  applyQuickSettings()
}

function applyQuickSettings() {
  const overrides: Record<string, string> = { ...userOverrides.value }
  // 先清除两维旧键（含强调色预设选择时保留其余覆盖），再按需写入
  for (const k of RADIUS_KEYS) delete overrides[k]
  for (const k of DENSITY_KEYS) delete overrides[k]

  if (radiusStyle.value === 'sharp') {
    overrides['--radius-btn'] = '2px'
    overrides['--radius-card'] = '4px'
    overrides['--radius-input'] = '2px'
    overrides['--radius-modal'] = '8px'
    overrides['--radius-sm'] = '1px'
    overrides['--radius-md'] = '4px'
    overrides['--radius-lg'] = '6px'
  } else if (radiusStyle.value === 'round') {
    overrides['--radius-btn'] = '12px'
    overrides['--radius-card'] = '16px'
    overrides['--radius-input'] = '12px'
    overrides['--radius-modal'] = '20px'
    overrides['--radius-sm'] = '8px'
    overrides['--radius-md'] = '14px'
    overrides['--radius-lg'] = '20px'
  }

  if (density.value === 'compact') {
    overrides['--spacing-card'] = 'var(--space-3)'
    overrides['--spacing-btn'] = 'var(--space-1) var(--space-2)'
    overrides['--spacing-gap'] = 'var(--space-2)'
    // 固定高度按钮仅水平内边距收紧（TuiButton 保留高度）
    overrides['--spacing-btn-x'] = 'var(--space-2)'
    overrides['--spacing-btn-sm-x'] = 'var(--space-2)'
    // 弹窗水平内边距收紧（TuiModal 保留垂直）
    overrides['--spacing-modal-x'] = 'var(--space-4)'
  } else if (density.value === 'spacious') {
    overrides['--spacing-card'] = 'var(--space-6)'
    overrides['--spacing-btn'] = 'var(--space-3) var(--space-5)'
    overrides['--spacing-gap'] = 'var(--space-4)'
    overrides['--spacing-btn-x'] = 'var(--space-5)'
    overrides['--spacing-btn-sm-x'] = 'var(--space-4)'
    // 弹窗水平内边距放宽（TuiModal 保留垂直）
    overrides['--spacing-modal-x'] = 'var(--space-6)'
  }

  setUserOverrides(overrides)
}
</script>

<style scoped>
.theme-quick { display: flex; flex-direction: column; gap: var(--space-5); }
.theme-quick__jump {
  display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-3) var(--space-4);
  border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg-elevated);
  cursor: pointer; text-align: left; transition: border-color var(--duration-fast) var(--ease-default), background var(--duration-fast) var(--ease-default);
}
.theme-quick__jump:hover { border-color: var(--color-primary); background: var(--color-bg-hover); }
.theme-quick__jump-title { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--color-primary); }
.theme-quick__jump-desc { font-size: var(--font-size-xs); color: var(--color-text-tertiary); }
.theme-quick__heading { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--color-text-secondary); margin-bottom: var(--space-2); }
.theme-quick__options { display: flex; gap: var(--space-2); }
.theme-quick__option {
  padding: var(--space-1) var(--space-3); border: 1px solid var(--color-border);
  border-radius: var(--radius-sm); background: transparent; font-size: var(--font-size-sm);
  color: var(--color-text-secondary); cursor: pointer; transition: background var(--duration-fast) var(--ease-default), border-color var(--duration-fast) var(--ease-default), color var(--duration-fast) var(--ease-default), box-shadow var(--duration-fast) var(--ease-default), transform var(--duration-fast) var(--ease-default), opacity var(--duration-fast) var(--ease-default), filter var(--duration-fast) var(--ease-default);
}
.theme-quick__option:hover { border-color: var(--color-primary); color: var(--color-primary); }
.theme-quick__option--active { background: var(--color-primary-subtle); border-color: var(--color-primary); color: var(--color-primary); }
</style>
