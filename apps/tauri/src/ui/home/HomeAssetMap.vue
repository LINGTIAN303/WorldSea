<template>
  <section class="home-section home-asset-map">
    <header class="home-section-head">
      <h2>资产地图</h2>
      <span
        class="home-section-note"
        title="同一实体类型可归属多个域（副域），域计数之和会大于实体总数"
      >当前启用的芽 · 计数含跨域</span>
    </header>
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
          <button
            type="button"
            class="home-domain-open"
            :disabled="!d.firstViewId"
            :aria-label="d.firstViewId ? `进入${d.label}` : `${d.label}暂无启用芽`"
            @click="d.firstViewId && emit('enter', d.firstViewId)"
          ><WsIcon name="arrow-right" size="xs" /></button>
        </header>

        <div class="home-domain-sprouts">
          <button
            v-for="s in d.activeSprouts.slice(0, 2)"
            :key="s.id"
            type="button"
            class="home-chip"
            @click="emit('enter', s.viewId)"
          >
            <WsIcon :name="s.icon" size="xs" />{{ s.label }}
          </button>
          <span v-if="d.activeSprouts.length > 2" class="home-chip is-muted">+{{ d.activeSprouts.length - 2 }}</span>
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
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { WsIcon } from '@worldsea/ui-kit'
import type { HomeDomain } from './homeData'

defineProps<{ domains: HomeDomain[] }>()
const emit = defineEmits<{
  enter: [viewId: string]
  entity: [viewId: string, entityId: string]
}>()
</script>
