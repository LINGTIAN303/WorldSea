<template>
  <div class="slot-container" :class="[`slot-${slot.direction}`]" :style="slotStyle">
    <template v-for="(child, idx) in slot.children" :key="idx">
      <div v-if="child.type === 'zone'" class="slot-zone" :style="zoneStyle(child)" :data-zone-id="child.zoneId">
        <template v-for="comp in zoneComponents(child.zoneId)" :key="comp.id">
          <div class="comp-wrapper" :style="compStyle(comp)" :class="{ 'comp-expanded': comp.expanded }">
            <ErrorBoundary :key="comp.id">
              <component
                v-if="getRenderer(comp.type)"
                :is="getRenderer(comp.type)"
                :config="comp.config"
                :component-id="comp.id"
              />
              <div v-else class="zone-comp-missing">
                <span><WsIcon name="warning" size="xs" /> 未注册的组件类型: {{ comp.type }}</span>
              </div>
              <template #fallback>
                <div class="comp-error">
                  <span><WsIcon name="warning" size="xs" /> 组件渲染错误: {{ comp.type }}</span>
                </div>
              </template>
            </ErrorBoundary>
            <div v-if="comp.expanded && comp.childSlot" class="comp-child-slot">
              <SlotRenderer :slot="comp.childSlot" :components="components" />
            </div>
          </div>
        </template>
        <div v-if="zoneComponents(child.zoneId).length === 0" class="zone-empty">
          <span class="zone-empty-text">{{ child.zoneId }}</span>
        </div>
      </div>
      <SlotRenderer v-else :slot="child.slot" :components="components" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, ref, onErrorCaptured } from 'vue'
import type { LayoutSlot, LayoutSlotChild, PlacedComponent, ComponentTypeId } from '../types/layoutSchema'
import { getComponentType } from '../registry/componentTypeRegistry'
import { WsIcon } from '@worldsmith/ui-kit'

const ErrorBoundary = defineComponent({
  setup(_, { slots }) {
    const hasError = ref(false)
    onErrorCaptured(() => {
      hasError.value = true
      return false
    })
    return () => hasError.value ? slots.fallback?.() : slots.default?.()
  },
})

const props = defineProps<{
  slot: LayoutSlot
  components: PlacedComponent[]
}>()

const slotStyle = computed(() => ({
  gap: (props.slot.gap ?? 8) + 'px',
}))

function zoneStyle(child: LayoutSlotChild) {
  if (child.type !== 'zone') return {}
  const style: Record<string, string> = {}
  if (child.width && child.width !== 'auto') style.width = child.width + 'px'
  if (child.height && child.height !== 'auto') style.height = child.height + 'px'
  if (child.flex) style.flex = String(child.flex)
  if (child.resizable) style.minWidth = '100px'
  return style
}

function compStyle(comp: PlacedComponent) {
  const style: Record<string, string> = {}
  if (comp.x !== undefined) style.left = comp.x + 'px'
  if (comp.y !== undefined) style.top = comp.y + 'px'
  if (comp.width && comp.width !== 'auto') style.width = comp.width + 'px'
  if (comp.height && comp.height !== 'auto') style.height = comp.height + 'px'
  return style
}

function zoneComponents(zoneId: string): PlacedComponent[] {
  return props.components
    .filter(c => c.zoneId === zoneId)
    .sort((a, b) => a.order - b.order)
}

function getRenderer(typeId: ComponentTypeId) {
  const def = getComponentType(typeId)
  return def?.renderer ?? null
}
</script>

<style scoped>
.slot-container { display: flex; width: 100%; height: 100%; }
.slot-horizontal { flex-direction: row; }
.slot-vertical { flex-direction: column; }
.slot-zone { display: flex; flex-direction: column; overflow: auto; min-width: 0; min-height: 0; position: relative; }
.comp-wrapper { position: relative; }
.comp-expanded { z-index: 10; }
.comp-child-slot { border-top: 1px solid var(--border-color); padding: 8px; min-height: 60px; }
.zone-empty { display: flex; align-items: center; justify-content: center; flex: 1; min-height: 60px; border: 1px dashed var(--border-color); border-radius: var(--radius-sm); }
.zone-empty-text { font-size: var(--font-size-xs); color: var(--text-tertiary); }
.zone-comp-missing { padding: 8px; background: color-mix(in srgb, var(--color-warning) 15%, transparent); border: 1px solid var(--color-warning); border-radius: 4px; font-size: var(--font-size-sm); color: var(--color-warning); }
.comp-error { padding: 8px; background: color-mix(in srgb, var(--color-danger) 15%, transparent); border: 1px solid var(--color-danger); border-radius: 4px; font-size: var(--font-size-sm); color: var(--color-danger); }
</style>
