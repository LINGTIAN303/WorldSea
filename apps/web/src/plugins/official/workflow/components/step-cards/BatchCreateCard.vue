<template>
  <div class="bcc">
    <div class="bcc__row">📦 实体类型: <strong>{{ config.entityType }}</strong></div>
    <div class="bcc__row">🔢 数量: <strong>{{ config.count }}</strong></div>
    <div v-if="config.context" class="bcc__row">📝 {{ config.context }}</div>
    <div v-if="config.namePrefix" class="bcc__row">🏷 前缀: {{ config.namePrefix }}</div>
  </div>
</template>
<script setup lang="ts">
import type { BatchCreateConfig } from '../../types'
defineProps<{ config: BatchCreateConfig }>()
</script>
<style scoped>
.bcc__row { font-size: 12px; line-height: 1.6; }
.bcc__row strong { color: var(--primary, #58a6ff); }
</style>
