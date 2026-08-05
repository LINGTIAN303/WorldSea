<script setup lang="ts">
/**
 * # SubAgentView — 子 Agent 规格管理界面
 *
 * 提供子 Agent 规格的查看 / 注册 / 删除能力，使用户能在桌面端配置主 Agent
 * 可委派的子 Agent 专长（`delegate_to_sub_agent` / `list_sub_agents`）。
 * 通过 `useSubagentRust` 调用 Rust 命令层（`subagent_*`）。
 *
 * ## 交互
 * - 左侧：规格列表（ID / 名称 / 描述 / 最大迭代），可删除
 * - 右侧：新增 / 编辑表单（编辑时按 id 覆盖）
 */
import { ref, reactive, onMounted, onBeforeUnmount } from 'vue'
import { useSubagentRust, type SubAgentSpec } from '../composables/useSubagentRust'
import { useAgentRust } from '../../agent/composables/useAgentRust'
import { subagentTemplates, type SubAgentTemplate } from '../templates'

const sub = useSubagentRust()
const { specs, busy: subBusy } = sub
// 实例管理按会话隔离：接入 useAgentRust 获取当前活动会话 id
const agent = useAgentRust()
const { instances, instancesBusy, instanceMsg } = sub

// 表单状态
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

// 导出/导入弹窗状态
const ioOpen = ref(false)
const ioMode = ref<'export' | 'import'>('export')
const ioText = ref('')
const ioMsg = ref('')

/** 打开导出弹窗：拉取 JSON 填入 */
async function openExport() {
  ioMsg.value = ''
  try {
    ioText.value = await sub.exportSpecs()
    ioMode.value = 'export'
    ioOpen.value = true
  } catch (err) {
    ioMsg.value = err instanceof Error ? err.message : String(err)
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
  } catch (err) {
    ioMsg.value = err instanceof Error ? err.message : String(err)
  }
}

/** 执行导入 */
async function doImport() {
  ioMsg.value = ''
  const json = ioText.value.trim()
  if (!json) {
    ioMsg.value = '请粘贴要导入的 JSON 内容'
    return
  }
  try {
    const n = await sub.importSpecs(json)
    ioMsg.value = `导入成功：${n} 条规格（同名 id 已覆盖）`
    ioText.value = ''
    ioOpen.value = false
  } catch (err) {
    ioMsg.value = err instanceof Error ? err.message : String(err)
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
  } catch (err) {
    listMsg.value = err instanceof Error ? err.message : String(err)
  }
}

/** 删除规格 */
async function remove(spec: SubAgentSpec) {
  if (!window.confirm(`确定删除子 Agent「${spec.name}」（${spec.id}）？`)) return
  try {
    await sub.removeSpec(spec.id)
    if (editingId.value === spec.id) resetForm()
  } catch (err) {
    formError.value = err instanceof Error ? err.message : String(err)
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

/** 点击下拉外部时关闭菜单 */
function onDocClick(e: MouseEvent) {
  if (tplOpen.value && tplWrapRef.value && !tplWrapRef.value.contains(e.target as Node)) {
    tplOpen.value = false
  }
}
onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))

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
}

/** 是否有当前活动会话（无则实例管理区提示先创建会话） */
const hasSession = () => !!agent.currentSessionId?.value

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
  } catch (err) {
    instanceMsg.value = err instanceof Error ? err.message : String(err)
  }
}

