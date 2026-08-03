<template>
  <Transition name="confirm-fade">
    <div v-if="visible" class="font-install-confirm-overlay" @click.self="onReject">
      <div class="font-install-confirm-card">
        <div class="confirm-header">
          <WsIcon name="type" size="sm" />
          <span class="confirm-title">字体安装请求</span>
        </div>
        <div class="confirm-body">
          Agent 请求安装字体「<strong>{{ family }}</strong>」，是否允许？
        </div>
        <div class="confirm-actions">
          <button class="btn btn-reject" @click="onReject">拒绝</button>
          <button class="btn btn-allow" @click="onAllow">允许安装</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'

const visible = ref(false)
const family = ref('')
let resolveFn: ((value: boolean) => void) | null = null

function show(familyName: string): Promise<boolean> {
  family.value = familyName
  visible.value = true
  return new Promise((resolve) => {
    resolveFn = resolve
  })
}

function onAllow() {
  visible.value = false
  resolveFn?.(true)
  resolveFn = null
}

function onReject() {
  visible.value = false
  resolveFn?.(false)
  resolveFn = null
}

defineExpose({ show })
</script>

<style scoped>
.font-install-confirm-overlay {
  position: fixed;
  inset: 0;
  z-index: 10002;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
}
.font-install-confirm-card {
  background: var(--color-surface, #1e1e2e);
  border: 1px solid var(--color-border, #333);
  border-radius: 12px;
  padding: 20px 24px;
  max-width: 360px;
  width: 90%;
}
.confirm-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  color: var(--color-text, #e0e0e0);
}
.confirm-title {
  font-weight: 600;
  font-size: 15px;
}
.confirm-body {
  font-size: 14px;
  color: var(--color-text-secondary, #aaa);
  line-height: 1.6;
  margin-bottom: 16px;
}
.confirm-body strong {
  color: var(--color-primary, #6c5ce7);
}
.confirm-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
.btn {
  padding: 6px 16px;
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
  border: 1px solid var(--color-border, #333);
  transition: background 0.15s;
}
.btn-reject {
  background: transparent;
  color: var(--color-text-secondary, #aaa);
}
.btn-reject:hover {
  background: rgba(255, 255, 255, 0.06);
}
.btn-allow {
  background: var(--color-primary, #6c5ce7);
  color: #fff;
  border-color: transparent;
}
.btn-allow:hover {
  opacity: 0.9;
}
.confirm-fade-enter-active,
.confirm-fade-leave-active {
  transition: opacity 0.2s;
}
.confirm-fade-enter-from,
.confirm-fade-leave-to {
  opacity: 0;
}
</style>
