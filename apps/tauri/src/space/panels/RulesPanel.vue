<!--
  RulesPanel：规则卡片面板（H5 八文件体系，2026-08-30 拍板）
  - 主设置 Agent 类下的规则统一编辑入口：八张文件卡（点击选中 → 下方编辑区）
  - 双层文件（WORLD/WRITING/DESIGN/TOOLS）卡内「项目级/全局级」作用域切换，
    分别编辑 <workdir>/X.md 与 <app_data>/worldsmith/rules/X.md
  - WORLDSMITH.md = 应用内置资源只读展示（唯一不可被 Agent/用户编辑，随版本维护）
  - MEMORY.md = 说明卡（用户不可直接编辑，Agent 可改；记忆系统设计展开后启用）
  - WORLD.md 保存即落盘；注入 = 节奏型（实体操作触发重注入，机制上线后生效）
  - 生效时机：新建会话时由 useAgentRust.buildSessionSystemPrompt 读入并注入
-->
<template>
  <div class="rules-panel">
    <div class="rp-header">
      <span class="rp-title">规则卡片</span>
      <span class="rp-header-hint">用户与 Agent 共同维护 · 新会话生效</span>
    </div>

    <!-- 八卡宫格 -->
    <div class="rp-grid">
      <button
        v-for="m in FILE_METAS" :key="m.id"
        class="rp-card" :class="{ on: activeId === m.id, special: m.readonly || m.disabled }"
        :title="m.title"
        @click="selectCard(m)"
      >
        <span class="rp-card-file">{{ m.file }}</span>
        <span class="rp-card-title">{{ m.title }}</span>
        <span class="rp-card-tags">
          <i v-for="t in cardTags(m)" :key="t" class="rp-tag" :class="{ builtin: m.readonly }">{{ t }}</i>
          <i v-if="isDirty(m)" class="rp-tag dirty">未保存</i>
        </span>
      </button>
    </div>

    <!-- 编辑区 -->
    <div v-if="activeMeta" class="rp-editor-wrap">
      <div class="rp-editor-head">
        <span class="rp-active-file">{{ activeMeta.file }}</span>
        <div v-if="activeMeta.scopes.length > 1" class="rp-scope-switch">
          <button
            v-for="s in activeMeta.scopes" :key="s"
            class="rp-scope-btn" :class="{ on: activeScope === s }"
            @click="switchScope(s)"
          >{{ s === 'project' ? '项目级' : '全局级' }}</button>
        </div>
      </div>
      <div class="rp-path" :title="activePath ?? undefined">
        {{ activePath ?? (activeMeta.readonly ? '应用内置资源' : '路径不可用——项目级需绑定项目目录，全局级需应用数据目录') }}
      </div>

      <!-- WORLDSMITH：只读展示 -->
      <template v-if="activeMeta.readonly">
        <pre class="rp-readonly">{{ builtinWorldsmithMd }}</pre>
        <div class="rp-note">应用内置系统文档（随版本维护，不可编辑），Agent 新会话自动注入。</div>
      </template>

      <!-- MEMORY：说明卡 -->
      <template v-else-if="activeMeta.disabled">
        <div class="rp-note-block">
          MEMORY.md 由 <b>Agent 维护</b>（记录对你的最重要记忆信息），用户不可在此直接编辑；
          可在对话中让 Agent 修改。记忆能力随记忆系统设计展开后启用。
        </div>
      </template>

      <!-- 常规编辑 -->
      <template v-else-if="activePath && activeDraft">
        <textarea
          v-model="activeDraft.draft"
          class="rp-editor"
          :disabled="activeDraft.loading || saving"
          rows="8"
          :placeholder="placeholder"
          :aria-label="`${activeMeta.file} 内容`"
        ></textarea>
        <div class="rp-actions">
          <button
            class="rp-btn"
            :disabled="saving || activeDraft.loading || activeDraft.draft === activeDraft.original"
            @click="onSave"
          >{{ saving ? '保存中...' : '保存' }}</button>
          <span v-if="statusMsg" class="rp-status" :class="{ error: statusIsError }">{{ statusMsg }}</span>
          <span v-else-if="!activeDraft.loading && activeDraft.exists === false" class="rp-status">尚无文件，保存后创建</span>
        </div>
        <div v-if="activeMeta.note" class="rp-note">{{ activeMeta.note }}</div>
        <!-- WORLD.md 节奏型注入阈值（用户拍板：默认 20，可配置 1-150） -->
        <div v-if="activeMeta.id === 'world'" class="rp-threshold">
          <label class="rp-threshold-label" for="rp-world-threshold">注入触发阈值</label>
          <input
            id="rp-world-threshold"
            type="number"
            min="1"
            max="150"
            :value="worldThreshold"
            class="rp-threshold-input"
            @change="onThresholdChange(($event.target as HTMLInputElement).value)"
          />
          <span class="rp-threshold-hint">次实体写操作触发一次 WORLD.md 重注入（1-150，默认 20）</span>
        </div>
      </template>
    </div>
    <div v-else class="rp-note-block muted">点击上方卡片选择要编辑的规则文件。</div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { resolveWorkspaceDir } from '@/space/workspace'
