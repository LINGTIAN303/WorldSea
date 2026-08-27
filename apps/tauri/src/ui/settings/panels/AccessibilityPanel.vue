<template>
  <CardDeck :count="1" :flat="!!searchQuery" @change="(i) => emit('card-change', i)" ref="deckRef">
    <template #card="{ idx, cls }">
      <div class="set-card deck-card" :class="cls" :data-index="idx" v-show="match('动画效果 减弱 动态 动画 动效 消息 脉冲 状态 面板 侧边栏 弹窗 控件 启动 眩晕 降低 可访问 reduce motion animation accessibility')">
        <div class="sc-head">动画效果</div>
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
  </CardDeck>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { CardDeck } from '@worldsmith/ui-kit'
import { useSettingsStore, ANIMATION_GROUPS } from '@worldsmith/entity-core'

const props = withDefaults(defineProps<{ searchQuery?: string }>(), { searchQuery: '' })
const emit = defineEmits<{ 'card-change': [index: number] }>()

const store = useSettingsStore()
const deckRef = ref<InstanceType<typeof CardDeck> | null>(null)

function match(keywords: string): boolean {
  if (!props.searchQuery) return true
  const q = props.searchQuery.toLowerCase()
  return keywords.toLowerCase().split(/\s+/).some((k) => q.includes(k))
}

/** 逐项开关：整体替换 animations 对象（触发 App 层根属性同步） */
function onAnimToggle(key: string, val: boolean): void {
  store.animations = { ...store.animations, [key]: val }
}

defineExpose({ goToCard: (i: number) => deckRef.value?.goToCard(i) })
</script>

<style scoped>
.set-card { background: var(--content-bg, var(--color-bg-surface)); border-radius: var(--radius-md); padding: 14px 16px; box-shadow: 0 1px 6px rgba(0,0,0,0.06), 0 0 0 1px var(--border, var(--color-border)); }
.sc-head { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--text-tertiary, var(--color-text-tertiary)); margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
.set-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; font-size: var(--font-size-sm); gap: 12px; }
.set-toggle { position: relative; display: inline-block; width: 36px; height: 20px; cursor: pointer; flex-shrink: 0; }
.set-toggle input { opacity: 0; width: 0; height: 0; position: absolute; }
.set-toggle-slider { position: absolute; inset: 0; background: var(--border, var(--color-border)); border-radius: 20px; transition: background 0.2s; }
.set-toggle-slider::before { content: ''; position: absolute; width: 14px; height: 14px; left: 3px; top: 3px; background: var(--color-bg-surface); border-radius: 50%; transition: transform 0.2s; }
.set-toggle input:checked + .set-toggle-slider { background: var(--primary, var(--color-primary)); }
.set-toggle input:checked + .set-toggle-slider::before { transform: translateX(16px); }
.set-hint { margin: 6px 0 0; font-size: var(--font-size-xs); color: var(--text-tertiary, var(--color-text-tertiary)); }
</style>
