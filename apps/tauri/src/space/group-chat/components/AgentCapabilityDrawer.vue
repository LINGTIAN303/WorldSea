<template>
  <div class="capability-panel">
    <div class="panel-header">
      <span class="panel-title">能力配置</span>
      <button class="panel-close" @click="$emit('close')">
        <WsIcon name="x" size="xs" />
      </button>
    </div>

    <div class="panel-body">
      <!-- 技能选择 -->
      <div class="skills-section">
        <div class="section-header">
          <div class="section-label">技能</div>
          <div class="section-actions">
            <button class="action-btn" @click="selectAllSkills">全选</button>
            <button class="action-btn" @click="clearAllSkills">清空</button>
          </div>
        </div>
        <div class="skills-desc">选择此 Agent 具备的能力，工具将自动从技能派生</div>

        <!-- 领域技能 -->
        <div v-if="domainSkills.length > 0" class="skill-group">
          <div class="skill-group-label">领域</div>
          <div
            v-for="skill in domainSkills"
            :key="skill.id"
            class="skill-row"
            :class="{ active: enabledSkills.includes(skill.id) }"
            @click="toggleSkill(skill.id)"
            :title="skill.description"
          >
            <WsIcon :name="skill.icon" size="xs" class="skill-row-icon" />
            <span class="skill-row-name">{{ skill.name }}</span>
            <span class="skill-row-count">{{ getSkillToolCount(skill) }} 工具</span>
            <WsIcon v-if="enabledSkills.includes(skill.id)" name="check" size="xs" class="skill-row-check" />
          </div>
        </div>

        <!-- 动作技能 -->
        <div v-if="actionSkills.length > 0" class="skill-group">
          <div class="skill-group-label">动作</div>
          <div
            v-for="skill in actionSkills"
            :key="skill.id"
            class="skill-row"
            :class="{ active: enabledSkills.includes(skill.id) }"
            @click="toggleSkill(skill.id)"
            :title="skill.description"
          >
            <WsIcon :name="skill.icon" size="xs" class="skill-row-icon" />
            <span class="skill-row-name">{{ skill.name }}</span>
            <span class="skill-row-count">{{ getSkillToolCount(skill) }} 工具</span>
            <WsIcon v-if="enabledSkills.includes(skill.id)" name="check" size="xs" class="skill-row-check" />
          </div>
        </div>

        <div v-if="enabledSkills.length === 0" class="skills-hint">
          未选择技能，Agent 将不具备任何工具能力
        </div>
      </div>

      <!-- 工具预览 -->
      <div v-if="skillDerivedToolNames.length > 0" class="tool-preview-section">
        <div class="section-header">
          <div class="section-label">工具预览（{{ skillDerivedToolNames.length }}个）</div>
          <button class="action-btn" @click="toolPreviewExpanded = !toolPreviewExpanded">
            {{ toolPreviewExpanded ? '收起' : '展开' }}
          </button>
        </div>
        <div class="tool-preview-summary">
          <span v-for="cat in derivedToolCategories" :key="cat.id" class="tool-preview-cat">
            {{ cat.label }} {{ cat.count }}
          </span>
        </div>
        <div v-if="toolPreviewExpanded" class="tool-preview-detail">
          <div v-for="cat in derivedToolCategories" :key="cat.id" class="preview-cat">
            <div class="preview-cat-label">{{ cat.label }}</div>
            <div class="preview-cat-tools">
              <span v-for="name in cat.toolNames" :key="name" class="preview-tool-tag">{{ name }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 高级：自定义工具 -->
      <div class="advanced-tools-section">
        <div class="advanced-toggle" @click="advancedToolsExpanded = !advancedToolsExpanded">
          <WsIcon name="settings" size="xs" />
          <span>自定义工具</span>
          <span v-if="toolSource === 'manual'" class="manual-badge">已自定义</span>
          <WsIcon :name="advancedToolsExpanded ? 'chevron-up' : 'chevron-down'" size="xs" class="advanced-arrow" />
        </div>
        <div v-if="advancedToolsExpanded" class="advanced-tools-content">
          <div class="advanced-tools-header">
                <span class="advanced-tools-hint">手动调整 Agent 可使用的工具</span>
                <button v-if="toolSource === 'manual'" class="reset-btn" @click="resetToDerived">重置为技能派生</button>
              </div>
              <div class="always-available-hint">
                <WsIcon name="info" size="xs" />
                <span>基础工具（查询/记忆/输出）始终可用，无需手动配置</span>
              </div>
              <div v-for="cat in toolCategories" :key="cat.id" class="tool-category">
                <div class="tool-cat-header" @click="toggleCategory(cat.id)">
                  <span class="tool-cat-arrow">{{ expandedCategories.includes(cat.id) ? '▼' : '▶' }}</span>
                  <span class="tool-cat-label">{{ cat.label }}</span>
                  <span class="tool-cat-count">{{ getCategoryCount(cat) }}</span>
                </div>
                <div v-if="expandedCategories.includes(cat.id)" class="tool-cat-items">
                  <label v-for="tool in getVisibleTools(cat)" :key="tool.name" class="tool-item" :class="{ derived: skillDerivedToolNames.includes(tool.name), 'always-on': alwaysAvailableSet.has(tool.name) }">
                    <input type="checkbox" :checked="effectiveTools.includes(tool.name)" :disabled="alwaysAvailableSet.has(tool.name)" @change="toggleTool(tool.name)" />
                    <span class="tool-name">{{ tool.name }}</span>
                    <span v-if="skillDerivedToolNames.includes(tool.name)" class="tool-derived-dot" title="来自技能派生"></span>
                    <span v-if="alwaysAvailableSet.has(tool.name)" class="tool-always-badge">始终可用</span>
                    <span class="tool-desc-inline">{{ tool.description?.slice(0, 40) }}{{ (tool.description?.length ?? 0) > 40 ? '...' : '' }}</span>
                  </label>
                </div>
              </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { getEnabledSkills, TOOL_CATEGORIES, resolveToolNames, ALWAYS_AVAILABLE_TOOLS, type SkillMeta } from '@agent/index'
import { type ToolSource } from '../types'
import { WsIcon } from '@worldsmith/ui-kit'

const props = defineProps<{
  enabledSkills: string[]
  enabledTools: string[]
  toolSource: ToolSource
}>()

const emit = defineEmits<{
  close: []
  'update:enabledSkills': [value: string[]]
  'update:enabledTools': [value: string[]]
  'update:toolSource': [value: ToolSource]
}>()

const toolCategories = TOOL_CATEGORIES
const expandedCategories = ref<string[]>([])
const toolPreviewExpanded = ref(false)
const advancedToolsExpanded = ref(false)

// 始终可用的工具集合（运行时始终存在，UI中不显示为"已选择"）
const alwaysAvailableSet = new Set(ALWAYS_AVAILABLE_TOOLS)

// 群聊 Agent 不可选技能：安全风险/全局操作/开发工具/元操作/与群聊架构冲突
const GROUP_CHAT_EXCLUDED_SKILLS = new Set([
  'retrofit-architect',   // 修改项目Schema，多Agent并发改造会冲突
  'project-io',           // 全局导入导出，不应由群聊Agent执行
  'terminal-operator',    // Shell命令执行，安全风险
  'fs-operator',          // 文件系统操作，安全风险
  'pkg-manager',          // 包管理，安全风险
  'git-operator',         // Git操作，与群聊场景无关
  'sys-inspector',        // 系统级查询，与群聊场景无关
  'terminal-launcher',    // 启动终端进程，安全风险
  'web-cli-operator',     // CLI联网，间接Shell访问
  'agent-orchestrator',   // 子Agent调度，与群聊对等架构冲突
  'skill-creator',        // 元操作，群聊Agent不应创建新技能
  'find-skills',          // 元操作，群聊Agent不应安装社区技能
  'code-reviewer',        // 开发工具，与世界观群聊场景无关
  'test-automator',       // 开发工具，与群聊场景无关
  'doc-generator',        // 开发工具，与群聊场景无关
  'security-scanner',     // 开发工具，与群聊场景无关
  'creation-orchestrator', // Pipeline编排是管理者技能，群聊协调应在群层面
])

// 过滤群聊 Agent 可选技能：排除 hidden、persona-possess 和群聊不适用技能
const availableSkills = computed(() => {
  return getEnabledSkills().filter(s =>
    s.visibility !== 'hidden' && s.id !== 'persona-possess' && !GROUP_CHAT_EXCLUDED_SKILLS.has(s.id)
  )
})

const domainSkills = computed(() => availableSkills.value.filter(s => s.category === 'domain'))
const actionSkills = computed(() => availableSkills.value.filter(s => s.category === 'action'))

// 从选中技能派生的工具名列表（与运行时 getToolsForSkills 一致）
const derivedToolNames = computed(() => {
  return resolveToolNames(props.enabledSkills)
})

// 仅来自技能派生的工具（排除始终可用的基线工具，用于UI展示）
const skillDerivedToolNames = computed(() => {
  return derivedToolNames.value.filter(n => !alwaysAvailableSet.has(n))
})

// 派生工具按分类汇总（仅技能派生的）
const derivedToolCategories = computed(() => {
  const derivedSet = new Set(skillDerivedToolNames.value)
  const result: Array<{ id: string; label: string; count: number; toolNames: string[] }> = []
  for (const cat of TOOL_CATEGORIES) {
    const matched = cat.tools.filter(t => derivedSet.has(t.name))
    if (matched.length > 0) {
      result.push({
        id: cat.id,
        label: cat.label,
        count: matched.length,
        toolNames: matched.map(t => t.name),
      })
    }
  }
  return result
})

// 实际生效的工具列表
const effectiveTools = computed(() => {
  if (props.toolSource === 'manual') {
    return props.enabledTools
  }
  return derivedToolNames.value
})

function toggleSkill(skillId: string): void {
  const idx = props.enabledSkills.indexOf(skillId)
  if (idx >= 0) {
    emit('update:enabledSkills', props.enabledSkills.filter(id => id !== skillId))
  } else {
    emit('update:enabledSkills', [...props.enabledSkills, skillId])
  }
}

function selectAllSkills(): void {
  emit('update:enabledSkills', availableSkills.value.map(s => s.id))
}

function clearAllSkills(): void {
  emit('update:enabledSkills', [])
}

function getSkillToolCount(skill: SkillMeta): number {
  return resolveToolNames([skill.id]).filter(n => !alwaysAvailableSet.has(n)).length
}

function toggleTool(toolName: string): void {
  // 切换到手动模式
  if (props.toolSource === 'derived') {
    emit('update:toolSource', 'manual')
    const tools = [...derivedToolNames.value]
    const idx = tools.indexOf(toolName)
    if (idx >= 0) {
      tools.splice(idx, 1)
    } else {
      tools.push(toolName)
    }
    emit('update:enabledTools', tools)
    return
  }
  const idx = props.enabledTools.indexOf(toolName)
  if (idx >= 0) {
    emit('update:enabledTools', props.enabledTools.filter(n => n !== toolName))
  } else {
    emit('update:enabledTools', [...props.enabledTools, toolName])
  }
}

function toggleCategory(catId: string): void {
  const idx = expandedCategories.value.indexOf(catId)
  if (idx >= 0) {
    expandedCategories.value = expandedCategories.value.filter(id => id !== catId)
  } else {
    expandedCategories.value = [...expandedCategories.value, catId]
  }
}

function getCategoryCount(cat: typeof TOOL_CATEGORIES[0]): string {
  const visible = cat.tools.filter(t => !alwaysAvailableSet.has(t.name))
  const current = effectiveTools.value
  const selected = visible.filter(t => current.includes(t.name)).length
  return selected > 0 ? `${selected}/${visible.length}` : `${visible.length}`
}

// 高级工具列表：始终可用的工具排在末尾并标记
function getVisibleTools(cat: typeof TOOL_CATEGORIES[0]): typeof cat.tools {
  return cat.tools.filter(t => !alwaysAvailableSet.has(t.name))
}

function resetToDerived(): void {
  emit('update:toolSource', 'derived')
  emit('update:enabledTools', [...derivedToolNames.value])
}
</script>

<style scoped>
/* 面板主体 */
.capability-panel {
  width: 380px;
  max-height: 80vh;
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  flex-shrink: 0;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.panel-title {
  font-size: var(--fs-base);
  font-weight: 600;
}

.panel-close {
  border: none;
  background: none;
  color: var(--color-text-secondary);
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.12s, border-color 0.12s, color 0.12s, box-shadow 0.12s, transform 0.12s, opacity 0.12s, filter 0.12s;
}

.panel-close:hover {
  color: var(--color-text);
  background: var(--color-surface);
}

.panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}

/* 通用 section 样式 */
.section-label { font-size: var(--fs-xs); color: var(--color-text-tertiary); font-weight: 600; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px; }
.section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.section-header .section-label { margin-bottom: 0; }
.section-actions { display: flex; gap: 4px; }
.action-btn { border: none; background: none; color: var(--color-text-tertiary); font-size: 10px; cursor: pointer; padding: 2px 6px; border-radius: 4px; transition: background 0.12s, border-color 0.12s, color 0.12s, box-shadow 0.12s, transform 0.12s, opacity 0.12s, filter 0.12s; }
.action-btn:hover { color: var(--color-primary); background: rgba(108,92,231,0.06); }

/* 技能区域 */
.skills-section { margin-bottom: 16px; }
.skills-desc { font-size: 10px; color: var(--color-text-tertiary); margin-bottom: 8px; }
.skill-group { margin-bottom: 6px; }
.skill-group-label { font-size: 9px; color: var(--color-text-tertiary); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; padding: 0 4px; margin-bottom: 4px; }
.skill-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s, color 0.12s, box-shadow 0.12s, transform 0.12s, opacity 0.12s, filter 0.12s;
  user-select: none;
}
.skill-row:hover { background: rgba(108,92,231,0.04); }
.skill-row.active { background: rgba(108,92,231,0.08); }
.skill-row-icon { color: var(--color-text-secondary); flex-shrink: 0; }
.skill-row.active .skill-row-icon { color: var(--color-primary); }
.skill-row-name { font-size: var(--fs-sm); font-weight: 500; flex: 1; }
.skill-row-count { font-size: 9px; color: var(--color-text-tertiary); }
.skill-row-check { color: var(--color-primary); flex-shrink: 0; }
.skills-hint { font-size: 10px; color: var(--color-text-tertiary); margin-top: 4px; font-style: italic; }

