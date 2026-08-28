<template>
  <div class="workdir-select" ref="selectRef">
    <button
      class="workdir-pill"
      aria-haspopup="listbox"
      :aria-expanded="open"
      aria-label="选择工作目录"
      @mousedown.prevent
      @click.stop="toggleDropdown"
      @keydown.esc.prevent="closeDropdown"
    >
      <WsIcon name="folder" size="xs" class="workdir-pill-icon" />
      <span class="workdir-pill-name">{{ displayLabel }}</span>
      <WsIcon name="chevron-down" size="xs" class="workdir-pill-arrow" :class="{ open }" />
    </button>
    <Teleport to="body">
      <Transition name="dropdown">
        <div v-if="open" class="workdir-dropdown-backdrop" @click="open = false"></div>
      </Transition>
      <Transition name="dropdown">
        <div
          v-if="open"
          id="workdir-listbox"
          class="workdir-dropdown"
          role="listbox"
          aria-label="工作目录列表"
          :style="dropdownStyle"
        >
          <div class="dropdown-header">工作目录</div>
          <!-- 置顶：打开文件夹…（系统目录选择） -->
          <button class="workdir-option" role="option" @click="openPicker">
            <span class="workdir-option-icon"><WsIcon name="folder-open" size="xs" /></span>
            <span class="workdir-option-name">打开文件夹…</span>
          </button>
          <!-- 默认工作区 -->
          <button
            class="workdir-option"
            :class="{ active: isDefault }"
            role="option"
            :aria-selected="isDefault"
            @click="selectDefault"
          >
            <span class="workdir-option-status" aria-hidden="true"><WsIcon v-if="isDefault" name="check" size="xs" /></span>
            <span class="workdir-option-name">默认工作区</span>
          </button>
          <!-- 已记录目录实体 -->
          <div v-if="recordedList.length" class="workdir-group">
            <div class="workdir-group-label" role="presentation">已记录目录</div>
            <button
              v-for="rec in recordedList"
              :key="rec.id"
              class="workdir-option"
              :class="{ active: rec.path === currentPath }"
              role="option"
              :aria-selected="rec.path === currentPath"
              :aria-label="`${rec.label}（${rec.path}）`"
              :title="rec.path"
              @click="selectRecord(rec)"
            >
              <span class="workdir-option-status" aria-hidden="true"><WsIcon v-if="rec.path === currentPath" name="check" size="xs" /></span>
              <span class="workdir-option-icon"><WsIcon name="folder" size="xs" /></span>
              <span class="workdir-option-name">{{ rec.label }}</span>
            </button>
          </div>
          <div v-else class="workdir-empty">暂无记录目录，可点击「打开文件夹…」选择</div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import { invoke } from '@/agent/composables/transport'
import { useAgent } from '@/agent/composables/useAgent'
import type { RustWorkdirRecord } from '@/agent/composables/useAgentRust'
import { resolveWorkspaceDir } from '../workspace'
import { toastError, toastSuccess, toastWarn } from '@/composables/useToast'

/** 记住上次选择的 localStorage key */
const LAST_WORKDIR_KEY = 'last_workdir'

const backend = useAgent()
/** 当前会话绑定的工作区根目录（ref，可读写；无会话为 null） */
const currentWorkdir = backend.currentWorkdir as { value: string | null }
/** 已记录目录实体列表（Phase 3 会话树分组标签来源，这里仅作下拉候选） */
const workdirs = backend.workdirs as { value: RustWorkdirRecord[] }
/** 刷新目录实体列表（从 cmd_list_workdirs 拉取） */
const loadWorkdirs = backend.loadWorkdirs as () => Promise<void>

const open = ref(false)
const selectRef = ref<HTMLElement>()
const dropdownStyle = ref<Record<string, string>>({ top: '0px', left: '0px' })
/** 默认工作区路径（固定 ~/.worldsmith/workspace，挂载时解析） */
const defaultDir = ref('')