import { invoke, invokeRpc } from '@/agent/composables/transport'
import {
  getWorldRulesThreshold,
  setWorldRulesThreshold,
} from '@/agent/composables/worldRulesInjector'
import {
  AGENTS_RULES_FILE,
  DESIGN_RULES_FILE,
  MEMORY_RULES_FILE,
  RULES_RULES_FILE,
  TOOLS_RULES_FILE,
  WORLD_RULES_FILE,
  WRITING_RULES_FILE,
} from '@/agent/composables/useAgentRust'
import BUILTIN_WORLDSMITH_MD from '../../agent/rules/WORLDSMITH.md?raw'

type Scope = 'project' | 'global'

/** 规则文件元数据（八卡；scopes 为空 = 非编辑卡） */
interface RuleFileMeta {
  id: string
  file: string
  title: string
  scopes: Scope[]
  readonly?: boolean
  disabled?: boolean
  note?: string
}

const FILE_METAS: RuleFileMeta[] = [
  { id: 'world', file: WORLD_RULES_FILE, title: '世界观固定规则', scopes: ['project', 'global'], note: '注入方式 = 节奏型：Agent 的实体写操作累计达到阈值时，自动把本文件相关分节重注入其上下文。' },
  { id: 'writing', file: WRITING_RULES_FILE, title: '写作规则', scopes: ['project', 'global'] },
  { id: 'worldsmith', file: 'WORLDSMITH.md', title: '系统说明', scopes: [], readonly: true },
  { id: 'agents', file: AGENTS_RULES_FILE, title: '协作规则', scopes: ['project'] },
  { id: 'rules', file: RULES_RULES_FILE, title: '全局规则', scopes: ['global'] },
  { id: 'design', file: DESIGN_RULES_FILE, title: '设计规则', scopes: ['project', 'global'] },
  { id: 'tools', file: TOOLS_RULES_FILE, title: '工具规则', scopes: ['project', 'global'] },
  { id: 'memory', file: MEMORY_RULES_FILE, title: '记忆', scopes: [], disabled: true },
]

interface DraftState {
  draft: string
  original: string
  exists: boolean | null
  loading: boolean
}

const workdir = ref<string | null>(null)
const rulesDir = ref<string | null>(null)
const activeId = ref<string | null>(null)
const activeScope = ref<Scope>('project')
const saving = ref(false)
const statusMsg = ref('')
const statusIsError = ref(false)
/** 各 (文件,作用域) 组合的编辑草稿缓存——切换不丢未保存内容 */
const drafts = reactive<Record<string, DraftState>>({})
/** 各组合的存在性（卡片状态点；挂载时全量探测） */
const existsMap = reactive<Record<string, boolean>>({})

const activeMeta = computed(() => FILE_METAS.find((m) => m.id === activeId.value) ?? null)
const activeKey = computed(() => (activeMeta.value ? `${activeMeta.value.id}:${activeScope.value}` : ''))
const activePath = computed(() => (activeMeta.value ? pathFor(activeMeta.value, activeScope.value) : null))
const activeDraft = computed(() => drafts[activeKey.value] ?? null)
const builtinWorldsmithMd = BUILTIN_WORLDSMITH_MD
const placeholder = '每行一条规则；支持 Markdown 列表与小节'

function pathFor(meta: RuleFileMeta, scope: Scope): string | null {
  if (meta.readonly || meta.disabled) return null
  if (scope === 'project') return workdir.value ? `${workdir.value}/${meta.file}` : null
  return rulesDir.value ? `${rulesDir.value}/${meta.file}` : null
}

/** 卡片标签：作用域（项目/全局）或特殊态（内置/记忆域） */
function cardTags(m: RuleFileMeta): string[] {
  if (m.readonly) return ['内置']
  if (m.disabled) return ['记忆域']
  return m.scopes.map((s) => (s === 'project' ? '项目' : '全局'))
}

