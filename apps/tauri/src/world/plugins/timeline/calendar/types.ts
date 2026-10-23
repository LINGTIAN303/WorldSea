/**
 * 可自定义时间体系（历法）的类型定义。
 *
 * 设计口径：日期 = 单位链取值向量；所有排序/缩放/冲突/拖拽只消费标量。
 * 详细见 docs/details/注释/apps/tauri/world/timeline-calendar.md
 */

/** 日期确定度（模糊日期） */
export type Certainty = 'exact' | 'approx' | 'before' | 'after' | 'legend'

/** 命名单位的取值（如「第一纪元」「一月」） */
export interface NamedUnitValue {
  id: string
  name: string
  /** 该值覆盖的下一级单位数量；缺省用所属单位 factor；顶层末尾值可省略 = 无界 */
  length?: number
  /** 该值专属的周期闰（如二月闰日），按父级实例序号判断 */
  leap?: LeapRule
}

/** 周期闰：每 every 个父级实例，增加 add 个本级单位的子单位 */
export interface LeapRule {
  every: number
  add: number
  /** 从第几个父级实例开始算（1 起） */
  offset?: number
  /** 每 exceptEvery 个父级实例跳过 */
  exceptEvery?: number
  /** 但每 butEvery 个父级实例补回（公历 400 年规则） */
  butEvery?: number
}

/** 单位链中的一级 */
export interface CalendarUnit {
  id: string
  name: string
  kind: 'numeric' | 'named'
  /** 1 个本级单位 = factor 个下一级单位；最小单位省略 */
  factor?: number
  /** 数值单位的起始值（默认 1；时/分/秒建议 0） */
  start?: number
  /** 数值单位的显示数字样式（默认阿拉伯数字） */
  numeral?: 'arabic' | 'chinese'
  /** 命名值（有序） */
  values?: NamedUnitValue[]
  /** 周期闰（只能挂在非最小单位上） */
  leap?: LeapRule
  /** 显示片段，`{value}` 为取值占位 */
  format?: string
}

/** 周循环：只影响显示，不参与标量 */
export interface CalendarWeek {
  length: number
  names: string[]
  /** 「日」在单位链中的 id（缺省 day）；没有日单位时不计算星期 */
  dayUnit?: string
  /** 锚点标量（最小单位）与对应星期序号（0 起） */
  anchorScalar?: number
  anchorIndex?: number
}

/** 期段（王朝/时代/战争等命名区间，可嵌套） */
export interface CalendarPeriod {
  id: string
  name: string
  /** 规范文本起止（用所属历法解析） */
  start: string
  end: string
  parentId?: string
  color?: string
}

/** 历法（时间体系） */
export interface Calendar {
  id: string
  name: string
  /** 从大到小的单位链，至少 1 个；最后一个是标量基 */
  units: CalendarUnit[]
  week?: CalendarWeek
  /** 日以下时间：每天小时数；分/秒固定 60 进制 */
  timeOfDay?: { hoursPerDay: number }
  /** 全日期显示模板（`{0}`/`{1}`… 引用单位）；缺省按单位 format 拼接 */
  format?: string
  periods?: CalendarPeriod[]
  updatedAt?: number
}

/** 日期值（持久化时只存规范文本；运行时解析成此结构） */
export interface TimePoint {
  calendarId: string
  /** 与 units 对齐；命名单位存值 id，数值单位存 number；长度 = 精度 */
  values: (number | string)[]
  certainty: Certainty
  /** 原文（解析失败/手工输入保留） */
  raw?: string
}

/** 已解析标量的日期 */
export interface ResolvedTimePoint extends TimePoint {
  scalar: number
}

/** 解析结果 */
export interface ParseResult {
  point: TimePoint
  /** 实际解析到的最高层级（0 起）；用于区分「未写纪元」与「写了第一纪元」 */
  parsedLevels: number[]
  /** 未解析的尾部文本，保留供排查 */
  rest?: string
}

/** 历法校验错误 */
export interface CalendarError {
  path: string
  message: string
}

/** 周期规则（存 JSON 字段，工具内部结构） */
export interface RecurrenceRule {
  /** 单位 id，如 'year' / 'month' / 'day' */
  unit: string
  /** 间隔（>=1） */
  every: number
  /** 结束日期（规范文本，含） */
  until?: string
  /** 跳过列表（规范文本） */
  exceptions?: string[]
  /** 最多展开次数（防御） */
  limit?: number
}

/** 用默认值补全一个时间点 */
export function makePoint(
  calendarId: string,
  values: (number | string)[],
  certainty: Certainty = 'exact',
): TimePoint {
  return { calendarId, values, certainty }
}
