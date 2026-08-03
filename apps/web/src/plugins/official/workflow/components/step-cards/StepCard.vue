<template>
  <div class="sc-card" :class="`sc-card--${step.type}`">
    <div class="sc-card__header">
      <span class="sc-card__icon">{{ icon }}</span>
      <span class="sc-card__title">{{ step.title }}</span>
      <span class="sc-card__status" :class="`status--${step.status}`">{{ statusText }}</span>
    </div>
    <div class="sc-card__body">
      <AgentTaskCard v-if="step.type === 'agent-task'" :config="step.config as AgentTaskConfig" />
      <UserReviewCard v-else-if="step.type === 'user-review'" :config="step.config as UserReviewConfig" />
      <BatchCreateCard v-else-if="step.type === 'batch-create'" :config="step.config as BatchCreateConfig" />
      <TemplateApplyCard v-else-if="step.type === 'template-apply'" :config="step.config as TemplateApplyConfig" />
      <ConsistencyCheckCard v-else-if="step.type === 'consistency-check'" :config="step.config as ConsistencyCheckConfig" />
      <TransformCard v-else-if="step.type === 'transform'" :config="step.config as TransformConfig" />
    </div>
    <div class="sc-card__output" v-if="step.output?.summary">
      <p>{{ step.output.summary }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { PipelineStep, AgentTaskConfig, UserReviewConfig, BatchCreateConfig, TemplateApplyConfig, ConsistencyCheckConfig, TransformConfig, StepStatus } from '../../types'
import { STEP_TYPE_ICONS } from '../../composables/useStepLibrary'
import AgentTaskCard from './AgentTaskCard.vue'
import UserReviewCard from './UserReviewCard.vue'
import BatchCreateCard from './BatchCreateCard.vue'
import TemplateApplyCard from './TemplateApplyCard.vue'
import ConsistencyCheckCard from './ConsistencyCheckCard.vue'
import TransformCard from './TransformCard.vue'
import { computed } from 'vue'

const props = defineProps<{ step: PipelineStep }>()

const icon = computed(() => STEP_TYPE_ICONS[props.step.type] || '📌')

const statusText = computed(() => {
  const map: Record<StepStatus, string> = {
    pending: '待执行', running: '执行中', completed: '已完成', failed: '失败', skipped: '已跳过',
  }
  return map[props.step.status] || props.step.status
})
</script>

<style scoped>
.sc-card {
  border: 1px solid var(--border, #30363d);
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-secondary, #161b22);
}
.sc-card__header {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border, #30363d);
}
.sc-card__icon { font-size: 16px; }
.sc-card__title { font-size: 13px; font-weight: 500; flex: 1; }
.sc-card__status { font-size: 11px; }
.status--pending { color: var(--text-secondary, #8b949e); }
.status--running { color: var(--warning, #d29922); }
.status--completed { color: var(--success, #3fb950); }
.status--failed { color: var(--danger, #f85149); }
.status--skipped { color: var(--text-secondary, #8b949e); font-style: italic; }
.sc-card__body { padding: 8px 12px; font-size: 12px; }
.sc-card__output {
  padding: 6px 12px; background: var(--bg-tertiary, #21262d);
  font-size: 11px; opacity: 0.7; border-top: 1px solid var(--border, #30363d);
}
.sc-card__output p { margin: 0; }
</style>
