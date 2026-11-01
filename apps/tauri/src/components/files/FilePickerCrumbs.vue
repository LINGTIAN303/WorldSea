<template>
  <!-- 面包屑：逐级跳转（点 chip）+ 同级子目录下拉（点箭头，跨级跳转不用先退再进） -->
  <div class="fp-crumbs">
    <template v-for="(crumb, i) in crumbs" :key="crumb.path">
      <span v-if="i > 0" class="fp-crumb-sep">/</span>
      <span class="fp-crumb-chip">
        <button
          class="fp-crumb"
          :class="{ on: i === crumbs.length - 1 }"
          :title="crumb.path"
          @click="$emit('navigate', crumb.path)"
        >
          {{ crumb.label }}
        </button>
        <button
          class="fp-crumb-arrow"
          :class="{ on: menu?.dir === crumb.path }"
          :aria-label="`展开「${crumb.label}」的子目录`"
          :aria-expanded="menu?.dir === crumb.path"
          title="展开子目录"
          @click.stop="toggleMenu(crumb, $event)"
        >
          <WsIcon name="chevron-down" size="xs" />
        </button>
      </span>
    </template>

    <!-- 子目录下拉：fixed 定位以 chip 矩形锚定；透明捕获层关菜单 -->
    <template v-if="menu">
      <Teleport to="body">
        <div class="fp-cm-backdrop" @click="closeMenu" />
        <div class="fp-crumb-menu" :style="{ top: `${menu.top}px`, left: `${menu.left}px` }" role="menu">
          <div v-if="menu.children.length === 0" class="fp-crumb-menu-empty">（无子文件夹）</div>
          <button
            v-for="child in menu.children"
            :key="child.path"
            class="fp-crumb-menu-item"
            role="menuitem"
            :title="child.path"
            @click="pickChild(child)"
          >
            <WsIcon name="folder" size="xs" />
            <span>{{ child.name }}</span>
          </button>
        </div>
      </Teleport>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * FilePickerCrumbs —— 面包屑 + 同级子目录下拉（从 FilePickerHost 抽出）。
 * 菜单数据现拉现用（cmd_fs_list 非递归很快，不做缓存）；Esc 优先关菜单
 * 由父级 onEscape 调 expose 的 closeMenu 实现（useFocusTrap 在 capture
 * 阶段拦截 Esc，本组件自己监听不到）。
 */
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { invoke } from '@/composables/transport'
import { WsIcon } from '@worldsea/ui-kit'
import type { FsEntry } from './filePickerModel'

interface Crumb {
  label: string
  path: string
}

interface CrumbMenu {
  dir: string
  top: number
  left: number
  children: FsEntry[]
}

const props = defineProps<{
  crumbs: Crumb[]
}>()

const emit = defineEmits<{ navigate: [path: string] }>()

const menu = ref<CrumbMenu | null>(null)

/** 展开某级的子目录菜单（再点同一级的箭头即收起） */
async function toggleMenu(crumb: Crumb, e: MouseEvent): Promise<void> {
  if (menu.value?.dir === crumb.path) return closeMenu()
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  // 先置锚点开菜单（读 children 期间给个空态），列表拉到后填充
  menu.value = { dir: crumb.path, top: rect.bottom + 4, left: rect.left, children: [] }
  try {
    const list = await invoke<FsEntry[]>('cmd_fs_list', { path: crumb.path, recursive: false })
    // 拉取期间用户可能已换菜单/关面板：过期结果丢弃
    if (menu.value?.dir !== crumb.path) return
    menu.value = {
      ...menu.value,
      children: (Array.isArray(list) ? list : [])
        .filter((entry) => entry.isDir)
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN')),
    }
  } catch {
    // 目录不可读：菜单留空态（「无子文件夹」），不弹错误打断导航
    if (menu.value?.dir === crumb.path) menu.value = { ...menu.value, children: [] }
  }
  await nextTick()
  clampMenu()
}

/** 贴窗口边缘时钳制位置（右溢出翻左，底部封顶） */
function clampMenu(): void {
  const el = document.querySelector<HTMLElement>('.fp-crumb-menu')
  if (!el || !menu.value) return
  const width = el.offsetWidth
  if (menu.value.left + width > window.innerWidth - 8) {
    menu.value = { ...menu.value, left: Math.max(8, window.innerWidth - width - 8) }
  }
  const height = el.offsetHeight
  if (menu.value.top + height > window.innerHeight - 8) {
    menu.value = { ...menu.value, top: Math.max(8, window.innerHeight - height - 8) }
  }
}

function pickChild(child: FsEntry): void {
  closeMenu()
  emit('navigate', child.path)
}

function closeMenu(): void {
  menu.value = null
}

/** 菜单是否开着（父级 Esc 分级处理用） */
function hasOpenMenu(): boolean {
  return menu.value !== null
}

defineExpose({ closeMenu, hasOpenMenu })

/** 面包屑变化 = 已发生导航，菜单内容必然过期：立即关闭 */
watch(() => props.crumbs, closeMenu)

onBeforeUnmount(closeMenu)
</script>

<style scoped src="./file-picker-crumbs.css"></style>
