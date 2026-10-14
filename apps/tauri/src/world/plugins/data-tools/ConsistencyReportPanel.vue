<template>
  <Teleport to="body">
    <div class="consistency-overlay" v-if="show" @click.self="close">
      <div class="consistency-modal">
        <div class="consistency-header">
          <h3>一致性检查</h3>
          <div class="consistency-hdr-actions">
            <TuiButton variant="primary" :disabled="checking" @click="onRunCheck">
              {{ checking ? '检查中...' : '运行检查' }}
            </TuiButton>
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
          <TuiButton variant="danger-ghost" @click="onFixDangling">一键修复悬空关系（{{ danglingRelations.length }} 项）</TuiButton>
        </div>

        <!-- Issue list grouped by category -->
        <div class="consistency-list">
          <template v-for="cat in categories" :key="cat.key">
            <div v-if="getIssuesByCategory(cat.key).length > 0" class="category-group">
              <div class="category-header" role="button" tabindex="0" :aria-expanded="expandedCategories[cat.key]" @click="toggleCategory(cat.key)" @keydown.enter.prevent="toggleCategory(cat.key)" @keydown.space.prevent="toggleCategory(cat.key)">
                <span class="category-icon"><WsIcon :name="cat.icon" size="sm" /></span>
                <span class="category-label">{{ cat.label }}</span>
                <span class="category-count">{{ getIssuesByCategory(cat.key).length }}</span>
                <span class="category-toggle">{{ expandedCategories[cat.key] ? '▼' : '▶' }}</span>
              </div>
              <div v-if="expandedCategories[cat.key]" class="category-issues">
                <div v-for="issue in getIssuesByCategory(cat.key)" :key="issue.id" class="issue-item" :class="'severity-' + issue.severity">
                  <span class="issue-severity-icon"><WsIcon :name="severityIcon(issue.severity)" size="xs" /></span>
                  <div class="issue-content">
                    <div class="issue-message">{{ issue.message }}</div>
                    <div class="issue-suggestion" v-if="issue.suggestion">建议：{{ issue.suggestion }}</div>
                  </div>
                  <div class="issue-links" v-if="issue.entityId || issue.relationId">
                    <TuiButton v-if="issue.entityId" variant="secondary" size="sm" @click="navigateToEntity(issue.entityId!)">查看实体</TuiButton>
                    <TuiButton v-if="issue.relationId" variant="secondary" size="sm" @click="navigateToRelation(issue.relationId!)">查看关系</TuiButton>
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
import { TuiButton, WsIcon, useModalShortcuts, useConfirm } from '@worldsea/ui-kit'
import { useConsistencyChecker, type ConsistencyIssue } from '@worldsea/plugin-sdk'
import { useRelationStore } from '@worldsea/entity-core'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ close: [] }>()

// Esc 关闭收编 useModalShortcuts（此前该弹窗无 Esc，仅点遮罩关闭）
useModalShortcuts(() => props.show, { id: 'consistency.close', onEscape: () => close() })

const { checking, issues, runFullCheck, getIssueCountBySeverity } = useConsistencyChecker()
const relationStore = useRelationStore()
const { confirm } = useConfirm()

const hasRun = ref(false)
const expandedCategories = reactive<Record<string, boolean>>({
  dangling_relation: true,
  missing_required: true,
  type_mismatch: true,
  orphan_entity: true,
  duplicate_name: true,
  empty_name: true,
  dangling_ref: true,
  invalid_select: true,
  unregistered_type: true,
  self_loop: true,
})

const errorCount = computed(() => getIssueCountBySeverity('error'))
const warningCount = computed(() => getIssueCountBySeverity('warning'))
const infoCount = computed(() => getIssueCountBySeverity('info'))

const danglingRelations = computed(() => issues.value.filter(i => i.category === 'dangling_relation'))

// 图标取 ui-kit 图标集名（禁 emoji 当图标；2026-09-27 E7 收拾）
const categories = [
  { key: 'dangling_relation' as const, label: '悬空关系', icon: 'link' },
  { key: 'dangling_ref' as const, label: '失效引用', icon: 'relation' },
  { key: 'empty_name' as const, label: '空白名称', icon: 'document' },
  { key: 'duplicate_name' as const, label: '重名实体', icon: 'copy' },
  { key: 'missing_required' as const, label: '缺少必填字段', icon: 'edit' },
  { key: 'invalid_select' as const, label: '选项越界', icon: 'list' },
  { key: 'type_mismatch' as const, label: '类型不匹配', icon: 'warning' },
  { key: 'unregistered_type' as const, label: '未注册关系类型', icon: 'help' },
  { key: 'self_loop' as const, label: '自环关系', icon: 'trade' },
  { key: 'orphan_entity' as const, label: '孤立实体', icon: 'location' },
]