/* 工具预览 */
.tool-preview-section { margin-bottom: 16px; }
.tool-preview-summary { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 4px; }
.tool-preview-cat { font-size: 10px; color: var(--color-text-secondary); background: var(--color-surface); padding: 2px 8px; border-radius: var(--radius-md); }
.tool-preview-detail { border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: 8px; margin-top: 6px; max-height: 200px; overflow-y: auto; }
.preview-cat { margin-bottom: 6px; }
.preview-cat:last-child { margin-bottom: 0; }
.preview-cat-label { font-size: 10px; font-weight: 600; color: var(--color-text-secondary); margin-bottom: 2px; }
.preview-cat-tools { display: flex; flex-wrap: wrap; gap: 4px; }
.preview-tool-tag { font-size: 9px; color: var(--color-text-tertiary); background: var(--color-surface); padding: 1px 6px; border-radius: 4px; font-family: monospace; }

/* 高级自定义工具 */
.advanced-tools-section { margin-bottom: 16px; }
.advanced-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  cursor: pointer;
  font-size: var(--fs-xs);
  font-weight: 500;
  color: var(--color-text-secondary);
  transition: background 0.12s, border-color 0.12s, color 0.12s, box-shadow 0.12s, transform 0.12s, opacity 0.12s, filter 0.12s;
}
.advanced-toggle:hover { border-color: var(--color-primary); color: var(--color-text); }
.advanced-arrow { margin-left: auto; }
.manual-badge { font-size: 9px; background: rgba(108,92,231,0.12); color: var(--color-primary); padding: 1px 6px; border-radius: 8px; font-weight: 600; }
.advanced-tools-content { margin-top: 8px; }
.advanced-tools-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.advanced-tools-hint { font-size: 10px; color: var(--color-text-tertiary); }
.always-available-hint {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: var(--color-text-tertiary);
  margin-bottom: 8px;
  padding: 4px 8px;
  background: var(--color-surface);
  border-radius: 4px;
}
.reset-btn { border: 1px solid var(--color-border); background: none; color: var(--color-text-secondary); font-size: 10px; padding: 2px 8px; border-radius: 4px; cursor: pointer; transition: background 0.12s, border-color 0.12s, color 0.12s, box-shadow 0.12s, transform 0.12s, opacity 0.12s, filter 0.12s; }
.reset-btn:hover { border-color: var(--color-primary); color: var(--color-primary); }

