<script setup lang="ts">
/** SubAgentView：子 Agent 规格管理界面（列表 + 新增/编辑表单），详细见 docs/details/注释/tauri/SubAgentView.md */
import { ref, reactive, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useSubagentRust, type SubAgentSpec } from '../composables/useSubagentRust'
import { useAgentRust } from '../../agent/composables/useAgentRust'
import { subagentTemplates, type SubAgentTemplate } from '../templates'
import TuiModal from '../../components/ui/TuiModal.vue'
import TuiConfirm from '../../components/ui/TuiConfirm.vue'
import TuiButton from '../../components/ui/TuiButton.vue'
import TuiIcon from '../../components/ui/TuiIcon.vue'
import TuiEmpty from '../../components/ui/TuiEmpty.vue'
import { useTuiToast } from '../../components/ui/useTuiToast'

const sub = useSubagentRust()
const { specs, busy: subBusy } = sub
// 实例管理按会话隔离：接入 useAgentRust 获取当前活动会话 id
const agent = useAgentRust()
const { instances, instancesBusy, instanceMsg } = sub
const toast = useTuiToast()

/** 确认框状态：{ 目标类型, 相关数据 }，用于删除规格 / 清空全部实例 */
const confirmState = ref<{
  show: boolean
  title: string
  message: string
  danger: boolean
  confirmText: string
  onConfirm: () => void
}>({ show: false, title: '', message: '', danger: false, confirmText: '确认', onConfirm: () => {} })

/** 表单状态 */
const form = reactive<SubAgentSpec>({
  id: '',
  name: '',
  description: '',
  system_prompt: '',
  tools_whitelist: null,
  max_iterations: null,
})
const formError = ref('')
const editingId = ref('') // 非空表示正在编辑现有规格
// 列表区瞬态提示（复制/删除结果反馈）
const listMsg = ref('')
/** 列表区提示类型：error → danger 语义（批次59：失败不再以 success 渲染） */
const listMsgType = ref<'success' | 'error'>('success')
/** 实例区提示类型（instanceMsg 来自 composable，类型由组件层控制） */
const instanceMsgType = ref<'success' | 'error'>('success')

// 导出/导入弹窗状态
const ioOpen = ref(false)
const ioMode = ref<'export' | 'import'>('export')
const ioText = ref('')
const ioMsg = ref('')
/** 弹窗内提示类型：error → danger 语义（批次59） */
const ioMsgType = ref<'success' | 'error'>('success')

/** 打开导出弹窗：拉取 JSON 填入 */
async function openExport() {
  ioMsg.value = ''
  try {
    ioText.value = await sub.exportSpecs()
    ioMode.value = 'export'
    ioOpen.value = true
  } catch (err) {
    ioMsg.value = err instanceof Error ? err.message : String(err)
    ioMsgType.value = 'error'
  }
}

/** 打开导入弹窗 */
function openImport() {
  ioMsg.value = ''
  ioText.value = ''
  ioMode.value = 'import'
  ioOpen.value = true
}

/** 复制导出的 JSON 到剪贴板 */
async function copyJson() {
  try {
    await navigator.clipboard.writeText(ioText.value)
    ioMsg.value = '已复制到剪贴板'
    ioMsgType.value = 'success'
  } catch (err) {
    ioMsg.value = err instanceof Error ? err.message : String(err)
    ioMsgType.value = 'error'
  }
}

/** 执行导入 */
async function doImport() {
  ioMsg.value = ''
  const json = ioText.value.trim()
  if (!json) {
    ioMsg.value = '请粘贴要导入的 JSON 内容'
    ioMsgType.value = 'error'
    return
  }
  try {
    const n = await sub.importSpecs(json)
    ioMsg.value = `导入成功：${n} 条规格（同名 id 已覆盖）`
    ioMsgType.value = 'success'
    ioText.value = ''
    ioOpen.value = false
  } catch (err) {
    ioMsg.value = err instanceof Error ? err.message : String(err)
    ioMsgType.value = 'error'
  }
}