function isDirty(m: RuleFileMeta): boolean {
  return m.scopes.some((s) => {
    const d = drafts[`${m.id}:${s}`]
    return !!d && d.draft !== d.original
  })
}

function selectCard(m: RuleFileMeta): void {
  if (activeId.value === m.id) return
  activeId.value = m.id
  activeScope.value = m.scopes[0] ?? 'project'
  statusMsg.value = ''
  statusIsError.value = false
  if (!m.readonly && !m.disabled) void ensureDraft(m, activeScope.value)
}

function switchScope(s: Scope): void {
  if (activeScope.value === s) return
  activeScope.value = s
  statusMsg.value = ''
  statusIsError.value = false
  if (activeMeta.value) void ensureDraft(activeMeta.value, s)
}

/** 惰性加载草稿（已加载直接复用——切换不丢未保存内容） */
async function ensureDraft(meta: RuleFileMeta, scope: Scope): Promise<void> {
  const key = `${meta.id}:${scope}`
  if (drafts[key]) return
  const path = pathFor(meta, scope)
  if (!path) return
  drafts[key] = { draft: '', original: '', exists: null, loading: true }
  try {
    const content = await invoke<string>('cmd_fs_read', { path })
    drafts[key] = { draft: content, original: content, exists: true, loading: false }
  } catch {
    drafts[key] = { draft: '', original: '', exists: false, loading: false }
  }
}

async function onSave(): Promise<void> {
  const meta = activeMeta.value
  const path = activePath.value
  const d = activeDraft.value
  const key = activeKey.value
  if (!meta || !path || !d) return
  saving.value = true
  statusMsg.value = ''
  statusIsError.value = false
  try {
    await invoke('cmd_fs_write', { path, content: d.draft, createDirs: true })
    d.original = d.draft
    d.exists = true
    existsMap[key] = true
    statusMsg.value = '已保存——当前会话已自动刷新，新会话同样生效'
    // H5 风险点③ 动态刷新：通知 useAgentRust 重建当前会话 system prompt（技能/规则中途生效）
    window.dispatchEvent(new CustomEvent('ws-session-prompt-dirty', { detail: { source: 'rules' } }))
  } catch (e: unknown) {
    statusIsError.value = true
    statusMsg.value = `保存失败: ${e instanceof Error ? e.message : String(e)}`
  } finally {
    saving.value = false
  }
}

/** WORLD.md 节奏型注入阈值（用户拍板：默认 20，可配置 1-150；localStorage 单消费方） */
const worldThreshold = ref(getWorldRulesThreshold())
function onThresholdChange(raw: string): void {
  setWorldRulesThreshold(Number(raw))
  worldThreshold.value = getWorldRulesThreshold()
}

onMounted(async () => {
  try {
    workdir.value = await resolveWorkspaceDir()
  } catch { workdir.value = null }
  try {
    const dataDir = await invokeRpc<string>('cmd_get_app_data_dir')
    rulesDir.value = dataDir ? `${dataDir.replace(/[\\/]+$/, '')}/worldsmith/rules` : null
  } catch { rulesDir.value = null }
  // 全量探测存在性（卡片状态点；异步尽力而为）
  for (const m of FILE_METAS) {
    for (const scope of m.scopes) {
      const path = pathFor(m, scope)
      const key = `${m.id}:${scope}`
      if (!path) continue
      void invoke('cmd_fs_read', { path })
        .then(() => { existsMap[key] = true })
        .catch(() => { existsMap[key] = false })
    }
  }
})
</script>

