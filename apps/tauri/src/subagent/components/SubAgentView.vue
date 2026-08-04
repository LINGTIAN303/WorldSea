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
import { ref, reactive, onMounted } from 'vue'
import { useSubagentRust, type SubAgentSpec } from '../composables/useSubagentRust'

const sub = useSubagentRust()
const { specs, busy: subBusy } = sub

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

/** 预填一个常用代码助手模板 */
function fillCoderTemplate() {
  editingId.value = 'coder'
  form.id = 'coder'
  form.name = '代码助手'
  form.description = '精通 Rust / TypeScript 代码编写，处理算法、函数实现、重构任务'
  form.system_prompt =
    '你是一个严谨的代码工程师。请直接给出简洁、正确的代码实现，关键行附中文注释，不做多余解释。'
  form.max_iterations = 5
  formError.value = ''
}

onMounted(sub.refreshSpecs)
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
          <button class="remove" title="删除" @click="remove(s)">删除</button>
        </li>
      </ul>
    </section>

    <!-- 右侧：新增 / 编辑表单 -->
    <section class="form">
      <header class="form-header">
        <h2>{{ editingId ? '编辑规格' : '新增规格' }}</h2>
        <div class="form-actions">
          <button v-if="editingId" class="ghost" @click="resetForm">取消编辑</button>
          <button class="ghost" @click="fillCoderTemplate">代码助手模板</button>
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
        <p class="hint">限制子 Agent 只能看到/调用这些工具（工具隔离）。可参考终端工具名：execute_command、shell_session_create、shell_session_exec、shell_session_destroy、shell_session_list。</p>
      </div>

      <div v-if="formError" class="form-error">{{ formError }}</div>

      <div class="submit-row">
        <button class="primary" :disabled="subBusy" @click="submit">
          {{ subBusy ? '提交中…' : editingId ? '保存修改' : '新增规格' }}
        </button>
      </div>
    </section>
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
.spec:hover .remove {
  opacity: 1;
}
.remove:hover {
  background: #d93025;
  color: #fff;
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
</style>