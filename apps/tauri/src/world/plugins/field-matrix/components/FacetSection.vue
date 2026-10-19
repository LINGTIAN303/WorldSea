<template>
  <h2>Facet 字段</h2>
  <p class="lead">
    Facet 不是独立实体，没有独立 ID，数据挂在 <code>item.facets[&lt;facetId&gt;]</code> 下；<code>official.weapons</code> / <code>official.apparel</code> 只提供视图筛选。
    <span class="muted">（<b>{{ totalFields }}</b> 个字段）</span>
  </p>
  <div v-for="facet in facets" :key="facet.id" class="facet-card">
    <div class="facet-head">
      <strong>{{ facet.label }}</strong>
      <code>{{ facet.id }}</code>
      <span class="muted">宿主 {{ facet.hostTypes.join(' / ') }} · {{ facet.fields.length }} 字段</span>
      <button type="button" class="ghost" style="margin-left: auto" @click="copyTable(facet)">复制整表</button>
    </div>
    <div class="facet-body">
      <div class="table-wrap">
        <table :id="`facet-${facet.id}-table`" class="field-table">
          <caption class="sr-only">{{ facet.label }}字段表</caption>
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
            <tr v-for="field in facet.fields" :key="field.key" class="field-row">
              <td>
                <div class="field-key">
                  <span>{{ field.key }}</span>
                  <button type="button" class="icon-btn copy-key" :aria-label="`复制字段键 ${field.key}`" title="复制字段键" @click="copyKey(field.key)">
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
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { writeClipboard } from '../composables/clipboard'
import { typeClass, typeZh } from '../model/fieldMeta'
import { noteHtml } from '../model/noteHtml'
import type { MatrixFacet } from '../model/types'

const props = defineProps<{
  facets: MatrixFacet[]
  notify: (message: string) => void
}>()

const totalFields = computed(() => props.facets.reduce((sum, facet) => sum + facet.fields.length, 0))

async function copyKey(key: string) {
  const ok = await writeClipboard(key)
  props.notify(ok ? `已复制 ${key}` : '复制失败')
}

async function copyTable(facet: MatrixFacet) {
  const lines = ['字段\t中文名\t类型\t必填\t来源\t选项 / 说明']
  for (const field of facet.fields) {
    const options = field.options?.length
      ? `选项：${(field.options ?? []).map(option => option.value === option.label ? option.label : `${option.value}→${option.label}`).join('、')}`
      : ''
    lines.push([
      field.key, field.label, field.fieldType, field.required ? '是' : '',
      field.sourceLabel, [...field.notes, options].filter(Boolean).join(' · '),
    ].join('\t'))
  }
  const ok = await writeClipboard(lines.join('\n'))
  props.notify(ok ? '已复制整表' : '复制失败')
}
</script>
