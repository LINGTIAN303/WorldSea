<template>
  <h2>关系类型</h2>
  <p class="lead">
    关系类型描述实体之间的边；source / target 与实体字段区交叉链接。
    <span class="muted">（<b>{{ relations.length }}</b> 条）</span>
  </p>
  <div class="table-wrap">
    <table id="relation-types-table">
      <caption class="sr-only">关系类型表</caption>
      <thead>
        <tr>
          <th scope="col">类型</th>
          <th scope="col">中文名</th>
          <th scope="col">源 → 目标</th>
          <th scope="col">逆关系</th>
          <th scope="col">对称</th>
          <th scope="col">领域</th>
          <th scope="col">属性数</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="relation in relations" :key="relation.type">
          <td><code>{{ relation.type }}</code></td>
          <td>{{ relation.label }}</td>
          <td>
            <template v-for="(type, index) in relation.sourceTypes" :key="`s-${type}`">
              <template v-if="index > 0"> / </template>
              <a v-if="isEntity(type)" :href="`#entity-${type}`"><code>{{ type }}</code></a>
              <code v-else>{{ type }}</code>
            </template>
            <span class="muted"> → </span>
            <template v-for="(type, index) in relation.targetTypes" :key="`t-${type}`">
              <template v-if="index > 0"> / </template>
              <a v-if="isEntity(type)" :href="`#entity-${type}`"><code>{{ type }}</code></a>
              <code v-else>{{ type }}</code>
            </template>
          </td>
          <td>{{ relation.inverseLabel }} <code>{{ relation.inverseType }}</code></td>
          <td>{{ relation.symmetric ? '是' : '否' }}</td>
          <td>{{ relation.domain ?? '—' }}</td>
          <td :class="{ 'is-zero': relation.propertyCount === 0 }">{{ relation.propertyCount }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import type { MatrixRelation } from '../model/types'

const props = defineProps<{
  relations: MatrixRelation[]
  entityTypes: Set<string>
}>()

function isEntity(type: string): boolean {
  return props.entityTypes.has(type)
}
</script>