/** 白名单输入（逗号分隔的工具名，空 = 继承全部工具） */
const whitelistText = ref('')

/** record 与文本互转：数组 → 逗号串 */
function whitelistToText(list?: string[] | null): string {
  return (list ?? []).join(', ')
}

/** 文本 → 数组（去空白、去空项）；空文本返回 null（不设白名单） */
function textToWhitelist(text: string): string[] | null {
  const items = text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return items.length ? items : null
}

/** 校验 + 注册（新增或按 id 覆盖） */
async function submit() {
  formError.value = ''
  const id = form.id.trim()
  if (!id) {
    formError.value = 'ID 不能为空'
    return
  }
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    formError.value = 'ID 仅允许字母、数字、下划线、连字符'
    return
  }
  if (id.length > 64) {
    formError.value = 'ID 过长（最多 64 个字符）'
    return
  }
  if (!form.name.trim()) {
    formError.value = '名称不能为空'
    return
  }
  if (!form.description.trim()) {
    formError.value = '能力描述不能为空'
    return
  }
  if (!form.system_prompt.trim()) {
    formError.value = '系统提示词不能为空'
    return
  }
  if (form.max_iterations != null && form.max_iterations < 1) {
    formError.value = '最大迭代次数必须大于 0'
    return
  }
  try {
    await sub.registerSpec({ ...form, id, tools_whitelist: textToWhitelist(whitelistText.value) })
    resetForm()
  } catch (err) {
    formError.value = err instanceof Error ? err.message : String(err)
  }
}

/** 编辑：把现有规格填入表单 */
function edit(spec: SubAgentSpec) {
  editingId.value = spec.id
  form.id = spec.id
  form.name = spec.name
  form.description = spec.description
  form.system_prompt = spec.system_prompt
  form.tools_whitelist = spec.tools_whitelist ?? null
  form.max_iterations = spec.max_iterations ?? null
  whitelistText.value = whitelistToText(spec.tools_whitelist)
  formError.value = ''
}

/** 复制单个规格的 JSON 到剪贴板（便于分享 / 复用单个子 Agent） */
async function copySpec(spec: SubAgentSpec) {
  try {
    await navigator.clipboard.writeText(JSON.stringify(spec, null, 2))
    listMsg.value = `已复制「${spec.name}」的规格 JSON`
    listMsgType.value = 'success'
  } catch (err) {
    listMsg.value = err instanceof Error ? err.message : String(err)
    listMsgType.value = 'error'
  }
}

/** 删除规格：弹出确认框（替代原生 confirm） */
function remove(spec: SubAgentSpec) {
  confirmState.value = {
    show: true,
    title: '删除子 Agent',
    message: `确定删除「${spec.name}」（${spec.id}）？\n已委派的实例将按最新规格重建。`,
    danger: true,
    confirmText: '删除',
    onConfirm: async () => {
      try {
        await sub.removeSpec(spec.id)
        if (editingId.value === spec.id) resetForm()
        toast.info(`已删除「${spec.name}」`)
      } catch (err) {
        formError.value = err instanceof Error ? err.message : String(err)
      } finally {
        confirmState.value.show = false
      }
    },
  }
}

/** 重置表单 */
function resetForm() {
  editingId.value = ''
  form.id = ''
  form.name = ''
  form.description = ''
  form.system_prompt = ''
  form.tools_whitelist = null
  form.max_iterations = null
  whitelistText.value = ''
  formError.value = ''
}

// 模板下拉状态
const tplOpen = ref(false)
const tplWrapRef = ref<HTMLElement | null>(null)
/** 模板菜单键盘高亮索引（-1 未高亮），与 TuiSelect 键盘导航同一语言 */
const tplActive = ref(-1)

/** 点击下拉外部时关闭菜单 */
function onDocClick(e: MouseEvent) {
  if (tplOpen.value && tplWrapRef.value && !tplWrapRef.value.contains(e.target as Node)) {
    tplOpen.value = false
    tplActive.value = -1
  }
}
onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))

