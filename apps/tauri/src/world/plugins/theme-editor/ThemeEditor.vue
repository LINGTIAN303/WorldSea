<template>
  <TuiModal :show="show" title="主题编辑器" size="lg" @close="$emit('close')">
    <div class="theme-editor">
      <div class="theme-editor__tabs">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          :class="['theme-editor__tab', { 'theme-editor__tab--active': activeTab === tab.id }]"
          @click="activeTab = tab.id"
        >
          <WsIcon :name="tab.icon" :size="14" :stroke-width="1.7" /> {{ tab.label }}
        </button>
        <button class="theme-editor__mode-toggle" :title="isDark ? '切到浅色预览' : '切到深色预览'" @click="togglePreviewMode">
          <WsIcon :name="isDark ? 'sun' : 'moon'" :size="14" :stroke-width="1.7" /> {{ isDark ? '浅色预览' : '深色预览' }}
        </button>
      </div>
      <div class="theme-editor__content">
        <ThemeEditorQuick v-if="activeTab === 'quick'" :active-tab="activeTab" @jump-to-appearance="closeForAppearance" />
        <ThemeEditorPro v-if="activeTab === 'pro'" :active-tab="activeTab" :preview-nonce="previewNonce" @jump-to-appearance="closeForAppearance" />
        <ThemeEditorCode v-if="activeTab === 'code'" :active-tab="activeTab" />
      </div>
    </div>
  </TuiModal>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import TuiModal from '@/components/ui/TuiModal.vue'
import ThemeEditorQuick from './ThemeEditorQuick.vue'
import ThemeEditorPro from './ThemeEditorPro.vue'
import ThemeEditorCode from './ThemeEditorCode.vue'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ close: [] }>()

type TabId = 'quick' | 'pro' | 'code'
const activeTab = ref<TabId>('quick')

const tabs = [
  { id: 'quick' as const, label: '快速', icon: 'sparkle' },
  { id: 'pro' as const, label: '专业', icon: 'wrench' },
  { id: 'code' as const, label: '代码', icon: 'terminal' },
]

/** 子 Tab 的「前往外观面板」跳转：先关本编辑器（避免双模态叠放），由 AppearancePanel 打开逻辑接手 */
function closeForAppearance() {
  if (props.show) emit('close')
}

// 深浅预览：走 ws-set-theme 统一契约切换底色（会持久化，编辑器内可随时切回）；nonce 通知 Pro Tab 重读 computed 样式
const previewNonce = ref(0)
const isDark = ref(false)
watch(() => props.show, (v) => { if (v) isDark.value = document.documentElement.dataset.theme === 'dark' })
function togglePreviewMode() {
  const next = isDark.value ? 'light' : 'dark'
  window.dispatchEvent(new CustomEvent('ws-set-theme', { detail: { mode: next } }))
  isDark.value = next === 'dark'
  previewNonce.value++
}
</script>

<style scoped>
.theme-editor { min-height: 400px; }
.theme-editor__tabs { display: flex; gap: var(--space-1); margin-bottom: var(--space-4); border-bottom: 1px solid var(--color-border-subtle); padding-bottom: var(--space-2); }
.theme-editor__tab {
  padding: var(--space-1) var(--space-3); border: none; background: transparent;
  font-size: var(--font-size-sm); color: var(--color-text-secondary); cursor: pointer;
  border-radius: var(--radius-sm); transition: background var(--duration-fast) var(--ease-default), border-color var(--duration-fast) var(--ease-default), color var(--duration-fast) var(--ease-default), box-shadow var(--duration-fast) var(--ease-default), transform var(--duration-fast) var(--ease-default), opacity var(--duration-fast) var(--ease-default), filter var(--duration-fast) var(--ease-default);
}
.theme-editor__tab:hover { background: var(--color-bg-hover); color: var(--color-text-primary); }
.theme-editor__tab--active { background: var(--color-primary-subtle); color: var(--color-primary); font-weight: var(--font-weight-medium); }
.theme-editor__mode-toggle { margin-left: auto; padding: var(--space-1) var(--space-2); border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: transparent; font-size: var(--font-size-xs); color: var(--color-text-secondary); cursor: pointer; display: inline-flex; align-items: center; gap: 4px; transition: background var(--duration-fast) var(--ease-default), border-color var(--duration-fast) var(--ease-default), color var(--duration-fast) var(--ease-default); }
.theme-editor__mode-toggle:hover { border-color: var(--color-primary); color: var(--color-primary); }
.theme-editor__content { }
</style>
