<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  surface: 'home' | 'workspace'
  inert?: boolean
  busy?: boolean
  workspaceClass?: Record<string, boolean> | string | Array<string | Record<string, boolean>>
}>(), { inert: false, busy: false, workspaceClass: () => ({}) })

/** 工作台常驻、首页覆盖在其上；切到首页时延后隐藏工作台，避免淡入时背后空白。 */
const workspaceShown = ref(props.surface === 'workspace')
let hideTimer: ReturnType<typeof setTimeout> | null = null

function clearHideTimer() {
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
}

watch(
  () => props.surface,
  (surface) => {
    clearHideTimer()
    if (surface === 'workspace') {
      workspaceShown.value = true
      return
    }
    const root = document.documentElement
    const instant = root.dataset.reduceMotion === 'on' || root.dataset.animNav === 'off'
    if (instant) {
      workspaceShown.value = false
      return
    }
    hideTimer = setTimeout(() => {
      workspaceShown.value = false
      hideTimer = null
    }, 180)
  },
)

onBeforeUnmount(clearHideTimer)
</script>

<template>
  <!-- 工作台子树常驻、只切换可见性：ViewContainer / 各实体视图内含指向 #view-toolbar-* 的
       Teleport 并依赖挂载期 DOM 引用，卸载会让 Vue 在空 vnode 上 patch 崩溃（surface 已切、
       DOM 不动）。首页无此类依赖，按需挂载即可——避免工作台编辑时后台持续重算首页聚合。
       首页以覆盖层形式淡入淡出，工作台延后隐藏以消除切换瞬间的空白。 -->
  <main
    id="main-content"
    tabindex="-1"
    class="shell-surface-root"
    :class="surface === 'home' ? 'is-home' : ['shell-body', workspaceClass]"
    :inert="inert || undefined"
    :aria-busy="busy ? 'true' : undefined"
  >
    <Transition name="ws-surface">
      <div v-if="surface === 'home'" class="shell-surface-slot shell-home-layer" data-surface="home">
        <slot name="home" />
      </div>
    </Transition>
    <div v-show="workspaceShown" class="shell-surface-slot" data-surface="workspace">
      <slot name="workspace" />
    </div>
  </main>
</template>

<style scoped>
.shell-surface-root {
  position: relative;
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
/* 首页层：绝对覆盖工作台，作为 Transition 的实际盒子承接 opacity */
.shell-home-layer {
  display: flex;
  position: absolute;
  inset: 0;
  z-index: 20;
  background: var(--bg-app);
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
