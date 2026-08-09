<template>
  <div class="search-path">
    <div
      v-for="group in groups"
      :key="group.id"
      class="search-group"
      :class="{ 'group-active': group.active, 'group-done': group.done }"
    >
      <div class="group-header" role="button" tabindex="0" :aria-expanded="!!expandedGroups[group.id]" @click="toggleGroup(group.id)" @keydown.enter.prevent="toggleGroup(group.id)" @keydown.space.prevent="toggleGroup(group.id)">
        <span class="group-icon"><WsIcon :name="group.icon" size="xs" /></span>
        <span class="group-label">{{ group.label }}</span>
        <span v-if="group.tools.length > 0" class="group-count">{{ group.tools.length }}条结果</span>
        <span v-else-if="group.active" class="group-count searching">搜索中…</span>
        <span class="group-chevron">{{ expandedGroups[group.id] ? '▾' : '▸' }}</span>
      </div>
      <div v-if="expandedGroups[group.id]" class="group-tools">
        <div v-for="tc in group.tools" :key="tc.id" class="search-tool" :class="tc.status">
          <span class="search-tool-icon">
            <span v-if="tc.status === 'running'" class="tc-pulse"><WsIcon name="search" size="xs" /></span>
            <WsIcon v-else-if="tc.status === 'completed'" name="check" size="xs" />
            <WsIcon v-else name="x" size="xs" />
          </span>
          <span class="search-tool-name">{{ getToolLabel(tc.name) }}</span>
          <span class="search-tool-args">{{ formatArgs(tc.args) }}</span>
        </div>
      </div>
    </div>
    <div v-if="hasAnyResults" class="search-summary">
      <WsIcon name="clipboard-list" size="xs" /> 汇总 {{ totalCount }} 条结果 · 识别 {{ gapCount }} 个知识缺口
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'

interface ToolCallView {
  id: string
  name: string
  args: Record<string, unknown>
  status: 'running' | 'completed' | 'failed'
  result?: string
  startedAt: number
  endedAt?: number
}

const TOOL_LABELS: Record<string, string> = {
  kb_search: '知识库搜索', kb_list: '知识库列表', kb_read: '知识库读取',
  kb_write: '知识库写入', kb_extract: '知识库提取', kb_link: '知识库关联',
  kb_reflect: '知识库反思', kb_delete: '知识库删除',
  web_search: '联网搜索', web_fetch: '网页抓取',
  entity_get: '获取实体', entity_list: '实体列表', entity_create: '创建实体',
  entity_update: '更新实体', content_search: '内容搜索', relation_list: '关系列表',
  relation_create: '创建关系',
  algo_graph_analysis: '图分析', algo_force_layout: '力导向布局',
  output_table: '搜索结果表', output_entity_card: '实体卡片',
  output_list: '结论列表', output_accordion: '知识缺口',
}

function getToolLabel(name: string): string {
  return TOOL_LABELS[name] || name.replace(/_/g, ' ')
}

function formatArgs(args: Record<string, unknown>): string {
  const values = Object.values(args).filter(v => typeof v === 'string' && v.length > 0 && v.length < 40)
  return values.length > 0 ? `"${values[0]}"` : ''
}

const SEARCH_GROUPS = [
  {
    id: 'kb',
    label: '知识库搜索',
    icon: 'book',
    tools: ['kb_search', 'kb_list', 'kb_read', 'kb_write', 'kb_extract', 'kb_link', 'kb_reflect', 'kb_delete'],
  },
  {
    id: 'web',
    label: '联网搜索',
    icon: 'globe',
    tools: ['web_search', 'web_fetch'],
  },
  {
    id: 'project',
    label: '项目数据',
    icon: 'chart',
    tools: ['entity_get', 'entity_list', 'entity_create', 'entity_update', 'content_search', 'relation_list', 'relation_create'],
  },
  {
    id: 'analysis',
    label: '分析与输出',
    icon: 'clipboard-list',
    tools: ['algo_graph_analysis', 'algo_force_layout', 'output_table', 'output_entity_card', 'output_list', 'output_accordion'],
  },
]

const props = defineProps<{
  toolCalls: ToolCallView[]
}>()

const expandedGroups = reactive<Record<string, boolean>>({})

function toggleGroup(id: string) {
  expandedGroups[id] = !expandedGroups[id]
}

const groups = computed(() => {
  return SEARCH_GROUPS.map(groupDef => {
    const groupTools = props.toolCalls.filter(tc =>
      groupDef.tools.includes(tc.name)
    )
    const hasRunning = groupTools.some(tc => tc.status === 'running')
    const allDone = groupTools.length > 0 && groupTools.every(tc => tc.status === 'completed' || tc.status === 'failed')
    if (hasRunning && expandedGroups[groupDef.id] === undefined) {
      expandedGroups[groupDef.id] = true
    }
    return {
      id: groupDef.id,
      label: groupDef.label,
      icon: groupDef.icon,
      tools: groupTools,
      active: hasRunning,
      done: allDone,
    }
  }).filter(g => g.tools.length > 0 || g.active)
})

const hasAnyResults = computed(() => props.toolCalls.some(tc => tc.status === 'completed'))
const totalCount = computed(() => props.toolCalls.filter(tc => tc.status === 'completed').length)
const gapCount = computed(() => {
  const accordionCalls = props.toolCalls.filter(tc => tc.name === 'output_accordion' && tc.status === 'completed')
  return accordionCalls.length
})
</script>

<style scoped>
.search-path {
  padding: 8px 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.search-group {
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid rgba(255,255,255,0.06);
  background: rgba(255,255,255,0.02);
}

.search-group.group-active {
  border-color: color-mix(in srgb, var(--agent-accent, #b388ff) 25%, transparent);
  background: color-mix(in srgb, var(--agent-accent, #b388ff) 4%, transparent);
}

.search-group.group-done {
  border-color: rgba(34,197,94,0.15);
}

.group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  cursor: pointer;
  user-select: none;
  transition: background 0.15s;
}

.group-header:hover {
  background: rgba(255,255,255,0.03);
}

.group-icon { font-size: 14px; }
.group-label { font-size: 12px; font-weight: 600; color: var(--agent-text, #e0e0e0); flex: 1; }

.group-count {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 8px;
  background: rgba(34,197,94,0.1);
  color: rgba(34,197,94,0.8);
}

.group-count.searching {
  background: color-mix(in srgb, var(--agent-accent, #b388ff) 10%, transparent);
  color: var(--agent-primary, #6c5ce7);
}

.group-chevron {
  font-size: 10px;
  color: var(--agent-text-tertiary, #666);
}

.group-tools {
  padding: 2px 10px 6px 30px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.search-tool {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
}

.search-tool.running {
  background: color-mix(in srgb, var(--agent-accent, #b388ff) 6%, transparent);
}

.search-tool.completed {
  opacity: 0.7;
}

.search-tool-icon { font-size: 11px; }
.search-tool-name { color: var(--agent-text-secondary, #aaa); }
.search-tool-args { color: var(--agent-text-tertiary, #666); font-style: italic; font-size: 10px; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.tc-pulse { animation: ws-pulse 1.5s infinite; }

.search-summary {
  margin-top: 4px;
  padding: 4px 10px;
  font-size: 11px;
  color: var(--agent-text-secondary, #aaa);
  border-top: 1px solid rgba(255,255,255,0.06);
}
</style>
