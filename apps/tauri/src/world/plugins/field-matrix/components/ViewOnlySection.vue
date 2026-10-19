<template>
  <h2>没有实体字段的芽</h2>
  <p class="lead">这些芽只注册视图或工具，不声明实体 Schema 字段。</p>
  <div class="view-only-grid">
    <div v-for="bud in VIEW_ONLY" :key="bud.id" class="view-only-card">
      <strong>{{ bud.label }}</strong>
      <code>{{ bud.id }}</code>
      <span>{{ bud.description }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { VIEW_ONLY } from '../model/viewOnly'
</script>
