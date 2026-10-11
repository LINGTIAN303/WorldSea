<template>
  <div class="urc">
    <p class="urc__instruction">{{ config.instruction }}</p>
    <span v-if="config.skippable" class="urc__skip">可跳过</span>
  </div>
</template>
<script setup lang="ts">
import type { UserReviewConfig } from '../../types'
defineProps<{ config: UserReviewConfig }>()
</script>
<style scoped>
.urc__instruction { margin: 0; font-size: var(--fs-sm); line-height: 1.5; }
.urc__skip { font-size: var(--fs-xs); opacity: 0.5; font-style: italic; }
</style>
