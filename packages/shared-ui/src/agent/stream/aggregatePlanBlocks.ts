// 过程层多级折叠树聚合（2026-09-04）：把 process 扁平行 → 嵌套块序列。
// 顺序无关——子动作行无论先于/交错于步骤行到达都归入所属块，修复「子动作平铺在步骤外」；
// 块在步骤行出现位置展示，块内子动作保持原始相对顺序。
//
// 嵌套结构（用户拍板的多级折叠树）：
//   plan_zone（区级折叠头，跟随首个待办项原位）→ plan_item（待办项文字折叠条）→ combination（组合行段）
//   combination（二级小折叠条）包裹连续非文本行段（think/tool）；text 行不入组合，独立直出。
import type { AgentStreamItem } from '@worldsea/shared-composables/agent/useAgent'

/** 计划步骤行（plan 类 tool 行：isPlanStep=true + 子动作 id 列表 + 折叠态 + 待办项扩展字段） */
export type PlanStepRow = AgentStreamItem & {
  type: 'tool'
  isPlanStep: true
  childRefIds?: string[]
  stepCollapsed?: boolean
  planStatus?: string
  planOrder?: number
  planDescription?: string
  planReason?: string
}

/** 组合行段（二级小折叠条）：包裹连续非文本行段（think/tool），遇 text/步骤行自动另起 */
export interface CombinationBlock {
  kind: 'combination'
  /** 合成折叠条形参（取组内首个子段行：提供稳定 id 供窗口化 key 使用） */
  col: AgentStreamItem
  rows: AgentStreamItem[]
}

/** 待办项（计划步骤折叠区内的项级折叠条）：头 = 序·状态·标题；rows = 子动作（含组合块/文本行） */
export interface PlanItemBlock {
  kind: 'plan_item'
  item: PlanStepRow
  rows: ProcessBlock[]
}

/** 计划步骤折叠区（区级折叠头，与过程层总折叠条同级但职责=待办项；跟随首个待办项原位） */
export interface PlanZoneBlock {
  kind: 'plan_zone'
  items: ProcessBlock[]
}

/** 过程层块：普通行 / 组合行段 / 待办项 / 计划折叠区 */
export type ProcessBlock = AgentStreamItem | CombinationBlock | PlanItemBlock | PlanZoneBlock

function isPlanStepRow(row: AgentStreamItem): row is PlanStepRow {
  return row.type === 'tool' && (row as { isPlanStep?: boolean }).isPlanStep === true
}

function isPlanItemBlock(b: ProcessBlock): b is PlanItemBlock {
  return (b as { kind?: string }).kind === 'plan_item'
}

/** 组合段成员：非文本动作行段（think/tool）；text / process_summary / divider / user 不入组合直出 */
function isComboRow(row: AgentStreamItem): boolean {
  return row.type === 'think' || row.type === 'tool'
}

/** 无计划步骤的纯组合：连续非文本行段（think/tool）攒成 combination 块，text 行独立直出 */
function combineSequence(rows: AgentStreamItem[]): ProcessBlock[] {
  const out: ProcessBlock[] = []
  let temp: AgentStreamItem[] = []
  const flush = () => {
    if (temp.length === 0) return
    // 2026-09-05 组合行段调整：单行不包组合头（消除「1 段执行」包一行的冗余头），≥2 段才组合
    if (temp.length === 1) {
      out.push(temp[0])
    } else {
      out.push({ kind: 'combination', col: temp[0], rows: temp })
    }
    temp = []
  }
  for (const row of rows) {
    if (!isComboRow(row)) {
      flush()
      out.push(row)
      continue
    }
    temp.push(row)
  }
  flush()
  return out
}

export function aggregatePlanBlocks(process: AgentStreamItem[]): ProcessBlock[] {
  // 第一遍：收集全部步骤行（isPlanStep）+ 完整 childRefIds；子动作 id → 所属步骤行 id
  const stepRowById = new Map<string, PlanStepRow>()
  const childToStep = new Map<string, string>()
  const planItemById = new Map<string, PlanItemBlock>()
  for (const row of process) {
    if (!isPlanStepRow(row)) continue
    stepRowById.set(row.id, row)
    planItemById.set(row.id, { kind: 'plan_item', item: row, rows: [] })
    for (const cid of row.childRefIds ?? []) {
      // 多步骤同子 id 取最先注册的步骤（确定性）
      if (!childToStep.has(cid)) childToStep.set(cid, row.id)
    }
  }
  if (stepRowById.size === 0) return combineSequence(process)

  // 第二遍：按原始顺序扫描——plan step 行 → plan_item 块（含子动作组合）；
  // 归属行抽入所属块（乱序先到时已预建）；连续非文本行攒组合段，遇 text/步骤行另起。
  const collectChildRows = (stepRow: PlanStepRow): AgentStreamItem[] => {
    const ids = new Set(stepRow.childRefIds ?? [])
    return process.filter((r) => ids.has(r.id))
  }
  const out: ProcessBlock[] = []
  let temp: AgentStreamItem[] = []
  const flushTemp = () => {
    if (temp.length === 0) return
    // 与 combineSequence 同规则：单行不包组合头（2026-09-05）
    if (temp.length === 1) {
      out.push(temp[0])
    } else {
      out.push({ kind: 'combination', col: temp[0], rows: temp })
    }
    temp = []
  }
  for (const row of process) {
    if (isPlanStepRow(row)) {
      flushTemp()
      // 子动作按 process 原始顺序收集（乱序/交错稳定），再组合（动作行段收进组合行段）
      const itemBlock = planItemById.get(row.id)!
      itemBlock.rows = combineSequence(collectChildRows(row))
      out.push(itemBlock)
      continue
    }
    if (childToStep.has(row.id)) continue // 归属行：已抽入所属待办项，不在顶层出现
    if (!isComboRow(row)) {
      flushTemp()
      out.push(row)
      continue
    }
    temp.push(row)
  }
  flushTemp()

  // 第三遍：有任一 plan step → 从首个待办项原位起包入单个 plan_zone 块（区级折叠头跟随原位）
  const firstPlanIdx = out.findIndex(isPlanItemBlock)
  if (firstPlanIdx < 0) return out
  return [...out.slice(0, firstPlanIdx), { kind: 'plan_zone', items: out.slice(firstPlanIdx) }]
}