<template>
  <div class="custom-view">
    <DashboardView />
  </div>
</template>

<script setup lang="ts">
import DashboardView from './DashboardView.vue'
</script>

<style scoped>
.custom-view { display: flex; flex-direction: column; height: 100%; padding: 20px; }
</style>
