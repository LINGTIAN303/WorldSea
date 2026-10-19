<template>
  <section class="entity" :id="`entity-${entity.type}`" data-field-section>
    <header class="entity-head">
      <span class="entity-name">{{ entity.label }}</span>
      <code class="entity-type">{{ entity.type }}</code>
      <span class="entity-plugin">{{ entity.pluginId }}</span>
      <span class="entity-count"><b>{{ fields.length }}</b> 字段</span>
      <button type="button" class="ghost entity-copy" @click="copyTable">复制整表</button>
      <span class="entity-traits">
        <code v-for="trait in entity.traits" :key="trait">{{ trait }}</code>
      </span>
    </header>
    <div class="entity-body">
      <div class="table-wrap">
        <table :id="`entity-${entity.type}-table`" class="field-table">
            <caption class="sr-only">{{ entity.label }}（{{ entity.type }}）字段表</caption>
            <thead>
              <tr>
                <th scope="col">字段（English）</th>
                <th scope="col">中文字段名</th>
                <th scope="col">类型</th>
                <th scope="col">必填</th>
                <th scope="col">来源</th>
                <th scope="col">选项 / 说明</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="field in fields"
                :id="`f-${entity.type}-${field.key}`"
                :key="field.key"
                class="field-row"
                :data-key="field.key"
                :data-label="field.label"
                :data-type="field.fieldType"
                :data-required="field.required ? '1' : '0'"
                :data-source="field.sourceKind"
                :data-search="field.search"
              >
                <td>
                  <div class="field-key">
                    <span>{{ field.key }}</span>
                    <button
                      type="button"
                      class="icon-btn copy-key"
                      :aria-label="`复制字段键 ${field.key}`"
                      title="复制字段键"
                      @click="copyKey(field.key)"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>
                    </button>
                  </div>
                </td>
                <td>{{ field.label }}</td>
                <td>
                  <span :class="['type-badge', `t-${typeClass(field.fieldType)}`]">{{ field.fieldType }}</span>
                  <span class="type-zh">{{ typeZh(field.fieldType) }}</span>
                </td>
                <td>
                  <span v-if="field.required" class="req">必填</span>
                  <span v-else class="muted">—</span>
                </td>
                <td><span :class="['src', `src-${field.sourceKind}`]">{{ field.sourceLabel }}</span></td>
                <td>
                  <template v-if="field.options && field.options.length <= 4">
                    <div class="opt-list">
                      <span v-for="option in (field.options ?? [])" :key="option.value" class="opt">
                        <code v-if="option.value !== option.label">{{ option.value }}</code>
                        {{ option.label }}
                      </span>
                    </div>
                  </template>
                  <details v-else-if="field.options?.length" class="opts">
                    <summary>{{ field.options?.length }} 个选项</summary>
                    <div class="opt-list">
                      <span v-for="option in (field.options ?? [])" :key="option.value" class="opt">
                        <code v-if="option.value !== option.label">{{ option.value }}</code>
                        {{ option.label }}
                      </span>
                    </div>
                  </details>
                  <span v-for="(note, index) in field.notes" :key="index" class="note" v-html="noteHtml(note)"></span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      <p v-if="note" class="section-note" v-html="noteHtml(note)"></p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { writeClipboard } from '../composables/clipboard'
import { ENTITY_NOTES } from '../model/entityNotes'
import { typeClass, typeZh } from '../model/fieldMeta'
import { noteHtml } from '../model/noteHtml'
import type { MatrixEntity, MatrixField } from '../model/types'

const props = defineProps<{
  entity: MatrixEntity
  fields: MatrixField[]
  notify: (message: string) => void
}>()

const note = computed(() => ENTITY_NOTES[props.entity.type] ?? '')



async function copyKey(key: string) {
  const ok = await writeClipboard(key)
  props.notify(ok ? `已复制 ${key}` : '复制失败')
}

async function copyTable() {
  const lines = ['字段\t中文名\t类型\t必填\t来源\t选项 / 说明']
  for (const field of props.fields) {
    const options = field.options?.length
      ? `选项：${(field.options ?? []).map(option => option.value === option.label ? option.label : `${option.value}→${option.label}`).join('、')}`
      : ''
    lines.push([
      field.key,
      field.label,
      field.fieldType,
      field.required ? '是' : '',
      field.sourceLabel,
      [...field.notes, options].filter(Boolean).join(' · '),
    ].join('\t'))
  }
  const ok = await writeClipboard(lines.join('\n'))
  props.notify(ok ? '已复制整表' : '复制失败')
}
</script>
