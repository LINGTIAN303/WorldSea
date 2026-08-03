<template>
  <Teleport to="body">
    <div class="consistency-overlay" v-if="show" @click.self="close">
      <div class="consistency-modal">
        <div class="consistency-header">
          <h3>一致性检查</h3>
          <div class="consistency-hdr-actions">
            <button class="btn btn-primary" :disabled="checking" @click="onRunCheck">
              {{ checking ? '检查中...' : '运行检查' }}
            </button>
            <button class="consistency-close" @click="close">✕</button>
          </div>
        </div>

        <!-- Summary stats -->
        <div class="consistency-summary" v-if="hasRun">
          <span class="summary-badge summary-error">错误 {{ errorCount }}</span>
          <span class="summary-badge summary-warning">警告 {{ warningCount }}</span>
          <span class="summary-badge summary-info">提示 {{ infoCount }}</span>
          <span class="summary-total">共 {{ issues.length }} 项</span>
        </div>

        <!-- Toolbar -->
        <div class="consistency-toolbar" v-if="danglingRelations.length > 0">
          <button class="btn btn-danger" @click="onFixDangling">一键修复悬空关系（{{ danglingRelations.length }} 项）</button>
        </div>

        <!-- Issue list grouped by category -->
        <div class="consistency-list">
          <template v-for="cat in categories" :key="cat.key">
            <div v-if="getIssuesByCategory(cat.key).length > 0" class="category-group">
              <div class="category-header" @click="toggleCategory(cat.key)">
                <span class="category-icon">{{ cat.icon }}</span>
                <span class="category-label">{{ cat.label }}</span>
                <span class="category-count">{{ getIssuesByCategory(cat.key).length }}</span>
                <span class="category-toggle">{{ expandedCategories[cat.key] ? '▼' : '▶' }}</span>
              </div>
              <div v-if="expandedCategories[cat.key]" class="category-issues">
                <div v-for="issue in getIssuesByCategory(cat.key)" :key="issue.id" class="issue-item" :class="'severity-' + issue.severity">
                  <span class="issue-severity-icon">{{ severityIcon(issue.severity) }}</span>
                  <div class="issue-content">
                    <div class="issue-message">{{ issue.message }}</div>
                    <div class="issue-suggestion" v-if="issue.suggestion">建议：{{ issue.suggestion }}</div>
                  </div>
                  <div class="issue-links" v-if="issue.entityId || issue.relationId">
                    <button v-if="issue.entityId" class="btn btn-sm" @click="navigateToEntity(issue.entityId!)">查看实体</button>
                    <button v-if="issue.relationId" class="btn btn-sm" @click="navigateToRelation(issue.relationId!)">查看关系</button>
                  </div>
                </div>
              </div>
            </div>
          </template>

          <div v-if="hasRun && issues.length === 0" class="consistency-empty">
            未发现一致性问题，数据状态良好
          </div>
          <div v-if="!hasRun" class="consistency-empty">
            点击"运行检查"开始检测数据一致性问题
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import { useConsistencyChecker, type ConsistencyIssue } from '@worldsmith/entity-core'
import { useRelationStore } from '@worldsmith/entity-core'

defineProps<{ show: boolean }>()
const emit = defineEmits<{ close: [] }>()

const { checking, issues, runFullCheck, getIssueCountBySeverity } = useConsistencyChecker()
const relationStore = useRelationStore()

const hasRun = ref(false)
const expandedCategories = reactive<Record<string, boolean>>({
  dangling_relation: true,
  missing_required: true,
  type_mismatch: true,
  orphan_entity: true,
})

const errorCount = computed(() => getIssueCountBySeverity('error'))
const warningCount = computed(() => getIssueCountBySeverity('warning'))
const infoCount = computed(() => getIssueCountBySeverity('info'))

const danglingRelations = computed(() => issues.value.filter(i => i.category === 'dangling_relation'))

const categories = [
  { key: 'dangling_relation' as const, label: '悬空关系', icon: '🔗' },
  { key: 'missing_required' as const, label: '缺少必填字段', icon: '📝' },
  { key: 'type_mismatch' as const, label: '类型不匹配', icon: '⚠️' },
  { key: 'orphan_entity' as const, label: '孤立实体', icon: '🏝️' },
]

function getIssuesByCategory(category: ConsistencyIssue['category']): ConsistencyIssue[] {
  return issues.value.filter(i => i.category === category)
}

function toggleCategory(key: string) {
  expandedCategories[key] = !expandedCategories[key]
}

function severityIcon(severity: ConsistencyIssue['severity']): string {
  switch (severity) {
    case 'error': return '❌'
    case 'warning': return '⚠️'
    case 'info': return 'ℹ️'
  }
}

