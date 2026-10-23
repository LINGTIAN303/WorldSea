<template>
  <Teleport to="body">
    <div v-if="show" class="dnd-mask" @pointerdown.self="$emit('cancel')">
      <div class="dnd" role="dialog" aria-modal="true" aria-label="删除节点">
        <div class="dnd-title">删除节点「{{ nodeName }}」</div>

        <p v-if="childCount > 0" class="dnd-hint">
          该节点有 <b>{{ childCount }}</b> 个子节点。删除后<b>不可撤销</b>，请先选择子节点的处理方式：
        </p>
        <p v-else class="dnd-hint">
          删除后<b>不可撤销</b>：节点、其白板容器、关联关系与章节关联都会一并清除。
        </p>

        <template v-if="childCount > 0">
          <label v-for="o in OPTIONS" :key="o.value" class="dnd-opt">
            <input v-model="strategy" type="radio" :value="o.value" />
            <span>{{ o.label }}</span>
          </label>
          <select v-if="strategy === 'reparent'" v-model="targetId" class="dnd-select">
            <option value="">选择目标节点…</option>
            <option v-for="c in candidates" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </template>

        <div class="dnd-foot">
          <button class="dnd-btn" type="button" @click="$emit('cancel')">取消</button>
          <button
            class="dnd-btn dnd-btn--danger"
            type="button"
            :disabled="childCount > 0 && strategy === 'reparent' && !targetId"
            @click="$emit('confirm', strategy, targetId)"
          >删除</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 删除节点确认框（2026-10-19）。
 *
 * 语义边界：本框只管**删除**（节点 + 容器 + 关系 + 章节解绑），
 * 「移除容器」（节点保留）不走这里——那是卡片上的 ✕。
 *
 * 有子节点时提供三选一（用户 2026-10-19 拍板）：连同删除 / 提升为根 / 转移到其它节点；
 * 无子节点时只做一次确认（破坏性 + 不可撤销，必须确认）。
 */
import { ref, watch } from 'vue'
import type { ChildStrategy } from '@/entity/outlineNodeDelete'

const props = defineProps<{
  show: boolean
  nodeName: string
  childCount: number
  /** 可转移的目标节点（已排除自身子树，由调用方过滤） */
  candidates: Array<{ id: string; name: string }>
}>()

const emit = defineEmits<{
  cancel: []
  confirm: [strategy: ChildStrategy, targetId: string]
}>()

const OPTIONS: Array<{ value: ChildStrategy; label: string }> = [
  { value: 'cascade', label: '连同子节点一起删除（整棵子树）' },
  { value: 'promote', label: '将子节点提升为根节点' },
  { value: 'reparent', label: '将子节点转移到其他节点' },
]

const strategy = ref<ChildStrategy>('cascade')
const targetId = ref('')

// 每次打开重置（避免上次的“转移到”残留）
watch(
  () => props.show,
  (v) => {
    if (v) {
      strategy.value = 'cascade'
      targetId.value = ''
    }
  },
)
</script>

<style scoped>
.dnd-mask {
  position: fixed; inset: var(--titlebar-height, 32px) 0 0 0; z-index: 4000;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.42);
}
.dnd {
  width: 380px; max-width: calc(100vw - 32px);
  padding: 16px 18px 12px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-mid);
  background: var(--menubar-bg, var(--bg-secondary));
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
}
.dnd-title { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--text-color); }
.dnd-hint { margin: 8px 0 10px; font-size: var(--font-size-xs); line-height: 1.6; color: var(--text-secondary); }
.dnd-hint b { color: var(--danger); }
.dnd-opt {
  display: flex; align-items: center; gap: 6px;
  margin: 4px 0; font-size: var(--font-size-xs); color: var(--text-color); cursor: pointer;
}
.dnd-select {
  width: 100%; height: 26px; margin-top: 6px; padding: 0 6px;
  border: 1px solid var(--border-color); border-radius: var(--radius-xs);
  background: var(--input-bg); color: var(--text-color);
  font-size: var(--font-size-xs); font-family: inherit;
}
.dnd-foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
.dnd-btn {
  height: 26px; padding: 0 12px;
  border: 1px solid var(--border-color); border-radius: var(--radius-xs);
  background: transparent; color: var(--text-secondary);
  font-size: var(--font-size-xs); font-family: inherit; cursor: pointer;
}
.dnd-btn:hover { border-color: var(--primary); color: var(--primary); }
.dnd-btn--danger { border-color: var(--danger); color: var(--danger); }
.dnd-btn--danger:hover { background: var(--danger); color: #fff; }
.dnd-btn:disabled { opacity: 0.4; cursor: default; }
</style>
