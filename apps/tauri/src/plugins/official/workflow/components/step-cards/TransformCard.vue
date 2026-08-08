<template>
  <div class="tc">
    <div v-if="config.description" class="tc__row">{{ config.description }}</div>
    <div v-else class="tc__empty">未配置转换规则</div>
    <div v-if="config.rules" class="tc__rules">{{ config.rules }}</div>
  </div>
</template>
<script setup lang="ts">
import type { TransformConfig } from '../../types'
defineProps<{ config: TransformConfig }>()
</script>
<style scoped>
.tc__row { font-size: 12px; line-height: 1.5; }
.tc__empty { font-size: 12px; opacity: 0.4; font-style: italic; }
.tc__rules { margin-top: 6px; font-size: 11px; opacity: 0.6; white-space: pre-wrap; }
</style>