async function onRunCheck() {
  await runFullCheck()
  hasRun.value = true
}

async function onFixDangling() {
  const dangling = danglingRelations.value
  if (dangling.length === 0) return
  if (!confirm(`确定删除 ${dangling.length} 条悬空关系？此操作不可撤销。`)) return

  const relationIds = new Set(dangling.map(i => i.relationId!))
  for (const relId of relationIds) {
    await relationStore.remove(relId)
  }

  // Re-run check after fix
  await runFullCheck()
}

function navigateToEntity(entityId: string) {
  window.dispatchEvent(new CustomEvent('ws-select-entity', { detail: { entityId } }))
}

function navigateToRelation(_relationId: string) {
  // Relations don't have a dedicated view; just close the panel for now
  close()
}

function close() {
  emit('close')
}
</script>

<style scoped>
.consistency-overlay { position: fixed; inset: 0; z-index: var(--z-overlay); background: rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; }
.consistency-modal { width: 600px; max-height: 75vh; background: var(--content-bg); border-radius: 12px; box-shadow: 0 8px 40px rgba(0,0,0,0.15); display: flex; flex-direction: column; overflow: hidden; }
.consistency-header { display: flex; justify-content: space-between; align-items: center; padding: 14px 20px; border-bottom: 1px solid var(--border); }
.consistency-header h3 { margin: 0; font-size: var(--font-size-lg); }
.consistency-hdr-actions { display: flex; align-items: center; gap: 10px; }
.consistency-close { background: none; border: none; font-size: var(--font-size-xl); cursor: pointer; padding: 4px 8px; border-radius: 4px; }
.consistency-close:hover { background: var(--hover-bg); }

.consistency-summary { display: flex; align-items: center; gap: 10px; padding: 10px 20px; border-bottom: 1px solid var(--border); }
.summary-badge { font-size: var(--font-size-sm); padding: 2px 10px; border-radius: 10px; font-weight: var(--font-weight-semibold); }
.summary-error { background: color-mix(in srgb, var(--danger) 15%, transparent); color: var(--danger); }
.summary-warning { background: color-mix(in srgb, #e6a700 15%, transparent); color: #b38600; }
.summary-info { background: color-mix(in srgb, var(--primary) 15%, transparent); color: var(--primary); }
.summary-total { font-size: var(--font-size-sm); color: var(--text-secondary); margin-left: auto; }

.consistency-toolbar { padding: 8px 20px; border-bottom: 1px solid var(--border); display: flex; justify-content: flex-end; }

.consistency-list { flex: 1; overflow-y: auto; }

.category-group { border-bottom: 1px solid var(--border); }
.category-header { display: flex; align-items: center; gap: 8px; padding: 10px 20px; cursor: pointer; user-select: none; }
.category-header:hover { background: var(--hover-bg); }
.category-icon { font-size: var(--font-size-base); }
.category-label { font-weight: var(--font-weight-semibold); flex: 1; }
.category-count { font-size: var(--font-size-xs); background: var(--bg); padding: 2px 8px; border-radius: 10px; color: var(--text-secondary); }
.category-toggle { font-size: var(--font-size-xs); color: var(--text-tertiary); }

.category-issues { padding: 0 20px 8px; }
.issue-item { display: flex; align-items: flex-start; gap: 8px; padding: 8px 12px; border-radius: 6px; margin-bottom: 4px; }
.issue-item.severity-error { background: color-mix(in srgb, var(--danger) 6%, transparent); }
.issue-item.severity-warning { background: color-mix(in srgb, #e6a700 6%, transparent); }
.issue-item.severity-info { background: color-mix(in srgb, var(--primary) 6%, transparent); }
.issue-severity-icon { flex-shrink: 0; margin-top: 1px; }
.issue-content { flex: 1; min-width: 0; }
.issue-message { font-size: var(--font-size-sm); }
.issue-suggestion { font-size: var(--font-size-xs); color: var(--text-secondary); margin-top: 2px; }
.issue-links { display: flex; gap: 4px; flex-shrink: 0; }

.consistency-empty { text-align: center; padding: 40px; color: var(--text-tertiary); }

.btn { padding: 6px 14px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); cursor: pointer; font-size: var(--font-size-sm); }
.btn:hover { background: var(--bg-hover); }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn.btn-sm { padding: 3px 8px; font-size: var(--font-size-xs); }
.btn.btn-primary { color: var(--primary); border-color: var(--primary); }
.btn.btn-primary:hover { background: color-mix(in srgb, var(--primary) 10%, transparent); }
.btn.btn-danger { color: var(--danger); border-color: var(--danger); }
.btn.btn-danger:hover { background: color-mix(in srgb, var(--danger) 10%, transparent); }
</style>
