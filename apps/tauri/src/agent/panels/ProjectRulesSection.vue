<!--
  ProjectRulesSection：项目规则（`{workdir}/.worldsea/permissions.json`）编辑与重载（UX-b / S4-c）
  - 编辑方式与 RulesPanel 一致（内置编辑器；`cmd_fs_read` / `cmd_fs_write` createDirs）
  - 重载 = `reload_project_rules`（会话级；文件不存在 / JSON 无效 / 无工作区 → false，绝不猜测）
  - 该文件位于**数据区**（Agent 不可自改）；本面板供用户直接编辑
-->
<template>
  <div class="pr-section">
    <div class="pr-label">项目规则（.worldsea/permissions.json）</div>
    <div v-if="!workdir" class="pr-hint">
      当前会话未绑定工作区——项目规则文件位于工作区根目录下，绑定目录后可用。
    </div>
    <template v-else>
      <div class="pr-hint">
        路径：<code class="pr-path">{{ rulesPath }}</code>
      </div>
      <div class="pr-hint">
        格式 {"deny":[…],"ask":[…],"allow":[…]}；条目 "tool" 或 "tool:内容"（内容含 * 视为通配）；
        优先级 deny &gt; ask &gt; allow
      </div>
      <textarea
        v-model="draft"
        class="pr-editor"
        rows="8"
        spellcheck="false"
        placeholder='{ "deny": [], "ask": [], "allow": [] }'
      />
      <div class="pr-actions">
        <TuiButton size="sm" variant="ghost" :disabled="saving || loading" @click="onSave">保存</TuiButton>
        <TuiButton size="sm" variant="ghost" :disabled="reloading" @click="onReload">
          重载到当前会话
        </TuiButton>
        <TuiButton size="sm" variant="ghost" :disabled="loading" @click="load">重新读取</TuiButton>
        <span v-if="status" class="pr-status" :class="{ err: statusError }">{{ status }}</span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { invoke } from '@/agent/composables/transport'
import { useAgentRust } from '@/agent/composables/useAgentRust'
import TuiButton from '@/components/ui/TuiButton.vue'

const { currentSessionId, currentWorkdir } = useAgentRust()
/** 模板用别名（当前会话绑定的工作区根目录） */
const workdir = currentWorkdir

const draft = ref('')
const loading = ref(false)
const saving = ref(false)
const reloading = ref(false)
const status = ref('')
const statusError = ref(false)

/** 规则文件路径（workdir 归一化尾部分隔符；Windows 反斜杠 / POSIX 斜杠均按原样） */
const rulesPath = computed(() => {
  const wd = currentWorkdir.value
  if (!wd) return ''
  const sep = wd.includes('\\') ? '\\' : '/'
  return `${wd.replace(/[\\/]$/, '')}${sep}.worldsea${sep}permissions.json`
})

/** 读取现有文件；不存在 → 给空模板（保存即创建） */
async function load(): Promise<void> {
  const path = rulesPath.value
  if (!path) return
  loading.value = true
  status.value = ''
  statusError.value = false
  try {
    draft.value = await invoke<string>('cmd_fs_read', { path })
  } catch {
    draft.value = '{\n  "deny": [],\n  "ask": [],\n  "allow": []\n}'
    status.value = '规则文件尚不存在——保存后创建'
  } finally {
    loading.value = false
  }
}

async function onSave(): Promise<void> {
  const path = rulesPath.value
  if (!path) return
  saving.value = true
  status.value = ''
  try {
    await invoke('cmd_fs_write', { path, content: draft.value, createDirs: true })
    status.value = '已保存——点「重载到当前会话」使其生效'
    statusError.value = false
  } catch (e) {
    status.value = `保存失败：${e instanceof Error ? e.message : String(e)}`
    statusError.value = true
  } finally {
    saving.value = false
  }
}

/** 重载到当前会话（Rust：按 workdir 读文件并解析；false = 未加载到规则） */
async function onReload(): Promise<void> {
  const sid = currentSessionId.value
  if (!sid) {
    status.value = '无活跃会话'
    statusError.value = true
    return
  }
  reloading.value = true
  status.value = ''
  try {
    const loaded = await invoke<boolean>('reload_project_rules', { sessionId: sid })
    status.value = loaded
      ? '已重载（规则已生效）'
      : '未加载到规则（文件不存在 / JSON 无效 / 无工作区）'
    statusError.value = !loaded
  } catch (e) {
    status.value = `重载失败：${e instanceof Error ? e.message : String(e)}`
    statusError.value = true
  } finally {
    reloading.value = false
  }
}

// 会话切换 / 工作区变化 → 重读该工作区的规则文件
watch(rulesPath, () => void load(), { immediate: true })
</script>

<style scoped>
.pr-section {
  margin-bottom: 14px;
}
.pr-label {
  font-size: var(--font-size-sm, 13px);
  color: var(--agent-text-secondary, var(--text-secondary));
  margin-bottom: 6px;
}
.pr-hint {
  font-size: var(--font-size-xs, 12px);
  color: var(--agent-text-tertiary, var(--text-muted));
  margin-top: 4px;
}
.pr-path {
  background: var(--bg-muted);
  border-radius: var(--radius-sm);
  padding: 1px 5px;
  word-break: break-all;
}
.pr-editor {
  width: 100%;
  margin-top: 8px;
  box-sizing: border-box;
  background: var(--bg-input, var(--bg-subtle));
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 6px 8px;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-primary);
  resize: vertical;
  outline: none;
}
.pr-editor:focus {
  border-color: var(--accent);
}
.pr-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  flex-wrap: wrap;
}
.pr-status {
  font-size: var(--font-size-xs, 12px);
  color: var(--success);
}
.pr-status.err {
  color: var(--danger);
}
</style>