/** 打开模板菜单：聚焦首项，键盘可直达 */
function openTplMenu() {
  tplOpen.value = true
  tplActive.value = 0
  nextTick(() => {
    tplWrapRef.value?.querySelector<HTMLElement>('.tpl-menu li')?.focus()
  })
}

/** 模板菜单键盘导航：↑↓ 循环移动、Enter 选中、Esc 关闭 */
function onTplKeydown(e: KeyboardEvent) {
  const n = subagentTemplates.length
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    const dir = e.key === 'ArrowDown' ? 1 : -1
    tplActive.value = tplActive.value === -1 ? (dir === 1 ? 0 : n - 1) : (tplActive.value + dir + n) % n
    tplWrapRef.value?.querySelectorAll<HTMLElement>('.tpl-menu li')[tplActive.value]?.focus()
  } else if (e.key === 'Enter' && tplActive.value >= 0) {
    e.preventDefault()
    loadTemplate(subagentTemplates[tplActive.value])
  } else if (e.key === 'Escape') {
    e.preventDefault()
    tplOpen.value = false
    tplActive.value = -1
  }
}

/** 载入预设模板：把模板规格预填进表单（编辑态也允许，覆盖当前编辑内容） */
function loadTemplate(t: SubAgentTemplate) {
  editingId.value = t.spec.id
  form.id = t.spec.id
  form.name = t.spec.name
  form.description = t.spec.description
  form.system_prompt = t.spec.system_prompt
  form.tools_whitelist = t.spec.tools_whitelist ?? null
  form.max_iterations = t.spec.max_iterations ?? null
  whitelistText.value = whitelistToText(t.spec.tools_whitelist)
  formError.value = ''
  tplOpen.value = false
  // 回焦触发按钮：菜单项 v-if 移除后焦点落入 body（批次90 5.3）
  tplWrapRef.value?.querySelector<HTMLElement>('.tui-btn')?.focus()
}

/** 是否有当前活动会话（无则实例管理区提示先创建会话） */
const hasSession = () => !!agent.currentSessionId?.value

/** 规格列表方向键导航：↑/↓ 移动焦点到相邻规格（批次90 1.1） */
function onSpecsKeydown(e: KeyboardEvent, el: HTMLElement) {
  const items = Array.from(el.querySelectorAll<HTMLElement>('.spec-main'))
  if (items.length === 0) return
  const idx = items.indexOf(document.activeElement as HTMLElement)
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    items[Math.min(idx + 1, items.length - 1)]?.focus()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    items[Math.max(idx - 1, 0)]?.focus()
  }
}

/** TuiConfirm update:show 回调 */
function onConfirmShow(v: boolean) {
  confirmState.value.show = v
}

/** 刷新当前会话的子 Agent 实例列表（无会话则清空占位） */
async function refreshInstancesNow() {
  const sid = agent.currentSessionId?.value
  if (!sid) {
    instances.value = []
    return
  }
  await sub.refreshInstances(sid)
}

/** 清空当前会话的单个子 Agent 实例（重置其累积上下文） */
async function clearOneInstance(instId: string) {
  const sid = agent.currentSessionId?.value
  if (!sid) return
  try {
    const removed = await sub.clearInstance(sid, instId)
    instanceMsg.value = removed ? `已清空子 Agent 实例「${instId}」` : '该实例不存在或已被清空'
    instanceMsgType.value = 'success'
  } catch (err) {
    instanceMsg.value = err instanceof Error ? err.message : String(err)
    instanceMsgType.value = 'error'
  }
}

/** 清空当前会话的全部子 Agent 实例（重置累积上下文）：弹出确认框 */
function clearAllInstances() {
  const sid = agent.currentSessionId?.value
  if (!sid) return
  confirmState.value = {
    show: true,
    title: '清空全部实例',
    message: '确定清空当前会话的全部子 Agent 实例？\n这会重置它们累积的上下文，下次委派将按最新规格重建。',
    danger: true,
    confirmText: '清空',
    onConfirm: async () => {
      try {
        const n = await sub.clearInstances(sid)
        instanceMsg.value = n > 0 ? `已清空 ${n} 个子 Agent 实例` : '当前没有可清空的子 Agent 实例'
        instanceMsgType.value = 'success'
      } catch (err) {
        instanceMsg.value = err instanceof Error ? err.message : String(err)
        instanceMsgType.value = 'error'
      } finally {
        confirmState.value.show = false
      }
    },
  }
}

