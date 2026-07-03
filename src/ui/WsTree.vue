<template>
  <div class="ws-tree" role="tree">
    <WsTreeNode
      v-for="node in data"
      :key="node[keyField]"
      :node="node"
      :key-field="keyField"
      :label-field="labelField"
      :children-field="childrenField"
      :level="0"
      :selected-set="selectedSet"
      :expanded-keys="expandedKeys"
      @toggle="onToggle"
      @select="onSelect"
    >
      <template #default="slotProps"><slot v-bind="slotProps" /></template>
    </WsTreeNode>
  </div>
</template>

<script setup lang="ts">
import { computed, watch, shallowRef, triggerRef } from 'vue'
import WsTreeNode from './WsTreeNode.vue'

export interface TreeNode {
  [key: string]: any
  children?: TreeNode[]
}

const props = withDefaults(defineProps<{
  data: TreeNode[]
  keyField?: string
  labelField?: string
  childrenField?: string
  defaultExpandAll?: boolean
  selectedKeys?: string[]
}>(), {
  keyField: 'key',
  labelField: 'label',
  childrenField: 'children',
  defaultExpandAll: false,
  selectedKeys: () => [],
})

const emit = defineEmits<{
  select: [node: TreeNode]
  toggle: [key: string, expanded: boolean]
}>()

// 性能优化:selectedKeys 数组转 Set 缓存,O(n²) → O(n) 一次构建 + O(1) 查找
// 对外 API 不变(仍接收 selectedKeys: string[]),仅内部转 Set 传给子节点
const selectedSet = computed(() => new Set(props.selectedKeys))

// expandedKeys 用 shallowRef,避免 Vue 对 Set 内部做深层响应式包装
const expandedKeys = shallowRef<Set<string>>(new Set())

watch(() => props.data, () => {
  if (props.defaultExpandAll) {
    const keys = new Set<string>()
    function walk(nodes: TreeNode[]) {
      for (const n of nodes) {
        keys.add(n[props.keyField])
        const children = n[props.childrenField]
        if (children?.length) walk(children)
      }
    }
    walk(props.data)
    expandedKeys.value = keys
  }
}, { immediate: true })

// 性能优化:onToggle 不再 new Set(...) 复制整个 Set,直接 mutate + triggerRef
// 原实现每次 toggle 都复制整个 Set,大型树频繁展开/收起会有 GC 压力
function onToggle(key: string) {
  const set = expandedKeys.value
  if (set.has(key)) set.delete(key); else set.add(key)
  triggerRef(expandedKeys)
  emit('toggle', key, set.has(key))
}

function onSelect(node: TreeNode) {
  emit('select', node)
}
</script>

<style scoped>
.ws-tree { font-size: var(--font-size-sm); }
</style>
