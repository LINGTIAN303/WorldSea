// 计划步骤块聚合（A，2026-09-04）：把 process 扁平行 → 块序列。
// 顺序无关——子动作行无论先于/交错于步骤行到达都归入所属块，修复「子动作平铺在步骤外」；
// 块在步骤行出现位置展示，块内子动作保持原始相对顺序。
import type { AgentStreamItem } from '@worldsmith/shared-composables/agent/useAgent'

/** 过程层块：普通行 或 计划步骤块（_step=步骤头行，_children=步骤内子动作） */
export type ProcessBlock =
  | AgentStreamItem
  | { id: string; _step: AgentStreamItem; _children: AgentStreamItem[] }

export function aggregatePlanBlocks(process: AgentStreamItem[]): ProcessBlock[] {
  // 第一遍：收集全部步骤行（isPlanStep）+ 完整 childRefIds；子动作 id → 所属步骤行 id
  const stepRowById = new Map<string, AgentStreamItem & { isPlanStep: true; childRefIds?: string[] }>()
  const childToStep = new Map<string, string>()
  for (const row of process) {
    if (row.type !== 'tool' || !(row as { isPlanStep?: boolean }).isPlanStep) continue
    const srow = row as AgentStreamItem & { isPlanStep: true; childRefIds?: string[] }
    stepRowById.set(row.id, srow)
    for (const cid of srow.childRefIds ?? []) {
      // 多步骤同子 id 取最先注册的步骤（确定性）
      if (!childToStep.has(cid)) childToStep.set(cid, row.id)
    }
  }
  // 第二遍前置：为所有步骤行预建块——保证乱序子动作先到时块已存在
  const blockByStep = new Map<string, ProcessBlock & { _step: AgentStreamItem; _children: AgentStreamItem[] }>()
  for (const [sid, srow] of stepRowById) {
    blockByStep.set(sid, { id: `step-${sid}`, _step: srow, _children: [] })
  }
  // 第三遍：按原始顺序组装——步骤行处输出其块，普通行命中子映射则归入，其余直出
  const blocks: ProcessBlock[] = []
  for (const row of process) {
    if (row.type === 'tool' && stepRowById.has(row.id)) {
      blocks.push(blockByStep.get(row.id)!)
      continue
    }
    const ownedBy = childToStep.get(row.id)
    const sb = ownedBy ? blockByStep.get(ownedBy) : undefined
    if (sb) {
      sb._children.push(row)
      continue
    }
    blocks.push(row as unknown as ProcessBlock)
  }
  return blocks
}