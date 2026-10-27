<template>
  <div class="isc">
    <div class="sc-head">
      <span>作用范围</span>
      <span class="isc-sub">项目 &gt; 全局 &gt; 默认</span>
    </div>

    <div class="set-row">
      <span>本项目跟随全局图标</span>
      <label class="set-toggle" title="关闭后，本项目未单独设置的槽位使用芽/实体类型默认">
        <input
          type="checkbox"
          :checked="followGlobal"
          @change="onToggleFollow(($event.target as HTMLInputElement).checked)"
        />
        <span class="set-toggle-slider" />
      </label>
    </div>
    <p class="set-hint">
      {{ followGlobal
        ? '未单独设置的槽位会跟随全局；本项目单独设置过的图标仍优先。'
        : '本项目已独立：未单独设置的槽位使用芽/实体类型默认，全局改动不影响本项目。' }}
    </p>

    <div class="isc-section">
      <div class="isc-section-head">
        <span>本项目</span>
        <span class="isc-count">{{ projectCount }} 项</span>
      </div>
      <div class="isc-actions">
        <button type="button" class="set-btn" :disabled="projectCount === 0" @click="emit('reset-project')">
          清除本项目全部图标
        </button>
        <button type="button" class="set-btn isc-danger" @click="emit('reset-defaults')">
          回到芽默认
        </button>
      </div>
      <p class="set-hint">「回到芽默认」会清空本项目覆盖并停止跟随全局，所有槽位回到芽/实体类型默认。</p>
    </div>

    <div class="isc-section">
      <div class="isc-section-head">
        <span>全局</span>
        <span class="isc-count">{{ globalCount }} 项</span>
      </div>
      <div class="isc-actions">
        <button type="button" class="set-btn isc-danger" :disabled="globalCount === 0" @click="emit('clear-global')">
          清除全局图标
        </button>
      </div>
      <p class="set-hint">全局改动会影响所有跟随全局的项目；已独立的项目保留自己的覆盖。</p>
      <p v-if="!followGlobal && ignoredGlobalCount > 0" class="set-hint isc-warn">
        全局有 {{ ignoredGlobalCount }} 项设置，本项目当前未跟随。
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  followGlobal: boolean
  projectCount: number
  globalCount: number
  ignoredGlobalCount: number
}>()

const emit = defineEmits<{
  'toggle-follow': [value: boolean]
  'reset-project': []
  'reset-defaults': []
  'clear-global': []
}>()

function onToggleFollow(value: boolean): void {
  emit('toggle-follow', value)
}
</script>

<style scoped>
.isc { display: flex; flex-direction: column; }
.isc-sub { font-size: var(--text-micro-font-size, 10px); color: var(--text-tertiary); text-transform: none; letter-spacing: normal; font-weight: var(--font-weight-normal, 400); }
.isc-section { margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--border, var(--color-border)); }
.isc-section-head { display: flex; align-items: baseline; justify-content: space-between; font-size: var(--font-size-sm); color: var(--text-color, var(--color-text)); }
.isc-count { font-size: var(--text-micro-font-size, 10px); color: var(--text-tertiary); }
.isc-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.isc-danger:hover:not(:disabled) { border-color: var(--danger, var(--color-danger)); color: var(--danger, var(--color-danger)); }
.isc-warn { color: var(--warning, var(--color-warning)); }
</style>
