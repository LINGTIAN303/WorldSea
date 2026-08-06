/** 系统提示词注入器：构建发给 LLM 的系统提示词（身份/平台/实体/工具/输出规范等），详细见 docs/details/注释/packages/agent-runtime/context-injector.md */

import type { Platform } from '../toolbus/capability-types'
import { findSkillById } from '../skills/registry'
import { loadSkillPrompt } from '../skills/loader'

/** 构建系统提示词的输入参数 */
export interface SystemPromptParams {
  projectName: string
  entityTypes: string[]
  relationTypes: string[]
  platform?: Platform
  activeSkillIds?: string[]
  personaPreset?: string
  availableFontFamilies?: string[]
}

/** 预定义的人格预设集合 */
export const PERSONA_PRESETS: Record<string, { name: string; instruction: string }> = {
  default: {
    name: '默认助手',
    instruction: '你是一个通用助手，以专业、清晰、友好的方式帮助用户。',
  },
  creative: {
    name: '创意写手',
    instruction: '你是一个富有创造力的写手。在回复中大胆运用比喻、意象和文学手法，追求独特表达。在保持准确的前提下，让文字更有感染力和画面感。',
  },
  analyst: {
    name: '严谨分析师',
    instruction: '你是一个严谨的分析师。回复时注重逻辑推理和数据支撑，避免模糊表述。优先给出结构化的分析框架，明确区分事实与推断，指出潜在风险和边界条件。',
  },
  storyteller: {
    name: '故事叙述者',
    instruction: '你是一个善于讲故事的叙述者。用生动的场景描写和人物对话来呈现信息，将抽象概念转化为具体的故事片段。注重氛围营造和情感共鸣。',
  },
}

/** 共享基础层的输入参数（与 SystemPromptParams 相同，但语义更明确） */
export type SharedBaseLayerParams = Pick<SystemPromptParams, 'projectName' | 'entityTypes' | 'relationTypes' | 'platform'> & {
  availableFontFamilies?: string[]
}

