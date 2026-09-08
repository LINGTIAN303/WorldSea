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
      </div>
      <div class="theme-editor__content">
        <ThemeEditorQuick v-if="activeTab === 'quick'" />
        <ThemeEditorPro v-if="activeTab === 'pro'" />
        <ThemeEditorCode v-if="activeTab === 'code'" />
      </div>
    </div>
  </TuiModal>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import TuiModal from '@/components/ui/TuiModal.vue'
import ThemeEditorQuick from './ThemeEditorQuick.vue'
import ThemeEditorPro from './ThemeEditorPro.vue'
import ThemeEditorCode from './ThemeEditorCode.vue'

defineProps<{ show: boolean }>()
defineEmits<{ close: [] }>()

const activeTab = ref('quick')

const tabs = [
  { id: 'quick', label: '快速', icon: 'sparkle' },
  { id: 'pro', label: '专业', icon: 'wrench' },
  { id: 'code', label: '代码', icon: 'terminal' },
]
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
.theme-editor__content { }
</style>
