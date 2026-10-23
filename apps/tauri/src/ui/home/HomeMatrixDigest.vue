<template>
  <section class="home-section home-matrix-section">
    <header class="home-section-head">
      <h2>字段矩阵</h2>
      <span class="home-section-note">当前注册 Schema</span>
    </header>
    <div class="home-matrix-scroll" tabindex="0" role="region" aria-label="字段矩阵表格，可横向滚动查看">
      <table class="home-matrix">
        <caption class="home-sr-only">实体类型字段与关系统计</caption>
        <thead>
          <tr>
            <th scope="col">实体类型</th>
            <th scope="col">所属芽</th>
            <th scope="col" class="is-num">字段</th>
            <th scope="col" class="is-num">必填</th>
            <th scope="col" class="is-num">关系类型</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.type">
            <td>{{ r.label }}</td>
            <td>{{ r.sproutLabel }}</td>
            <td class="is-num">{{ r.fieldCount }}</td>
            <td class="is-num">{{ r.requiredCount }}</td>
            <td class="is-num">{{ r.relationTypeCount }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <footer class="home-matrix-foot">
      <span>{{ stats.buds }} 芽 · {{ stats.entities }} 类型 · {{ stats.instances }} 字段 · {{ relationTypeCount }} 关系类型</span>
      <TuiButton v-if="matrixViewId" size="sm" variant="secondary" icon="arrow-right" @click="emit('open')">
        查看完整字段矩阵
      </TuiButton>
      <span v-else class="home-muted">启用字段矩阵芽后可查看完整矩阵</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { TuiButton } from '@worldsea/ui-kit'
import type { FieldMatrixStats } from '@/world/plugins/field-matrix/model/types'
import type { HomeMatrixRow } from './homeData'

defineProps<{
  rows: HomeMatrixRow[]
  stats: FieldMatrixStats
  relationTypeCount: number
  matrixViewId: string | null
}>()
const emit = defineEmits<{ open: [] }>()
</script>