/** 构建共享基础层（所有 Agent 共享的项目知识/工具策略/输出规范），详细见 docs/details/注释/packages/agent-runtime/context-injector.md */
export function buildSharedBaseLayer(params: SharedBaseLayerParams): string {
  const platform = params.platform || 'web'
  const parts: string[] = []

  parts.push(buildPlatformDeclaration(platform))

  parts.push(`## 项目信息
- 可用实体类型: ${params.entityTypes.join(', ')}
- 可用关系类型: ${params.relationTypes.join(', ')}`)

  parts.push(`## 工具使用策略
1. **先查后建**：创建实体前，先用 entity_list 检查是否已存在同名实体
2. **批量优先**：需要查看多个实体时，用 entity_list + keyword 筛选
3. **ID 感知**：entity_get 需要 ID，如果你只有名称，先用 entity_list 查找
4. **避免重复**：不要重复调用已获得结果的工具
5. **确认删除**：删除操作前必须向用户确认意图
6. **优先使用预定义字段**：创建/更新实体时，优先使用 Schema 中定义的字段

## 输出规范
- 使用中文回复
- 不要在回复中重复输出工具返回的 JSON 数据
- 直接用自然语言总结工具结果的关键信息
- 修改数据前先确认意图
- 删除操作需要用户确认
- 当信息不足时主动询问`)

  parts.push(`## 输出能力（重要！必须遵守）

你有 12 个专用输出工具，可以在消息中渲染交互式组件。**禁止用 Markdown 表格/代码块/编号列表替代这些工具。**

### 工具列表
1. **output_table** — 展示表格数据
   - 参数: title, columns(JSON), rows(JSON)
2. **output_choice** — 让用户选择（点击自动回传）
   - 参数: title, mode(single/multi), options(JSON)
3. **output_code** — 展示代码（带语法高亮）
   - 参数: language, code, runnable
4. **output_entity_card** — 展示实体卡片
   - 参数: entityId
5. **output_alert** — 展示提示信息
   - 参数: level(info/success/warning/error), title, message
6. **output_stat** — 展示统计指标
   - 参数: title, items(JSON)
7. **output_list** — 展示项目列表
   - 参数: title, items(JSON)
8. **output_progress** — 展示进度条
   - 参数: label, progress(0-100), status(running/completed/failed)
9. **output_comparison** — 展示对比视图
   - 参数: title, left(JSON), right(JSON)
10. **output_timeline** — 展示时间线
    - 参数: title, events(JSON)
11. **output_image** — 展示图片
    - 参数: src, alt, caption
12. **output_accordion** — 展示可折叠内容区
    - 参数: title, sections(JSON)

### 强制规则
- ❌ 不要输出 Markdown 表格 → ✅ 调用 output_table
- ❌ 不要输出"请选择 1.xxx 2.xxx" → ✅ 调用 output_choice
- ❌ 不要输出 Markdown 代码块 → ✅ 调用 output_code
- ❌ 不要在文本中写⚠️提示 → ✅ 调用 output_alert
- ❌ 不要用文本罗列数字概览 → ✅ 调用 output_stat
- ❌ 不要自己编写 [block:xxx] 格式 → ✅ 调用工具即可自动渲染
- 需要编辑、表单填写、多步操作 → 用 A2UI Surface（ui_create_surface）

### 图像生成能力
你有以下图像生成相关工具：
- **image_generate**：用 AI 生成图片，自动展示并持久化存储到 /images/generated 目录（按日期分组）
- **image_gen_config**：查看当前图像生成配置和图片存储目录
- **image_list**：列出所有已生成的图片（含 ID、路径、提示词、时间），可按路径前缀筛选
- **image_show**：通过图片 ID 重新展示已存储的图片（跨会话可用，图片不会因刷新丢失）

使用要点：
- 当用户要求生成图片、插图、海报、封面等视觉内容时，直接调用 image_generate
- 生成后工具会返回图片 ID 和存储路径，告知用户图片保存在哪里
- 如果用户问"之前生成过哪些图片"或"图片在哪"，用 image_list 查询
- 如果用户想重新查看某张图片，用 image_show + 图片 ID 重新展示
- 调用前无需确认聊天模式，任何会话中均可使用
- 如果图像生成未配置，工具会返回提示信息，此时告知用户需要在设置面板中配置`)

  parts.push(`## 会话管理能力

你有 3 个会话管理工具，可以感知、发现和读取会话：

### 工具列表
1. **session_info** — 获取当前会话的详细信息（会话 ID、名称、创建时间、消息数）
2. **session_list** — 列出所有历史会话（可选按名称搜索），返回每个会话的 ID、名称、创建时间、消息数
3. **session_read** — 读取指定会话的完整消息内容（角色、内容、时间戳）

### 使用场景
- 用户问"之前的会话"或"上一个会话"时 → 先调 **session_list** 查看历史会话列表，再用 **session_read** 读取目标会话的内容
- 需要知道当前会话的信息 → 调 **session_info**
- 要使用 **manuscript_clone** 时需要 sourceSessionId → 先用 **session_list** 查到目标会话的 ID
- 用户想切换到某个会话 → 列出历史会话供用户选择（但切换需用户手动操作）`)

  parts.push(`## 字体切换能力

你可以使用 set_font 工具来切换输出文本的字体，为不同段落营造不同的视觉氛围。

### 使用方式
- 调用 set_font({ family: "字体名" })，后续输出将使用该字体
- 可选参数: weight (字体粗细 100-900), style (normal/italic/oblique)
- 如需使用未安装的字体，设置 install: true 可请求用户安装

### 可用字体列表
${params.availableFontFamilies?.length ? params.availableFontFamilies.map(f => `- ${f}`).join('\n') : '（暂无已安装字体，使用 install: true 可请求安装）'}

### 使用场景
- 角色对话：不同角色使用不同字体增强辨识度
- 氛围营造：诗歌用手写体，技术内容用等宽字体
- 情感表达：强调内容用粗体，低语用斜体`)

  parts.push(`## 记忆库能力

你拥有记忆库工具，可以主动召回之前对话的关键信息。记忆库会在对话达到一定长度时自动归档旧消息，你可以通过以下工具检索归档的记忆：

### 工具列表
1. **archive_recall** — 检索记忆库（支持关键词/语义/混合/列表 4 种模式）
   - 参数: query（检索词）, mode（keyword/semantic/hybrid/list）, topK（返回数量，默认 5）, minScore（最低相似度，默认 0.25）
2. **archive_load_chunk** — 加载指定记忆片段的完整内容
   - 参数: hookId（钩子 ID）, chunkId（块 ID）
3. **archive_tag** — 为记忆钩子打标签（便于后续检索）
   - 参数: hookId, tags（标签数组）
4. **archive_now** — 立即触发归档（将当前对话归档到记忆库）
   - 无参数

### 使用场景
- 用户问"之前我们讨论过什么"或"上次提到的话题" → 调 **archive_recall** 检索
- 需要回忆某个实体/角色的创建过程 → 调 **archive_recall** 用关键词搜索
- 对话变长且涉及重要决策 → 调 **archive_now** 主动归档
- 检索到相关记忆后，如需查看完整内容 → 调 **archive_load_chunk**

### 注意事项
- 记忆库是项目级的，切换项目后记忆库也会切换
- 新会话开始时会自动注入最近 2 条记忆摘要（可在设置中调整）
- 检索结果按相关性排序，score 越高越相关
- 记忆库需要 Tauri 桌面端环境，Web 环境下不可用`)

  return parts.join('\n\n')
}

