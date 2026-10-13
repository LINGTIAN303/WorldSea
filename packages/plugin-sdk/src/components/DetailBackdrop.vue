<template>
  <div v-if="visible" class="dp-backdrop" :class="{ 'is-blocking': blocking }" @click="onClick" />
</template>

<script setup lang="ts">
/**
 * overlay 型载体的共用遮罩。详细见 docs/details/注释/packages/plugin-sdk/实体详情内容形态.md §11.4
 * 缺省**穿透**（`pointer-events:none`）——抽屉/弹层开着仍能直接点列表；档位两层（全局默认+按类型覆写）
 * 只在 `backdropFor()` 解析一处；「点空白关闭」只在拦截档成立，处理器与样式必须一起看档位。
 */
import { computed } from 'vue'
import { useDetailLayoutStore } from '@worldsea/entity-core'

const props = withDefaults(defineProps<{
  visible: boolean
  /** 空串＝该调用方没有类型概念（如全局浮层），只吃全局默认 */
  entityType?: string
}>(), { entityType: '' })

const emit = defineEmits<{ close: [] }>()

const detailPrefs = useDetailLayoutStore()
const blocking = computed(() => detailPrefs.backdropFor(props.entityType) === 'blocking')

function onClick() {
  if (blocking.value) emit('close')
}
</script>

<style scoped>
.dp-backdrop {
  position: fixed;
  inset: 0;
  z-index: 99;
  pointer-events: none;
}
.dp-backdrop.is-blocking {
  pointer-events: auto;
}
</style>
