<template>
  <div v-if="insight" class="spd" role="region" :aria-label="`${insight.label}详情`">
    <div class="spd-head">
      <WsIcon :name="insight.icon" size="sm" class="spd-icon" />
      <span class="spd-name">{{ insight.label }}</span>
      <span class="spd-badge">{{ insight.source === 'external' ? '外部' : '内置' }}</span>
      <span class="spd-state">{{ insight.active ? '已启用' : '未启用' }}</span>
      <span class="spd-state">{{ runtimeLabel }}</span>
    </div>

    <div class="spd-meta">
      <span>域：{{ sproutDomainLabel(insight.domain) }}</span>
      <span v-if="insight.secondaryDomains.length">
        副域：{{ insight.secondaryDomains.map(sproutDomainLabel).join(' / ') }}
      </span>
    </div>

    <div class="spd-runtime">
      <template v-if="!insight.active">
        未启用 · 入口已隐藏（实体数据保留，仍可被其它芽引用）。
      </template>
      <template v-else-if="insight.runtime === 'rejected'">
        被拒：{{ insight.reason || '原因未记录' }}
      </template>
      <template v-else-if="insight.runtime !== 'loaded'">
        未装载，入口不可用。
      </template>
      <template v-else-if="insight.viewCount === 0">
        已装载，但没有注册侧栏视图。
      </template>
      <template v-else>入口视图：{{ insight.viewCount }} 个</template>
    </div>

    <div class="spd-deps">
      <section>
        <h4>出依赖 <span>{{ insight.outgoing.length }}</span></h4>
        <p v-if="insight.outgoing.length === 0" class="spd-empty">{{ emptyOutgoing }}</p>
        <ul v-else>
          <li v-for="item in insight.outgoing" :key="item.pluginId" :title="item.relations.join(' / ')">
            <span>{{ item.label }}</span>
            <em>{{ item.relations.length }}</em>
          </li>
        </ul>
      </section>
      <section>
        <h4>入依赖 <span>{{ insight.incoming.length }}</span></h4>
        <p v-if="insight.incoming.length === 0" class="spd-empty">暂无其它芽引用它。</p>
        <ul v-else>
          <li v-for="item in insight.incoming" :key="item.pluginId" :title="item.relations.join(' / ')">
            <span>{{ item.label }}</span>
            <em>{{ item.relations.length }}</em>
          </li>
        </ul>
      </section>
    </div>

    <div class="spd-foot">
      <span v-if="insight.requires.length">服务依赖：{{ insight.requires.join(' / ') }}</span>
      <span v-if="insight.dependencyLimited">外部插件未声明类型归属；依赖仅统计已装载类型。</span>
      <span>依赖为类型级关系（设计意图），不是当前项目实体边数。</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import { sproutDomainLabel, type SproutInsight } from '@/world/sproutInsights'

const props = defineProps<{ insight: SproutInsight | null }>()

const runtimeLabel = computed(() => (
  props.insight?.runtime === 'loaded'
    ? '已装载'
    : props.insight?.runtime === 'rejected'
      ? '被拒'
      : '未装载'
))

const emptyOutgoing = computed(() => (
  (props.insight?.entityTypes.length ?? 0) === 0
    ? '纯视图芽：不注册实体类型，无跨芽实体关系。'
    : '没有向外的关系声明。'
))
</script>

<style scoped>
.spd { margin: 4px 0 2px; padding: 10px 12px; border: 1px solid var(--border, var(--color-border)); border-radius: var(--radius-md, 8px); background: var(--bg-secondary, var(--color-bg-elevated)); }
.spd-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
.spd-icon { color: var(--primary, var(--color-primary)); }
.spd-name { font-size: var(--font-size-sm); font-weight: var(--font-weight-medium, 500); }
.spd-badge, .spd-state { font-size: var(--text-micro-font-size, 10px); color: var(--text-tertiary, var(--color-text-tertiary)); }
.spd-badge { padding: 1px 5px; border-radius: 999px; background: var(--bg, var(--color-bg-surface)); }
.spd-meta { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 6px; font-size: var(--font-size-xs, 12px); color: var(--text-secondary, var(--color-text-secondary)); }
.spd-runtime { margin-top: 4px; font-size: var(--font-size-xs, 12px); color: var(--text-secondary, var(--color-text-secondary)); }
.spd-deps { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 8px; }
.spd-deps h4 { margin: 0 0 4px; font-size: var(--font-size-xs, 12px); color: var(--text-tertiary, var(--color-text-tertiary)); font-weight: var(--font-weight-medium, 500); }
.spd-deps h4 span { font-variant-numeric: tabular-nums; }
.spd-deps ul { display: flex; flex-wrap: wrap; gap: 4px; margin: 0; padding: 0; list-style: none; }
.spd-deps li { display: inline-flex; align-items: center; gap: 4px; padding: 2px 7px; border-radius: 999px; background: var(--bg, var(--color-bg-surface)); font-size: var(--font-size-xs, 12px); }
.spd-deps li em { font-style: normal; color: var(--text-tertiary, var(--color-text-tertiary)); font-variant-numeric: tabular-nums; }
.spd-empty { margin: 0; font-size: var(--font-size-xs, 12px); color: var(--text-tertiary, var(--color-text-tertiary)); }
.spd-foot { display: flex; flex-direction: column; gap: 2px; margin-top: 8px; font-size: var(--text-micro-font-size, 10px); color: var(--text-tertiary, var(--color-text-tertiary)); }
@media (max-width: 720px) { .spd-deps { grid-template-columns: 1fr; } }
</style>