/** 当前选中路径（currentWorkdir 或默认目录） */
const currentPath = computed(() => currentWorkdir.value || defaultDir.value)
/** 是否选中默认工作区 */
const isDefault = computed(() => Boolean(currentWorkdir.value && currentWorkdir.value === defaultDir.value))
/** 展示名称：默认工作区 / 已记录目录的实体 label / 回退路径基名（I3：与下拉勾选项名统一） */
const displayLabel = computed(() => {
  const p = currentPath.value
  if (!p) return '默认工作区'
  if (p === defaultDir.value) return '默认工作区'
  const rec = workdirs.value.find((w) => w.path === p)
  if (rec && rec.label) return rec.label
  return baseName(p)
})
/** 下拉中「已记录目录」候选（排除默认目录实体，避免与默认项重复） */
const recordedList = computed(() =>
  workdirs.value.filter((w) => defaultDir.value && w.path !== defaultDir.value),
)

/** 取路径基名（兼容 / 与 \ 两种分隔符） */
function baseName(p: string): string {
  const segs = p.split(/[\\/]/).filter(Boolean)
  return segs[segs.length - 1] ?? p
}

/** 更新下拉定位（相对触发器左下锚定，向上弹出） */
function updateDropdownPosition() {
  if (!selectRef.value) return
  const rect = selectRef.value.getBoundingClientRect()
  dropdownStyle.value = {
    bottom: `${window.innerHeight - rect.top + 6}px`,
    left: `${Math.max(8, rect.left + rect.width / 2 - 110)}px`,
  }
}

async function toggleDropdown() {
  open.value = !open.value
  if (open.value) {
    await updateDropdownPosition()
    // 打开时刷新目录实体列表，保证下拉候选最新
    await loadWorkdirs()
  }
}

function closeDropdown() {
  open.value = false
}

/** 应用选中目录：写穿 currentWorkdir（ref）+ 记住上次选择；非默认目录保存为目录实体。
 *  save=true 为「用户主动选择/新建目录」（打开文件夹），此时联动绑定为当前项目存储目录（统一根目录）。 */
function applyWorkdir(path: string, label: string, save: boolean) {
  currentWorkdir.value = path
  try { localStorage.setItem(LAST_WORKDIR_KEY, path) } catch {}
  open.value = false
  // X3 修复：仅切换「本次发送目录」（currentWorkdir 供工具桥上下文/新会话创建消费），
  // 不再改写当前会话归属——会话条目保持原工作空间分组；切走再切回时恢复该会话原目录
  if (save) {
    void invoke('cmd_save_workdir', { path, label }).catch((err) => {
      console.warn('[WorkdirSelect] 保存目录实体失败:', err)
    })
    void bindAsProjectDir(path, label)
  }
}

/** 把选中的目录同步绑定为当前项目的存储目录（统一根目录：Agent 工作区 = 项目数据存储） */
async function bindAsProjectDir(path: string, label: string) {
  try {
    const { useFileSystemProject } = await import('@/composables/useFileSystemProject')
    const { bindDirToProject } = useFileSystemProject()
    const ok = await bindDirToProject(path)
    if (ok) {
      toastSuccess(`已绑定工作区「${label}」为项目存储目录`)
    } else {
      const err = useFileSystemProject().lastError?.value ?? '绑定失败'
      toastWarn(`已设为工作区，但未绑定项目存储：${err}`)
    }
  } catch (err) {
    // 非 Tauri 环境（浏览器 preview）或项目管理器不可用：仅作工作区，不绑定项目
    console.warn('[WorkdirSelect] 绑定项目目录失败（可忽略，仅作工作区）:', err)
  }
}

/** 打开系统目录选择对话框（@tauri-apps/plugin-dialog，动态导入避免首屏开销）
 *  仅在真实 Tauri IPC（桌面端）可用；浏览器 preview / HTTP 桥无系统对话框，明确降级提示。 */
