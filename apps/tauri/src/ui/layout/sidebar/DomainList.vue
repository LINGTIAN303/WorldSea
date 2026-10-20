<template>
  <div class="ws-sn-domain-list" :class="`is-${variant}`">
    <button
      v-for="domain in domains"
      :key="domain.id"
      class="ws-sn-domain"
      :class="{ active: domain.id === active }"
      :title="domain.label"
      :aria-label="domain.label"
      :aria-pressed="domain.id === active"
      :aria-current="domain.id === active ? 'page' : undefined"
      @click="emit('select', domain.id, $event)"
    >
      <WsIcon :name="domain.icon" size="sm" class="ws-sn-domain-icon" />
      <template v-if="variant === 'list'">
        <span class="ws-sn-domain-label">{{ domain.label }}</span>
        <span class="ws-sn-domain-count">{{ domain.count }}</span>
      </template>
    </button>
  </div>
</template>

<script setup lang="ts">
import { WsIcon } from '@worldsea/ui-kit'
import type { SproutDomainFilter } from '@/stores/uiStore'
import type { SproutDomainGroup } from './sproutNavigation'

withDefaults(defineProps<{
  domains: SproutDomainGroup[]
  active: SproutDomainFilter
  variant?: 'list' | 'rail'
}>(), { variant: 'list' })

const emit = defineEmits<{
  select: [id: SproutDomainGroup['id'], event: MouseEvent]
}>()
</script>
