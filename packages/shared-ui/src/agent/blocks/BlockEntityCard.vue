<template>
  <div class="block-entity-card">
    <div class="block-toggle" @click="expanded = !expanded">
      <WsIcon :name="entityIcon" size="xs" class="block-icon" />
      <span class="block-title">{{ block.entityType }}: {{ block.name }}</span>
      <span class="block-meta">{{ block.entityType }}</span>
      <span class="block-arrow">{{ expanded ? '▾ 点击收起' : '▸ 点击展开' }}</span>
    </div>
    <Transition name="block-expand">
      <div v-if="expanded" class="block-content">
        <div class="ec-header">
          <WsIcon :name="entityIcon" size="md" class="ec-icon" />
          <div class="ec-info">
            <span class="ec-name">{{ block.name }}</span>
            <span class="ec-type">{{ block.entityType }}</span>
          </div>
          <button
            class="ec-open-btn"
            title="在浮窗中打开详情"
            @click.stop="onOpenDetail"
          >
            <WsIcon name="expand" size="xs" />
            <span>详情</span>
          </button>
        </div>
        <p v-if="block.description" class="ec-desc">{{ block.description }}</p>
        <div v-if="block.tags?.length" class="ec-tags">
          <span v-for="tag in block.tags" :key="tag" class="ec-tag">{{ tag }}</span>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import { entitySchemaRegistry } from '@worldsmith/entity-core'
import type { EntityCardBlock } from '@worldsmith/agent-runtime'

const props = defineProps<{
  block: EntityCardBlock
}>()

const emit = defineEmits<{
  /** 用户点击"详情"按钮，请求在浮窗中打开实体详情 */
  action: [event: { blockId: string; action: 'open-detail'; data: { entityId: string; entityType: string; name: string; triggerRect: DOMRect } }]
}>()

const expanded = ref(false)

/** 通过 entitySchemaRegistry 获取图标名，统一走 WsIcon 体系（项目规则禁止 emoji 当图标） */
const entityIcon = computed(() => entitySchemaRegistry.getIconName(props.block.entityType))

/** 点击"详情"按钮：向上发射 open-detail 动作，由 AgentChat 接收并打开 EntityMiniPanel 浮窗 */
function onOpenDetail(e: MouseEvent) {
  const triggerRect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  emit('action', {
    blockId: props.block.id,
    action: 'open-detail',
    data: {
      entityId: props.block.entityId,
      entityType: props.block.entityType,
      name: props.block.name,
      triggerRect,
    },
  })
}
</script>

<style scoped>
.block-entity-card { margin: 4px 0; }
.block-toggle {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px; border-radius: 14px; cursor: pointer;
  background: rgba(108,92,231,0.08); border: 1px solid rgba(108,92,231,0.2);
  transition: border-color 0.15s; font-size: 12px;
}
.block-toggle:hover { border-color: rgba(108,92,231,0.5); }
.block-icon { color: var(--agent-accent, #b388ff); flex-shrink: 0; }
.block-title { font-size: 12px; color: var(--agent-accent, #b388ff); font-weight: 500; }
.block-meta { font-size: 11px; color: var(--agent-text-tertiary, #888); }
.block-arrow { font-size: 11px; color: var(--agent-text-tertiary, #888); }
.block-content {
  padding: 10px 12px; margin-top: 4px;
  background: rgba(0,0,0,0.15); border: 1px solid rgba(108,92,231,0.2);
  border-radius: 8px;
}
.ec-header { display: flex; align-items: center; gap: 8px; }
.ec-icon { color: var(--agent-accent, #b388ff); flex-shrink: 0; }
.ec-info { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.ec-name { font-size: 14px; font-weight: 600; color: var(--agent-text, #e0e0e0); }
.ec-type { font-size: 11px; color: var(--agent-text-tertiary, #888); }
.ec-open-btn {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 3px 8px; border-radius: 4px; cursor: pointer;
  background: transparent; border: 1px solid var(--agent-border, rgba(108,92,231,0.3));
  color: var(--agent-text-secondary, #aaa); font-size: 11px;
  transition: all 0.15s; flex-shrink: 0;
}
.ec-open-btn:hover {
  background: rgba(108,92,231,0.12);
  border-color: var(--agent-accent, #b388ff);
  color: var(--agent-accent, #b388ff);
}
.ec-desc { font-size: 12px; color: var(--agent-text-secondary, #aaa); margin: 6px 0 0; line-height: 1.4; }
.ec-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.ec-tag {
  font-size: 11px; padding: 1px 6px; border-radius: 3px;
  background: rgba(108,92,231,0.15); color: var(--agent-accent, #b388ff);
}
.block-expand-enter-active, .block-expand-leave-active {
  transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease, opacity 0.2s ease, filter 0.2s ease; overflow: hidden;
}
.block-expand-enter-from, .block-expand-leave-to {
  opacity: 0;
}
</style>
