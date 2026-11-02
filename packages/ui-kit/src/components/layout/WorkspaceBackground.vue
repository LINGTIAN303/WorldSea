<template>
  <div v-if="visible" class="workspace-bg" aria-hidden="true">
    <div class="workspace-bg__image"></div>
    <div class="workspace-bg__dim"></div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useBackground } from '@worldsea/style-kit'

const props = withDefaults(defineProps<{ preview?: boolean }>(), { preview: false })
const { background, missing } = useBackground()
const visible = computed(() => !missing.value && !!background.value.src && (props.preview || background.value.enabled))
</script>
