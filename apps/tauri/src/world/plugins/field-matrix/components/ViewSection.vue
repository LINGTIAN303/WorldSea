<template>
  <h2>视图</h2>
  <p class="lead">
    全部已注册视图；按所属芽关联实体类型。视图增删随 <code>pluginAPI.onViewChange</code> 刷新。
    <span class="muted">（<b>{{ views.length }}</b> 个）</span>
  </p>
  <div class="table-wrap">
    <table id="views-table">
      <caption class="sr-only">视图注册表</caption>
      <thead>
        <tr>
          <th scope="col">视图 id</th>
          <th scope="col">中文名</th>
          <th scope="col">所属芽</th>
          <th scope="col">实体类型</th>
          <th scope="col">工具条</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="view in views" :key="view.id">
          <td><code>{{ view.id }}</code></td>
          <td>{{ view.label }}</td>
          <td><code>{{ view.pluginId || '—' }}</code></td>
          <td>
            <template v-if="view.entityTypes.length">
              <template v-for="(type, index) in view.entityTypes" :key="type">
                <template v-if="index > 0"> / </template>
                <a :href="`#entity-${type}`"><code>{{ type }}</code></a>
              </template>
            </template>
            <span v-else class="muted">—</span>
          </td>
          <td><code>{{ view.toolbar }}</code></td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import type { MatrixView } from '../model/types'

defineProps<{ views: MatrixView[] }>()
</script>