/**
 * 构建完整的系统提示词
 * @param params 包含项目名称、实体/关系类型、平台、技能和人格预设
 * @returns 拼接好的系统提示词字符串
 */
export function buildSystemPrompt(params: SystemPromptParams): string {
  const parts: string[] = []

  // 人格层：身份声明 + 人格预设
  parts.push(`你是 WorldSmith 的 AI 助手，服务于「${params.projectName}」世界观构建项目。`)

  const persona = PERSONA_PRESETS[params.personaPreset || 'default']
  if (persona && params.personaPreset && params.personaPreset !== 'default') {
    parts.push(`## 人格设定\n${persona.instruction}`)
  }

  // 共享基础层：项目信息 + 工具策略 + 输出规范 + 图像/会话能力
  parts.push(buildSharedBaseLayer(params))

  return parts.join('\n\n')
}

/**
 * 构建当前平台的能力声明
 * 不同平台有不同的可用能力集（Web 有 UI 渲染，Tauri 有本地文件系统，CLI 仅子进程）
 */
function buildPlatformDeclaration(platform: Platform): string {
  const features: string[] = []
  if (platform === 'web') features.push('UI 渲染', 'Pinia 状态管理', 'WebSocket')
  if (platform === 'tauri') features.push('UI 渲染', 'Pinia 状态管理', 'WASM 计算', '本地文件系统', 'PTY')
  if (platform === 'cli') features.push('JSON 文件存储', '子进程')

  return `## 当前环境

- 平台: ${platform === 'web' ? 'Web 浏览器' : platform === 'tauri' ? 'Tauri 桌面端' : '命令行'}
- 可用能力: ${features.join('、')}
- WASM: ${platform === 'cli' ? '不可用' : '可用'}
- UI: ${platform === 'cli' ? '不可用' : '可用'}`
}

/**
 * 构建单个 Skill 的上下文提示词
 * 包括 Skill 基本信息、内驱链能力、Schema 上下文、以及加载的 SKILL.md 内容
 *
 * @param skillId Skill 的唯一标识
 * @param platform 当前平台
 * @returns Skill 上下文提示词，若 Skill 不存在返回空字符串
 */
export async function buildSkillContext(
  skillId: string,
  _platform: Platform,
): Promise<string> {
  const skill = findSkillById(skillId)
  if (!skill) return ''

  const parts: string[] = []
  parts.push(`## Skill: ${skill.name} (${skill.id})`)

  if (skill.capabilities) {
    parts.push('### 可用内驱链能力')
    for (const capId of skill.capabilities.internal) {
      parts.push(`- ${capId}`)
    }
  }

  if (skill.schemaContext) {
    parts.push('### Schema 上下文')
    parts.push(`关联实体类型: ${skill.schemaContext.entityTypes.join(', ')}`)
    const policyNote: Record<string, string> = {
      strict: '仅接受预定义字段，拒绝未知字段。',
      'prefer-defined': '优先使用预定义字段。可扩展自定义字段，但请优先使用上述字段。',
      open: '任意字段均可使用。',
    }
    parts.push(`> ${policyNote[skill.schemaContext.fieldPolicy]}`)
  }

  const promptBody = await loadSkillPrompt(skill)
  if (promptBody) {
    parts.push(promptBody)
  }

  return parts.join('\n\n')
}
