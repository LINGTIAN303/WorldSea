/**
 * 桥工具契约单一事实源（T5，2026-09-17）
 *
 * 背景：Rust `apps/tauri/src-tauri/src/frontend_tool_bridge.rs` 的桥工具契约
 * （name/description/parameters）曾是从本包工具定义**手工拷贝**的常量，已发生实际漂移
 * （同一工具在两侧 schema 文本不一致，LLM 看到的契约与实际执行不符）。
 * 现在本包的工具定义是唯一事实源，本模块承担三件事：
 *   ① 桥工具清单（BRIDGE_TOOL_NAMES，顺序即 LLM 可见顺序）；
 *   ② 记录式 `ToolParameter` → JSON Schema 转换（Rust 侧 `Tool::parameters()` 需要的形状）；
 *   ③ 规范化序列化（供生成脚本写盘与校验器比对，保证字节级可比）。
 *
 * 生成物：apps/tauri/src-tauri/src/bridge_tool_specs.json（Rust `include_str!` 编译期嵌入）
 * 生成：`node scripts/gen-bridge-spec.mjs`
 * 校验：`__tests__/bridge-spec.spec.ts`（vitest 全量跑测时自动比对，不一致即失败）
 */

import type { ToolDefinition, ToolParameter } from '../bridge-types'
import type { ToolMeta } from '@worldsea/agent-core'

/** 桥工具清单（顺序即装配顺序：Rust `bridge_tools()` 按此顺序提供给 LLM） */
export const BRIDGE_TOOL_NAMES = [
  // 实体 CRUD（tools/entity-crud.ts）
  'entity_create',
  'entity_update',
  'entity_delete',
  // 内容搜索（tools/content-search.ts）
  'content_search',
  // Skills 元工具（skills/meta-tools.ts）
  'load_skill',
  'load_skill_reference',
  'load_skill_asset',
  // 世界观芽工具（tools/worldview/）——2026-09-21 芽工具整合（批 1）：
  // 芽名清单 / 使用方法 / 动作执行三级入口（芽名随芽注册动态；执行面收敛自 10 个域工具）
  'worldview',
  // A2UI 画布（tools/a2ui-tools.ts）
  'ui_create_surface',
  'ui_update_components',
  'ui_update_data',
  'ui_delete_surface',
  // 知识库（tools/kb-tools.ts，9 件）——S3 补桥（2026-09-18）：knowledge-base 技能移工具面前置；
  // 其中 kb_read/kb_search/kb_write 已在 kernel scenario.rs 的场景 tool_ids 内声明，补桥后即可见
  'kb_write',
  'kb_read',
  'kb_list',
  'kb_search',
  'kb_delete',
  'kb_extract',
  'kb_reflect',
  'kb_link',
  'kb_init',
  // 项目数据导入导出（tools/project-io.ts，2 件）——project-io 技能移工具面前置
  'project_export',
  'project_import',
  // 数据一致性检查（tools/daily-task.ts）——project-io 技能 capability，且被多个技能引用
  'consistency_check',
  // 实体上下文与智能填充（tools/entity-context.ts + tools/entity-crud.ts）——smart-fill 技能移工具面前置
  'entity_get_context',
  'entity_suggest_field',
  'entity_smart_fill',
  // 视觉工具（tools/vision-tools.ts）——E2 裁定：vision-analyzer 技能退役前先补桥，
  // 使「图像理解」作为可达工具面保留（此前仅存于 TS 工具、无任何桥或原生承载）
  'vision_analyze',
  'list_vision_images',
] as const

/** JSON Schema 节点（ToolParameter 可表达的子集：type/description/enum/items/properties） */
export interface JsonSchemaNode {
  type: ToolParameter['type']
  description: string
  enum?: string[]
  items?: JsonSchemaNode
  properties?: Record<string, JsonSchemaNode>
}

/** 顶层参数 schema（对象）：required 由各字段的 required:true 汇总 */
export interface JsonSchemaObject {
  type: 'object'
  properties: Record<string, JsonSchemaNode>
  required: string[]
}

/** 单个桥工具契约（与 Rust 侧 `ToolDescriptor` 同构，`executor` 恒为 client） */
export interface BridgeToolSpec {
  name: string
  aliases: string[]
  category: string
  description: string
  input_schema: JsonSchemaObject
  output_schema: null
  strict: boolean
  safety: {
    read_only: boolean
    destructive: boolean
    concurrent_safe: boolean
    requires_user_interaction: boolean
    always_ask: boolean
    needs_approval: boolean
    risk_level: 'safe' | 'moderate' | 'dangerous'
    side_effect_scope: 'none' | 'workspace' | 'git' | 'network' | 'system' | 'session'
  }
  limits: { timeout_ms: number | null; max_output_bytes: number | null }
  control: { stop_turn_on_success: boolean; provider_visible: boolean }
  executor: 'client'
}

/** 上桥工具必填的元数据字段（C2 ToolDescriptor 安全组；缺失即抛——见 buildBridgeSpec） */
const REQUIRED_BRIDGE_META_FIELDS = [
  'readOnly',
  'sideEffectScope',
  'concurrentSafe',
  'requiresUserInteraction',
  'alwaysAsk',
] as const

