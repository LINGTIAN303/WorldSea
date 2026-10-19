<template>
  <h2>Trait × 实体类型矩阵</h2>
  <p class="lead">✓ = 该实体类型声明了该 Trait；— = 未声明。Trait 的字段明细见下方“通用字段组”。</p>
  <div class="matrix-wrap">
    <table class="matrix">
      <caption class="sr-only">Trait 与实体类型覆盖矩阵</caption>
      <thead>
        <tr>
          <th scope="col">实体类型</th>
          <th v-for="trait in traits" :key="trait.id" scope="col"><code>{{ trait.id }}</code></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="entity in entities" :key="entity.type">
          <td><a :href="`#entity-${entity.type}`"><code>{{ entity.type }}</code></a></td>
          <td v-for="trait in traits" :key="trait.id" :class="entity.traits.includes(trait.id) ? 'yes' : 'no'">
            {{ entity.traits.includes(trait.id) ? '✓' : '—' }}
          </td>
        </tr>
        <tr>
          <td>使用数</td>
          <td v-for="trait in traits" :key="trait.id">{{ trait.usage }}</td>
        </tr>
      </tbody>
    </table>
  </div>
  <p class="matrix-legend">
    <span><b class="yes" style="color: var(--accent-strong)">✓</b> 已声明</span>
    <span><b class="no">—</b> 未声明</span>
    <span>使用数 = 声明该 Trait 的实体类型数量</span>
  </p>
  <div class="table-wrap" style="margin-top: 16px">
    <table class="trait-table">
      <caption class="sr-only">原子 Trait 字段明细</caption>
      <thead>
        <tr>
          <th scope="col">Trait</th>
          <th scope="col">中文名</th>
          <th scope="col">使用数</th>
          <th scope="col">字段（English / 中文 / 类型）</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="trait in traits" :key="trait.id">
          <td><code>{{ trait.id }}</code></td>
          <td>{{ trait.label }}</td>
          <td>{{ trait.usage }}</td>
          <td>
            <span v-for="(field, index) in trait.fields" :key="field.key">
              <template v-if="index > 0">；</template>
              <code>{{ field.key }}</code> / {{ field.label }} / {{ typeZh(field.fieldType) }}
            </span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { typeZh } from '../model/fieldMeta'
import type { MatrixEntity, MatrixTrait } from '../model/types'

defineProps<{
  traits: MatrixTrait[]
  entities: MatrixEntity[]
}>()
</script>
