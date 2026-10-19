<template>
  <h2>系统级 / 顶层字段</h2>
  <p class="lead">
    所有实体都具备以下顶层结构（不属于某个芽的 ownFields）。
    <span class="muted">（<b>{{ fields.length }}</b> 个字段）</span>
  </p>
  <div class="table-wrap">
    <table id="system-table">
      <caption class="sr-only">系统级字段表</caption>
      <thead>
        <tr>
          <th scope="col">字段（English）</th>
          <th scope="col">中文名</th>
          <th scope="col">类型</th>
          <th scope="col">来源</th>
          <th scope="col">说明</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="field in fields" :key="field.key" class="field-row">
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
            <span class="type-zh">系统字段</span>
          </td>
          <td><span class="src src-system">{{ field.sourceLabel }}</span></td>
          <td>
            <span v-for="(note, index) in field.notes" :key="index" class="note" v-html="noteHtml(note)"></span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
  <div style="margin-top: 10px">
    <button type="button" class="ghost" @click="copyTable">复制整表</button>
  </div>
</template>

<script setup lang="ts">
import { writeClipboard } from '../composables/clipboard'
import { typeClass } from '../model/fieldMeta'
import { noteHtml } from '../model/noteHtml'
import type { MatrixField } from '../model/types'

const props = defineProps<{
  fields: MatrixField[]
  notify: (message: string) => void
}>()

async function copyKey(key: string) {
  const ok = await writeClipboard(key)
  props.notify(ok ? `已复制 ${key}` : '复制失败')
}

async function copyTable() {
  const lines = ['字段\t中文名\t类型\t来源\t说明']
  for (const field of props.fields) {
    lines.push([field.key, field.label, field.fieldType, field.sourceLabel, field.notes.join(' · ')].join('\t'))
  }
  const ok = await writeClipboard(lines.join('\n'))
  props.notify(ok ? '已复制整表' : '复制失败')
}
</script>
