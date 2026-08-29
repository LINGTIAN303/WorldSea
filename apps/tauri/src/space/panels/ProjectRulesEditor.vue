<!--
  ProjectRulesEditor：项目规则编辑器（H5 规则工程 P2，2026-08-30）
  - 规则文件 = <项目目录>/WORLDSMITH.md（随项目走，类比 AGENTS.md / Cursor Rules 心智）
  - 生效时机：新建会话时由 useAgentRust.buildSessionSystemPrompt 读入并注入
    system_prompt（static_p 段与场景 prompt 拼接非覆盖）
  - 未绑定项目目录时显示引导提示；文件不存在时保存即创建
-->
<template>
  <div class="project-rules">
    <div class="pr-header">
      <span class="pr-title">项目规则</span>
      <span class="pr-file">WORLDSMITH.md</span>
    </div>
    <p class="pr-hint">
      写入本项目的强制约束（语气、格式、禁忌、工作流等），Agent 新建会话时自动遵守。
      文件随项目目录走，可直接用外部编辑器修改。
    </p>

    <div v-if="!workdir" class="pr-empty">未绑定项目目录——先在上方选择项目目录后再配置规则。</div>
    <template v-else>
      <textarea
        v-model="draft"
        class="pr-editor"
        :disabled="loading || saving"
        rows="8"
        placeholder="例：&#10;- 所有实体命名使用中文，附拼音备注&#10;- 每次创建角色后必须建立至少一条关系&#10;- 输出设定时先列变更摘要"
        aria-label="项目规则内容"
      ></textarea>
      <div class="pr-actions">
        <button class="pr-btn" :disabled="saving || loading || draft === original" @click="onSave">
          {{ saving ? '保存中...' : '保存规则' }}
        </button>
        <span v-if="statusMsg" class="pr-status" :class="{ error: statusIsError }">{{ statusMsg }}</span>
        <span v-else-if="!loading && exists === false" class="pr-status">尚无规则文件，保存后创建</span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { resolveWorkspaceDir } from '@/space/workspace'
import { PROJECT_RULES_FILE } from '@/agent/composables/useAgentRust'

const workdir = ref<string | null>(null)
const draft = ref('')
const original = ref('')
const loading = ref(false)
const saving = ref(false)
const exists = ref<boolean | null>(null)
const statusMsg = ref('')
const statusIsError = ref(false)

onMounted(async () => {
  loading.value = true
  try {
    workdir.value = await resolveWorkspaceDir()
    const content = await tauriInvoke<string>('cmd_fs_read', { path: `${workdir.value}/${PROJECT_RULES_FILE}` })
    exists.value = true
    draft.value = content
    original.value = content
  } catch {
    exists.value = false // 文件不存在：空编辑态，保存即创建
  } finally {
    loading.value = false
  }
})

async function onSave(): Promise<void> {
  if (!workdir.value) return
  saving.value = true
  statusMsg.value = ''
  try {
    await tauriInvoke('cmd_fs_write', {
      path: `${workdir.value}/${PROJECT_RULES_FILE}`,
      content: draft.value,
      createDirs: true,
    })
    original.value = draft.value
    exists.value = true
    statusMsg.value = '已保存——新会话生效'
  } catch (e: unknown) {
    statusIsError.value = true
    statusMsg.value = `保存失败: ${e instanceof Error ? e.message : String(e)}`
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.project-rules {
  padding: 12px;
  border-top: 1px solid var(--color-border, rgba(128, 128, 128, 0.2));
}
.pr-header {
  display: flex;
  align-items: center;
  gap: 8px;
}
.pr-title {
  font-size: var(--font-size-base);
  font-weight: 600;
  color: var(--color-text);
}
.pr-file {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary, var(--color-text-2));
  background: var(--color-fill-2, rgba(128, 128, 128, 0.12));
  padding: 1px 6px;
  border-radius: 6px;
}
.pr-hint {
  margin: 6px 0 8px;
  font-size: var(--font-size-xs);
  color: var(--color-text-3, var(--color-text-secondary));
  line-height: 1.5;
}
.pr-empty {
  padding: 10px;
  font-size: var(--font-size-xs);
  color: var(--color-text-3, var(--color-text-secondary));
  background: var(--color-fill-1, rgba(128, 128, 128, 0.06));
  border-radius: 8px;
}
.pr-editor {
  width: 100%;
  box-sizing: border-box;
  min-height: 140px;
  padding: 8px 10px;
  font-family: var(--font-mono, monospace);
  font-size: var(--font-size-xs);
  line-height: 1.6;
  color: var(--color-text);
  background: var(--color-fill-1, rgba(128, 128, 128, 0.06));
  border: 1px solid var(--color-border, rgba(128, 128, 128, 0.25));
  border-radius: 8px;
  resize: vertical;
}
.pr-editor:focus {
  outline: none;
  border-color: var(--color-primary, #7c5cff);
}
.pr-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
}
.pr-btn {
  padding: 4px 14px;
  font-size: var(--font-size-xs);
  color: #fff;
  background: var(--color-primary, #7c5cff);
  border: none;
  border-radius: 8px;
  cursor: pointer;
}
.pr-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.pr-status {
  font-size: var(--font-size-xs);
  color: var(--color-success, #3fbf6f);
}
.pr-status.error {
  color: var(--color-danger, #e05a5a);
}
</style>
