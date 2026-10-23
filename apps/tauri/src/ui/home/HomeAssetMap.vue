<template>
  <section class="home-section home-asset-map">
    <header class="home-section-head">
      <h2>资产地图</h2>
      <span class="home-section-note">当前启用的芽</span>
    </header>
    <div
      v-if="barTotal > 0"
      class="home-domain-bar"
      role="img"
      :aria-label="barLabel"
    >
      <span
        v-for="(d, i) in barDomains"
        :key="d.id"
        class="home-domain-bar-seg"
        :style="{ flexGrow: d.entityCount ?? 0, background: `var(--home-cat-${(i % 8) + 1})` }"
      ></span>
    </div>
    <div class="home-domain-grid">
      <article
        v-for="d in domains"
        :key="d.id"
        class="home-domain"
        :class="{ 'is-empty': d.activeSprouts.length === 0 }"
      >
        <header class="home-domain-head">
          <span class="home-domain-icon"><WsIcon :name="d.icon" size="sm" /></span>
          <div class="home-domain-title">
            <h3>{{ d.label }}</h3>
            <p>{{ d.question }}</p>
          </div>
          <span class="home-domain-count">{{ d.entityCount ?? '—' }}</span>
        </header>

        <div class="home-domain-sprouts">
          <button
            v-for="s in d.activeSprouts.slice(0, 3)"
            :key="s.id"
            type="button"
            class="home-chip"
            @click="emit('enter', s.viewId)"
          >
            <WsIcon :name="s.icon" size="xs" />{{ s.label }}
          </button>
          <span v-if="d.activeSprouts.length > 3" class="home-chip is-muted">+{{ d.activeSprouts.length - 3 }}</span>
          <span v-if="d.activeSprouts.length === 0" class="home-muted">该域暂无启用芽</span>
        </div>

        <div class="home-domain-recent">
          <button
            v-for="e in d.recentEntities"
            :key="e.id"
            type="button"
            class="home-entity-link"
            @click="emit('entity', e.viewId, e.id)"
          >{{ e.name }}</button>
          <span v-if="d.recentEntities.length === 0" class="home-muted">
            {{ d.activeSprouts.length ? '尚无内容' : '—' }}
          </span>
        </div>

        <button
          type="button"
          class="home-btn-enter"
          :disabled="!d.firstViewId"
          @click="d.firstViewId && emit('enter', d.firstViewId)"
        >进入</button>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import type { HomeDomain } from './homeData'

const props = defineProps<{ domains: HomeDomain[] }>()
const emit = defineEmits<{
  enter: [viewId: string]
  entity: [viewId: string, entityId: string]
}>()

const barDomains = computed(() => props.domains.filter(d => (d.entityCount ?? 0) > 0))
const barTotal = computed(() => barDomains.value.reduce((sum, d) => sum + (d.entityCount ?? 0), 0))
const barLabel = computed(() =>
  props.domains.map(d => `${d.label} ${d.entityCount ?? '未启用'}`).join('，'),
)
</script>
