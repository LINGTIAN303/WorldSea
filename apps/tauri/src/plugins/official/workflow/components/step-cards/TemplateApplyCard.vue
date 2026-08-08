<template>
  <div class="tac">
    <div class="tac__row">📋 模板: <strong>{{ config.templateId || '未选择' }}</strong></div>
    <div v-if="config.overrides && Object.keys(config.overrides).length" class="tac__row">
      ⚙️ 覆盖参数: {{ Object.keys(config.overrides).length }} 项
    </div>
  </div>
</template>
<script setup lang="ts">
import type { TemplateApplyConfig } from '../../types'
defineProps<{ config: TemplateApplyConfig }>()
</script>
<style scoped>
.tac__row { font-size: 12px; line-height: 1.6; }
.tac__row strong { color: var(--primary, #58a6ff); }
</style>