onMounted(async () => {
  await sub.refreshSpecs()
  await refreshInstancesNow()
})
</script>

<template>
  <div class="subagent">
    <!-- 左侧：规格列表 -->
    <section class="list">
      <header class="list-header">
        <h2>子 Agent 规格</h2>
        <span class="count">{{ specs.length }}</span>
      </header>

      <TuiEmpty v-if="specs.length === 0" icon="subagent" title="暂无子 Agent 规格">
        <p class="empty-hint">在右侧新增一个，主 Agent 即可通过 <code>delegate_to_sub_agent</code> 委派任务给它。</p>
      </TuiEmpty>
      <Transition name="fade">
        <p v-if="listMsg" class="list-msg" :class="listMsgType">{{ listMsg }}</p>
      </Transition>

      <ul class="specs" @keydown="(e) => onSpecsKeydown(e, e.currentTarget as HTMLElement)">
        <li v-for="s in specs" :key="s.id" class="spec" :class="{ editing: editingId === s.id }">
          <div
            class="spec-main"
            role="button"
            tabindex="0"
            title="点击编辑该规格"
            @click="edit(s)"
            @keydown.enter="edit(s)"
            @keydown.space.prevent="edit(s)"
          >
            <div class="spec-title">
              <span class="name">{{ s.name }}</span>
              <code class="id">{{ s.id }}</code>
              <span v-if="s.max_iterations" class="iter">max {{ s.max_iterations }}</span>
              <span v-if="s.tools_whitelist?.length" class="wl" :title="'白名单: ' + s.tools_whitelist.join(', ')">白名单 {{ s.tools_whitelist.length }}</span>
            </div>
            <div class="desc">{{ s.description }}</div>
          </div>
          <div class="spec-actions">
            <TuiButton variant="ghost" size="sm" title="复制该规格 JSON" @click="copySpec(s)">复制</TuiButton>
            <TuiButton variant="danger-ghost" size="sm" title="删除" @click="remove(s)">删除</TuiButton>
          </div>
        </li>
      </ul>

      <!-- 实例管理：重置子 Agent 累积的上下文 -->
      <section class="instances">
        <header class="instances-header">
          <h3>子 Agent 实例 <span class="instances-count">{{ instances.length }}</span></h3>
          <TuiButton
            variant="danger-ghost"
            size="sm"
            :disabled="instancesBusy || !hasSession() || instances.length === 0"
            @click="clearAllInstances"
          >
            清空实例
          </TuiButton>
        </header>
        <p v-if="!hasSession()" class="instances-empty">
          需先在「对话」页创建/切换会话，才能查看并清空该会话的子 Agent 实例。
        </p>
        <p v-else-if="instances.length === 0" class="instances-empty">
          当前会话暂无活跃子 Agent 实例。<br />委派任务给子 Agent 后将在此累积上下文。
        </p>
        <ul v-else class="instances-list">
          <li
            v-for="(inst, i) in instances"
            :key="inst.sub_agent_id"
            class="instance-item"
            :class="{ 'is-streaming': inst.is_streaming }"
          >
            <div class="instance-main">
              <span class="instance-seq" :title="`实例 ${i + 1}`">{{ i + 1 }}</span>
              <span class="instance-name">{{ inst.name }}</span>
              <code class="instance-id" :title="inst.sub_agent_id">{{
                inst.sub_agent_id.length > 8 ? inst.sub_agent_id.slice(0, 8) + '…' : inst.sub_agent_id
              }}</code>
              <span class="instance-msg" :title="'累积上下文消息数'">{{ inst.message_count }} 条</span>
            </div>
            <div class="instance-side">
              <span v-if="inst.is_streaming" class="streaming">流式中</span>
              <TuiButton
                variant="danger-ghost"
                size="sm"
                :disabled="instancesBusy || inst.is_streaming || !hasSession()"
                :title="'清空该实例的累积上下文'"
                @click="clearOneInstance(inst.sub_agent_id)"
              >
                清空
              </TuiButton>
            </div>
          </li>
        </ul>
        <Transition name="fade">
          <p v-if="instanceMsg" class="instances-msg" :class="instanceMsgType">{{ instanceMsg }}</p>
        </Transition>
      </section>
    </section>

    <!-- 右侧：新增 / 编辑表单 -->
    <section class="form">
      <header class="form-header">
        <h2>{{ editingId ? '编辑规格' : '新增规格' }}</h2>
        <div class="form-actions">
          <TuiButton variant="ghost" size="sm" @click="openImport">导入</TuiButton>
          <TuiButton variant="ghost" size="sm" @click="openExport">导出</TuiButton>
          <TuiButton v-if="editingId" variant="ghost" size="sm" @click="resetForm">取消编辑</TuiButton>
          <div class="tpl-wrap" ref="tplWrapRef">
            <TuiButton
              variant="ghost"
              size="sm"
              aria-haspopup="listbox"
              :aria-expanded="tplOpen"
              :aria-activedescendant="tplOpen && tplActive >= 0 ? `tpl-opt-${tplActive}` : undefined"
              @click="openTplMenu()"
            >
              模板
              <TuiIcon name="chevronDown" :size="12" :stroke-width="2" />
            </TuiButton>
            <!-- 过渡与 TuiSelect 菜单同一语言（批次90 4.4） -->
            <Transition name="tui-select">
              <ul v-if="tplOpen" class="tpl-menu" role="listbox" @keydown="onTplKeydown">
                <li
                  v-for="(t, i) in subagentTemplates"
                  :key="t.spec.id"
                  :id="`tpl-opt-${i}`"
                  tabindex="-1"
                  role="option"
                  :aria-selected="editingId === t.spec.id"
                  :class="{ 'is-focus': i === tplActive }"
                  @click="loadTemplate(t)"
                  @mouseenter="tplActive = i"
                >
                  <span class="tpl-label">{{ t.label }}</span>
                  <span class="tpl-hint">{{ t.hint }}</span>
                </li>
              </ul>
            </Transition>
          </div>
        </div>
      </header>

      <div class="field">
        <label for="spec-id">ID（唯一标识，delegate 时引用）</label>
        <input id="spec-id" name="spec-id" v-model="form.id" type="text" placeholder="如 coder / writer / data-analyst" :disabled="!!editingId" />
      </div>

      <div class="field">
        <label for="spec-name">名称</label>
        <input id="spec-name" name="spec-name" v-model="form.name" type="text" placeholder="如 代码助手" />
      </div>

      <div class="field">
        <label for="spec-description">能力描述（供主 Agent 的 LLM 选择时参考）</label>
        <textarea id="spec-description" name="spec-description" v-model="form.description" rows="2" placeholder="清晰描述该子 Agent 的专长" />
      </div>

      <div class="field">
        <label for="spec-system-prompt">系统提示词（定义专长与行为边界）</label>
        <textarea id="spec-system-prompt" name="spec-system-prompt" v-model="form.system_prompt" rows="5" placeholder="你是……请直接给出……" />
      </div>

      <div class="field row">
        <div class="subfield">
          <label for="spec-max-iterations">最大迭代次数</label>
          <input id="spec-max-iterations" name="spec-max-iterations" v-model.number="form.max_iterations" type="number" min="1" placeholder="可空" />
        </div>
      </div>

      <div class="field">
        <label for="spec-tools-whitelist">工具白名单（逗号分隔，空 = 继承全部工具）</label>
        <input
          id="spec-tools-whitelist"
          name="spec-tools-whitelist"
          v-model="whitelistText"
          type="text"
          placeholder="如 execute_command, shell_session_create（不填则子 Agent 可用全部工具）"
        />
        <p class="hint">限制子 Agent 只能看到/调用这些工具（工具隔离）。可参考终端工具名：execute_command、detect_shells、shell_session_create、shell_session_exec、shell_session_input、shell_session_destroy、shell_session_list。</p>
      </div>

      <Transition name="fade">
        <div v-if="formError" class="form-error">{{ formError }}</div>
      </Transition>

      <div class="submit-row">
        <TuiButton variant="primary" :loading="subBusy" @click="submit">
          {{ editingId ? '保存修改' : '新增规格' }}
        </TuiButton>
      </div>
    </section>

    <!-- 导出 / 导入弹窗（统一 TuiModal 基座） -->
    <TuiModal :show="ioOpen" :title="ioMode === 'export' ? '导出子 Agent 规格' : '导入子 Agent 规格'" size="lg" @close="ioOpen = false">
      <p v-if="ioMode === 'export'" class="io-tip">
        以下是当前全部规格的 JSON。可复制保存，换机后通过「导入」恢复。
      </p>
      <p v-else class="io-tip">
        粘贴从「导出」得到的 JSON 数组（或手写 <code>[{...}]</code>），同名 id 会覆盖现有规格。
      </p>
      <textarea
        class="io-text"
        :readonly="ioMode === 'export'"
        v-model="ioText"
        rows="12"
        spellcheck="false"
        :aria-label="ioMode === 'import' ? '粘贴待导入的规格 JSON' : '当前规格 JSON 内容'"
        :placeholder="ioMode === 'import' ? '例如 [{id, name, description, system_prompt}]' : ''"
      />
      <p v-if="ioMsg" class="io-msg" :class="ioMsgType">{{ ioMsg }}</p>

      <template #footer>
        <TuiButton v-if="ioMode === 'export'" variant="secondary" @click="copyJson">复制</TuiButton>
        <TuiButton v-if="ioMode === 'import'" variant="primary" :loading="subBusy" @click="doImport">
          导入
        </TuiButton>
        <TuiButton variant="ghost" @click="ioOpen = false">关闭</TuiButton>
      </template>
    </TuiModal>

    <!-- 删除 / 清空确认框 -->
    <TuiConfirm
      :show="confirmState.show"
      :title="confirmState.title"
      :message="confirmState.message"
      :danger="confirmState.danger"
      :confirm-text="confirmState.confirmText"
      @confirm="confirmState.onConfirm"
      @cancel="confirmState.show = false"
      @update:show="onConfirmShow"
    />
  </div>
