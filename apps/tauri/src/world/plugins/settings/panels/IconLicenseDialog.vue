<template>
  <TuiModal :show="show" title="图标来源与许可" size="md" @close="emit('close')">
    <div class="il-body">
      <p class="il-lead">
        内置图标库来自以下开源项目。CC BY 图标需要在应用内保留来源与许可说明；MIT / ISC / Apache 2.0 为宽松许可。
      </p>
      <div class="il-list">
        <div v-for="pack in ICON_PACKS" :key="pack.id" class="il-row">
          <div class="il-main">
            <span class="il-name">{{ pack.label }}</span>
            <span class="il-style">{{ pack.style }}</span>
          </div>
          <span class="il-license" :class="{ 'is-cc': pack.license.startsWith('CC BY') }">{{ pack.license }}</span>
          <a
            v-if="pack.source"
            class="il-link"
            :href="pack.source"
            target="_blank"
            rel="noreferrer"
          >来源</a>
        </div>
      </div>
      <p class="il-foot">
        自定义图标由用户上传，仅存放在本地项目或全局图标目录，不随内置库分发。
      </p>
    </div>
  </TuiModal>
</template>

<script setup lang="ts">
import { ICON_PACKS } from '@worldsea/ui-kit'
import TuiModal from '@/components/ui/TuiModal.vue'

defineProps<{ show: boolean }>()
const emit = defineEmits<{ close: [] }>()
</script>

<style scoped>
.il-body { display: flex; flex-direction: column; gap: 10px; }
.il-lead { margin: 0; font-size: var(--font-size-xs, 12px); line-height: 1.7; color: var(--text-secondary); }
.il-list { display: flex; flex-direction: column; border: 1px solid var(--border, var(--color-border)); border-radius: var(--radius-md); overflow: hidden; }
.il-row { display: flex; align-items: center; gap: 10px; padding: 7px 10px; border-top: 1px solid var(--border, var(--color-border)); }
.il-row:first-child { border-top: none; }
.il-main { display: flex; align-items: baseline; gap: 6px; min-width: 0; flex: 1; }
.il-name { font-size: var(--font-size-sm); color: var(--text-color, var(--color-text)); }
.il-style { font-size: var(--text-micro-font-size, 10px); color: var(--text-tertiary); }
.il-license { flex-shrink: 0; padding: 1px 6px; border-radius: 999px; font-size: var(--text-micro-font-size, 10px); color: var(--text-tertiary); background: var(--bg-secondary, var(--color-bg-elevated)); }
.il-license.is-cc { color: var(--warning, var(--color-warning)); }
.il-link { flex-shrink: 0; font-size: var(--text-micro-font-size, 10px); color: var(--primary, var(--color-primary)); text-decoration: none; }
.il-link:hover { text-decoration: underline; }
.il-foot { margin: 0; font-size: var(--text-micro-font-size, 10px); color: var(--text-tertiary); }
</style>
