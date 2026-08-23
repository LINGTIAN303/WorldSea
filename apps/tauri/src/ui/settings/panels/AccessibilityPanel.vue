<template>
  <div class="set-card" v-show="match('动画效果 减弱 动态 动画 动效 消息 脉冲 状态 面板 侧边栏 弹窗 控件 启动 眩晕 降低 可访问 reduce motion animation accessibility')">
    <div class="set-card-title">动画效果</div>
    <div class="set-row">
      <span>减弱动态效果</span>
      <label class="set-toggle">
        <input type="checkbox" v-model="store.reduceMotion" />
        <span class="set-toggle-slider"></span>
      </label>
    </div>
    <p class="set-hint">开启后关闭全部界面动效（全局减弱）；关闭时保留动画，可按下述分组逐项关闭。</p>
    <div v-for="(label, key) in ANIMATION_GROUPS" :key="key" class="set-row">
      <span>{{ label }}</span>
      <label class="set-toggle">
        <input type="checkbox" :checked="!!store.animations[key]" @change="onAnimToggle(key, ($event.target as HTMLInputElement).checked)" />
        <span class="set-toggle-slider"></span>
      </label>
    </div>
    <p class="set-hint">关闭某类动画（如消息与对话）即禁用对应组件的动效，其余保持正常。</p>
  </div>
</template>

<script setup lang="ts">
import { useSettingsStore, ANIMATION_GROUPS } from '@worldsmith/entity-core'

const props = withDefaults(defineProps<{ searchQuery?: string }>(), { searchQuery: '' })

const store = useSettingsStore()

function match(keywords: string): boolean {
  if (!props.searchQuery) return true
  const q = props.searchQuery.toLowerCase()
  return keywords.toLowerCase().split(/\s+/).some((k) => q.includes(k))
}

/** 逐项开关：整体替换 animations 对象（触发 App 层根属性同步） */
function onAnimToggle(key: string, val: boolean): void {
  store.animations = { ...store.animations, [key]: val }
}
</script>

<style scoped>
.set-card {
  background: var(--content-bg, var(--color-bg-surface));
  border-radius: var(--radius-md);
  padding: 14px 16px;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.06), 0 0 0 1px var(--border, var(--color-border));
}
.set-card-title {
  font-weight: var(--font-weight-medium, 500);
  font-size: var(--font-size-sm);
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border, var(--color-border));
  margin-bottom: 6px;
}
.set-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 0;
  font-size: var(--font-size-sm);
  gap: 12px;
}
.set-toggle { position: relative; display: inline-flex; align-items: center; cursor: pointer; }
.set-toggle input { position: absolute; opacity: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; }
.set-toggle-slider {
  width: 34px; height: 20px; background: var(--border, var(--color-border));
  border-radius: 999px; position: relative; transition: background 0.2s;
}
.set-toggle-slider::after {
  content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px;
  background: #fff; border-radius: 50%; transition: transform 0.2s;
}
.set-toggle input:checked + .set-toggle-slider { background: var(--color-primary, #3b82f6); }
.set-toggle input:checked + .set-toggle-slider::after { transform: translateX(14px); }
.set-hint { margin: 6px 0 0; font-size: var(--font-size-xs); color: var(--text-tertiary, var(--color-text-tertiary)); }
</style>