/* 工具分类列表 */
.tool-category { margin-bottom: 4px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); overflow: hidden; }
.tool-cat-header { display: flex; align-items: center; gap: 6px; padding: 6px 8px; cursor: pointer; background: var(--color-surface); font-size: var(--fs-xs); font-weight: 600; }
.tool-cat-header:hover { background: var(--color-surface-elevated); }
.tool-cat-arrow { font-size: 8px; width: 12px; text-align: center; }
.tool-cat-label { flex: 1; }
.tool-cat-count { font-size: 9px; color: var(--color-text-tertiary); font-weight: 400; }
.tool-cat-items { padding: 4px 8px; border-top: 1px solid var(--color-border); }
.tool-item { display: flex; align-items: center; gap: 6px; padding: 3px 0; font-size: var(--fs-xs); cursor: pointer; }
.tool-item input { accent-color: var(--color-primary); flex-shrink: 0; }
.tool-item input:disabled { opacity: 0.5; cursor: not-allowed; }
.tool-item.derived .tool-name { color: var(--color-primary); }
.tool-item.always-on { opacity: 0.6; }
.tool-name { font-weight: 600; min-width: 120px; white-space: nowrap; }
.tool-derived-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--color-primary); flex-shrink: 0; }
.tool-always-badge { font-size: 8px; background: var(--color-surface); color: var(--color-text-tertiary); padding: 0px 4px; border-radius: 3px; border: 1px solid var(--color-border); flex-shrink: 0; }
.tool-desc-inline { color: var(--color-text-tertiary); font-size: 9px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>