<script setup lang="ts">
withDefaults(defineProps<{
  surface: 'home' | 'workspace'
  inert?: boolean
  busy?: boolean
  workspaceClass?: Record<string, boolean> | string | Array<string | Record<string, boolean>>
}>(), { inert: false, busy: false, workspaceClass: () => ({}) })
</script>

<template>
  <!-- 工作台子树常驻、只切换可见性：ViewContainer / 各实体视图内含指向 #view-toolbar-* 的
       Teleport 并依赖挂载期 DOM 引用，卸载会让 Vue 在空 vnode 上 patch 崩溃（surface 已切、
       DOM 不动）。首页无此类依赖，按需挂载即可——避免工作台编辑时后台持续重算首页聚合。 -->
  <main
    id="main-content"
    tabindex="-1"
    class="shell-surface-root"
    :class="surface === 'home' ? 'is-home' : ['shell-body', workspaceClass]"
    :inert="inert || undefined"
    :aria-busy="busy ? 'true' : undefined"
  >
    <div v-if="surface === 'home'" class="shell-surface-slot" data-surface="home">
      <slot name="home" />
    </div>
    <div v-show="surface === 'workspace'" class="shell-surface-slot" data-surface="workspace">
      <slot name="workspace" />
    </div>
  </main>
</template>

<style scoped>
.shell-surface-root {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  overflow: hidden;
}
/* 槽包装不生成盒子：子元素（Sidebar/ViewContainer/HomeSurface）直接参与 main 的 flex 布局；
   v-show 隐藏时以内联 display:none 覆盖 */
.shell-surface-slot {
  display: contents;
}
.shell-body {
  position: relative;
  padding: var(--region-pad, 8px);
  background: var(--bg-app);
}
.shell-body.sprout-nav-dual {
  --layout-sidebar-width: var(--layout-sidebar-dual-width, 300px);
}
.is-home {
  background: var(--bg-app);
}
</style>