function getIssuesByCategory(category: ConsistencyIssue['category']): ConsistencyIssue[] {
  return issues.value.filter(i => i.category === category)
}

function toggleCategory(key: string) {
  expandedCategories[key] = !expandedCategories[key]
}

function severityIcon(severity: ConsistencyIssue['severity']): string {
  switch (severity) {
    case 'error': return 'close'
    case 'warning': return 'warning'
    case 'info': return 'info'
  }
}

async function onRunCheck() {
  await runFullCheck()
  hasRun.value = true
}

async function onFixDangling() {
  const dangling = danglingRelations.value
  if (dangling.length === 0) return
  // 危险操作走统一确认弹窗 + 二段式确认键（原 window.confirm 与全应用弹窗体系不一致）
  const ok = await confirm({
    type: 'danger',
    title: '一键修复悬空关系',
    description: `将删除 ${dangling.length} 条悬空关系，此操作不可撤销。`,
    armedConfirmText: '确认删除',
  })
  if (!ok) return

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

function navigateToRelation(relationId: string) {
  // 关系无专属视图：跳到其源实体（原实现仅关面板，按钮等于摆设）
  const rel = relationStore.relations.find(r => r.id === relationId)
  if (!rel) return
  window.dispatchEvent(new CustomEvent('ws-select-entity', { detail: { entityId: rel.sourceId } }))
  close()
}

function close() {
  emit('close')
}
</script>

<style scoped>
.consistency-overlay { position: fixed; inset: 0; z-index: var(--z-overlay); background: var(--overlay, rgba(0,0,0,0.3)); display: flex; align-items: center; justify-content: center; }
.consistency-modal { width: 600px; max-height: 75vh; background: var(--content-bg); border-radius: var(--radius-2xl); box-shadow: 0 8px 40px rgba(0,0,0,0.15); display: flex; flex-direction: column; overflow: hidden; }
.consistency-header { display: flex; justify-content: space-between; align-items: center; padding: 14px 20px; border-bottom: 1px solid var(--border); }
.consistency-header h3 { margin: 0; font-size: var(--font-size-lg); }
.consistency-hdr-actions { display: flex; align-items: center; gap: 10px; }
.consistency-close { background: none; border: none; font-size: var(--font-size-xl); cursor: pointer; padding: 4px 8px; border-radius: var(--radius-xs); }
.consistency-close:hover { background: var(--hover-bg); }

.consistency-summary { display: flex; align-items: center; gap: 10px; padding: 10px 20px; border-bottom: 1px solid var(--border); }
.summary-badge { font-size: var(--font-size-sm); padding: 2px 10px; border-radius: var(--radius-md); font-weight: var(--font-weight-semibold); }
.summary-error { background: color-mix(in srgb, var(--danger) 15%, transparent); color: var(--danger); }
.summary-warning { background: color-mix(in srgb, var(--warning) 15%, transparent); color: var(--warning); }
.summary-info { background: color-mix(in srgb, var(--primary) 15%, transparent); color: var(--primary); }
.summary-total { font-size: var(--font-size-sm); color: var(--text-secondary); margin-left: auto; }

.consistency-toolbar { padding: 8px 20px; border-bottom: 1px solid var(--border); display: flex; justify-content: flex-end; }

.consistency-list { flex: 1; overflow-y: auto; }

.category-group { border-bottom: 1px solid var(--border); }
.category-header { display: flex; align-items: center; gap: 8px; padding: 10px 20px; cursor: pointer; user-select: none; }
.category-header:hover { background: var(--hover-bg); }
.category-icon { font-size: var(--font-size-base); }
.category-label { font-weight: var(--font-weight-semibold); flex: 1; }
.category-count { font-size: var(--font-size-xs); background: var(--bg); padding: 2px 8px; border-radius: var(--radius-md); color: var(--text-secondary); }
.category-toggle { font-size: var(--font-size-xs); color: var(--text-tertiary); }

.category-issues { padding: 0 20px 8px; }
.issue-item { display: flex; align-items: flex-start; gap: 8px; padding: 8px 12px; border-radius: var(--radius-sm); margin-bottom: 4px; }
.issue-item.severity-error { background: color-mix(in srgb, var(--danger) 6%, transparent); }
.issue-item.severity-warning { background: color-mix(in srgb, var(--warning) 6%, transparent); }
.issue-item.severity-info { background: color-mix(in srgb, var(--primary) 6%, transparent); }
.issue-severity-icon { flex-shrink: 0; margin-top: 1px; }
.issue-content { flex: 1; min-width: 0; }
.issue-message { font-size: var(--font-size-sm); }
.issue-suggestion { font-size: var(--font-size-xs); color: var(--text-secondary); margin-top: 2px; }
.issue-links { display: flex; gap: 4px; flex-shrink: 0; }

.consistency-empty { text-align: center; padding: 40px; color: var(--text-tertiary); }

</style>