</template>

<style scoped>
.subagent {
  display: flex;
  height: 100%;
  font-family: var(--font-sans);
}
.list {
  width: 340px;
  border-right: 1px solid var(--border);
  padding: 0 16px 16px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
/* 面板 header：吸顶横条，与对话/终端/记忆视图 header 同一视觉语言（surface 底 + 12px 垂直内边距 + 下边框） */
.list-header {
  position: sticky;
  top: 0;
  z-index: var(--z-sticky);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  margin: 0 -16px 12px;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.list-header h2 {
  font-size: var(--fs-lg);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}
.count {
  font-size: var(--fs-sm);
  color: var(--text-muted);
  background: var(--bg-muted);
  padding: 1px 8px;
  border-radius: var(--radius-pill);
}
.empty-hint {
  font-size: var(--fs-sm);
  color: var(--text-muted);
  margin: 0;
  line-height: var(--lh-base);
  max-width: 320px;
}
.empty-hint code {
  background: var(--bg-muted);
  padding: 1px 5px;
  border-radius: var(--radius-sm);
  font-size: var(--fs-sm);
}
.specs {
  list-style: none;
  padding: 0;
  margin: 0;
}
.spec {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  margin-bottom: 8px;
  transition: border-color var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease);
}
.spec:hover {
  border-color: var(--accent);
}
.spec.editing {
  border-color: var(--accent);
  background: var(--accent-soft);
}
/* 光标仅提示可点热区（.spec-main 可点，右侧操作按钮独立），与键盘热区一致 */
.spec-main {
  flex: 1;
  min-width: 0;
  cursor: pointer;
}
.spec-title {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.name {
  font-size: var(--fs-base);
  font-weight: 600;
  color: var(--text-primary);
}
.id {
  font-size: var(--fs-xs);
  color: var(--accent);
  background: var(--accent-soft);
  padding: 1px 6px;
  border-radius: var(--radius-sm);
}
.iter {
  font-size: var(--fs-xs);
  color: var(--text-muted);
}
.wl {
  font-size: var(--fs-xs);
  color: var(--text-secondary);
  background: var(--bg-muted);
  padding: 1px 6px;
  border-radius: var(--radius-sm);
}
.hint {
  font-size: var(--fs-xs);
  color: var(--text-secondary); /* 批次87 #25：帮助小字升 secondary 提升对比度 */
  margin-top: 6px;
  line-height: var(--lh-base);
}
.desc {
  font-size: var(--fs-sm);
  color: var(--text-secondary);
  margin-top: 4px;
  line-height: var(--lh-md);
}
/* 列表项操作按钮组（复制 + 删除 → TuiButton，悬浮显示；键盘聚焦也显形） */
.spec-actions {
  flex-shrink: 0;
  display: flex;
  gap: 6px;
  opacity: 0;
  transition: opacity var(--dur-fast) var(--ease);
}
.spec:hover .spec-actions,
.spec-actions:focus-within {
  opacity: 1;
}
/* 列表区瞬态提示：统一 box 形态（success 默认 / error 走 danger，批次59） */
.list-msg {
  font-size: var(--fs-sm);
  color: var(--success);
  background: var(--success-soft);
  border: 1px solid var(--success-soft);
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  margin: 0 0 10px;
}
.list-msg.error {
  border-color: var(--danger-soft);
  color: var(--danger);
  background: var(--danger-soft);
}
/* 实例管理区 */
.instances {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}
.instances-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.instances-header h3 {
  font-size: var(--fs-md);
  font-weight: 600;
  color: var(--text-secondary);
  margin: 0;
}
.instances-count {
  font-size: var(--fs-xs);
  color: var(--text-muted);
  background: var(--bg-muted);
  padding: 1px 8px;
  border-radius: var(--radius-pill);
  margin-left: 4px;
}
.instances-empty {
  font-size: var(--fs-sm);
  color: var(--text-muted);
  line-height: var(--lh-base);
  margin: 0;
}
.instances-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.instance-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  margin-bottom: 6px;
  transition: border-color var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease);
}
/* 流式执行中的实例：accent 边框 + 弱底强调（批次107 活跃实例区分） */
.instance-item.is-streaming {
  border-color: var(--accent);
  background: var(--accent-soft);
}
/* 实例卡片 hover 边框 accent 微反馈（与规格卡同一语言） */
.instance-item:hover {
  border-color: var(--accent);
}
.instance-main {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
/* 序号徽标：多实例视觉区分锚点（批次107），圆形弱底数字 */
.instance-seq {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--fs-xs);
  font-weight: 600;
  color: var(--text-muted);
  background: var(--bg-muted);
  border-radius: 50%;
}
.instance-name {
  font-size: var(--fs-md);
  font-weight: 500;
  color: var(--text-primary);
}
.instance-id {
  font-size: var(--fs-xs);
  color: var(--accent);
  background: var(--accent-soft);
  padding: 1px 6px;
  border-radius: var(--radius-sm);
}
.instance-msg {
  font-size: var(--fs-xs);
  color: var(--text-secondary);
  background: var(--bg-muted);
  padding: 1px 6px;
  border-radius: var(--radius-sm);
}
.instance-side {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.streaming {
  flex-shrink: 0;
  font-size: var(--fs-xs);
  color: var(--accent);
  background: var(--accent-soft);
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  animation: pulse var(--dur-pulse) ease-in-out infinite;
}
/* 实例区提示：统一 box 形态（与 list-msg 同构，批次59 收敛三分叉） */
.instances-msg {
  font-size: var(--fs-sm);
  color: var(--success);
  background: var(--success-soft);
  border: 1px solid var(--success-soft);
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  margin: 8px 0 0;
}
.instances-msg.error {
  border-color: var(--danger-soft);
  color: var(--danger);
  background: var(--danger-soft);
}
.form {
  flex: 1;
  padding: 0 20px 16px;
  overflow-y: auto;
}
/* 表单 header：与左侧面板 header 同构（吸顶横条 + 统一视觉语言） */
.form-header {
  position: sticky;
  top: 0;
  z-index: var(--z-sticky);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  margin: 0 -20px 16px;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.form-header h2 {
  font-size: var(--fs-lg);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}
.form-actions {
  display: flex;
  gap: 8px;
}
/* 模板下拉 */
.tpl-wrap {
  position: relative;
}
.tpl-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  list-style: none;
  margin: 0;
  padding: 6px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  z-index: var(--z-dropdown);
  min-width: 200px;
}
.tpl-menu li {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.tpl-menu li:hover {
  background: var(--accent-soft);
}
/* 按压反馈（批次89） */
.tpl-menu li:active {
  transform: scale(var(--press-scale));
}
/* 键盘导航高亮：与 TuiSelect is-focus 同一语言（bg-active 底 + 主文字色） */
.tpl-menu li.is-focus {
  background: var(--bg-active);
  outline: none;
}
.tpl-label {
  font-size: var(--fs-md);
  color: var(--text-primary);
  font-weight: 500;
}
.tpl-hint {
  font-size: var(--fs-xs);
  color: var(--text-muted);
}
.field {
  margin-bottom: 14px;
}
.field label {
  display: block;
  font-size: var(--fs-sm);
  color: var(--text-secondary);
  margin-bottom: 6px;
}
.field input,
.field textarea {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  font-size: var(--fs-md);
  font-family: inherit;
  outline: none;
  box-sizing: border-box;
  background: var(--bg-surface);
  color: var(--text-primary);
  transition: border-color var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease);
}
.field textarea {
  resize: vertical;
  line-height: var(--lh-md);
}
.field input:focus,
.field textarea:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.field input:disabled {
  background: var(--bg-muted);
  color: var(--text-muted);
}
.field.row {
  display: flex;
}
.subfield {
  flex: 1;
}
.form-error {
  color: var(--danger);
  font-size: var(--fs-md);
  background: var(--danger-soft);
  border: 1px solid var(--danger-soft);
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  margin-bottom: 12px;
}
/* 底部操作行：sticky 吸底——表单内容多或错误条出现导致滚动时，主按钮始终可见（批次87 #5） */
.submit-row {
  position: sticky;
  bottom: -16px; /* 抵消 .form 底部 padding，让按钮行贴底 */
  display: flex;
  justify-content: flex-end;
  margin: 8px -20px -16px;
  padding: 10px 20px 16px;
  background: var(--bg-app);
  border-top: 1px solid var(--border);
  z-index: var(--z-sticky);
}
/* 导入导出弹窗内容（弹窗基座由 TuiModal 提供） */
.io-tip {
  font-size: var(--fs-sm);
  color: var(--text-secondary);
  margin: 0 0 10px;
  line-height: var(--lh-base);
}
.io-tip code {
  background: var(--bg-muted);
  padding: 1px 5px;
  border-radius: var(--radius-sm);
  font-size: var(--fs-xs);
}
.io-text {
  width: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  font-family: var(--font-mono);
  font-size: var(--fs-sm);
  line-height: var(--lh-md);
  resize: vertical;
  outline: none;
  background: var(--bg-surface);
  color: var(--text-primary);
}
.io-text:focus {
  border-color: var(--accent);
}
/* 弹窗内提示：统一 box 形态（与 list-msg 同构，批次59）；距 textarea 12px 垂直节奏（批次87 #22） */
.io-msg {
  font-size: var(--fs-sm);
  color: var(--success);
  background: var(--success-soft);
  border: 1px solid var(--success-soft);
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  margin: 12px 0 0;
}
.io-msg.error {
  border-color: var(--danger-soft);
  color: var(--danger);
  background: var(--danger-soft);
}
</style>