async function openPicker() {
  const isBrowserPreview = !(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
  if (isBrowserPreview) {
    toastWarn('目录选择需要 Tauri 桌面端环境（浏览器预览不可用）')
    return
  }
  try {
    const { open: pick } = await import('@tauri-apps/plugin-dialog')
    const selected = await pick({ directory: true, title: '选择工作目录', multiple: false })
    if (!selected) return
    const path = selected as string
    applyWorkdir(path, baseName(path), true)
  } catch (err) {
    console.warn('[WorkdirSelect] 打开目录选择失败:', err)
    toastError(`打开目录选择失败：${err instanceof Error ? err.message : String(err)}`)
  }
}

/** 选择默认工作区（固定 ~/.worldsmith/workspace，无需另存目录实体） */
async function selectDefault() {
  const path = await resolveWorkspaceDir()
  applyWorkdir(path, '默认工作区', false)
}

/** 选择已记录目录实体（选择即复用，无需重新保存） */
function selectRecord(rec: RustWorkdirRecord) {
  applyWorkdir(rec.path, rec.label, false)
}

function onDocClick(e: MouseEvent) {
  if (!open.value) return
  const target = e.target as HTMLElement
  if (selectRef.value && !selectRef.value.contains(target) && !target.closest('.workdir-dropdown')) {
    open.value = false
  }
}

/** I1 修复：全局 Escape 关闭（原仅触发按钮聚焦时生效，焦点在输入框时 Escape 无响应） */
function onDocKeydown(e: KeyboardEvent) {
  if (!open.value) return
  if (e.key === 'Escape') open.value = false
}

onMounted(async () => {
  // capture 阶段监听：抢在 useShortcuts（document 冒泡，命中即 stopImmediatePropagation）之前消费 Esc
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onDocKeydown, true)
  // 解析固定默认目录（resolveWorkspaceDir() 无参）
  defaultDir.value = await resolveWorkspaceDir()
  // 记住上次选择：存在则恢复为当前工作区（否则 fallback 默认目录）
  let last: string | null = null
  try { last = localStorage.getItem(LAST_WORKDIR_KEY) } catch {}
  if (last && !currentWorkdir.value) currentWorkdir.value = last
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onDocKeydown, true)
})
</script>

<style scoped>
.workdir-select {
  flex-shrink: 0;
  position: relative;
}

.workdir-pill {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-3xl);
  background: var(--color-surface-elevated);
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  cursor: pointer;
  white-space: nowrap;
  max-width: 140px;
  height: 32px;
  transition: background 0.2s, border-color 0.2s, color 0.2s;
}

.workdir-pill:hover {
  border-color: var(--color-primary);
  color: var(--color-text);
}

.workdir-pill-icon {
  flex-shrink: 0;
  color: var(--color-primary);
}

.workdir-pill-name {
  font-weight: 500;
  max-width: 92px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.workdir-pill-arrow {
  font-size: var(--fs-3xs);
  opacity: 0.5;
  margin-left: 2px;
  transition: transform 0.2s;
}
.workdir-pill-arrow.open {
  transform: rotate(180deg);
}

.workdir-dropdown-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10000;
}

.workdir-dropdown {
  position: fixed;
  min-width: 220px;
  max-height: 70vh;
  overflow-y: auto;
  background: rgba(10, 10, 20, 0.08);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  padding: 6px;
  z-index: 10001;
}

.dropdown-header {
  padding: 6px 10px 4px;
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--color-text-secondary);
  border-bottom: 1px solid var(--color-border);
  margin-bottom: 4px;
}

.workdir-group {
  margin-top: 4px;
}

.workdir-group-label {
  padding: 4px 10px 2px;
  font-size: var(--font-size-2xs);
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.workdir-option {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 10px;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  text-align: left;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  transition: background 0.12s;
}

.workdir-option:hover {
  background: var(--color-surface);
  color: var(--color-text);
}

.workdir-option.active {
  background: var(--color-primary-muted);
  color: var(--color-text);
}

.workdir-option-status {
  width: 14px;
  font-size: var(--font-size-xs);
  color: var(--color-primary);
  flex-shrink: 0;
}

.workdir-option-icon {
  display: flex;
  flex-shrink: 0;
  color: var(--color-text-tertiary);
}

.workdir-option-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.workdir-empty {
  padding: 8px 10px;
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}

.dropdown-enter-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
}
.dropdown-leave-active {
  transition: opacity 0.08s ease, transform 0.08s ease;
}
.dropdown-enter-from {
  opacity: 0;
  transform: translateY(4px);
}
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(2px);
}
</style>