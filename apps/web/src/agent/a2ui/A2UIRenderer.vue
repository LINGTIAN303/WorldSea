<template>
  <div class="a2ui-renderer">
    <div v-for="surface in surfaces" :key="surface.surfaceId" class="a2ui-surface">
      <template v-for="rootId in surface.rootIds" :key="rootId">
        <A2UIComponent
          v-if="surface.components[rootId]"
          :comp="surface.components[rootId]"
          :all-components="surface.components"
          :data-model="surface.dataModel"
          :resolve-binding="resolveBinding"
          @action="onAction(surface.surfaceId, $event)"
        />
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import A2UIComponent from './A2UIComponent.vue'

interface Surface {
  surfaceId: string
  catalogId: string
  theme?: Record<string, unknown>
  components: Record<string, any>
  rootIds: readonly string[]
  dataModel: Record<string, unknown>
}

const props = defineProps<{
  surfaces: Record<string, Surface>
  resolveBinding: (binding: any, dataModel: Record<string, unknown>) => any
}>()

const emit = defineEmits<{
  action: [surfaceId: string, action: { name: string; data?: any }]
}>()

const surfaces = computed(() => Object.values(props.surfaces))

function onAction(surfaceId: string, action: { name: string; data?: any }) {
  emit('action', surfaceId, action)
}
</script>

<style scoped>
.a2ui-renderer {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.a2ui-surface {
  background: var(--agent-bg, var(--bg-secondary, #1e1e2e));
  border: 1px solid var(--agent-border, var(--border-color, rgba(255,255,255,0.08)));
  border-radius: var(--radius-md, 8px);
  padding: 12px;
  animation: ws-fade-in 0.25s ease;
}

</style>