<style scoped>
.rules-panel {
  padding: 12px;
  border-top: 1px solid var(--color-border, rgba(128, 128, 128, 0.2));
}
.rp-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.rp-title {
  font-size: var(--font-size-base);
  font-weight: 600;
  color: var(--color-text);
}
.rp-header-hint {
  font-size: var(--font-size-2xs, 10px);
  color: var(--color-text-3, var(--color-text-secondary));
}
.rp-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  margin: 10px 0;
}
.rp-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 7px 8px;
  text-align: left;
  border: 1px solid var(--color-border, rgba(128, 128, 128, 0.25));
  border-radius: 8px;
  background: var(--color-fill-1, rgba(128, 128, 128, 0.06));
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.rp-card:hover { border-color: var(--color-primary, #7c5cff); }
.rp-card.on {
  border-color: var(--color-primary, #7c5cff);
  background: color-mix(in srgb, var(--color-primary, #7c5cff) 10%, transparent);
}
.rp-card.special { opacity: 0.85; }
.rp-card-file {
  font-family: var(--font-mono, monospace);
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--color-text);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rp-card-title {
  font-size: var(--font-size-2xs, 10px);
  color: var(--color-text-3, var(--color-text-secondary));
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rp-card-tags { display: flex; gap: 3px; flex-wrap: wrap; }
.rp-tag {
  font-style: normal;
  font-size: 9px;
  padding: 0 4px;
  border-radius: 4px;
  background: var(--color-fill-2, rgba(128, 128, 128, 0.14));
  color: var(--color-text-secondary, var(--color-text-2));
}
.rp-tag.builtin { background: color-mix(in srgb, var(--color-primary, #7c5cff) 16%, transparent); color: var(--color-primary, #7c5cff); }
.rp-tag.dirty { background: var(--color-warning-bg, rgba(230, 162, 60, 0.2)); color: var(--color-warning, #e6a23c); }
.rp-editor-wrap {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 10px;
  border-top: 1px dashed var(--color-border, rgba(128, 128, 128, 0.2));
}
.rp-editor-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.rp-active-file { font-family: var(--font-mono, monospace); font-size: var(--font-size-xs); font-weight: 600; color: var(--color-text); }
.rp-scope-switch { display: flex; gap: 2px; }
.rp-scope-btn {
  padding: 2px 10px;
  font-size: var(--font-size-2xs, 10px);
  border: 1px solid var(--color-border, rgba(128, 128, 128, 0.25));
  border-radius: 999px;
  background: transparent;
  color: var(--color-text-3, var(--color-text-secondary));
  cursor: pointer;
}
.rp-scope-btn.on {
  border-color: var(--color-primary, #7c5cff);
  color: var(--color-primary, #7c5cff);
  background: color-mix(in srgb, var(--color-primary, #7c5cff) 10%, transparent);
}
.rp-path {
  font-family: var(--font-mono, monospace);
  font-size: var(--font-size-2xs, 10px);
  color: var(--color-text-3, var(--color-text-secondary));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rp-editor {
  width: 100%;
  box-sizing: border-box;
  min-height: 130px;
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
.rp-editor:focus { outline: none; border-color: var(--color-primary, #7c5cff); }
.rp-readonly {
  margin: 0;
  max-height: 220px;
  overflow: auto;
  padding: 8px 10px;
  font-family: var(--font-mono, monospace);
  font-size: var(--font-size-xs);
  line-height: 1.6;
  color: var(--color-text-secondary, var(--color-text-2));
  background: var(--color-fill-1, rgba(128, 128, 128, 0.06));
  border: 1px solid var(--color-border, rgba(128, 128, 128, 0.25));
  border-radius: 8px;
  white-space: pre-wrap;
}
.rp-actions { display: flex; align-items: center; gap: 10px; }
.rp-btn {
  padding: 4px 14px;
  font-size: var(--font-size-xs);
  color: #fff;
  background: var(--color-primary, #7c5cff);
  border: none;
  border-radius: 8px;
  cursor: pointer;
}
.rp-btn:disabled { opacity: 0.5; cursor: default; }
.rp-status { font-size: var(--font-size-xs); color: var(--color-success, #3fbf6f); }
.rp-status.error { color: var(--color-danger, #e05a5a); }
.rp-note, .rp-note-block {
  font-size: var(--font-size-2xs, 10px);
  color: var(--color-text-3, var(--color-text-secondary));
  line-height: 1.5;
}
.rp-threshold { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.rp-threshold-label { font-size: var(--font-size-2xs, 10px); color: var(--color-text); }
.rp-threshold-input {
  width: 64px;
  padding: 2px 6px;
  font-size: var(--font-size-xs);
  color: var(--color-text);
  background: var(--color-fill-1, rgba(128, 128, 128, 0.06));
  border: 1px solid var(--color-border, rgba(128, 128, 128, 0.25));
  border-radius: 6px;
}
.rp-threshold-input:focus { outline: none; border-color: var(--color-primary, #7c5cff); }
.rp-threshold-hint { font-size: var(--font-size-2xs, 10px); color: var(--color-text-3, var(--color-text-secondary)); }
.rp-note-block {
  padding: 10px;
  background: var(--color-fill-1, rgba(128, 128, 128, 0.06));
  border-radius: 8px;
}
.rp-note-block.muted { text-align: center; }
.rp-note-block b { color: var(--color-text); }
</style>
