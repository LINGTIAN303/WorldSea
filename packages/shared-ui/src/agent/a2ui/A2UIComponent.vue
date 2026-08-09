<template>
  <div :class="['a2ui-comp', `a2ui-${comp.component}`]">
    <template v-if="comp.component === 'Text'">
      <component :is="textTag" :class="['a2ui-text', variantClass]">{{ resolvedText }}</component>
    </template>

    <template v-else-if="comp.component === 'Button'">
      <button :class="['a2ui-btn', `a2ui-btn-${comp.variant || 'secondary'}`]" @click="onAction">
        <A2UIComponent
          v-if="comp.child && allComponents[comp.child]"
          :comp="allComponents[comp.child]"
          :all-components="allComponents"
          :data-model="dataModel"
          :resolve-binding="resolveBinding"
          @action="$emit('action', $event)"
        />
        <span v-else>{{ comp.child || comp.text || '' }}</span>
      </button>
    </template>

    <template v-else-if="comp.component === 'TextField'">
      <div class="a2ui-field">
        <label v-if="comp.label" class="a2ui-label">{{ comp.label }}</label>
        <input
          v-if="comp.textFieldType === 'obscured'"
          type="password"
          class="a2ui-input"
          :placeholder="comp.placeholder || ''"
          :value="resolvedValue"
          @input="onInput($event)"
        />
        <textarea
          v-else-if="comp.textFieldType === 'longText'"
          class="a2ui-input a2ui-textarea"
          :placeholder="comp.placeholder || ''"
          :value="resolvedValue"
          @input="onInput($event)"
        />
        <input
          v-else
          type="text"
          class="a2ui-input"
          :placeholder="comp.placeholder || ''"
          :value="resolvedValue"
          @input="onInput($event)"
        />
      </div>
    </template>

    <template v-else-if="comp.component === 'Slider'">
      <div class="a2ui-field">
        <label v-if="comp.label" class="a2ui-label">{{ comp.label }}</label>
        <div class="a2ui-slider-row">
          <input
            type="range"
            class="a2ui-slider"
            :min="comp.minValue ?? 0"
            :max="comp.maxValue ?? 100"
            :value="resolvedValue"
            @input="onInput($event)"
          />
          <span class="a2ui-slider-val">{{ resolvedValue ?? comp.minValue ?? 0 }}</span>
        </div>
      </div>
    </template>

    <template v-else-if="comp.component === 'CheckBox'">
      <label class="a2ui-checkbox">
        <input type="checkbox" :checked="!!resolvedValue" @change="onCheckboxChange($event)" />
        <span v-if="comp.label">{{ comp.label }}</span>
      </label>
    </template>

    <template v-else-if="comp.component === 'ChoicePicker' || comp.component === 'MultipleChoice'">
      <div class="a2ui-field">
        <label v-if="comp.label" class="a2ui-label">{{ comp.label }}</label>
        <div class="a2ui-choices">
          <button
            v-for="opt in (comp.options || [])"
            :key="opt.value"
            :class="['a2ui-choice', { active: isSelected(opt.value) }]"
            @click="selectChoice(opt.value)"
          >
            {{ opt.label || opt.value }}
          </button>
        </div>
      </div>
    </template>

    <template v-else-if="comp.component === 'DateTimeInput'">
      <div class="a2ui-field">
        <label v-if="comp.label" class="a2ui-label">{{ comp.label }}</label>
        <input
          :type="comp.enableTime ? 'datetime-local' : 'date'"
          class="a2ui-input"
          :value="resolvedValue"
          @input="onInput($event)"
        />
      </div>
    </template>

    <template v-else-if="comp.component === 'Column'">
      <div class="a2ui-column">
        <template v-for="childId in resolvedChildren" :key="childId">
          <A2UIComponent
            v-if="allComponents[childId]"
            :comp="allComponents[childId]"
            :all-components="allComponents"
            :data-model="dataModel"
            :resolve-binding="resolveBinding"
            @action="$emit('action', $event)"
          />
        </template>
      </div>
    </template>

    <template v-else-if="comp.component === 'Row'">
      <div class="a2ui-row">
        <template v-for="childId in resolvedChildren" :key="childId">
          <A2UIComponent
            v-if="allComponents[childId]"
            :comp="allComponents[childId]"
            :all-components="allComponents"
            :data-model="dataModel"
            :resolve-binding="resolveBinding"
            @action="$emit('action', $event)"
          />
        </template>
      </div>
    </template>

    <template v-else-if="comp.component === 'List'">
      <div class="a2ui-list">
        <template v-for="childId in resolvedChildren" :key="childId">
          <A2UIComponent
            v-if="allComponents[childId]"
            :comp="allComponents[childId]"
            :all-components="allComponents"
            :data-model="dataModel"
            :resolve-binding="resolveBinding"
            @action="$emit('action', $event)"
          />
        </template>
      </div>
    </template>

    <template v-else-if="comp.component === 'Card'">
      <div class="a2ui-card">
        <A2UIComponent
          v-if="comp.child && allComponents[comp.child]"
          :comp="allComponents[comp.child]"
          :all-components="allComponents"
          :data-model="dataModel"
          :resolve-binding="resolveBinding"
          @action="$emit('action', $event)"
        />
      </div>
    </template>

    <template v-else-if="comp.component === 'Tabs'">
      <div class="a2ui-tabs">
        <div class="a2ui-tab-headers">
          <button
            v-for="(tab, idx) in (comp.tabItems || [])"
            :key="idx"
            :class="['a2ui-tab-btn', { active: activeTab === idx }]"
            @click="setActiveTab(Number(idx))"
          >
            {{ tab.title }}
          </button>
        </div>
        <div class="a2ui-tab-content">
          <template v-for="(tab, idx) in (comp.tabItems || [])" :key="idx">
            <A2UIComponent
              v-if="activeTab === idx && tab.child && allComponents[tab.child]"
              :comp="allComponents[tab.child]"
              :all-components="allComponents"
              :data-model="dataModel"
              :resolve-binding="resolveBinding"
              @action="$emit('action', $event)"
            />
          </template>
        </div>
      </div>
    </template>

    <template v-else-if="comp.component === 'Modal'">
      <div class="a2ui-modal-wrap">
        <A2UIComponent
          v-if="comp.entryPointChild && allComponents[comp.entryPointChild]"
          :comp="allComponents[comp.entryPointChild]"
          :all-components="allComponents"
          :data-model="dataModel"
          :resolve-binding="resolveBinding"
          @action="$emit('action', $event)"
        />
      </div>
    </template>

    <template v-else-if="comp.component === 'Image'">
      <A2UIResolvedImage
        :src="resolvedUrl"
        :alt="comp.alt || ''"
        img-class="a2ui-image"
      />
    </template>

    <template v-else-if="comp.component === 'Icon'">
      <span class="a2ui-icon">{{ resolvedIcon }}</span>
    </template>

    <template v-else-if="comp.component === 'Divider'">
      <hr class="a2ui-divider" />
    </template>

    <template v-else-if="comp.component === 'EntityCard'">
      <div class="a2ui-entity-card">
        <div v-if="resolvedEntityCover" class="a2ui-ec-cover-wrap">
          <A2UIResolvedImage
            :src="resolvedEntityCover"
            alt="封面"
            img-class="a2ui-ec-cover"
            :img-style="entityCoverStyle"
          />
        </div>
        <div class="a2ui-ec-header">
          <span class="a2ui-ec-icon"><WsIcon :name="resolvedEntityTypeIcon" size="lg" /></span>
          <div class="a2ui-ec-info">
            <span class="a2ui-ec-name">{{ resolvedEntityName }}</span>
            <span class="a2ui-ec-type">{{ resolvedEntityType }}</span>
          </div>
        </div>
        <p v-if="resolvedEntityDesc" class="a2ui-ec-desc">{{ resolvedEntityDesc }}</p>
        <div v-if="resolvedEntityTags?.length" class="a2ui-ec-tags">
          <span v-for="tag in resolvedEntityTags" :key="tag" class="a2ui-ec-tag">{{ tag }}</span>
        </div>
        <div v-if="comp.actions" class="a2ui-ec-actions">
          <button
            v-for="act in comp.actions"
            :key="act.name"
            class="a2ui-btn a2ui-btn-sm"
            :class="`a2ui-btn-${act.variant || 'secondary'}`"
            @click="$emit('action', { name: act.name, data: resolvedEntityData })"
          >
            {{ act.label }}
          </button>
        </div>
      </div>
    </template>

    <template v-else-if="comp.component === 'StatBar'">
      <div class="a2ui-statbar">
        <span class="a2ui-statbar-label">{{ comp.label }}</span>
        <div class="a2ui-statbar-track">
          <div
            class="a2ui-statbar-fill"
            :style="{ width: statPercent + '%', background: comp.color || 'var(--accent, #b388ff)' }"
          />
        </div>
        <span class="a2ui-statbar-value">{{ resolvedStatValue }}/{{ comp.max ?? 10 }}</span>
      </div>
    </template>

    <template v-else-if="comp.component === 'TagGroup'">
      <div class="a2ui-taggroup">
        <span
          v-for="tag in resolvedTags"
          :key="tag"
          class="a2ui-tag"
          role="button"
          tabindex="0"
          @click="$emit('action', { name: 'tag_click', data: { tag } })"
          @keydown.enter.prevent="$emit('action', { name: 'tag_click', data: { tag } })"
          @keydown.space.prevent="$emit('action', { name: 'tag_click', data: { tag } })"
        >
          {{ tag }}
        </span>
      </div>
    </template>

    <template v-else-if="comp.component === 'ConfirmBar'">
      <div class="a2ui-confirm">
        <span class="a2ui-confirm-msg">{{ comp.message }}</span>
        <div class="a2ui-confirm-btns">
          <button class="a2ui-btn a2ui-btn-danger" @click="$emit('action', { name: 'confirm' })">{{ comp.confirmText || '确认' }}</button>
          <button class="a2ui-btn a2ui-btn-secondary" @click="$emit('action', { name: 'cancel' })">{{ comp.cancelText || '取消' }}</button>
        </div>
      </div>
    </template>

    <template v-else-if="comp.type === 'plan_board'">
      <div class="a2ui-plan-board">
        <div v-if="comp.title" class="pb-title">{{ comp.title }}</div>
        <div class="pb-columns">
          <div v-for="col in (comp.columns || ['待办', '进行中', '已完成'])" :key="col" class="pb-col">
            <div class="pb-col-header">{{ col }}</div>
            <div class="pb-col-items">
              <div v-for="item in getPlanItems(comp, col)" :key="item.id" class="pb-item" :class="{ 'pb-done': item.status === 'done' }">
                <div class="pb-item-title">{{ item.title }}</div>
                <div v-if="item.description" class="pb-item-desc">{{ item.description }}</div>
                <div v-if="item.priority" class="pb-item-priority" :class="'priority-' + item.priority">{{ item.priority }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <template v-else-if="comp.type === 'json_view'">
      <div class="a2ui-json-view">
        <div v-if="comp.title" class="jv-title">{{ comp.title }}</div>
        <div class="jv-tree">
          <template v-for="(value, key) in parseJson(comp.data)" :key="String(key)">
            <div class="jv-node" :style="{ paddingLeft: '0px' }">
              <span class="jv-key">{{ key }}</span>
              <span class="jv-colon">:</span>
              <span :class="jsonValueType(value)">{{ jsonFormatValue(value) }}</span>
            </div>
          </template>
        </div>
      </div>
    </template>

    <template v-else-if="comp.type === 'svg_view'">
      <div class="a2ui-svg-view">
        <div v-if="comp.title" class="sv-title">{{ comp.title }}</div>
        <div class="sv-container" v-html="sanitizeSvg(comp.content || comp.svg || '')"></div>
      </div>
    </template>

    <template v-else-if="comp.type === 'mermaid_view'">
      <div class="a2ui-mermaid-view">
        <div v-if="comp.title" class="mv-title">{{ comp.title }}</div>
        <div class="mv-container">
          <pre class="mermaid">{{ comp.content || comp.code || '' }}</pre>
        </div>
      </div>
    </template>

    <template v-else-if="comp.component === 'EditableTable'">
      <div class="a2ui-table-wrap">
        <div v-if="comp.title" class="a2ui-table-title">{{ comp.title }}</div>
        <div class="a2ui-table-scroll">
          <table class="a2ui-table">
            <thead>
              <tr>
                <th v-for="col in tableColumns" :key="col.key">{{ col.label }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, ri) in tableRows" :key="ri">
                <td v-for="col in tableColumns" :key="col.key">
                  <input
                    v-if="col.editable"
                    class="a2ui-table-input"
                    :value="resolveBinding(row[col.key], dataModel)"
                    @change="onTableEdit(ri, col.key, ($event.target as HTMLInputElement).value)"
                  />
                  <span v-else>{{ resolveBinding(row[col.key], dataModel) ?? '' }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <template v-else-if="comp.component === 'ChartView'">
      <div class="a2ui-chart-wrap">
        <div v-if="comp.title" class="a2ui-chart-title">{{ comp.title }}</div>
        <div class="a2ui-chart-container" :data-chart-type="comp.chartType">
          <span class="a2ui-chart-placeholder"><WsIcon name="dashboard" size="sm" /> {{ comp.chartType || 'bar' }} 图表（需集成 ECharts）</span>
        </div>
      </div>
    </template>

    <template v-else-if="comp.component === 'MermaidRender'">
      <div class="a2ui-mermaid-render">
        <div v-if="comp.title" class="a2ui-mmr-title">{{ comp.title }}</div>
        <div class="a2ui-mmr-container" v-html="renderedMermaid"></div>
      </div>
    </template>

    <template v-else-if="comp.component === 'SuggestionPicker'">
      <div class="a2ui-suggestion-picker">
        <div v-if="comp.title" class="a2ui-sp-title">{{ comp.title }}</div>
        <div class="a2ui-sp-options">
          <div
            v-for="opt in (comp.options || [])"
            :key="opt.id"
            :class="['a2ui-sp-option', { active: selectedSuggestion === opt.id }]"
            role="button"
            tabindex="0"
            :aria-pressed="selectedSuggestion === opt.id"
            @click="selectSuggestion(opt.id)"
            @keydown.enter.prevent="selectSuggestion(opt.id)"
            @keydown.space.prevent="selectSuggestion(opt.id)"
          >
            <div class="a2ui-sp-label">{{ opt.label }}</div>
            <div v-if="opt.description" class="a2ui-sp-desc">{{ opt.description }}</div>
          </div>
        </div>
      </div>
    </template>

    <template v-else-if="comp.component === 'FilePreview'">
      <div class="a2ui-file-preview">
        <div class="a2ui-fp-header">
          <span class="a2ui-fp-icon"><WsIcon :name="fileIcon" size="lg" /></span>
          <div class="a2ui-fp-info">
            <span class="a2ui-fp-name">{{ comp.fileName }}</span>
            <span class="a2ui-fp-type">{{ comp.fileType }}</span>
          </div>
        </div>
        <p v-if="comp.summary" class="a2ui-fp-summary">{{ comp.summary }}</p>
        <div v-if="comp.suggestions?.length" class="a2ui-fp-suggestions">
          <div class="a2ui-fp-sug-title">建议操作：</div>
          <div
            v-for="(sug, si) in comp.suggestions"
            :key="si"
            class="a2ui-fp-sug-item"
            role="button"
            tabindex="0"
            @click="$emit('action', { name: 'file_route', data: { target: sug.target, reason: sug.reason, fileId: comp.fileId } })"
            @keydown.enter.prevent="$emit('action', { name: 'file_route', data: { target: sug.target, reason: sug.reason, fileId: comp.fileId } })"
            @keydown.space.prevent="$emit('action', { name: 'file_route', data: { target: sug.target, reason: sug.reason, fileId: comp.fileId } })"
          >
            → {{ sug.target }}：{{ sug.reason }}
          </div>
        </div>
      </div>
    </template>

    <template v-else-if="comp.component === 'CodeBlock'">
      <div class="a2ui-code-block">
        <div class="a2ui-cb-header">
          <span class="a2ui-cb-lang">{{ comp.language || 'text' }}</span>
          <button v-if="comp.runnable" class="a2ui-cb-run" @click="$emit('action', { name: 'code_run', data: { code: comp.code, noteId: comp.noteId } })">▶ 运行</button>
        </div>
        <pre class="a2ui-cb-code"><code>{{ comp.code || '' }}</code></pre>
      </div>
    </template>

    <template v-else-if="comp.component === 'EntityLink'">
      <span
        class="a2ui-entity-link"
        role="link"
        tabindex="0"
        :aria-label="`查看实体 ${comp.name}`"
        @click="$emit('action', { name: 'entity_navigate', data: { entityId: comp.entityId, entityType: comp.entityType } })"
        @keydown.enter.prevent="$emit('action', { name: 'entity_navigate', data: { entityId: comp.entityId, entityType: comp.entityType } })"
        @keydown.space.prevent="$emit('action', { name: 'entity_navigate', data: { entityId: comp.entityId, entityType: comp.entityType } })"
      >
        <WsIcon :name="ENTITY_ICONS[comp.entityType] || 'item'" size="xs" /> {{ comp.name }}
      </span>
    </template>

    <template v-else-if="comp.component === 'SvgCanvas'">
      <div class="a2ui-svg-canvas">
        <div v-if="comp.title" class="a2ui-sc-title">{{ comp.title }}</div>
        <div class="a2ui-sc-container" v-html="sanitizeSvg(comp.svg || comp.content || '')"></div>
      </div>
    </template>

    <template v-else>
      <div class="a2ui-unknown">[未知组件: {{ comp.component }}]</div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import A2UIResolvedImage from './A2UIResolvedImage.vue'

const props = defineProps<{
  comp: any
  allComponents: Record<string, any>
  dataModel: Record<string, unknown>
  resolveBinding: (binding: any, dataModel: Record<string, unknown>) => any
}>()

const emit = defineEmits<{
  action: [action: { name: string; data?: any }]
}>()

const activeTab = ref(0)

const resolvedText = computed(() => props.resolveBinding(props.comp.text, props.dataModel) ?? '')
const resolvedValue = computed(() => props.resolveBinding(props.comp.value ?? props.comp.text, props.dataModel))
const resolvedUrl = computed(() => props.resolveBinding(props.comp.url, props.dataModel))
const resolvedIcon = computed(() => props.resolveBinding(props.comp.name, props.dataModel))

const variantClass = computed(() => {
  const v = props.comp.variant || props.comp.usageHint || 'body'
  return `a2ui-text-${v}`
})

const textTag = computed(() => {
  const v = props.comp.variant || props.comp.usageHint || 'body'
  if (v === 'h1' || v === 'h2') return 'h3'
  if (v === 'h3' || v === 'h4' || v === 'h5') return 'h4'
  return 'p'
})

const resolvedChildren = computed(() => {
  const ch = props.comp.children
  if (Array.isArray(ch)) return ch
  if (ch && typeof ch === 'object' && 'componentId' in ch) {
    const list = props.resolveBinding({ path: ch.path }, props.dataModel)
    if (Array.isArray(list)) return list.map((_: any, i: number) => `${ch.componentId}-${i}`)
    return []
  }
  return []
})

const resolvedStatValue = computed(() => {
  const v = props.resolveBinding(props.comp.value, props.dataModel)
  return v ?? props.comp.min ?? 0
})

const statPercent = computed(() => {
  const min = props.comp.min ?? 0
  const max = props.comp.max ?? 10
  const val = resolvedStatValue.value
  return Math.min(100, Math.max(0, ((val - min) / (max - min)) * 100))
})

const resolvedTags = computed(() => {
  const v = props.resolveBinding(props.comp.tags, props.dataModel)
  return Array.isArray(v) ? v : []
})

const ENTITY_ICONS: Record<string, string> = {
  character: 'character', region: 'region', item: 'item', building: 'building', organization: 'organization',
  concept: 'concept', culture: 'culture', language: 'language', magic: 'magic', species: 'species',
  plant: 'plant', weapon: 'weapon', event: 'event', manuscript: 'manuscript', inspiration: 'inspiration',
  conflict: 'war', apparel: 'apparel', custom: 'item', combat_stat: 'combat', dashboard: 'dashboard',
}

const resolvedEntityData = computed(() => props.resolveBinding({ path: props.comp.dataPath || '/entity' }, props.dataModel) || {})
const resolvedEntityName = computed(() => resolvedEntityData.value.name || props.comp.name || '')
const resolvedEntityType = computed(() => resolvedEntityData.value.type || props.comp.entityType || '')
const resolvedEntityDesc = computed(() => resolvedEntityData.value.description || props.comp.description || '')
const resolvedEntityTags = computed(() => resolvedEntityData.value.tags || props.comp.tags || [])
const resolvedEntityTypeIcon = computed(() => ENTITY_ICONS[resolvedEntityType.value] || 'item')

const resolvedEntityCover = computed(() => {
  const cover = resolvedEntityData.value.coverImage || props.comp.coverImage || resolvedEntityData.value.properties?.coverImage
  return cover || ''
})

const entityCoverStyle = computed(() => {
  const pos = resolvedEntityData.value.coverPosition || '50% 50%'
  const zoom = resolvedEntityData.value.coverZoom || 1
  return {
    objectPosition: pos,
    transform: `scale(${zoom})`,
    transformOrigin: pos,
  }
})

function setActiveTab(index: number): void {
  activeTab.value = index
}

function isSelected(value: string): boolean {
  const current = props.resolveBinding(props.comp.selections, props.dataModel)
  if (Array.isArray(current)) return current.includes(value)
  return current === value
}

function selectChoice(value: string): void {
  emit('action', { name: 'choice_select', data: { value, field: props.comp.id } })
}

function onAction(): void {
  const action = props.comp.action
  if (!action) return
  if (action.event) emit('action', { name: action.event.name, data: action.event.data })
  else if (action.name) emit('action', { name: action.name })
}

function onInput(event: Event): void {
  const target = event.target as HTMLInputElement
  emit('action', { name: 'input_change', data: { field: props.comp.id, value: target.value } })
}

function onCheckboxChange(event: Event): void {
  const target = event.target as HTMLInputElement
  emit('action', { name: 'input_change', data: { field: props.comp.id, value: target.checked } })
}

function getPlanItems(comp: any, column: string) {
  const items = comp.items || []
  const statusMap: Record<string, string> = { '待办': 'todo', '进行中': 'doing', '已完成': 'done' }
  return items.filter((item: any) => {
    if (item.column === column) return true
    if (item.status === statusMap[column]) return true
    return false
  })
}

function parseJson(data: any): any {
  if (typeof data === 'string') { try { return JSON.parse(data) } catch { return data } }
  return data
}

function jsonValueType(v: any): string {
  if (v === null) return 'jv-null'
  if (typeof v === 'string') return 'jv-string'
  if (typeof v === 'number') return 'jv-number'
  if (typeof v === 'boolean') return 'jv-boolean'
  if (Array.isArray(v)) return 'jv-array'
  return 'jv-object'
}

function jsonFormatValue(v: any): string {
  if (v === null) return 'null'
  if (typeof v === 'string') return `"${v}"`
  if (Array.isArray(v)) return `Array[${v.length}]`
  if (typeof v === 'object') return `{${Object.keys(v).length} keys}`
  return String(v)
}

function sanitizeSvg(svg: string): string {
  return svg.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/on\w+="[^"]*"/g, '')
}

const tableColumns = computed(() => {
  const cols = props.comp.columns
  if (Array.isArray(cols)) return cols
  return []
})

const tableRows = computed(() => {
  const rows = props.comp.rows
  if (Array.isArray(rows)) return rows
  return []
})

function onTableEdit(rowIndex: number, key: string, value: string): void {
  emit('action', { name: 'table_edit', data: { rowIndex, key, value } })
}

const selectedSuggestion = ref<string | null>(null)

function selectSuggestion(id: string): void {
  selectedSuggestion.value = id
  emit('action', { name: 'suggestion_select', data: { id } })
}

const fileIcon = computed(() => {
  const type = props.comp.fileType || ''
  if (type.includes('markdown') || type.includes('text/markdown')) return 'edit'
  if (type.includes('word') || type.includes('docx')) return 'manuscript'
  if (type.includes('javascript') || type.includes('typescript') || type.includes('json')) return 'keyboard'
  if (type.includes('presentation') || type.includes('pptx')) return 'dashboard'
  if (type.includes('image')) return 'image'
  return 'manuscript'
})

const renderedMermaid = computed(() => {
  const code = props.comp.code || ''
  if (!code) return '<p style="color:var(--color-text-tertiary);font-size:var(--text-micro-font-size);">无 Mermaid 代码</p>'
  return `<pre class="mermaid">${code}</pre><p style="color:var(--color-text-tertiary);font-size:var(--text-micro-font-size);margin-top:4px;">Mermaid 预览（需集成 mermaid.js 渲染引擎）</p>`
})
</script>

<style scoped>
.a2ui-comp { font-size: var(--font-size-sm); }
.a2ui-text { margin: 0; word-break: break-word; }
.a2ui-text-h1 { font-size: var(--font-size-xl); font-weight: var(--font-weight-bold); color: var(--agent-text, var(--color-text-primary)); }
.a2ui-text-h2 { font-size: var(--font-size-lg); font-weight: var(--font-weight-semibold); color: var(--agent-text, var(--color-text-primary)); }
.a2ui-text-h3, .a2ui-text-h4, .a2ui-text-h5 { font-size: var(--font-size-base); font-weight: var(--font-weight-semibold); color: var(--agent-text, var(--color-text-primary)); }
.a2ui-text-body { font-size: var(--font-size-sm); color: var(--agent-text-secondary, var(--color-text-tertiary)); }
.a2ui-text-caption { font-size: var(--font-size-xs); color: var(--agent-text-tertiary, #888); }

.a2ui-btn {
  padding: 4px 12px; border-radius: var(--radius-sm, 4px); border: 1px solid var(--agent-border, var(--color-border));
  cursor: pointer; font-size: var(--font-size-sm); transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease, opacity 0.15s ease, filter 0.15s ease; background: var(--agent-bg-tertiary, var(--color-bg-elevated));
  color: var(--agent-text, var(--color-text-primary));
}
.a2ui-btn:hover { filter: brightness(1.2); }
.a2ui-btn-sm { padding: 2px 8px; font-size: var(--font-size-xs); }
.a2ui-btn-primary { background: var(--agent-accent, var(--color-primary)); color: #fff; border-color: transparent; }
.a2ui-btn-secondary { background: var(--agent-bg-tertiary, var(--color-bg-elevated)); }
.a2ui-btn-danger { background: var(--color-danger); color: #fff; border-color: transparent; }

.a2ui-field { display: flex; flex-direction: column; gap: 4px; }
.a2ui-label { font-size: var(--font-size-xs); color: var(--agent-text-secondary, var(--color-text-tertiary)); font-weight: var(--font-weight-medium); }
.a2ui-input {
  padding: 6px 8px; border-radius: var(--radius-sm, 4px); border: 1px solid var(--agent-border, var(--color-border));
  background: var(--agent-bg-tertiary, var(--color-bg-elevated)); color: var(--agent-text, var(--color-text-primary)); font-size: var(--font-size-sm);
  outline: none; transition: border-color 0.15s;
}
.a2ui-input:focus { border-color: var(--agent-accent, var(--color-primary)); }
.a2ui-textarea { min-height: 60px; resize: vertical; }

.a2ui-slider-row { display: flex; align-items: center; gap: 8px; }
.a2ui-slider { flex: 1; accent-color: var(--agent-accent, var(--color-primary)); }
.a2ui-slider-val { font-size: var(--font-size-sm); color: var(--agent-text-secondary, var(--color-text-tertiary)); min-width: 30px; text-align: right; }

.a2ui-checkbox { display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: var(--font-size-sm); }
.a2ui-checkbox input { accent-color: var(--agent-accent, var(--color-primary)); }

.a2ui-choices { display: flex; flex-wrap: wrap; gap: 4px; }
.a2ui-choice {
  padding: 3px 10px; border-radius: 12px; border: 1px solid var(--agent-border, var(--color-border));
  background: transparent; color: var(--agent-text-secondary, var(--color-text-tertiary)); font-size: var(--font-size-sm); cursor: pointer; transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s;
}
.a2ui-choice:hover { border-color: var(--agent-accent, var(--color-primary)); }
.a2ui-choice.active { background: var(--agent-accent, var(--color-primary)); color: #fff; border-color: transparent; }

.a2ui-column { display: flex; flex-direction: column; gap: 8px; }
.a2ui-row { display: flex; flex-direction: row; gap: 8px; align-items: center; flex-wrap: wrap; }
.a2ui-list { display: flex; flex-direction: column; gap: 6px; }

.a2ui-card {
  background: var(--agent-bg-tertiary, var(--color-bg-elevated)); border: 1px solid var(--agent-border, var(--color-border));
  border-radius: var(--radius-md, 8px); padding: 10px;
}

.a2ui-tabs { display: flex; flex-direction: column; gap: 0; }
.a2ui-tab-headers { display: flex; gap: 0; border-bottom: 1px solid var(--agent-border, var(--color-border)); }
.a2ui-tab-btn {
  padding: 6px 14px; border: none; background: transparent; color: var(--agent-text-secondary, var(--color-text-tertiary));
  font-size: var(--font-size-sm); cursor: pointer; border-bottom: 2px solid transparent; transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s;
}
.a2ui-tab-btn:hover { color: var(--agent-text, var(--color-text-primary)); }
.a2ui-tab-btn.active { color: var(--agent-accent, var(--color-primary)); border-bottom-color: var(--agent-accent, var(--color-primary)); }
.a2ui-tab-content { padding-top: 8px; }

.a2ui-image { max-width: 100%; border-radius: var(--radius-sm, 4px); }
.a2ui-icon { font-size: var(--font-size-lg); }
.a2ui-divider { border: none; border-top: 1px solid var(--agent-border, var(--color-border)); margin: 6px 0; }

.a2ui-entity-card {
  background: var(--agent-bg-tertiary, var(--color-bg-elevated)); border: 1px solid var(--agent-border, var(--color-border));
  border-radius: var(--radius-md, 8px); padding: 10px; overflow: hidden;
}
.a2ui-ec-cover-wrap {
  max-height: 160px; overflow: hidden; border-radius: var(--radius-sm, 4px); margin-bottom: 8px;
}
.a2ui-ec-cover {
  width: 100%; display: block; object-fit: cover;
}
.a2ui-ec-header { display: flex; align-items: center; gap: 8px; }
.a2ui-ec-icon { font-size: var(--font-size-2xl); }
.a2ui-ec-info { display: flex; flex-direction: column; gap: 2px; }
.a2ui-ec-name { font-size: var(--font-size-base); font-weight: var(--font-weight-semibold); color: var(--agent-text, var(--color-text-primary)); }
.a2ui-ec-type { font-size: var(--font-size-xs); color: var(--agent-text-tertiary, #888); }
.a2ui-ec-desc { font-size: var(--font-size-sm); color: var(--agent-text-secondary, var(--color-text-tertiary)); margin: 6px 0 0; line-height: 1.4; }
.a2ui-ec-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.a2ui-ec-tag {
  font-size: var(--font-size-xs); padding: 1px 6px; border-radius: 3px;
  background: var(--agent-accent-bg, color-mix(in srgb, var(--color-primary) 15%, transparent)); color: var(--agent-accent, var(--color-primary));
}
.a2ui-ec-actions { display: flex; gap: 6px; margin-top: 8px; }

.a2ui-statbar { display: flex; align-items: center; gap: 8px; }
.a2ui-statbar-label { font-size: var(--font-size-sm); color: var(--agent-text-secondary, var(--color-text-tertiary)); min-width: 50px; }
.a2ui-statbar-track {
  flex: 1; height: 6px; border-radius: 3px; background: var(--agent-bg-tertiary, var(--color-bg-elevated)); overflow: hidden;
}
.a2ui-statbar-fill { height: 100%; border-radius: 3px; transition: width 0.3s ease; }
.a2ui-statbar-value { font-size: var(--font-size-xs); color: var(--agent-text-tertiary, #888); min-width: 40px; text-align: right; }

.a2ui-taggroup { display: flex; flex-wrap: wrap; gap: 4px; }
.a2ui-tag {
  font-size: var(--font-size-xs); padding: 2px 8px; border-radius: 10px; cursor: pointer;
  background: var(--agent-bg-tertiary, var(--color-bg-elevated)); color: var(--agent-text-secondary, var(--color-text-tertiary));
  border: 1px solid var(--agent-border, var(--color-border)); transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s;
}
.a2ui-tag:hover { border-color: var(--agent-accent, var(--color-primary)); color: var(--agent-accent, var(--color-primary)); }

.a2ui-confirm {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 8px 12px; border-radius: var(--radius-sm, 4px);
  background: color-mix(in srgb, var(--color-danger) 10%, transparent); border: 1px solid color-mix(in srgb, var(--color-danger) 30%, transparent);
}
.a2ui-confirm-msg { font-size: var(--font-size-sm); color: var(--agent-text, var(--color-text-primary)); }
.a2ui-confirm-btns { display: flex; gap: 6px; }

.a2ui-unknown { font-size: var(--font-size-xs); color: var(--agent-text-tertiary, #888); font-style: italic; }

.a2ui-plan-board { background: var(--agent-bg-tertiary, var(--color-bg-elevated)); border: 1px solid var(--agent-border, var(--color-border)); border-radius: var(--radius-md, 8px); padding: 10px; }
.pb-title { font-size: var(--font-size-base); font-weight: var(--font-weight-semibold); color: var(--agent-text, var(--color-text-primary)); margin-bottom: 8px; }
.pb-columns { display: flex; gap: 8px; overflow-x: auto; }
.pb-col { flex: 1; min-width: 120px; background: var(--color-bg-elevated); border-radius: var(--radius-sm, 4px); padding: 6px; }
.pb-col-header { font-size: var(--font-size-xs); font-weight: var(--font-weight-semibold); color: var(--agent-text-secondary, var(--color-text-tertiary)); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; padding-bottom: 4px; border-bottom: 1px solid var(--agent-border, var(--color-border)); }
.pb-col-items { display: flex; flex-direction: column; gap: 4px; }
.pb-item { background: var(--agent-bg-tertiary, var(--color-bg-elevated)); border: 1px solid var(--agent-border, var(--color-border)); border-radius: var(--radius-sm, 4px); padding: 6px 8px; }
.pb-item-title { font-size: var(--font-size-sm); color: var(--agent-text, var(--color-text-primary)); font-weight: var(--font-weight-medium); }
.pb-item-desc { font-size: var(--font-size-xs); color: var(--agent-text-tertiary, #888); margin-top: 2px; }
.pb-item-priority { font-size: var(--font-size-xs); padding: 1px 5px; border-radius: 3px; display: inline-block; margin-top: 3px; }
.priority-high { background: color-mix(in srgb, var(--color-danger) 20%, transparent); color: var(--color-danger); }
.priority-medium { background: color-mix(in srgb, var(--color-warning) 20%, transparent); color: var(--color-warning); }
.priority-low { background: color-mix(in srgb, var(--color-success) 20%, transparent); color: var(--color-success); }
.pb-done { opacity: 0.5; }
.pb-done .pb-item-title { text-decoration: line-through; }

.a2ui-json-view { background: var(--agent-bg-tertiary, var(--color-bg-elevated)); border: 1px solid var(--agent-border, var(--color-border)); border-radius: var(--radius-md, 8px); padding: 10px; }
.jv-title { font-size: var(--font-size-base); font-weight: var(--font-weight-semibold); color: var(--agent-text, var(--color-text-primary)); margin-bottom: 8px; }
.jv-tree { font-family: monospace; font-size: var(--font-size-sm); }
.jv-node { padding: 1px 0; }
.jv-key { color: var(--agent-accent, var(--color-primary)); }
.jv-colon { color: var(--agent-text-tertiary, #888); margin: 0 4px; }
.jv-string { color: var(--color-success); }
.jv-number { color: var(--color-warning); }
.jv-boolean { color: var(--color-primary-hover); }
.jv-null { color: var(--agent-text-tertiary, #888); font-style: italic; }
.jv-array { color: var(--agent-text-secondary, var(--color-text-tertiary)); }
.jv-object { color: var(--agent-text-secondary, var(--color-text-tertiary)); }

.a2ui-svg-view { background: var(--agent-bg-tertiary, var(--color-bg-elevated)); border: 1px solid var(--agent-border, var(--color-border)); border-radius: var(--radius-md, 8px); padding: 10px; }
.sv-title { font-size: var(--font-size-base); font-weight: var(--font-weight-semibold); color: var(--agent-text, var(--color-text-primary)); margin-bottom: 8px; }
.sv-container { display: flex; justify-content: center; align-items: center; overflow: auto; max-height: 300px; }
.sv-container svg { max-width: 100%; height: auto; }

.a2ui-mermaid-view { background: var(--agent-bg-tertiary, var(--color-bg-elevated)); border: 1px solid var(--agent-border, var(--color-border)); border-radius: var(--radius-md, 8px); padding: 10px; }
.mv-title { font-size: var(--font-size-base); font-weight: var(--font-weight-semibold); color: var(--agent-text, var(--color-text-primary)); margin-bottom: 8px; }
.mv-container { overflow: auto; max-height: 300px; }
.mv-container pre.mermaid { font-family: monospace; font-size: var(--font-size-sm); color: var(--agent-text-secondary, var(--color-text-tertiary)); white-space: pre-wrap; margin: 0; background: transparent; }

.a2ui-table-wrap { background: var(--agent-bg-tertiary, var(--color-bg-elevated)); border: 1px solid var(--agent-border, var(--color-border)); border-radius: var(--radius-md, 8px); padding: 10px; }
.a2ui-table-title { font-size: var(--font-size-base); font-weight: var(--font-weight-semibold); color: var(--agent-text, var(--color-text-primary)); margin-bottom: 8px; }
.a2ui-table-scroll { overflow-x: auto; }
.a2ui-table { width: 100%; border-collapse: collapse; font-size: var(--font-size-sm); }
.a2ui-table th { padding: 6px 10px; text-align: left; font-weight: var(--font-weight-semibold); color: var(--agent-text-secondary, var(--color-text-tertiary)); border-bottom: 1px solid var(--agent-border, var(--color-border)); font-size: var(--font-size-xs); text-transform: uppercase; letter-spacing: 0.3px; }
.a2ui-table td { padding: 5px 10px; border-bottom: 1px solid var(--agent-border, var(--color-border)); color: var(--agent-text, var(--color-text-primary)); }
.a2ui-table-input { background: transparent; border: 1px solid transparent; color: var(--agent-text, var(--color-text-primary)); font-size: var(--font-size-sm); padding: 2px 4px; border-radius: 3px; width: 100%; outline: none; }
.a2ui-table-input:hover { border-color: var(--agent-border, var(--color-border)); }
.a2ui-table-input:focus { border-color: var(--agent-accent, var(--color-primary)); background: var(--color-bg-elevated); }

.a2ui-chart-wrap { background: var(--agent-bg-tertiary, var(--color-bg-elevated)); border: 1px solid var(--agent-border, var(--color-border)); border-radius: var(--radius-md, 8px); padding: 10px; }
.a2ui-chart-title { font-size: var(--font-size-base); font-weight: var(--font-weight-semibold); color: var(--agent-text, var(--color-text-primary)); margin-bottom: 8px; }
.a2ui-chart-container { width: 100%; min-height: 200px; display: flex; align-items: center; justify-content: center; }
.a2ui-chart-placeholder { color: var(--agent-text-tertiary, #888); font-size: var(--font-size-sm); }

.a2ui-mermaid-render { background: var(--agent-bg-tertiary, var(--color-bg-elevated)); border: 1px solid var(--agent-border, var(--color-border)); border-radius: var(--radius-md, 8px); padding: 10px; }
.a2ui-mmr-title { font-size: var(--font-size-base); font-weight: var(--font-weight-semibold); color: var(--agent-text, var(--color-text-primary)); margin-bottom: 8px; }
.a2ui-mmr-container { overflow: auto; max-height: 400px; }
.a2ui-mmr-container pre.mermaid { font-family: monospace; font-size: var(--font-size-sm); color: var(--agent-text-secondary, var(--color-text-tertiary)); white-space: pre-wrap; margin: 0; background: transparent; }

.a2ui-suggestion-picker { background: var(--agent-bg-tertiary, var(--color-bg-elevated)); border: 1px solid var(--agent-border, var(--color-border)); border-radius: var(--radius-md, 8px); padding: 12px; }
.a2ui-sp-title { font-size: var(--font-size-base); font-weight: var(--font-weight-semibold); color: var(--agent-text, var(--color-text-primary)); margin-bottom: 10px; }
.a2ui-sp-options { display: flex; flex-direction: column; gap: 6px; }
.a2ui-sp-option { padding: 10px 12px; border: 1px solid var(--agent-border, var(--color-border)); border-radius: 6px; cursor: pointer; transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s; }
.a2ui-sp-option:hover { border-color: var(--agent-accent, var(--color-primary)); }
.a2ui-sp-option.active { border-color: var(--agent-accent, var(--color-primary)); background: color-mix(in srgb, var(--color-primary) 10%, transparent); }
.a2ui-sp-label { font-size: var(--font-size-sm); font-weight: var(--font-weight-medium); color: var(--agent-text, var(--color-text-primary)); }
.a2ui-sp-desc { font-size: var(--font-size-xs); color: var(--agent-text-tertiary, #888); margin-top: 2px; }

.a2ui-file-preview { background: var(--agent-bg-tertiary, var(--color-bg-elevated)); border: 1px solid var(--agent-border, var(--color-border)); border-radius: var(--radius-md, 8px); padding: 12px; }
.a2ui-fp-header { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.a2ui-fp-icon { font-size: var(--font-size-3xl); }
.a2ui-fp-info { display: flex; flex-direction: column; }
.a2ui-fp-name { font-size: var(--font-size-base); font-weight: var(--font-weight-semibold); color: var(--agent-text, var(--color-text-primary)); }
.a2ui-fp-type { font-size: var(--font-size-xs); color: var(--agent-text-tertiary, #888); }
.a2ui-fp-summary { font-size: var(--font-size-sm); color: var(--agent-text-secondary, var(--color-text-tertiary)); line-height: 1.5; margin-bottom: 8px; }
.a2ui-fp-sug-title { font-size: var(--font-size-xs); font-weight: var(--font-weight-semibold); color: var(--agent-text-secondary, var(--color-text-tertiary)); margin-bottom: 4px; }
.a2ui-fp-sug-item { font-size: var(--font-size-sm); color: var(--agent-accent, var(--color-primary)); cursor: pointer; padding: 3px 0; transition: opacity 0.15s; }
.a2ui-fp-sug-item:hover { opacity: 0.8; }

.a2ui-code-block { background: var(--color-bg-base); border: 1px solid var(--agent-border, var(--color-border)); border-radius: 6px; overflow: hidden; }
.a2ui-cb-header { display: flex; justify-content: space-between; align-items: center; padding: 4px 10px; background: var(--color-bg-elevated); border-bottom: 1px solid var(--agent-border, var(--color-border)); }
.a2ui-cb-lang { font-size: var(--font-size-xs); color: var(--agent-text-tertiary, #888); text-transform: uppercase; }
.a2ui-cb-run { font-size: var(--font-size-xs); padding: 2px 8px; border-radius: 3px; border: 1px solid var(--agent-accent, var(--color-primary)); background: transparent; color: var(--agent-accent, var(--color-primary)); cursor: pointer; }
.a2ui-cb-run:hover { background: color-mix(in srgb, var(--color-primary) 10%, transparent); }
.a2ui-cb-code { padding: 10px; margin: 0; font-family: 'Fira Code', 'Consolas', monospace; font-size: var(--font-size-sm); color: var(--agent-text-secondary, var(--color-text-tertiary)); white-space: pre-wrap; overflow-x: auto; line-height: 1.5; }

.a2ui-entity-link { color: var(--agent-accent, var(--color-primary)); cursor: pointer; font-size: var(--font-size-sm); text-decoration: none; border-bottom: 1px dashed var(--agent-accent, var(--color-primary)); transition: opacity 0.15s; }
.a2ui-entity-link:hover { opacity: 0.8; }

.a2ui-svg-canvas { background: var(--agent-bg-tertiary, var(--color-bg-elevated)); border: 1px solid var(--agent-border, var(--color-border)); border-radius: var(--radius-md, 8px); padding: 10px; }
.a2ui-sc-title { font-size: var(--font-size-base); font-weight: var(--font-weight-semibold); color: var(--agent-text, var(--color-text-primary)); margin-bottom: 8px; }
.a2ui-sc-container { display: flex; justify-content: center; align-items: center; overflow: auto; max-height: 400px; }
.a2ui-sc-container svg { max-width: 100%; height: auto; }
</style>