/** 清空当前会话的全部子 Agent 实例（重置累积上下文） */
async function clearAllInstances() {
  const sid = agent.currentSessionId?.value
  if (!sid) return
  if (!window.confirm('确定清空当前会话的全部子 Agent 实例？\n这会重置它们累积的上下文，下次委派将按最新规格重建。')) return
  try {
    const n = await sub.clearInstances(sid)
    instanceMsg.value = n > 0 ? `已清空 ${n} 个子 Agent 实例` : '当前没有可清空的子 Agent 实例'
  } catch (err) {
    instanceMsg.value = err instanceof Error ? err.message : String(err)
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

      <div v-if="specs.length === 0" class="empty">
        暂无子 Agent 规格。<br />在右侧新增一个，主 Agent 即可通过
        <code>delegate_to_sub_agent</code> 委派任务给它。
      </div>
      <p v-if="listMsg" class="list-msg">{{ listMsg }}</p>

      <ul class="specs">
        <li v-for="s in specs" :key="s.id" class="spec" :class="{ editing: editingId === s.id }">
          <div class="spec-main" @click="edit(s)">
            <div class="spec-title">
              <span class="name">{{ s.name }}</span>
              <code class="id">{{ s.id }}</code>
              <span v-if="s.max_iterations" class="iter">max {{ s.max_iterations }}</span>
              <span v-if="s.tools_whitelist?.length" class="wl" :title="'白名单: ' + s.tools_whitelist.join(', ')">白名单 {{ s.tools_whitelist.length }}</span>
            </div>
            <div class="desc">{{ s.description }}</div>
          </div>
          <div class="spec-actions">
            <button class="copy" title="复制该规格 JSON" @click="copySpec(s)">复制</button>
            <button class="remove" title="删除" @click="remove(s)">删除</button>
          </div>
        </li>
      </ul>

      <!-- 实例管理：重置子 Agent 累积的上下文 -->
      <section class="instances">
        <header class="instances-header">
          <h3>子 Agent 实例 <span class="instances-count">{{ instances.length }}</span></h3>
          <button class="ghost inst-clear" :disabled="instancesBusy || !hasSession()" @click="clearAllInstances">
            清空实例
          </button>
        </header>
        <p v-if="!hasSession()" class="instances-empty">
          需先在「对话」页创建/切换会话，才能查看并清空该会话的子 Agent 实例。
        </p>
        <p v-else-if="instances.length === 0" class="instances-empty">
          当前会话暂无活跃子 Agent 实例。<br />委派任务给子 Agent 后将在此累积上下文。
        </p>
        <ul v-else class="instances-list">
          <li v-for="inst in instances" :key="inst.sub_agent_id" class="instance-item">
            <div class="instance-main">
              <span class="instance-name">{{ inst.name }}</span>
              <code class="instance-id">{{ inst.sub_agent_id }}</code>
              <span class="instance-msg" :title="'累积上下文消息数'">{{ inst.message_count }} 条</span>
            </div>
            <div class="instance-side">
              <span v-if="inst.is_streaming" class="streaming">流式中</span>
              <button
                class="ghost inst-clear-one"
                :disabled="instancesBusy || inst.is_streaming || !hasSession()"
                :title="'清空该实例的累积上下文'"
                @click="clearOneInstance(inst.sub_agent_id)"
              >
                清空
              </button>
            </div>
          </li>
        </ul>
        <p v-if="instanceMsg" class="instances-msg">{{ instanceMsg }}</p>
      </section>
    </section>

    <!-- 右侧：新增 / 编辑表单 -->
    <section class="form">
      <header class="form-header">
        <h2>{{ editingId ? '编辑规格' : '新增规格' }}</h2>
        <div class="form-actions">
          <button class="ghost" @click="openImport">导入</button>
          <button class="ghost" @click="openExport">导出</button>
          <button v-if="editingId" class="ghost" @click="resetForm">取消编辑</button>
          <div class="tpl-wrap" ref="tplWrapRef">
            <button class="ghost" @click="tplOpen = !tplOpen">模板</button>
            <ul v-if="tplOpen" class="tpl-menu">
              <li v-for="t in subagentTemplates" :key="t.spec.id" @click="loadTemplate(t)">
                <span class="tpl-label">{{ t.label }}</span>
                <span class="tpl-hint">{{ t.hint }}</span>
              </li>
            </ul>
          </div>
        </div>
      </header>

      <div class="field">
        <label>ID（唯一标识，delegate 时引用）</label>
        <input name="spec-id" v-model="form.id" type="text" placeholder="如 coder / writer / data-analyst" :disabled="!!editingId" />
      </div>

      <div class="field">
        <label>名称</label>
        <input name="spec-name" v-model="form.name" type="text" placeholder="如 代码助手" />
      </div>

      <div class="field">
        <label>能力描述（供主 Agent 的 LLM 选择时参考）</label>
        <textarea name="spec-description" v-model="form.description" rows="2" placeholder="清晰描述该子 Agent 的专长" />
      </div>

      <div class="field">
        <label>系统提示词（定义专长与行为边界）</label>
        <textarea name="spec-system-prompt" v-model="form.system_prompt" rows="5" placeholder="你是……请直接给出……" />
      </div>

      <div class="field row">
        <div class="subfield">
          <label>最大迭代次数</label>
          <input name="spec-max-iterations" v-model.number="form.max_iterations" type="number" min="1" placeholder="可空" />
        </div>
      </div>

      <div class="field">
        <label>工具白名单（逗号分隔，空 = 继承全部工具）</label>
        <input
          name="spec-tools-whitelist"
          v-model="whitelistText"
          type="text"
          placeholder="如 execute_command, shell_session_create（不填则子 Agent 可用全部工具）"
        />
        <p class="hint">限制子 Agent 只能看到/调用这些工具（工具隔离）。可参考终端工具名：execute_command、detect_shells、shell_session_create、shell_session_exec、shell_session_input、shell_session_destroy、shell_session_list。</p>
      </div>

      <div v-if="formError" class="form-error">{{ formError }}</div>

      <div class="submit-row">
        <button class="primary" :disabled="subBusy" @click="submit">
          {{ subBusy ? '提交中…' : editingId ? '保存修改' : '新增规格' }}
        </button>
      </div>
    </section>

    <!-- 导出 / 导入弹窗 -->
    <div v-if="ioOpen" class="io-mask">
      <div class="io-modal">
        <header class="io-header">
          <h3>{{ ioMode === 'export' ? '导出子 Agent 规格' : '导入子 Agent 规格' }}</h3>
          <button class="io-close" @click="ioOpen = false" aria-label="关闭">×</button>
        </header>
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
          :placeholder="ioMode === 'import' ? '例如 [{id, name, description, system_prompt}]' : ''"
        />
        <p v-if="ioMsg" class="io-msg">{{ ioMsg }}</p>
        <footer class="io-footer">
          <button v-if="ioMode === 'export'" class="ghost" @click="copyJson">复制</button>
          <button v-if="ioMode === 'import'" class="primary" :disabled="subBusy" @click="doImport">
            {{ subBusy ? '导入中…' : '导入' }}
          </button>
          <button class="ghost" @click="ioOpen = false">关闭</button>
        </footer>
      </div>
    </div>
  </div>
</template>

<style scoped>
.subagent {
  display: flex;
  height: 100%;
  font-family: system-ui, -apple-system, sans-serif;
}
.list {
  width: 340px;
  border-right: 1px solid #e5e5e5;
  padding: 16px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
.list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.list-header h2 {
  font-size: 14px;
  color: #666;
  margin: 0;
}
.count {
  font-size: 12px;
  color: #999;
  background: #f0f0f0;
  padding: 2px 8px;
  border-radius: 10px;
}
.empty {
  color: #999;
  font-size: 13px;
  text-align: center;
  padding: 24px 8px;
  line-height: 1.8;
}
.empty code {
  background: #f5f5f5;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 12px;
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
  border: 1px solid #eee;
  border-radius: 8px;
  margin-bottom: 8px;
  cursor: pointer;
}
.spec:hover {
  border-color: #1a73e8;
}
.spec.editing {
  border-color: #1a73e8;
  background: #f5f9ff;
}
.spec-main {
  flex: 1;
  min-width: 0;
}
.spec-title {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.name {
  font-size: 14px;
  font-weight: 600;
  color: #333;
}
.id {
  font-size: 11px;
  color: #1a73e8;
  background: #e8f0fe;
  padding: 1px 6px;
  border-radius: 4px;
}
.iter {
  font-size: 11px;
  color: #999;
}
.wl {
  font-size: 11px;
  color: #b45309;
  background: #fef3c7;
  padding: 1px 6px;
  border-radius: 4px;
}
.hint {
  font-size: 11px;
  color: #999;
  margin-top: 6px;
  line-height: 1.6;
}
.desc {
  font-size: 12px;
  color: #666;
  margin-top: 4px;
  line-height: 1.5;
}
.remove {
  flex-shrink: 0;
  padding: 4px 10px;
  border: 1px solid #f0c0c0;
  border-radius: 6px;
  background: #fff;
  color: #d93025;
  font-size: 12px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s;
}
.remove:hover {
  background: #d93025;
  color: #fff;
}
/* 列表项操作按钮组（复制 + 删除，悬浮显示） */
.spec-actions {
  flex-shrink: 0;
  display: flex;
  gap: 6px;
}
.spec-actions .copy,
.spec-actions .remove {
  opacity: 0;
  transition: opacity 0.15s;
}
.spec:hover .spec-actions .copy,
.spec:hover .spec-actions .remove {
  opacity: 1;
}
.copy {
  padding: 4px 10px;
  border: 1px solid #ddd;
  border-radius: 6px;
  background: #fff;
  color: #1a73e8;
  font-size: 12px;
  cursor: pointer;
}
.copy:hover {
  background: #e8f0fe;
}
/* 列表区瞬态提示 */
.list-msg {
  font-size: 12px;
  color: #188038;
  background: #e6f4ea;
  padding: 6px 10px;
  border-radius: 6px;
  margin: 0 0 10px;
}
/* 实例管理区 */
.instances {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid #eee;
}
.instances-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.instances-header h3 {
  font-size: 13px;
  color: #555;
  margin: 0;
}
.instances-count {
  font-size: 11px;
  color: #999;
  background: #f0f0f0;
  padding: 1px 7px;
  border-radius: 10px;
  margin-left: 4px;
}
.inst-clear {
  font-size: 12px;
  color: #d93025;
  border-color: #f0c0c0;
}
.inst-clear:hover {
  color: #fff;
  background: #d93025;
  border-color: #d93025;
}
.inst-clear:disabled {
  color: #bbb;
  background: #fff;
  border-color: #eee;
  cursor: not-allowed;
}
.instances-empty {
  font-size: 12px;
  color: #999;
  line-height: 1.7;
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
  border: 1px solid #f0f0f0;
  border-radius: 8px;
  margin-bottom: 6px;
}
.instance-main {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.instance-name {
  font-size: 13px;
  font-weight: 500;
  color: #333;
}
.instance-id {
  font-size: 11px;
  color: #1a73e8;
  background: #e8f0fe;
  padding: 1px 5px;
  border-radius: 4px;
}
.instance-msg {
  font-size: 11px;
  color: #999;
}
.instance-side {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.inst-clear-one {
  font-size: 11px;
  color: #d93025;
  border-color: #f0c0c0;
  padding: 1px 8px;
}
.inst-clear-one:hover {
  color: #fff;
  background: #d93025;
  border-color: #d93025;
}
.inst-clear-one:disabled {
  color: #bbb;
  background: #fff;
  border-color: #eee;
  cursor: not-allowed;
}
.streaming {
  flex-shrink: 0;
  font-size: 11px;
  color: #b45309;
  background: #fef3c7;
  padding: 1px 6px;
  border-radius: 4px;
  animation: pulse 1.2s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
.instances-msg {
  font-size: 12px;
  color: #1a73e8;
  margin: 8px 0 0;
}
.form {
  flex: 1;
  padding: 16px 20px;
  overflow-y: auto;
}
.form-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.form-header h2 {
  font-size: 15px;
  color: #333;
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
.tpl-wrap .ghost {
  min-width: 52px;
}
.tpl-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  list-style: none;
  margin: 0;
  padding: 6px;
  background: #fff;
  border: 1px solid #e5e5e5;
  border-radius: 8px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12);
  z-index: 20;
  min-width: 200px;
}
.tpl-menu li {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
}
.tpl-menu li:hover {
  background: #f5f9ff;
}
.tpl-label {
  font-size: 13px;
  color: #333;
  font-weight: 500;
}
.tpl-hint {
  font-size: 11px;
  color: #999;
}
.field {
  margin-bottom: 14px;
}
.field label {
  display: block;
  font-size: 12px;
  color: #666;
  margin-bottom: 6px;
}
.field input,
.field textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #ddd;
  border-radius: 8px;
  font-size: 13px;
  font-family: inherit;
  outline: none;
  box-sizing: border-box;
}
.field textarea {
  resize: vertical;
  line-height: 1.5;
}
.field input:focus,
.field textarea:focus {
  border-color: #1a73e8;
}
.field input:disabled {
  background: #f5f5f5;
  color: #999;
}
.field.row {
  display: flex;
}
.subfield {
  flex: 1;
}
.form-error {
  color: #d93025;
  font-size: 13px;
  background: #fce8e6;
  padding: 8px 12px;
  border-radius: 6px;
  margin-bottom: 12px;
}
.submit-row {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}
.primary {
  padding: 10px 24px;
  border: none;
  border-radius: 8px;
  background: #1a73e8;
  color: #fff;
  font-size: 14px;
  cursor: pointer;
}
.primary:disabled {
  background: #ccc;
  cursor: not-allowed;
}
.ghost {
  padding: 6px 14px;
  border: 1px solid #ddd;
  border-radius: 6px;
  background: #fff;
  color: #666;
  font-size: 12px;
  cursor: pointer;
}
.ghost:hover {
  border-color: #1a73e8;
  color: #1a73e8;
}
/* 导出/导入弹窗 */
.io-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}
.io-modal {
  width: 560px;
  max-width: 90vw;
  background: #fff;
  border-radius: 12px;
  padding: 18px 20px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.2);
}
.io-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.io-header h3 {
  font-size: 15px;
  color: #333;
  margin: 0;
}
.io-close {
  border: none;
  background: transparent;
  font-size: 20px;
  line-height: 1;
  color: #999;
  cursor: pointer;
  padding: 2px 6px;
}
.io-close:hover {
  color: #333;
}
.io-tip {
  font-size: 12px;
  color: #666;
  margin: 0 0 10px;
  line-height: 1.6;
}
.io-tip code {
  background: #f5f5f5;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 11px;
}
.io-text {
  width: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  border: 1px solid #ddd;
  border-radius: 8px;
  font-family: ui-monospace, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  resize: vertical;
  outline: none;
}
.io-text:focus {
  border-color: #1a73e8;
}
.io-msg {
  font-size: 12px;
  color: #1a73e8;
  margin: 8px 0 0;
}
.io-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
}
</style>