/**
 * `permission` → 安全组派生（既有声明不重复：riskLevel/destructive/needsApproval 由它单源派生）
 *
 * 派生口径对齐现状判定语义（B7 不变）：safe 只读放行 / moderate 按档位策略确认 /
 * dangerous 走 alwaysAsk（位次 5，不可绕过）。
 * `read_only` 不派生（显式声明）——避免把陈旧的 `permission` 误传播到只读面。
 */
function deriveSafety(meta: ToolMeta, name: string): BridgeToolSpec['safety'] {
  const base = {
    read_only: meta.readOnly === true,
    concurrent_safe: meta.concurrentSafe === true,
    requires_user_interaction: meta.requiresUserInteraction === true,
    always_ask: meta.alwaysAsk === true,
    side_effect_scope: meta.sideEffectScope!,
  }
  switch (meta.permission) {
    case 'safe':
      return { ...base, destructive: false, needs_approval: false, risk_level: 'safe' }
    case 'moderate':
      return { ...base, destructive: false, needs_approval: true, risk_level: 'moderate' }
    case 'dangerous':
      if (meta.alwaysAsk !== true) {
        throw new Error(
          `桥工具 "${name}" 声明不一致：permission=dangerous 必须 alwaysAsk=true（不可绕过的确认）`,
        )
      }
      return { ...base, destructive: true, needs_approval: false, risk_level: 'dangerous' }
    default:
      throw new Error(
        `桥工具 "${name}" 的 permission 非法：${String(meta.permission)}（期望 safe/moderate/dangerous）`,
      )
  }
}

/** 单字段转换（items/properties 递归，保持可扩展） */
function toJsonSchemaNode(param: ToolParameter): JsonSchemaNode {
  const node: JsonSchemaNode = { type: param.type, description: param.description }
  if (param.enum) node.enum = [...param.enum]
  if (param.items) node.items = toJsonSchemaNode(param.items)
  if (param.properties) node.properties = toJsonSchemaProperties(param.properties)
  return node
}

/** 参数记录 → JSON Schema properties（保持声明顺序） */
function toJsonSchemaProperties(params: Record<string, ToolParameter>): Record<string, JsonSchemaNode> {
  const properties: Record<string, JsonSchemaNode> = {}
  for (const [key, param] of Object.entries(params)) {
    properties[key] = toJsonSchemaNode(param)
  }
  return properties
}

/** 记录式参数 → JSON Schema（顶层对象 + required 汇总） */
export function toJsonSchema(params: Record<string, ToolParameter>): JsonSchemaObject {
  return {
    type: 'object',
    properties: toJsonSchemaProperties(params),
    required: Object.entries(params)
      .filter(([, param]) => param.required === true)
      .map(([key]) => key),
  }
}

/**
 * 按桥工具清单构造契约（缺失即抛——防止清单与工具模块脱节后静默生成残缺契约）
 *
 * C2 元数据族：**上桥工具必须声明安全组四字段**（`sideEffectScope` / `concurrentSafe` /
 * `requiresUserInteraction` / `alwaysAsk`），缺失即抛（vitest 全量跑测覆盖 = 反证①）；
 * `riskLevel` 等由其既有 `permission` 声明派生（不重复声明、不猜测）。
 */
export function buildBridgeSpec(tools: readonly ToolDefinition[]): BridgeToolSpec[] {
  const byName = new Map(tools.map(tool => [tool.name, tool]))
  return BRIDGE_TOOL_NAMES.map(name => {
    const tool = byName.get(name)
    if (!tool) {
      throw new Error(`桥工具 "${name}" 未在任何工具模块中定义（检查 BRIDGE_TOOL_NAMES 或导入集）`)
    }
    const meta = tool.meta
    if (!meta) {
      throw new Error(`桥工具 "${name}" 缺少 meta 声明（C2：安全组必填）`)
    }
    const record = meta as unknown as Record<string, unknown>
    const missing = REQUIRED_BRIDGE_META_FIELDS.filter(field => record[field] === undefined)
    if (missing.length > 0) {
      throw new Error(
        `桥工具 "${name}" 元数据缺字段：${missing.join(' / ')}——上桥工具必须声明安全组（见 bridge-spec.ts §REQUIRED_BRIDGE_META_FIELDS）`,
      )
    }
    return {
      name,
      aliases: [...(meta.aliases ?? [])],
      category: meta.category,
      description: tool.description,
      input_schema: toJsonSchema(tool.parameters),
      output_schema: null,
      strict: false,
      safety: deriveSafety(meta, name),
      limits: { timeout_ms: null, max_output_bytes: null },
      control: { stop_turn_on_success: false, provider_visible: true },
      executor: 'client',
    }
  })
}

/** 规范化序列化（生成与校验共用，保证输出字节级稳定） */
export function serializeBridgeSpec(specs: BridgeToolSpec[]): string {
  return `${JSON.stringify(
    {
      generatedBy: 'node scripts/gen-bridge-spec.mjs',
      source: '唯一事实源：packages/agent-runtime（ToolDefinition）；本文件由脚本生成，勿手改',
      tools: specs,
    },
    null,
    2,
  )}\n`
}