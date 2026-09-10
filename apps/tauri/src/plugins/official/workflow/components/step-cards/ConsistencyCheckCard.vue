<template>
  <div class="ccc">
    <div class="ccc__row"><IconSearch :size="13" /> 范围: <strong>{{ scopeLabel }}</strong></div>
    <div class="ccc__row"><IconRuler :size="13" /> 严格度: <strong>{{ strictnessLabel }}</strong></div>
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import { IconSearch, IconRuler } from '@tabler/icons-vue'
import type { ConsistencyCheckConfig } from '../../types'
const props = defineProps<{ config: ConsistencyCheckConfig }>()
const scopeLabel = computed(() => {
  const m: Record<string, string> = { all: '全部内容', recent: '最近创建' }
  return m[props.config.scope] || props.config.scope
})
const strictnessLabel = computed(() => {
  const m: Record<string, string> = { loose: '宽松', normal: '标准', strict: '严格' }
  return m[props.config.strictness] || props.config.strictness
})
</script>
<style scoped>
.ccc__row { font-size: var(--fs-sm); line-height: 1.6; display: flex; align-items: center; gap: 4px; }
.ccc__row strong { color: var(--primary, #4f46e5); }
</style>
