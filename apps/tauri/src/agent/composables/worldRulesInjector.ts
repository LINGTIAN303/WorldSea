/**
 * WORLD.md 节奏型注入——app 层胶水（H5 八文件体系，2026-08-30 拍板）
 *
 * 机制（用户拍板定稿）：
 * - 计数模式 = **全局计数**（entity_create/update/delete 成功共享计数器；严格同类在
 *   混合操作场景有永不触发盲区，评估结论见设计文档 §2.8）
 * - 阈值 = 默认 **20**，用户可配置 1-150（localStorage `ws_world_rules_threshold`，
 *   RulesPanel WORLD 卡提供输入）
 * - 触发 → 读取双层 WORLD.md（全局 ~/.WorldSmith/rules/ + 项目 workdir，全局在前标注来源）→
 *   按「窗口内操作过的实体类型」提取相关分节（`## 标题` 匹配 typeKey/显示名，
 *   无匹配兜底全文）→ 以 `__world_rules` 字段附加进该次工具结果 JSON →
 *   随 cmd_agent_tool_result 进历史（LLM 下一轮立即可见），计数与窗口归零
 *
 * 注：`__world_rules` 会出现在前端行卡结果 JSON 中——与 `__meta` 同属已知展示噪音，
 * 待流式区结果投影层（P1）统一剥离。
 * 纯逻辑（分节提取/计数器/阈值夹取）在 @agent/tools/world-rules（可单测）。
 */
import { invoke } from './transport'
import {
  extractWorldRuleSections,
  WORLD_RULES_TRIGGER_DEFAULT,
  WorldRulesTrigger,
  clampTriggerThreshold,
} from '@agent/tools/world-rules'

/** 实体写工具（计数对象；读类 entity_list/entity_get 不计数） */
const ENTITY_WRITE_TOOLS = new Set(['entity_create', 'entity_update', 'entity_delete'])

/** 阈值 localStorage 键（纯 UI 偏好，单消费方=本注入器，无双真相源问题） */
const THRESHOLD_STORAGE_KEY = 'ws_world_rules_threshold'

export function getWorldRulesThreshold(): number {
  try {
    return clampTriggerThreshold(localStorage.getItem(THRESHOLD_STORAGE_KEY))
  } catch {
    return WORLD_RULES_TRIGGER_DEFAULT
  }
}

export function setWorldRulesThreshold(n: number): void {
  try {
    localStorage.setItem(THRESHOLD_STORAGE_KEY, String(clampTriggerThreshold(n)))
  } catch { /* 存储不可用时阈值回落默认，注入机制不受影响 */ }
}

/** 每会话一个触发器（会话隔离；量小不做 LRU，随页面生命周期存续） */
const sessionTriggers = new Map<string, WorldRulesTrigger>()

function triggerFor(sessionId: string): WorldRulesTrigger {
  let t = sessionTriggers.get(sessionId)
  if (!t) {
    t = new WorldRulesTrigger(getWorldRulesThreshold())
    sessionTriggers.set(sessionId, t)
  }
  // 用户改阈值实时生效（每次同步，省监听）
  t.setThreshold(getWorldRulesThreshold())
  return t
}

async function readTextOrNull(path: string): Promise<string | null> {
  try {
    const c = await invoke<string>('cmd_fs_read', { path })
    return c?.trim() ? c : null
  } catch {
    return null // 文件不存在（未配置）→ 跳过该层
  }
}

/** 双层 WORLD.md 合并读取（全局在前标注来源；单层/双层皆可） */
async function readWorldRulesMerged(workdir: string | null, rulesDir: string | null): Promise<string | null> {
  const parts: string[] = []
  if (rulesDir) {
    const g = await readTextOrNull(`${rulesDir}/WORLD.md`)
    if (g) parts.push(`【全局 WORLD.md】\n${g.trim()}`)
  }
  if (workdir) {
    const p = await readTextOrNull(`${workdir}/WORLD.md`)
    if (p) parts.push(`【项目 WORLD.md】\n${p.trim()}`)
  }
  return parts.length ? parts.join('\n\n') : null
}

/** WORLD.md 节奏注入选项（handleToolCall 出口组装） */
export interface WorldRulesAttachOptions {
  /** 当前会话 ID（计数器按会话隔离；缺失则跳过注入） */
  sessionId?: string
  /** 项目目录（项目级 WORLD.md 来源；未绑定 → 仅全局层） */
  workdir: string | null
  /** 全局规则目录 <app_data>/worldsmith/rules（未得 → 仅项目层） */
  rulesDir: string | null
  /** typeKey → 显示名映射（WORLD.md 分节标题匹配用） */
  typeLabels: Record<string, string>
}

/**
 * handleToolCall 出口调用：实体写工具成功时全局计数，满阈值把 WORLD.md 相关内容
 * 附加为结果对象的 `__world_rules` 字段。非实体写工具/失败/未触发原样返回。
 */
export async function attachWorldRulesIfTriggered(
  toolName: string,
  outJson: string,
  opts: WorldRulesAttachOptions,
): Promise<string> {
  if (!ENTITY_WRITE_TOOLS.has(toolName) || !opts.sessionId) return outJson

  let parsed: Record<string, unknown> | null = null
  try {
    parsed = JSON.parse(outJson) as Record<string, unknown>
  } catch {
    return outJson
  }
  if (!parsed || parsed.success !== true || parsed.error) return outJson
  const entityType = typeof parsed.type === 'string' ? parsed.type : ''
  if (!entityType) return outJson

  const triggeredTypes = triggerFor(opts.sessionId).bump(entityType)
  if (!triggeredTypes || triggeredTypes.length === 0) return outJson

  const merged = await readWorldRulesMerged(opts.workdir, opts.rulesDir)
  if (!merged) return outJson
  const labels = triggeredTypes.map((t) => opts.typeLabels[t]).filter(Boolean)
  const section = extractWorldRuleSections(merged, triggeredTypes, labels)
  if (!section) return outJson

  parsed.__world_rules =
    `【WORLD.md 规则提醒（节奏注入）】以下是 WORLD.md 中与本次操作实体类型` +
    `（${triggeredTypes.join('、')}）相关的固定规则，请继续遵循：\n\n${section}`
  return JSON.stringify(parsed)
}
