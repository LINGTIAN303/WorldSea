<template>
  <div class="codex-view">
    <!-- 搜索 → R3 收束条；导出 → R3 动作落点 -->
    <Teleport to="#view-toolbar-filter-body">
      <input v-model="keyword" class="cx-search" type="text" placeholder="搜索名称 / 描述 / 标签…">
    </Teleport>
    <Teleport to="#view-toolbar-actions">
      <button class="cx-btn" :disabled="allSections.length === 0" @click="exportMarkdown">
        <WsIcon name="file-down" :size="12" :stroke-width="2" /> 导出 MD
      </button>
      <button class="cx-btn" :disabled="allSections.length === 0" @click="exportHtml">
        <WsIcon name="file-down" :size="12" :stroke-width="2" /> 导出 HTML
      </button>
      <span class="cx-count">{{ entryCount }} 条</span>
    </Teleport>

    <div v-if="displaySections.length > 0" class="cx-body">
      <details v-for="section in displaySections" :key="section.domainLabel" class="cx-domain" open>
        <summary class="cx-domain-head">
          <span class="cx-domain-name">{{ section.domainLabel }}</span>
          <span class="cx-domain-count">{{ sectionTotal(section) }} 条</span>
        </summary>
        <div v-for="group in section.groups" :key="group.typeLabel" class="cx-group">
          <div class="cx-group-head">{{ group.typeLabel }}（{{ group.rows.length }}）</div>
          <button
            v-for="row in group.rows"
            :key="row.entity.id"
            class="cx-entry"
            :title="row.data.description"
            @click="openEntity(row.entity)"
          >
            <CodexThumb :entity="row.entity" />
            <span class="cx-entry-main">
              <span class="cx-entry-name">
                {{ row.data.name }}
                <span v-if="row.data.tags.length > 0" class="cx-entry-tags">{{ row.data.tags.join(' · ') }}</span>
              </span>
              <span v-if="row.data.description" class="cx-entry-desc">{{ row.data.description }}</span>
              <span v-if="row.data.fields.length > 0" class="cx-entry-fields">
                {{ row.data.fields.slice(0, 3).map(f => `${f.label}：${f.value}`).join(' ｜ ') }}
              </span>
            </span>
          </button>
        </div>
      </details>
    </div>
    <div v-else class="cx-empty">
      <WsIcon name="book-open" :size="28" :stroke-width="1.5" />
      <p>{{ keyword.trim() ? '没有匹配的设定条目' : '暂无设定条目——在各芽创建实体后，这里按域分章聚合展示' }}</p>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import {
  entitySchemaRegistry,
  entitySchemaRegistryV2,
  SPROUT_DOMAINS,
  getSproutDomain,
  type Entity,
  type FieldSchema,
} from '@worldsea/entity-core'
import { toPlainText } from '@worldsea/plugin-sdk'
import { availablePlugins } from '../../tree'
import { getWorldService } from '../../service-registry'
import type { WorldEntitiesService } from '../../services'
import { useProjectSwitcher } from '@/composables/useProjectSwitcher'
import {
  buildCodexHtml,
  buildCodexMarkdown,
  formatFieldValue,
  type CodexEntryData,
  type CodexFieldData,
  type CodexSectionData,
} from './codexExport'
import CodexThumb from './CodexThumb.vue'

/** 取数经树服务（唯一取数通道，换数据源只改 services.ts）；取不到属时序被破坏，报错不降级。 */
function entitiesSvc(): WorldEntitiesService {
  const svc = getWorldService<WorldEntitiesService>('world.entities')
  if (!svc) throw new Error('[codex] world.entities 服务未就绪（视图渲染早于起树）')
  return svc
}

/** 展示行：导出结构 + 原实体（跳转用） */
interface CodexRow { data: CodexEntryData; entity: Entity }
interface CodexGroupRows { typeLabel: string; rows: CodexRow[] }
interface CodexSectionRows { domainLabel: string; groups: CodexGroupRows[] }

/** 不进字段清单的系统键：名称/描述已成标题正文，视觉/标签字段另行呈现 */
const SYSTEM_FIELD_KEYS = new Set([
  'name', 'title', 'description', 'tags', 'thumbnail',
  'coverImage', 'coverPosition', 'coverZoom', 'coverSource', 'portrait', 'portraitKind', 'portraitMeta', 'videoAsset',
])

const keyword = ref('')

/** 导出标题/文件名带项目名（挂账①：固定「WorldSea 设定集」退役） */
const { currentProject } = useProjectSwitcher()
const exportTitle = computed(() => `${currentProject.value?.name?.trim() || 'WorldSea'} 设定集`)
const exportBaseName = computed(() => {
  const name = currentProject.value?.name?.trim() || 'worldsea'
  return `${name.replace(/[\\/:*?"<>|]/g, '')}-设定集`
})

/** 类型 → 域映射（真源 = 各芽 manifest.entityTypes；未命中归「未分类」） */
const typeDomain = computed(() => {
  const map = new Map<string, string>()
  for (const plugin of availablePlugins()) {
    const domain = plugin.manifest.domain
    if (!domain) continue
    for (const t of plugin.manifest.entityTypes ?? []) if (!map.has(t)) map.set(t, domain)
  }
  return map
})

function collectFields(schemaFields: FieldSchema[] | undefined, entity: Entity): CodexFieldData[] {
  if (!schemaFields) return []
  const fields: CodexFieldData[] = []
  for (const field of schemaFields) {
    if (SYSTEM_FIELD_KEYS.has(field.key)) continue
    const value = formatFieldValue(field, entity.properties?.[field.key])
    if (value) fields.push({ label: field.label, value })
  }
  return fields
}

