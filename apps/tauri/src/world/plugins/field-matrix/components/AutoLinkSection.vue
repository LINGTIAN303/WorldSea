<template>
  <h2>AutoLink 运转</h2>
  <p class="lead">
    只读观测 AutoLink 的策略、潜在链接、决策与事件流；不改变 AutoLink 行为，也不对其应用 AutoLink。
  </p>
  <div class="stat-grid">
    <div class="stat" :class="{ zero: strategies.length === 0 }"><b>{{ strategies.length }}</b><span>策略</span></div>
    <div class="stat" :class="{ zero: unresolvedLinks.length === 0 }"><b>{{ unresolvedLinks.length }}</b><span>未处理链接</span></div>
    <div class="stat" :class="{ zero: resolvedLinks.length === 0 }"><b>{{ resolvedLinks.length }}</b><span>已处理链接</span></div>
    <div class="stat" :class="{ zero: decisions.length === 0 }"><b>{{ decisions.length }}</b><span>决策</span></div>
    <div class="stat" :class="{ zero: mappings.length === 0 }"><b>{{ mappings.length }}</b><span>字段映射</span></div>
  </div>
  <div class="al-stage-grid">
    <div v-for="stage in stageToggles" :key="stage.id" class="al-stage">
      <div>
        <strong>{{ stage.label }}</strong>
        <span>{{ stage.detail }}</span>
      </div>
      <span :class="['al-state', stage.enabled ? 'on' : 'off']">{{ stage.enabled ? '开' : '关' }}</span>
    </div>
  </div>
  <div class="al-columns">
    <div class="al-panel">
      <div class="al-panel-head">
        <h3>事件流</h3>
        <div class="al-actions">
          <button type="button" class="ghost" @click="togglePause">{{ paused ? '继续' : '暂停' }}</button>
          <button type="button" class="ghost" @click="clearEvents">清空</button>
        </div>
      </div>
      <div class="al-events">
        <div v-for="event in events" :key="event.id" class="al-event">
          <span class="al-time">{{ formatTime(event.at) }}</span>
          <span class="al-kind">{{ event.kind }}</span>
          <span class="al-summary" :title="event.summary">{{ event.summary }}</span>
        </div>
        <p v-if="events.length === 0" class="muted">暂无事件；编辑实体或处理关联建议后出现。</p>
      </div>
    </div>
    <div class="al-panel">
      <h3>策略 / 语义标签 / 字段映射</h3>
      <h4>策略</h4>
      <ul class="al-list">
        <li v-for="(strategy, index) in strategies" :key="`${strategy.hint}-${index}`">
          <code>{{ strategy.hint }}</code> → {{ strategy.matchTargets.join(' / ') }} · {{ strategy.relationType }}
        </li>
      </ul>
      <h4>语义标签</h4>
      <ul class="al-list">
        <li v-for="hint in hints" :key="hint.hint">
          <code>{{ hint.hint }}</code> {{ hint.description }}
        </li>
      </ul>
      <h4>字段映射</h4>
      <ul class="al-list">
        <li v-for="mapping in mappings" :key="mapping.key">
          <code>{{ mapping.key }}</code> → {{ mapping.targetType ?? mapping.hint }} · {{ mapping.relationType }}
        </li>
        <li v-if="mappings.length === 0" class="muted">暂无用户字段映射</li>
      </ul>
    </div>
  </div>
  <h3>潜在链接</h3>
  <div class="table-wrap">
    <table id="auto-link-table">
      <caption class="sr-only">AutoLink 潜在链接</caption>
      <thead>
        <tr>
          <th scope="col">源字段</th>
          <th scope="col">目标类型</th>
          <th scope="col">语义标签</th>
          <th scope="col">关系</th>
          <th scope="col">分数</th>
          <th scope="col">状态</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="link in links" :key="link.id">
          <td><code>{{ link.sourceFieldKey }}</code></td>
          <td><code>{{ link.targetEntityType }}</code></td>
          <td><code>{{ link.hint }}</code></td>
          <td><code>{{ link.relationType }}</code></td>
          <td>{{ link.score.toFixed(2) }}</td>
          <td>
            <span v-if="link.resolved" class="muted">已处理{{ link.decision ? ` · ${link.decision}` : '' }}</span>
            <span v-else>未处理</span>
          </td>
        </tr>
        <tr v-if="links.length === 0"><td colspan="6" class="muted">暂无潜在链接</td></tr>
      </tbody>
    </table>
  </div>
  <h3>决策</h3>
  <div class="table-wrap">
    <table id="auto-link-decisions-table">
      <caption class="sr-only">AutoLink 决策记录</caption>
      <thead>
        <tr>
          <th scope="col">源字段</th>
          <th scope="col">目标实体</th>
          <th scope="col">关系</th>
          <th scope="col">决策</th>
          <th scope="col">时间</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="decision in decisions" :key="`${decision.sourceEntityId}-${decision.sourceFieldKey}-${decision.targetEntityId}-${decision.relationType}`">
          <td><code>{{ decision.sourceFieldKey }}</code></td>
          <td><code>{{ decision.targetEntityId }}</code></td>
          <td><code>{{ decision.relationType }}</code></td>
          <td>{{ decision.decision }}</td>
          <td>{{ formatTime(decision.decidedAt) }}</td>
        </tr>
        <tr v-if="decisions.length === 0"><td colspan="5" class="muted">暂无决策</td></tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { useAutoLinkObserver } from '../composables/useAutoLinkObserver'

const {
  events, links, decisions, strategies, hints, mappings,
  unresolvedLinks, resolvedLinks, stageToggles, paused, togglePause, clearEvents,
} = useAutoLinkObserver()

function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString('zh-CN', { hour12: false })
}
</script>
