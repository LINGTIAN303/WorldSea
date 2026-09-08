<template>
  <!-- 空对话欢迎语 -->
  <div class="chat-empty">
    <div class="empty-icon">
      <!-- #icon 插槽：宿主可注入品牌 logo 替换默认图标 -->
      <slot name="icon"><WsIcon name="profile" size="lg" /></slot>
    </div>
    <div class="empty-title">WorldSea Agent</div>
    <!-- #hint 插槽：宿主可注入项目选择器（项目=目录，2026-09-03）；默认保留原文案 -->
    <div class="empty-hint"><slot name="hint">我可以帮你管理世界观实体和关系。试试输入 / 查看可用命令</slot></div>
  </div>
</template>

<script setup lang="ts">
import { WsIcon } from '@worldsea/ui-kit'
</script>

<style scoped>
.chat-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  text-align: center;
}

.empty-icon { font-size: var(--icon-xl); margin-bottom: 12px }
.empty-title {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
  color: var(--agent-text);
  margin-bottom: 8px;
  font-family: var(--agent-font);
}
.empty-hint {
  font-size: var(--font-size-sm);
  color: var(--agent-text-secondary);
  line-height: 1.5;
  font-family: var(--agent-font);
}
</style>