/** 分章构建（kw 空 = 全量；导出走全量，展示走搜索后结果） */
function buildSectionRows(kw: string): CodexSectionRows[] {
  const byType = new Map<string, Entity[]>()
  for (const e of entitiesSvc().list()) {
    const list = byType.get(e.type) ?? []
    list.push(e)
    byType.set(e.type, list)
  }
  const result: CodexSectionRows[] = []
  for (const domainId of [...SPROUT_DOMAINS.map(d => d.id), '__unclassified__']) {
    const domainLabel = domainId === '__unclassified__' ? '未分类' : (getSproutDomain(domainId)?.label ?? domainId)
    const groups: CodexGroupRows[] = []
    for (const [type, list] of byType) {
      if ((typeDomain.value.get(type) ?? '__unclassified__') !== domainId) continue
      const schemaFields = entitySchemaRegistryV2.get(type)?._compiledFields
      const typeLabel = entitySchemaRegistry.getLabel(type) || type
      const rows: CodexRow[] = []
      for (const entity of list) {
        const description = toPlainText(entity.description || '')
        const fields = collectFields(schemaFields, entity)
        const haystack = `${entity.name} ${description} ${entity.tags.join(' ')}`.toLowerCase()
        if (kw && !haystack.includes(kw)) continue
        rows.push({ entity, data: { name: entity.name, typeLabel, description, tags: entity.tags, fields } })
      }
      if (rows.length === 0) continue
      rows.sort((a, b) => a.data.name.localeCompare(b.data.name, 'zh'))
      groups.push({ typeLabel, rows })
    }
    if (groups.length === 0) continue
    result.push({ domainLabel, groups })
  }
  return result
}

const displaySections = computed(() => buildSectionRows(keyword.value.trim().toLowerCase()))

/** 导出结构（全量、去实体引用） */
const allSections = computed<CodexSectionData[]>(() =>
  buildSectionRows('').map(section => ({
    domainLabel: section.domainLabel,
    groups: section.groups.map(group => ({ typeLabel: group.typeLabel, entries: group.rows.map(row => row.data) })),
  })),
)

function sectionTotal(section: CodexSectionRows): number {
  return section.groups.reduce((sum, g) => sum + g.rows.length, 0)
}

const entryCount = computed(() => displaySections.value.reduce((sum, s) => sum + sectionTotal(s), 0))

function openEntity(entity: Entity) {
  window.dispatchEvent(new CustomEvent('ws-navigate', { detail: { entityType: entity.type, entityId: entity.id } }))
}

function download(content: string, mime: string, filename: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function exportMarkdown() {
  download(buildCodexMarkdown(exportTitle.value, allSections.value), 'text/markdown', `${exportBaseName.value}.md`)
}

function exportHtml() {
  download(buildCodexHtml(exportTitle.value, allSections.value), 'text/html', `${exportBaseName.value}.html`)
}
</script>
<style scoped>
.codex-view { display: flex; flex-direction: column; height: 100%; overflow-y: auto; padding: 12px 16px; }
.cx-search {
  height: 24px; width: 180px; padding: 0 8px; font-size: var(--font-size-sm);
  border: 1px solid var(--color-border); border-radius: var(--radius-xs);
  background: var(--color-bg-elevated); color: var(--color-text-primary); outline: none;
}
.cx-search:focus { border-color: var(--color-accent); }
.cx-search::placeholder { color: var(--color-text-tertiary); }
.cx-btn {
  display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px;
  border: 1px solid var(--color-border); border-radius: var(--radius-xs);
  background: var(--color-bg-elevated); color: var(--color-text-primary);
  font-size: var(--font-size-sm); cursor: pointer; white-space: nowrap;
  transition: background 0.15s, border-color 0.15s;
}
.cx-btn:hover:not(:disabled) { background: var(--color-bg-hover); border-color: var(--color-text-secondary); }
.cx-btn:disabled { opacity: 0.45; cursor: default; }
.cx-count { font-size: var(--font-size-sm); color: var(--color-text-secondary); white-space: nowrap; }

.cx-body { display: flex; flex-direction: column; gap: 8px; }
.cx-domain {
  border: 1px solid var(--color-border); border-radius: var(--radius-sm);
  background: var(--color-bg-elevated); overflow: hidden;
}
.cx-domain-head {
  display: flex; align-items: center; gap: 8px; padding: 8px 12px; cursor: pointer;
  background: var(--color-bg-hover); user-select: none;
}
.cx-domain-name { font-size: var(--font-size-md); font-weight: 600; color: var(--color-text-primary); }
.cx-domain-count { font-size: var(--font-size-xs); color: var(--color-text-tertiary); }
.cx-group { padding: 8px 12px; }
.cx-group + .cx-group { border-top: 1px dashed var(--color-border); }
.cx-group-head { font-size: var(--font-size-sm); color: var(--color-text-secondary); margin-bottom: 6px; }
.cx-entry {
  display: flex; align-items: flex-start; gap: 10px; width: 100%; padding: 6px 8px;
  border: 0; border-radius: var(--radius-xs); background: transparent; cursor: pointer; text-align: left;
  transition: background 0.15s;
}
.cx-entry:hover { background: var(--color-bg-hover); }
.cx-entry-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.cx-entry-name { font-size: var(--font-size-sm); font-weight: 500; color: var(--color-text-primary); }
.cx-entry-tags { font-size: var(--font-size-xs); font-weight: 400; color: var(--color-text-tertiary); margin-left: 6px; }
.cx-entry-desc, .cx-entry-fields {
  font-size: var(--font-size-xs); color: var(--color-text-tertiary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;
}
.cx-empty {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; color: var(--color-text-tertiary); font-size: var(--font-size-sm); text-align: center; padding: 32px;
}
</style>
