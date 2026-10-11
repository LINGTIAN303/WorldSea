<template>
  <div class="atc">
    <div v-if="config.prompt" class="atc__prompt">{{ config.prompt }}</div>
    <div v-else class="atc__empty">未配置任务描述</div>
    <div class="atc__meta" v-if="config.targetEntityType || config.skillIds?.length">
      <span v-if="config.targetEntityType" class="atc__tag"><IconTarget :size="11" /> {{ config.targetEntityType }}</span>
      <span v-for="skill in config.skillIds" :key="skill" class="atc__tag"><IconBolt :size="11" /> {{ skill }}</span>
    </div>
  </div>
</template>
<script setup lang="ts">
import { IconTarget, IconBolt } from '@tabler/icons-vue'
import type { AgentTaskConfig } from '../../types'
defineProps<{ config: AgentTaskConfig }>()
</script>
<style scoped>
.atc__prompt { font-size: var(--fs-sm); line-height: 1.5; opacity: 0.8; white-space: pre-wrap; }
.atc__empty { font-size: var(--fs-sm); opacity: 0.4; font-style: italic; }
.atc__meta { display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap; }
.atc__tag { display: inline-flex; align-items: center; gap: 3px; font-size: var(--fs-xs); padding: 2px 6px; background: var(--bg-tertiary, #e4e4e7); border-radius: var(--radius-xs); }
</style>
