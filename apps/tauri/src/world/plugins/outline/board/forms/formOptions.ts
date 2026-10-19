/**
 * forms/formOptions —— 表现形式配置的共享选项常量
 *
 * 2026-10-19（信息密度增强批）：`initializeForms` 拆分为内容型 / 聚合型时抽出。
 * 编号与范围两类选项被两边的形式共用，集中在这里避免各写一份。
 */
import type { NumberingStyle } from './titleNumbering'

export const NUMBERING_OPTIONS: Array<{ value: NumberingStyle; label: string }> = [
  { value: 'none', label: '无编号' },
  { value: 'numeric', label: '数字 1.2.3' },
  { value: 'chinese', label: '中文 一、（一）' },
  { value: 'roman', label: '罗马 I、II' },
]

/** 统计类形式共用的范围选项（口径：`this` = 本节点 + 其子树，**含自身**） */
export const SCOPE_OPTIONS = [
  { value: 'all', label: '全部节点' },
  { value: 'this', label: '本节点及子树' },
]

/** 通用数量上限（线索分组 / 关联实体分组等） */
export const COUNT_LIMIT_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: '3', label: '3' },
  { value: '5', label: '5' },
  { value: '10', label: '10' },
]

/** 线索行数上限（允许到 20） */
export const LINE_LIMIT_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: '5', label: '5' },
  { value: '10', label: '10' },
  { value: '20', label: '20' },
]
