<template>
  <div class="bcc">
    <div class="bcc__row"><IconBox :size="13" /> 实体类型: <strong>{{ config.entityType }}</strong></div>
    <div class="bcc__row"><IconNumber :size="13" /> 数量: <strong>{{ config.count }}</strong></div>
    <div v-if="config.context" class="bcc__row"><IconNote :size="13" /> {{ config.context }}</div>
    <div v-if="config.namePrefix" class="bcc__row"><IconTag :size="13" /> 前缀: {{ config.namePrefix }}</div>
  </div>
</template>
<script setup lang="ts">
import { IconBox, IconNumber, IconNote, IconTag } from '@tabler/icons-vue'
import type { BatchCreateConfig } from '../../types'
defineProps<{ config: BatchCreateConfig }>()
</script>
<style scoped>
.bcc__row { font-size: var(--fs-sm); line-height: 1.6; display: flex; align-items: center; gap: 4px; }
.bcc__row strong { color: var(--primary, #4f46e5); }
</style>
