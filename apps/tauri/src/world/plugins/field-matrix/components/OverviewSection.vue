<template>
  <h2>总览</h2>
  <p class="lead">按芽 / 实体类型查阅字段。字段 = <b>Trait 字段 + 芽自有字段</b>；中文名是展示标签，英文 key 是数据键。</p>
  <div class="stat-grid">
    <div class="stat"><b>{{ stats.buds }}</b><span>注册芽</span></div>
    <div class="stat"><b>{{ stats.entities }}</b><span>实体类型</span></div>
    <div class="stat"><b>{{ stats.instances }}</b><span>字段实例</span></div>
    <div class="stat"><b>{{ stats.keys }}</b><span>唯一字段键</span></div>
    <div class="stat"><b>{{ stats.traits }}</b><span>原子 Trait</span></div>
    <div class="stat"><b>{{ stats.facets }}</b><span>Facet</span></div>
  </div>
  <div class="table-wrap">
    <table class="overview-table">
      <caption class="sr-only">芽与实体类型总览</caption>
      <thead>
        <tr>
          <th scope="col">芽（插件 id）</th>
          <th scope="col">实体类型</th>
          <th scope="col">Traits</th>
          <th scope="col">字段数</th>
          <th scope="col">特例</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="entity in entities" :key="entity.type">
          <td><code>{{ entity.pluginId || '—' }}</code></td>
          <td>
            <a class="entity-link" :href="`#entity-${entity.type}`">{{ entity.label }}</a>
            <code>{{ entity.type }}</code>
          </td>
          <td>
            <span v-if="entity.traits.length" class="traits-inline">
              <code v-for="trait in entity.traits" :key="trait">{{ trait }}</code>
            </span>
            <span v-else class="muted">—</span>
          </td>
          <td><b>{{ entity.fields.length }}</b></td>
          <td>{{ entity.facets.length ? `Facet：${entity.facets.join(' / ')}` : '' }}</td>
        </tr>
      </tbody>
    </table>
  </div>
  <p class="section-note">点击实体名跳到字段表。运行时字段包含项目级 schema 覆盖与用户自定义字段。</p>
</template>

<script setup lang="ts">
import type { FieldMatrixStats, MatrixEntity } from '../model/types'

defineProps<{
  stats: FieldMatrixStats
  entities: MatrixEntity[]
}>()
</script>
