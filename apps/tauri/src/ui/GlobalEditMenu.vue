<template>
  <!-- 统一输入框右键菜单（2026-09-06）：原生右键菜单已被 App 全局拦截，
       INPUT/TEXTAREA/contentEditable 上右键时由本组件弹出编辑菜单
       （撤销/重做/剪切/复制/粘贴/删除/全选），命令走 document.execCommand；
       粘贴经 navigator.clipboard.readText + insertText（保留 undo 栈）。
       详见 docs/details/架构/快捷键系统.md §3「系统级行为」。 -->
  <Teleport to="body">
    <Transition name="ws-menu">
    <div
      v-if="open"
      ref="menuRef"
      class="gedit-menu"
      :style="{ left: x + 'px', top: y + 'px', '--ws-origin': '0 0' }"
      role="menu"
      @contextmenu.prevent
    >
      <button
        v-for="item in items"
        :key="item.label"
        class="gedit-item"
        role="menuitem"
        :disabled="item.disabled?.()"
        @mousedown.prevent
        @click="run(item)"
      >
        <span class="gedit-label">{{ item.label }}</span>
        <kbd v-if="item.keys" class="gedit-kbd">{{ item.keys }}</kbd>
      </button>
    </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

const open = ref(false)
const x = ref(0)
const y = ref(0)
const menuRef = ref<HTMLDivElement | null>(null)
/** 右键目标元素：命令执行依赖其保持聚焦（菜单项 mousedown.prevent 防焦点转移） */
let target: HTMLElement | null = null

interface MenuItem {
  label: string
  keys?: string
  cmd?: string
  disabled?: () => boolean
  run?: () => void
}

const hasSelection = () => {
  const el = target as HTMLInputElement | HTMLTextAreaElement | null
  if (el && typeof (el as HTMLInputElement).selectionStart === 'number') {
    return (el.selectionStart ?? 0) !== (el.selectionEnd ?? 0)
  }
  return !!window.getSelection()?.toString()
}

const items: MenuItem[] = [
  { label: '撤销', keys: 'Ctrl+Z', cmd: 'undo' },
  { label: '重做', keys: 'Ctrl+Y', cmd: 'redo' },
  { label: '剪切', keys: 'Ctrl+X', cmd: 'cut', disabled: () => !hasSelection() },
  { label: '复制', keys: 'Ctrl+C', cmd: 'copy', disabled: () => !hasSelection() },
  { label: '粘贴', keys: 'Ctrl+V', run: () => { void paste() } },
  { label: '删除', keys: 'Del', cmd: 'delete', disabled: () => !hasSelection() },
  { label: '全选', keys: 'Ctrl+A', cmd: 'selectAll' },
]

function isEditable(el: EventTarget | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable
}

/** 右键入口：仅输入元素打开菜单；其余仅保持全局拦截（preventDefault） */
function onContextMenu(e: MouseEvent): void {
  if (!isEditable(e.target)) return
  e.preventDefault()
  target = e.target
  // 菜单不出视口：先按打开态定位再钳位（宽度约 180、行高约 30×7）
  x.value = Math.min(e.clientX, window.innerWidth - 190)
  y.value = Math.min(e.clientY, window.innerHeight - 230)
  open.value = true
  void nextTick(() => menuRef.value?.focus())
}

function exec(cmd: string): void {
  target?.focus()
  document.execCommand(cmd)
  close()
}

/** 粘贴：读剪贴板 + insertText（走输入事件、保留撤销栈）；
    权限被拒时提示用 Ctrl+V（WebView 原生快捷键不经 JS，始终可用） */
async function paste(): Promise<void> {
  target?.focus()
  try {
    const text = await navigator.clipboard.readText()
    if (text) document.execCommand('insertText', false, text)
    close()
  } catch {
    close()
    const { toastWarn } = await import('@worldsea/ui-kit')
    toastWarn('剪贴板不可用，请直接按 Ctrl+V 粘贴')
  }
}

function run(item: MenuItem): void {
  if (item.cmd) exec(item.cmd)
  item.run?.()
}

function close(): void {
  open.value = false
  target = null
}

/** 菜单外点击 / Esc / 滚动 / 失焦即关闭（menu 内 mousedown 已 prevent 不触发） */
function onDocPointerDown(e: MouseEvent): void {
  if (open.value && !menuRef.value?.contains(e.target as Node)) close()
}
function onKeydown(e: KeyboardEvent): void {
  if (open.value && e.key === 'Escape') { e.stopPropagation(); close() }
}

onMounted(() => {
  document.addEventListener('contextmenu', onContextMenu)
  document.addEventListener('pointerdown', onDocPointerDown, true)
  document.addEventListener('keydown', onKeydown, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('contextmenu', onContextMenu)
  document.removeEventListener('pointerdown', onDocPointerDown, true)
  document.removeEventListener('keydown', onKeydown, true)
})
</script>

<style scoped>
.gedit-menu {
  position: fixed;
  z-index: 15000;
  min-width: 180px;
  padding: 4px;
  border-radius: calc(var(--radius-md, 8px) * var(--sf-radius-scale));
  border: 1px solid var(--sf-overlay-edge);
  background: var(--sf-overlay-bg);
  box-shadow: var(--sf-overlay-shadow), inset 0 1px 0 var(--sf-highlight);
  -webkit-backdrop-filter: var(--sf-overlay-filter, none);
  backdrop-filter: var(--sf-overlay-filter, none);
  display: flex;
  flex-direction: column;
}
.gedit-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 10px;
  border: none;
  border-radius: var(--radius-sm, 6px);
  background: transparent;
  color: var(--color-text);
  font-size: var(--font-size-sm, 13px);
  text-align: left;
  cursor: pointer;
}
.gedit-item:hover:not(:disabled) {
  background: var(--bg-muted, rgba(0, 0, 0, 0.06));
}
.gedit-item:disabled {
  color: var(--color-text-tertiary, #aaa);
  cursor: default;
}
.gedit-label {
  flex: 1;
}
.gedit-kbd {
  padding: 0 5px;
  border-radius: 4px;
  border: 1px solid var(--border-color, var(--color-border, #ddd));
  color: var(--color-text-tertiary);
  font-family: inherit;
  font-size: 11px;
  line-height: 1.5;
}
</style>
