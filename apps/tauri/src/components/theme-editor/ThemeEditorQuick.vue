<template>
  <div class="theme-quick">
    <div class="theme-quick__section">
      <h4 class="theme-quick__heading">选择预设主题</h4>
      <div class="theme-quick__grid">
        <div
          v-for="theme in themes"
          :key="theme.id"
          :class="['theme-quick__card', { 'theme-quick__card--active': currentThemeId === theme.id }]"
          @click="setTheme(theme.id)"
        >
          <div class="theme-quick__preview" :style="theme.previewStyle">
            <div class="theme-quick__preview-dot" :style="{ background: theme.primary }"></div>
          </div>
          <div class="theme-quick__name">{{ theme.name }}</div>
        </div>
      </div>
    </div>

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
import { ref } from 'vue'
import { useTheme } from '@/composables/useTheme'

const { currentThemeId, setTheme, setUserOverrides } = useTheme()

const radiusStyle = ref<'sharp' | 'standard' | 'round'>('standard')
const density = ref<'compact' | 'comfortable' | 'spacious'>('comfortable')

const themes = [
  { id: 'aurora-abyss', name: '极光深渊', primary: '#8b5cf6', previewStyle: { background: 'linear-gradient(135deg, #0f0f23, #1a1a3e)' } },
  { id: 'light', name: '明亮', primary: '#4a6cf7', previewStyle: { background: '#f5f5f5' } },
  { id: 'forge-ember', name: '锻造炉', primary: '#c87830', previewStyle: { background: 'linear-gradient(160deg, #1a1410, #2a1e14)' } },
  { id: 'ink-scroll', name: '水墨卷轴', primary: '#2a2018', previewStyle: { background: 'linear-gradient(180deg, #f8f4ef, #f0ebe2)' } },
  { id: 'crystal-prism', name: '晶体棱镜', primary: '#64b4ff', previewStyle: { background: 'linear-gradient(135deg, #0c0c14, #12121e)' } },
]

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
  const overrides: Record<string, string> = {}

  if (radiusStyle.value === 'sharp') {
    overrides['--radius-btn'] = '2px'
    overrides['--radius-card'] = '4px'
    overrides['--radius-input'] = '2px'
    overrides['--radius-modal'] = '8px'
  } else if (radiusStyle.value === 'round') {
    overrides['--radius-btn'] = '12px'
    overrides['--radius-card'] = '16px'
    overrides['--radius-input'] = '12px'
    overrides['--radius-modal'] = '20px'
  }

  if (density.value === 'compact') {
    overrides['--spacing-card'] = 'var(--space-3)'
    overrides['--spacing-btn'] = 'var(--space-1) var(--space-2)'
    overrides['--spacing-gap'] = 'var(--space-2)'
  } else if (density.value === 'spacious') {
    overrides['--spacing-card'] = 'var(--space-6)'
    overrides['--spacing-btn'] = 'var(--space-3) var(--space-5)'
    overrides['--spacing-gap'] = 'var(--space-4)'
  }

  setUserOverrides(overrides)
}
</script>

<style scoped>
.theme-quick { display: flex; flex-direction: column; gap: var(--space-5); }
.theme-quick__heading { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--color-text-secondary); margin-bottom: var(--space-2); }
.theme-quick__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: var(--space-3); }
.theme-quick__card {
  cursor: pointer; border: 2px solid transparent; border-radius: var(--radius-md);
  padding: var(--space-2); text-align: center; transition: background var(--duration-fast) var(--ease-default), border-color var(--duration-fast) var(--ease-default), color var(--duration-fast) var(--ease-default), box-shadow var(--duration-fast) var(--ease-default), transform var(--duration-fast) var(--ease-default), opacity var(--duration-fast) var(--ease-default), filter var(--duration-fast) var(--ease-default);
}
.theme-quick__card:hover { border-color: var(--color-primary); }
.theme-quick__card--active { border-color: var(--color-primary); background: var(--color-primary-subtle); }
.theme-quick__preview {
  height: 60px; border-radius: var(--radius-sm); margin-bottom: var(--space-1);
  display: flex; align-items: center; justify-content: center;
}
.theme-quick__preview-dot { width: 20px; height: 20px; border-radius: 50%; }
.theme-quick__name { font-size: var(--font-size-xs); color: var(--color-text-secondary); }
.theme-quick__options { display: flex; gap: var(--space-2); }
.theme-quick__option {
  padding: var(--space-1) var(--space-3); border: 1px solid var(--color-border);
  border-radius: var(--radius-sm); background: transparent; font-size: var(--font-size-sm);
  color: var(--color-text-secondary); cursor: pointer; transition: background var(--duration-fast) var(--ease-default), border-color var(--duration-fast) var(--ease-default), color var(--duration-fast) var(--ease-default), box-shadow var(--duration-fast) var(--ease-default), transform var(--duration-fast) var(--ease-default), opacity var(--duration-fast) var(--ease-default), filter var(--duration-fast) var(--ease-default);
}
.theme-quick__option:hover { border-color: var(--color-primary); color: var(--color-primary); }
.theme-quick__option--active { background: var(--color-primary-subtle); border-color: var(--color-primary); color: var(--color-primary); }
</style>
