<template>
  <div class="rslot" :class="[`rslot-${slot.arrangement}`]" :style="slotStyle">
    <!-- container：按排列渲染子槽位 -->
    <template v-if="slot.kind === 'container'">
      <RuntimeSlotRenderer v-for="child in slot.children" :key="child.id" :slot="child" />
      <div v-if="!slot.children || slot.children.length === 0" class="rslot-empty">空区域</div>
    </template>

    <!-- leaf：渲染组件 -->
    <template v-else>
      <template v-for="comp in slot.components || []" :key="comp.id">
        <div class="rcomp-wrapper" :class="{ 'rcomp-expanded': comp.expanded }">
          <ErrorBoundary>
            <component
              v-if="getRenderer(comp.type)"
              :is="getRenderer(comp.type)"
              :config="comp.config"
              :component-id="comp.id"
            />
            <div v-else class="rcomp-missing"><WsIcon name="warning" size="xs" /> 未注册组件: {{ comp.type }}</div>
            <template #fallback><div class="rcomp-error"><WsIcon name="warning" size="xs" /> 渲染错误: {{ comp.type }}</div></template>
          </ErrorBoundary>
          <RuntimeSlotRenderer v-if="comp.expanded && comp.childSlot" :slot="comp.childSlot" class="rcomp-child" />
        </div>
      </template>
      <div v-if="!slot.components || slot.components.length === 0" class="rslot-empty">{{ slot.name || '空组件区' }}</div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, ref, onErrorCaptured } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import { getComponentType } from '../registry/componentTypeRegistry'
import type { Slot, ComponentTypeId } from '../types/layoutSchema'
import RuntimeSlotRenderer from './RuntimeSlotRenderer.vue'

const ErrorBoundary = defineComponent({
  setup(_, { slots }) {
    const hasError = ref(false)
    onErrorCaptured(() => { hasError.value = true; return false })
    return () => hasError.value ? slots.fallback?.() : slots.default?.()
  },
})

const props = defineProps<{ slot: Slot }>()

const slotStyle = computed(() => {
  const s = props.slot.size || {}
  const style: Record<string, string> = {}
  if (s.width && s.width !== 'auto') style.width = s.width + 'px'
  if (s.height && s.height !== 'auto') style.height = s.height + 'px'
  if (s.flex) style.flex = String(s.flex)
  return style
})

function getRenderer(typeId: ComponentTypeId) {
  return getComponentType(typeId)?.renderer ?? null
}
</script>

<style scoped>
.rslot { display: flex; width: 100%; min-width: 0; min-height: 0; }
.rslot-horizontal { flex-direction: row; gap: 8px; }
.rslot-vertical { flex-direction: column; gap: 8px; }
.rslot-grid { flex-wrap: wrap; gap: 8px; }
.rslot-tabs, .rslot-accordion, .rslot-carousel, .rslot-split { flex-direction: row; gap: 8px; }
.rslot-leaf { flex-direction: column; }
.rslot-free { position: relative; }
.rslot-empty { display: flex; align-items: center; justify-content: center; flex: 1; min-height: 60px; color: var(--text-tertiary); font-size: var(--font-size-xs); border: 1px dashed var(--border-color); border-radius: var(--radius-sm); }
.rcomp-wrapper { position: relative; min-width: 0; flex: 1; }
.rcomp-expanded { z-index: 10; }
.rcomp-child { padding: 8px; min-height: 60px; }
.rcomp-missing { padding: 8px; background: color-mix(in srgb, var(--color-warning) 15%, transparent); border: 1px solid var(--color-warning); border-radius: var(--radius-xs); font-size: var(--font-size-sm); color: var(--color-warning); }
.rcomp-error { padding: 8px; background: color-mix(in srgb, var(--color-danger) 15%, transparent); border: 1px solid var(--color-danger); border-radius: var(--radius-xs); font-size: var(--font-size-sm); color: var(--color-danger); }
</style>
