<template>
  <div class="tac">
    <div class="tac__row"><IconClipboard :size="13" /> 模板: <strong>{{ config.templateId || '未选择' }}</strong></div>
    <div v-if="config.overrides && Object.keys(config.overrides).length" class="tac__row">
      <IconSettings :size="13" /> 覆盖参数: {{ Object.keys(config.overrides).length }} 项
    </div>
  </div>
</template>
<script setup lang="ts">
import { IconClipboard, IconSettings } from '@tabler/icons-vue'
import type { TemplateApplyConfig } from '../../types'
defineProps<{ config: TemplateApplyConfig }>()
</script>
<style scoped>
.tac__row { font-size: var(--fs-sm); line-height: 1.6; display: flex; align-items: center; gap: 4px; }
.tac__row strong { color: var(--primary, #4f46e5); }
</style>
