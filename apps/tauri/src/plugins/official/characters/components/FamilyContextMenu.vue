<template>
  <div v-if="visible" class="fcm-menu" :style="menuStyle" @click.stop>
    <button class="fcm-item" @click="action('addParent')">↑ 添加父母</button>
    <button class="fcm-item" @click="action('addChild')">↓ 添加子女</button>
    <button class="fcm-item" @click="action('addSpouse')"><WsIcon name="character" size="xs" /> 添加配偶</button>
    <button class="fcm-item" @click="action('addSibling')"><WsIcon name="character" size="xs" /> 添加兄弟姐妹</button>
    <button class="fcm-item" @click="action('addMentor')"><WsIcon name="star" size="xs" /> 添加师徒关系</button>
    <div class="fcm-divider"></div>
    <button class="fcm-item fcm-item-danger" @click="action('deleteRelation')">✕ 删除关系</button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'

const props = defineProps<{
  visible: boolean
  x: number
  y: number
}>()

const emit = defineEmits<{
  action: [type: string]
  close: []
}>()

const menuStyle = computed(() => ({
  left: `${props.x}px`,
  top: `${props.y}px`,
}))

function action(type: string) {
  emit('action', type)
  emit('close')
}
</script>

<style scoped>
.fcm-menu {
  position: absolute;
  z-index: 200;
  background: var(--card-bg, #fff);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 8px;
  padding: 4px 0;
  min-width: 160px;
  box-shadow: 0 6px 16px rgba(0,0,0,0.18);
}
.fcm-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 7px 14px;
  font-size: var(--font-size-sm);
  color: var(--text-color);
  background: none;
  border: none;
  cursor: pointer;
}
.fcm-item:hover { background: var(--bg-secondary, #f5f5f5); }
.fcm-item-danger { color: #e74c3c; }
.fcm-divider { height: 1px; background: var(--border-color); margin: 4px 0; }
</style>

